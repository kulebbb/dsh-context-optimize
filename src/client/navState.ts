/**
 * 侧边栏入口的状态源：正在分析、有新报告没看、上次分析失败。
 *
 * 侧边栏一直在屏幕上，所以这个 store 由客户端入口创建、活到插件卸载：
 * - 运行中每 2 秒问一次状态，空闲每 20 秒问一次（覆盖「另一个窗口发起分析」）；
 * - 页面切到后台时降速到 20 秒一次，回到前台立刻补一次；
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

/** 存「已关闭的失败提示」的键；值是被关掉的那次运行 id。 */
const DISMISSED_KEY = 'dsh-context-optimize:dismissed-insight-failure'

/** 读回上次关掉的失败提示；没有或不支持 sessionStorage 时返回 null。 */
function readDismissed(): string | null {
  try {
    return globalThis.sessionStorage?.getItem(DISMISSED_KEY) ?? null
  } catch {
    return null
  }
}

/** 记住关掉的失败提示。 */
function writeDismissed(runId: string): void {
  try {
    globalThis.sessionStorage?.setItem(DISMISSED_KEY, runId)
  } catch {
    // 存不进去就只在本次进程内有效，不影响主流程。
  }
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
  /**
   * 用户看到了某一次失败时调用。
   *
   * `runId` 必填：只有知道「看的是哪一次」，才不会把后来发生的一次失败一起吞掉。
   */
  clearFailed(runId: string): void
  /** 手动补一次状态（面板刷新后调用，省一次轮询等待）。 */
  refresh(): void
  /** 面板刚发起一次分析：立刻亮起「运行中」，别等下一轮轮询。 */
  noteRunStarted(): void
  dispose(): void
}

/** 模块单例：侧边栏组件靠它拿状态，避免把 store 塞进槽位 props。 */
let current: InsightNavStore | null = null

/** 全局订阅者：store 被替换或销毁时也要让图标重渲染。 */
const globalListeners = new Set<() => void>()

function notifyGlobal(): void {
  for (const listener of globalListeners) listener()
}

/**
 * 侧边栏组件用的稳定订阅函数。
 *
 * 组件在渲染期读模块单例会绑定到「当时那个 store」（首次为 null、热更新会换掉），
 * 所以对外只暴露这两个身份稳定的函数，内部再委托给当前 store。
 */
export function navSubscribe(listener: () => void): () => void {
  globalListeners.add(listener)
  return () => globalListeners.delete(listener)
}

/** 侧边栏组件用的稳定快照函数。 */
export function navGetSnapshot(): InsightNavState {
  return current?.getSnapshot() ?? INITIAL
}

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
  let dismissedFailure: string | null = readDismissed()
  /** 已经统计过的那份报告；换了 id 说明有新的报告生成。 */
  let lastSeenReportId: string | null = null

  const emit = (next: InsightNavState): void => {
    if (sameState(state, next)) return
    state = next
    for (const listener of listeners) listener()
    notifyGlobal()
  }

  const schedule = (delay: number): void => {
    if (disposed) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      void tick()
    }, delay)
    timer.unref?.()
  }

  /** 历史请求的序号：只接受最新一次的响应，避免先发后到把新值盖回去。 */
  let historySeq = 0

  const refreshHistory = async (): Promise<void> => {
    const seq = (historySeq += 1)
    const history = await api.insightHistory().catch(() => null)
    if (history === null || disposed || seq !== historySeq) return
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
    } else if (!running) {
      // 空闲时也隔一轮拉一次历史：另一个窗口标已读或删了报告，这里的点要跟着消失。
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
      // 先把「已读」写进宿主，再拉历史：否则 GET 可能读到写入前的索引，
      // 蓝点就要等到下一次有新报告才消失。
      if (state.unread > 0) emit({ ...state, unread: state.unread - 1 })
      void api
        .insightRead(id)
        .catch(() => undefined)
        .then(() => refreshHistory())
    },
    clearFailed(runId) {
      dismissedFailure = runId
      writeDismissed(runId)
      emit({ ...state, failed: false })
    },
    refresh() {
      void tick()
      void refreshHistory()
    },
    noteRunStarted() {
      emit({ running: true, unread: state.unread, failed: false })
      // 立刻排一轮快轮询，让进度和「跑完变未读」都跟上。
      schedule(RUNNING_INTERVAL_MS)
    },
    dispose() {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility)
      listeners.clear()
      if (current === store) current = null
      notifyGlobal()
    },
  }

  current = store
  void tick()
  void refreshHistory()
  return store
}
