/**
 * 采集层：过滤器、事件折叠、摘要预算、语料统计。
 *
 * 所有用例只构造内存事件，不读磁盘、不调模型。
 */
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DIGEST_BUDGET,
  collectCorpus,
  foldSession,
  isHumanSession,
  projectNameOf,
  toLocalDateKey,
} from '../src/host/insight/collect.ts'
import type { SessionHeaderLike, SessionSource } from '../src/host/insight/collect.ts'

/** 人工会话头。 */
function humanHeader(id: string, createdAt = Date.now()): SessionHeaderLike {
  return { id, cwd: '/repo/demo', createdAt }
}

/** 一条你的消息。 */
function userEvent(seq: number, text: string, kind = 'user'): unknown {
  return { type: 'user/message', seq, time: 1000 + seq, data: { content: [{ type: 'text', text }], source: { kind } } }
}

/** 一条助手消息。 */
function assistantEvent(
  seq: number,
  text: string,
  usage: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } = {},
): unknown {
  return {
    type: 'assistant/message',
    seq,
    time: 1000 + seq,
    data: {
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model', provider: 'magpie', model: 'demo-model' },
      },
      usage,
    },
  }
}

/** 一次工具调用。 */
function toolCallEvent(seq: number, callId: string, name: string): unknown {
  return { type: 'tool/call', seq, time: 1000 + seq, data: { callId, name, arguments: '{}' } }
}

/** 命令结束事件；detail 用来判断退出码。 */
function jobSettledEvent(seq: number, callId: string, status: string, detail: string, label = 'pnpm test'): unknown {
  return { type: 'job/settled', seq, time: 1000 + seq, data: { status, detail, label, toolCall: { callId } } }
}

/** 工具结果，带任意 meta。 */
function toolResultEvent(seq: number, callId: string, meta: Record<string, unknown>): unknown {
  return { type: 'tool/result', seq, time: 1000 + seq, data: { toolCallId: callId, meta } }
}

/** 组装一个完整会话。 */
function fullSessionEvents(): unknown[] {
  return [
    { type: 'turn/start', seq: 1, time: 1000, data: { turn: 1 } },
    userEvent(2, '把导出按钮改成图标'),
    { type: 'step/end', seq: 3, time: 1000, data: { turn: 1, step: 1 } },
    assistantEvent(4, '先看现有实现', { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40 }),
    toolCallEvent(5, 'c1', 'read'),
    toolCallEvent(6, 'c2', 'bash'),
    jobSettledEvent(7, 'c2', 'completed', 'exit code: 2'),
    toolResultEvent(8, 'c1', { path: '/repo/demo/src/a.tsx', offset: 0, lines: 40, totalLines: 40 }),
    toolCallEvent(9, 'c3', 'edit'),
    toolResultEvent(15, 'c3', { path: '/repo/demo/src/a.tsx', diffs: [] }),
    { type: 'step/end', seq: 9, time: 1000, data: { turn: 1, step: 2 } },
    userEvent(10, '顺便把标题也改了', 'runtime-context'),
    userEvent(11, '再补一个测试'),
    assistantEvent(12, '改完了', { inputTokens: 50, outputTokens: 10 }),
    { type: 'step/end', seq: 13, time: 1000, data: { turn: 1, step: 3 } },
    { type: 'session/title', seq: 14, time: 1000, data: { title: '导出按钮改图标' } },
  ]
}

describe('isHumanSession', () => {
  it('普通会话算人工会话', () => {
    expect(isHumanSession(humanHeader('a'))).toBe(true)
  })

  it('子代理会话不算', () => {
    expect(isHumanSession({ ...humanHeader('a'), parentSession: 'p' })).toBe(false)
    expect(isHumanSession({ ...humanHeader('a'), origin: 'subagent' })).toBe(false)
    expect(isHumanSession({ ...humanHeader('a'), delegationDepth: 1 })).toBe(false)
  })

  it('由父会话播种出来的会话不算', () => {
    expect(isHumanSession({ ...humanHeader('a'), isSeeded: true })).toBe(false)
  })
})

describe('projectNameOf', () => {
  it('取路径最后一段', () => {
    expect(projectNameOf('/a/b/c')).toBe('c')
    expect(projectNameOf('/a/b/')).toBe('b')
  })

  it('空路径给 unknown', () => {
    expect(projectNameOf(null)).toBe('unknown')
    expect(projectNameOf('')).toBe('unknown')
  })
})

describe('foldSession', () => {
  it('只把 source.kind=user 的消息算成你的消息', () => {
    const { digest } = foldSession(humanHeader('s1'), fullSessionEvents())
    expect(digest.userMessages).toBe(2)
  })

  it('累计轮次、步数、工具调用与失败', () => {
    const { digest, toolCounts, toolFailures } = foldSession(humanHeader('s1'), fullSessionEvents())
    expect(digest.turns).toBe(1)
    expect(digest.steps).toBe(3)
    expect(digest.toolCalls).toBe(3)
    expect(digest.toolFailures).toBe(1)
    expect(toolCounts.get('bash')).toBe(1)
    expect(toolFailures.get('bash')).toBe(1)
  })

  it('累计 token 用量与模型名', () => {
    const { digest } = foldSession(humanHeader('s1'), fullSessionEvents())
    expect(digest.inputTokens).toBe(150)
    expect(digest.outputTokens).toBe(30)
    expect(digest.cacheReadTokens).toBe(40)
    expect(digest.models).toEqual(['magpie/demo-model'])
  })

  it('记录改动过的文件数与标题', () => {
    const { digest } = foldSession(humanHeader('s1'), fullSessionEvents())
    expect(digest.filesTouched).toBe(1)
    expect(digest.title).toBe('导出按钮改图标')
  })

  it('按工具名统计改动文件：edit 计入、read 不计入、apply_patch 用 diffs 的路径', () => {
    const events = [
      toolCallEvent(1, 'a', 'read'),
      toolResultEvent(2, 'a', { path: '/x/read.ts', offset: 0, lines: 10, totalLines: 10 }),
      toolCallEvent(3, 'b', 'edit'),
      toolResultEvent(4, 'b', { path: '/x/edit.ts', diffs: [] }),
      toolCallEvent(5, 'c', 'apply_patch'),
      toolResultEvent(6, 'c', { diffs: [{ path: '/x/p1.ts' }, { path: '/x/p2.ts' }], stopped: false }),
      toolCallEvent(7, 'd', 'write'),
      toolResultEvent(8, 'd', { operation: 'create', path: '/x/new.ts', diffs: [] }),
    ]
    const { digest } = foldSession(humanHeader('s1'), events)
    expect(digest.filesTouched).toBe(4)
  })

  it('工具自身报错也算失败，并与 job 的退出码按 callId 去重', () => {
    const events = [
      toolCallEvent(1, 'c1', 'edit'),
      {
        type: 'tool/result',
        seq: 2,
        time: 1002,
        data: { toolCallId: 'c1', message: { role: 'tool', isError: true }, meta: { path: '/x' } },
      },
      jobSettledEvent(3, 'c1', 'completed', 'exit code: 1'),
    ]
    const { digest, toolFailures } = foldSession(humanHeader('s1'), events)
    expect(digest.toolFailures).toBe(1)
    expect(toolFailures.get('edit')).toBe(1)
  })

  it('摘要里带上项目、你的话、失败命令', () => {
    const { digest } = foldSession(humanHeader('s1'), fullSessionEvents())
    expect(digest.digest).toContain('项目：demo')
    expect(digest.digest).toContain('把导出按钮改成图标')
    expect(digest.digest).toContain('失败：')
    expect(digest.digest).toContain('exit code: 2')
  })

  it('超出预算时截断并标注', () => {
    const events = [userEvent(1, '长'.repeat(500))]
    const { digest } = foldSession(humanHeader('s1'), events, {
      ...DEFAULT_DIGEST_BUDGET,
      userChars: 20,
      maxChars: 60,
    })
    expect(digest.digest.length).toBeLessThanOrEqual(70)
    expect(digest.digest).toContain('已截断')
  })

  it('同一份事件两次折叠得到相同摘要哈希', () => {
    const a = foldSession(humanHeader('s1'), fullSessionEvents()).digest.digestHash
    const b = foldSession(humanHeader('s1'), fullSessionEvents()).digest.digestHash
    expect(a).toBe(b)
  })
})

describe('collectCorpus', () => {
  const now = new Date('2026-11-17T12:00:00+08:00')

  function sourceOf(sessions: Record<string, unknown[]>): SessionSource {
    const headers = Object.keys(sessions).map((id, index) => ({
      header: { ...humanHeader(id, now.getTime() - index * 1000), ...(id.startsWith('sub') ? { origin: 'subagent' } : {}) },
      live: false,
    }))
    return {
      listSessions: async () => headers,
      readSession: async (id) => ({ events: sessions[id] ?? [] }),
    }
  }

  it('排除子代理与超窗会话', async () => {
    const source: SessionSource = {
      listSessions: async () => [
        { header: { id: 'human', cwd: '/r/a', createdAt: now.getTime() - 1000 }, live: false },
        { header: { id: 'sub', cwd: '/r/a', createdAt: now.getTime() - 1000, origin: 'subagent' }, live: false },
        { header: { id: 'old', cwd: '/r/a', createdAt: now.getTime() - 60 * 86_400_000 }, live: false },
      ],
      readSession: async () => ({ events: [] }),
    }
    const result = await collectCorpus({ source, days: 30, now: () => now })
    expect(result.stats.sessions).toBe(1)
    expect(result.stats.excludedSubagent).toBe(1)
    expect(result.stats.excludedOld).toBe(1)
  })

  it('days=null 时不按时间过滤', async () => {
    const source: SessionSource = {
      listSessions: async () => [
        { header: { id: 'old', cwd: '/r/a', createdAt: now.getTime() - 400 * 86_400_000 }, live: false },
      ],
      readSession: async () => ({ events: [] }),
    }
    const result = await collectCorpus({ source, days: null, now: () => now })
    expect(result.stats.sessions).toBe(1)
    expect(result.stats.excludedOld).toBe(0)
  })

  it('聚合项目、工具与时段分布', async () => {
    const source = sourceOf({
      a: [userEvent(1, '一'), toolCallEvent(2, 'c1', 'read')],
      b: [userEvent(1, '二'), toolCallEvent(2, 'c2', 'read'), toolCallEvent(3, 'c3', 'bash')],
    })
    const result = await collectCorpus({ source, days: null, now: () => now })
    expect(result.projects[0]?.name).toBe('demo')
    expect(result.projects[0]?.sessions).toBe(2)
    expect(result.tools[0]).toEqual({ name: 'read', calls: 2, failures: 0 })
    expect(result.hours.reduce((sum, item) => sum + item.sessions, 0)).toBe(2)
  })

  it('超过单次上限时按时间保留最新的并计数', async () => {
    const source: SessionSource = {
      listSessions: async () =>
        Array.from({ length: 5 }, (_unused, index) => ({
          header: { id: `s${String(index)}`, cwd: '/r/a', createdAt: now.getTime() - index * 1000 },
          live: false,
        })),
      readSession: async () => ({ events: [] }),
    }
    const result = await collectCorpus({ source, days: null, now: () => now, maxSessions: 3 })
    expect(result.stats.sessions).toBe(3)
    expect(result.stats.excludedCapped).toBe(2)
    expect(result.sessions[0]?.id).toBe('s0')
  })

  it('活跃天数按本地自然日去重', async () => {
    const day = 86_400_000
    const source: SessionSource = {
      listSessions: async () => [
        { header: { id: 'a', cwd: '/r/a', createdAt: now.getTime() - day }, live: false },
        { header: { id: 'b', cwd: '/r/a', createdAt: now.getTime() - day + 5000 }, live: false },
        { header: { id: 'c', cwd: '/r/a', createdAt: now.getTime() - 2 * day }, live: false },
      ],
      readSession: async () => ({ events: [] }),
    }
    const result = await collectCorpus({ source, days: null, now: () => now })
    expect(result.stats.activeDays).toBe(2)
    expect(toLocalDateKey(now.getTime() - day)).not.toBe(toLocalDateKey(now.getTime() - 2 * day))
  })
})
