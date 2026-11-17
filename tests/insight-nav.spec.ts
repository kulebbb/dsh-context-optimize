/**
 * 侧边栏状态：未读统计、运行/失败/已读的流转。
 *
 * 不碰真实网络和时间：假 api 直接返回构造好的载荷，轮询靠手动 refresh 触发。
 */
import { afterEach, describe, expect, it } from 'vitest'
import { createInsightNavStore, unreadCountOf } from '../src/client/navState.ts'
import type { ContextOptimizeApi } from '../src/client/api.ts'
import type { InsightHistoryEntry, InsightStatusPayload } from '../src/shared/insight.ts'

/** 一条历史记录；默认未读。 */
function entryOf(id: string, options: { status?: InsightHistoryEntry['status']; readAt?: string | null } = {}): InsightHistoryEntry {
  return {
    id,
    startedAt: '2026-11-17T16:20:00.000Z',
    finishedAt: '2026-11-17T16:24:00.000Z',
    status: options.status ?? 'done',
    days: 30,
    sessions: 3,
    tokens: 100,
    provider: 'p',
    model: 'm',
    durationMs: 240_000,
    failedSessions: 0,
    readAt: options.readAt ?? null,
  }
}

/** 状态载荷。 */
function statusOf(overrides: Partial<InsightStatusPayload> = {}): InsightStatusPayload {
  return {
    status: 'idle',
    runId: null,
    phases: [],
    current: null,
    startedAt: null,
    elapsedMs: 0,
    error: null,
    reportId: null,
    ...overrides,
  }
}

interface FakeApi extends ContextOptimizeApi {
  readonly reads: string[]
}

/** 只实现状态与历史两条路由的假 api。 */
function makeApi(init: { status: InsightStatusPayload; entries: InsightHistoryEntry[] }): FakeApi {
  const reads: string[] = []
  const api = {
    reads,
    insightStatus: async () => init.status,
    insightHistory: async () => ({ entries: init.entries, running: init.status.status === 'running' }),
    insightRead: async (id: string) => {
      reads.push(id)
      init.entries = init.entries.map((entry) => (entry.id === id ? { ...entry, readAt: '2026-11-17T18:00:00.000Z' } : entry))
      return { ok: true } as const
    },
  } as unknown as FakeApi
  return api
}

/** 等一轮微任务，让 store 里那串 await 落地。 */
async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
  await new Promise((resolve) => setTimeout(resolve, 0))
}

const stores: { dispose(): void }[] = []

afterEach(() => {
  for (const store of stores.splice(0)) store.dispose()
})

function start(api: FakeApi) {
  const store = createInsightNavStore(api)
  stores.push(store)
  return store
}

describe('unreadCountOf', () => {
  it('只数成功生成、还没看过的报告', () => {
    expect(
      unreadCountOf([
        entryOf('a'),
        entryOf('b', { readAt: '2026-11-17T18:00:00.000Z' }),
        entryOf('c', { status: 'failed' }),
        entryOf('d', { status: 'cancelled' }),
      ]),
    ).toBe(1)
  })
})

describe('createInsightNavStore', () => {
  it('启动时就统计出未读数', async () => {
    const api = makeApi({ status: statusOf(), entries: [entryOf('a'), entryOf('b')] })
    const store = start(api)
    await settle()
    expect(store.getSnapshot().unread).toBe(2)
    expect(store.getSnapshot().running).toBe(false)
  })

  it('运行中会亮起 running，跑完自动把新报告算进未读', async () => {
    const api = makeApi({ status: statusOf(), entries: [] })
    const store = start(api)
    await settle()

    // 宿主进入运行中
    api.insightStatus = async () => statusOf({ status: 'running', runId: 'r1' })
    store.refresh()
    await settle()
    expect(store.getSnapshot().running).toBe(true)

    // 跑完，历史里多了一份未读
    api.insightStatus = async () => statusOf({ status: 'done', runId: 'r1', reportId: 'r1' })
    api.insightHistory = async () => ({ entries: [entryOf('r1')], running: false })
    store.refresh()
    await settle()

    const snapshot = store.getSnapshot()
    expect(snapshot.running).toBe(false)
    expect(snapshot.unread).toBe(1)
  })

  it('报告显示后调 noteReportShown，未读数归零并写回宿主', async () => {
    const api = makeApi({ status: statusOf(), entries: [entryOf('a')] })
    const store = start(api)
    await settle()
    expect(store.getSnapshot().unread).toBe(1)

    store.noteReportShown('a')
    await settle()
    expect(api.reads).toEqual(['a'])
    expect(store.getSnapshot().unread).toBe(0)
  })

  it('失败提示只在用户没看过的那一次运行上出现，关掉后不会再冒出来', async () => {
    const api = makeApi({ status: statusOf({ status: 'failed', runId: 'r1', error: 'boom' }), entries: [] })
    const store = start(api)
    await settle()
    expect(store.getSnapshot().failed).toBe(true)

    // 用户打开了面板：这一轮的失败不再提示
    store.clearFailed()
    await settle()
    expect(store.getSnapshot().failed).toBe(false)

    // 再轮询一次，还是那次失败，不该重新亮起
    store.refresh()
    await settle()
    expect(store.getSnapshot().failed).toBe(false)

    // 换了一次运行（不同 runId）就重新提示
    api.insightStatus = async () => statusOf({ status: 'failed', runId: 'r2', error: 'boom' })
    store.refresh()
    await settle()
    expect(store.getSnapshot().failed).toBe(true)
  })

  it('同一个状态反复轮询不会反复通知订阅者', async () => {
    const api = makeApi({ status: statusOf(), entries: [entryOf('a', { readAt: '2026-11-17T18:00:00.000Z' })] })
    const store = start(api)
    await settle()

    let calls = 0
    store.subscribe(() => {
      calls += 1
    })
    for (let i = 0; i < 5; i += 1) {
      store.refresh()
      await settle()
    }
    expect(calls).toBe(0)
  })
})
