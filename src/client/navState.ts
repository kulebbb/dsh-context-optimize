/**
 * 侧边栏入口的状态源：正在分析、有新报告没看、上次分析失败。
 *
 * 侧边栏一直在屏幕上，所以这个 store 由客户端入口创建、活到插件卸载：
 * - 运行中每 2 秒问一次状态，空闲每 20 秒问一次（覆盖「另一个窗口发起分析」）；
 * - 页面切到后台时停表，回来立刻补一次；
 * - 「未读」以宿主索引为准（`readAt === null`），不是浏览器本地状态，重启和多窗口都一致；
 * - 「失败」只在本进程内有效，用户打开洞察面板就清掉（宿主那边的失败状态本身也在内存里）。
 */
import type { ContextOptimizeApi } from './api.ts'
import type { InsightHistoryEntry, InsightStatusPayload } from '../shared/insight.ts'

/** 运行中轮询间隔。 */
const RUNNING_INTERVAL_MS = 2_000
/** 空闲轮询间隔。 */
const IDLE_INTERVAL_MS = 20_000

/** 侧边栏入口要的三种状态。 */
export interface InsightNavState {
  readonly running: boolean
  /** 已生成但还没看过的报告数；0 表示没有未读。 */
  readonly unread: number
  /** 最近一次分析失败，且用户还没去看。 */
  readonly failed: boolean
}

const INITIAL: InsightNavState = { running: false, unread: 0, failed: false }

/** 统计未读数：只看成功生成、且没有已读时间的报告。 */
export function unreadCountOf(entries: readonly InsightHistoryEntry[]): number {
  let count = 0
  for (const entry of entries) {
    if (entry.status === 'done' && entry.readAt === null) count += 1
  }
  return count
}

/** 状态变更时是否值得重渲染侧边栏。 */
function sameState(a: InsightNavState, b: InsightNavState): boolean {
  return a.running === b.running && a.unread === b.unread && a.failed === b.failed
}

export interface InsightNavStore {
  /** useSyncExternalStore 用。 */
  getSnapshot(): InsightNavState
  subscribe(listener: () => void): () => void
  /** 报告显示到屏幕上时调用：标已读并刷新未读数。 */
  noteReportShown(id: string): void
  /** 用户看到了某一次失败时调用；传那次运行的 id，避免把后来的一次也一起吞掉。 */
  clearFailed(runId?: string | null): void
  /** 手动补一次状态（面板刷新后调用，省一次轮询等待）。 */
  refresh(): void
  dispose(): void
}

/** 模块单例：侧边栏组件靠它拿状态，避免把 store 塞进槽位 props。 */
let current: InsightNavStore | null = null

/** 侧边栏组件读取当前 store；没有则返回 null（此时只画静默图标）。 */
export function getInsightNavStore(): InsightNavStore | null {
  return current
}

/**
 * 建一个 store 并开始轮询。
 *
 * @param api - 客户端远程接口；插件卸载时通过返回的 dispose 停表。
 */
export function createInsightNavStore(api: ContextOptimizeApi): InsightNavStore {
  let state: InsightNavState = INITIAL
  const listeners = new Set<() => void>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let inFlight = false
  /** 已经看过、被用户关掉提示的那次失败；换一次运行才会重新提示。 */
  let dismissedFailure: string | null = null
  /** 最近一次问到的运行 id，用来记住「哪一次失败已经被关掉」。 */
  let lastRunId: string | null = null
  /** 已经统计过的那份报告；换了 id 说明有新的报告生成。 */
  let lastSeenReportId: string | null = null

  const emit = (next: InsightNavState): void => {
    if (sameState(state, next)) return
    state = next
    for (const listener of listeners) listener()
  }

  const schedule = (delay: number): void => {
    if (disposed) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      void tick()
    }, delay)
    timer.unref?.()
  }

  const refreshHistory = async (): Promise<void> => {
    const history = await api.insightHistory().catch(() => null)
    if (history === null || disposed) return
    emit({ ...state, unread: unreadCountOf(history.entries) })
  }

  const tick = async (): Promise<void> => {
    if (disposed) return
    if (typeof document !== 'undefined' && document.hidden) {
      schedule(IDLE_INTERVAL_MS)
      return
    }
    if (inFlight) return
    inFlight = true
    let status: InsightStatusPayload | null = null
    try {
      status = await api.insightStatus()
    } catch {
      status = null
    } finally {
      inFlight = false
    }
    if (disposed) return
    const running = status?.status === 'running'
    const reportId = status?.reportId ?? null
    if (status !== null) {
      lastRunId = status.runId ?? lastRunId
      emit({
        running,
        unread: state.unread,
        failed: status.status === 'failed' && status.runId !== dismissedFailure,
      })
    }
    // 出现新的报告 id 就刷新一次未读：即使中途没看到「运行中」，也能亮起未读点。
    if (reportId !== null && reportId !== lastSeenReportId) {
      lastSeenReportId = reportId
      await refreshHistory()
    }
    schedule(running ? RUNNING_INTERVAL_MS : IDLE_INTERVAL_MS)
  }

  const onVisibility = (): void => {
    if (typeof document === 'undefined' || disposed) return
    if (!document.hidden) void tick()
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', onVisibility)
  }

  const store: InsightNavStore = {
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    noteReportShown(id) {
      void api.insightRead(id).catch(() => undefined)
      void refreshHistory()
    },
    clearFailed(runId) {
      dismissedFailure = runId ?? lastRunId
      emit({ ...state, failed: false })
    },
    refresh() {
      void tick()
      void refreshHistory()
    },
    dispose() {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      listeners.clear()
      if (current === store) current = null
    },
  }

  current = store
  void tick()
  void refreshHistory()
  return store
}
