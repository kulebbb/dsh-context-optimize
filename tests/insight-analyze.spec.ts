/**
 * 模型层：流解析、输出上限、汇总 JSON 的编号映射。
 *
 * 真截断（maxTokens 打满）在这里用假的 finish 原因模拟，不触网。
 */
import { describe, expect, it } from 'vitest'
import {
  InsightModelError,
  InsightTimeoutError,
  InsightTruncatedError,
  aggregateReport,
  complete,
  extractJsonObject,
  labelSession,
  outputLimitOf,
  shouldRetry,
} from '../src/host/insight/analyze.ts'
import type { AggregateInput, LlmLike } from '../src/host/insight/analyze.ts'
import type { InsightFacet, InsightSessionDigest } from '../src/shared/insight.ts'

const SELECTION = { provider: 'p', model: 'm' }

/** 调用记录：用来断言预算怎么变。 */
interface Trace {
  readonly maxTokens: number[]
}

/** 把一串 chunk 变成 llm。 */
function llmOf(chunks: readonly unknown[], trace: Trace = { maxTokens: [] }): LlmLike {
  return {
    stream(options) {
      if (options.maxTokens !== undefined) trace.maxTokens.push(options.maxTokens)
      return (async function* generate() {
        for (const chunk of chunks) yield chunk
      })()
    },
  }
}

/** 据报道 JSON 的一串 chunk。 */
function jsonChunks(payload: unknown, reason: unknown = { kind: 'stop' }): unknown[] {
  return [
    { type: 'text-delta', text: JSON.stringify(payload) },
    { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } },
    { type: 'finish', reason },
  ]
}

/** 一次会话摘要。 */
function digestOf(id: string): InsightSessionDigest {
  const at = Date.parse('2026-11-10T10:00:00+08:00')
  return {
    id,
    title: `会话 ${id}`,
    project: 'demo',
    createdAt: at,
    updatedAt: at,
    turns: 2,
    steps: 4,
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 3,
    toolFailures: 0,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    filesTouched: 1,
    models: ['m'],
    lastSeq: 10,
    digest: `会话 ${id} 的摘要`,
    digestHash: `hash-${id}`,
  }
}

/** 一份标签。 */
function facetOf(goal: string): InsightFacet {
  return { goal, outcome: '完成', sessionType: '调试', frictions: [], wins: [], summary: '一句话' }
}

/** 汇总输入。 */
function inputsOf(ids: readonly string[]): AggregateInput[] {
  return ids.map((id) => ({ session: digestOf(id), facet: facetOf(`目标 ${id}`) }))
}

const STATS = { sessions: 3, messages: 3, toolCalls: 9, projects: 1 }

/** 汇总 JSON 的最小骨架，按需覆盖字段。 */
function aggregateJson(frictions: readonly unknown[] = []): unknown {
  return {
    glance: { working: '先写约束', friction: '需求分几次说', next: '加一条复述规则' },
    frictions,
    wins: [{ title: '先写约束', detail: '返工更少' }],
    suggestions: [{ title: '先复述再动手', detail: '确认后再改', where: 'agents', snippet: '先复述目标' }],
    fun: '凌晨两点还在改树',
  }
}

describe('complete', () => {
  it('截断不在这里抛错，只把标记交出去（文本可能是完整 JSON）', async () => {
    const llm = llmOf([
      { type: 'text-delta', text: '{"a":1}' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ])
    await expect(complete(llm, SELECTION, { system: 's', prompt: 'p', maxTokens: 2600 })).resolves.toMatchObject({
      text: '{"a":1}',
      truncated: true,
    })
  })

  it('error 收尾带出 code 和 message', async () => {
    const llm = llmOf([
      { type: 'finish', reason: { kind: 'error', failure: { code: 'rate-limit', message: '太快了' } } },
    ])
    await expect(complete(llm, SELECTION, { system: 's', prompt: 'p' })).rejects.toThrow('rate-limit：太快了')
  })

  it('正常收尾时把三类 token 都累计起来', async () => {
    const llm = llmOf([
      { type: 'text-delta', text: '甲' },
      { type: 'text-delta', text: '乙' },
      { type: 'usage', usage: { inputTokens: 7, outputTokens: 3, cacheReadTokens: 5 } },
      { type: 'finish', reason: { kind: 'stop' } },
    ])
    await expect(complete(llm, SELECTION, { system: 's', prompt: 'p' })).resolves.toEqual({
      text: '甲乙',
      inputTokens: 7,
      outputTokens: 3,
      cacheReadTokens: 5,
      truncated: false,
    })
  })

  it('空内容报「空内容」而不是截断', async () => {
    const llm = llmOf([{ type: 'finish', reason: { kind: 'stop' } }])
    await expect(complete(llm, SELECTION, { system: 's', prompt: 'p' })).rejects.toThrow('空内容')
  })

  it('流没收尾就断了，报意外中断而不是假装成功', async () => {
    const llm = llmOf([{ type: 'text-delta', text: '{"a":' }])
    await expect(complete(llm, SELECTION, { system: 's', prompt: 'p' })).rejects.toThrow('意外中断')
  })

  it('超时用中文说清楚，并带上等待的秒数', async () => {
    const llm: LlmLike = {
      stream(options) {
        return (async function* generate() {
          await new Promise<void>((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
          })
          yield { type: 'finish', reason: { kind: 'stop' } }
        })()
      },
    }
    await expect(complete(llm, SELECTION, { system: 's', prompt: 'p', timeoutMs: 20 })).rejects.toBeInstanceOf(
      InsightTimeoutError,
    )
    await expect(complete(llm, SELECTION, { system: 's', prompt: 'p', timeoutMs: 20 })).rejects.toThrow(/秒内没写完/)
  })
})

describe('extractJsonObject', () => {
  it('容忍代码围栏和前后废话', () => {
    expect(extractJsonObject('好的：\n```json\n{"a":1}\n```\n完毕')).toEqual({ a: 1 })
  })

  it('没有对象时报错', () => {
    expect(() => extractJsonObject('没有 JSON')).toThrow(InsightModelError)
  })
})

describe('outputLimitOf', () => {
  it('问到上限就用它', async () => {
    const llm: LlmLike = { stream: llmOf([]).stream, resolveModelInfo: async () => ({ defaultMaxTokens: 4000 }) }
    await expect(outputLimitOf(llm, SELECTION)).resolves.toBe(4000)
  })

  it('查询失败或没有这个能力时，当作没有上限', async () => {
    await expect(outputLimitOf(llmOf([]), SELECTION)).resolves.toBe(Number.POSITIVE_INFINITY)
    const broken: LlmLike = {
      stream: llmOf([]).stream,
      resolveModelInfo: async () => {
        throw new Error('连不上')
      },
    }
    await expect(outputLimitOf(broken, SELECTION)).resolves.toBe(Number.POSITIVE_INFINITY)
  })
})

describe('labelSession', () => {
  it('标签写进缓存时要带本轮的 token 花费', async () => {
    const llm = llmOf(
      jsonChunks({ goal: '改图标', outcome: '完成', sessionType: '新功能', frictions: [], wins: [], summary: '换了图标' }),
    )
    const result = await labelSession(llm, SELECTION, digestOf('s1'))
    expect(result.facet.goal).toBe('改图标')
    expect(result.inputTokens).toBe(10)
  })

  it('预算按 1200 起、重试翻倍', async () => {
    const trace: Trace = { maxTokens: [] }
    const llm = llmOf(jsonChunks({ goal: 'g' }), trace)
    await labelSession(llm, SELECTION, digestOf('s1'))
    expect(trace.maxTokens).toEqual([1200])
  })

  it('模型上限更小时按上限发，不会被 provider 拒绝', async () => {
    const trace: Trace = { maxTokens: [] }
    const llm = llmOf(
      jsonChunks({ goal: 'g' }),
      trace,
    )
    await labelSession(llm, SELECTION, digestOf('s1'), undefined, 500)
    expect(trace.maxTokens).toEqual([500])
  })

  it('截断导致解析失败时报截断，不报 JSON 解析失败', async () => {
    const llm = llmOf([
      { type: 'text-delta', text: '{"goal":"改图' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ])
    const error = await labelSession(llm, SELECTION, digestOf('s1')).catch((error_: unknown) => error_)
    expect(error).toBeInstanceOf(InsightTruncatedError)
    expect((error as Error).message).not.toMatch(/JSON 解析失败/)
  })

})

describe('shouldRetry', () => {
  it('超时不重试，免得再等一轮', () => {
    expect(shouldRetry(new InsightTimeoutError(180_000), 1200, Number.POSITIVE_INFINITY)).toBe(false)
  })

  it('截断只有在预算还能翻倍时才重试', () => {
    expect(shouldRetry(new InsightTruncatedError(1200), 1200, Number.POSITIVE_INFINITY)).toBe(true)
    expect(shouldRetry(new InsightTruncatedError(4000), 4000, 4000)).toBe(false)
  })

  it('别的错误照旧重试一次', () => {
    expect(shouldRetry(new InsightModelError('rate-limit'), 1200, 1200)).toBe(true)
  })
})

describe('aggregateReport', () => {
  it('按编号回填真实会话、按编号去重计数', async () => {
    const payload = aggregateJson([
      {
        title: '需求分几次说全',
        detail: '方向到第三轮才发现不对',
        sessions: [1, 3, 3, 99],
        examples: [{ n: 3, quote: '不是这个意思' }],
      },
    ])
    const llm = llmOf(jsonChunks(payload))
    const result = await aggregateReport(llm, SELECTION, inputsOf(['s1', 's2', 's3']), STATS)
    expect(result.frictions[0]?.count).toBe(2)
    expect(result.frictions[0]?.examples[0]?.sessionId).toBe('s3')
    expect(result.frictions[0]?.examples[0]?.project).toBe('demo')
    expect(result.glance.next).toBe('加一条复述规则')
    expect(result.suggestions[0]?.where).toBe('agents')
  })

  it('数字字符串、0、负数、小数都不会算出假会话', async () => {
    const payload = aggregateJson([
      { title: 'x', detail: 'y', sessions: ['2', 0, -1, 1.5, 3], examples: [] },
    ])
    const llm = llmOf(jsonChunks(payload))
    const result = await aggregateReport(llm, SELECTION, inputsOf(['s1', 's2', 's3']), STATS)
    expect(result.frictions[0]?.count).toBe(2)
  })

  it('模型不听话直接回 id 也能认（sessions 和 examples 都认）', async () => {
    const payload = aggregateJson([
      { title: 'x', detail: 'y', sessions: ['s2'], examples: [{ sessionId: 's1', quote: '原话' }] },
    ])
    const llm = llmOf(jsonChunks(payload))
    const result = await aggregateReport(llm, SELECTION, inputsOf(['s1', 's2']), STATS)
    expect(result.frictions[0]?.count).toBe(1)
    expect(result.frictions[0]?.examples[0]?.sessionId).toBe('s1')
  })

  it('只给例子不给统计时，按例子涉及的会话数兜底', async () => {
    const payload = aggregateJson([
      { title: 'x', detail: 'y', sessions: [], examples: [{ n: 1, quote: 'a' }, { n: 1, quote: 'b' }] },
    ])
    const llm = llmOf(jsonChunks(payload))
    const result = await aggregateReport(llm, SELECTION, inputsOf(['s1', 's2']), STATS)
    expect(result.frictions[0]?.count).toBe(1)
  })

  it('汇总预算 16000 起，重试翻倍', async () => {
    const trace: Trace = { maxTokens: [] }
    const llm = llmOf(jsonChunks(aggregateJson()), trace)
    await aggregateReport(llm, SELECTION, inputsOf(['s1']), STATS)
    expect(trace.maxTokens).toEqual([16_000])
  })

  it('模型上限更低时按上限发，重试也不会超', async () => {
    const trace: Trace = { maxTokens: [] }
    const truncated = [
      { type: 'text-delta', text: '{"glance":{"working":"先写' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ]
    const llm = llmOf(truncated, trace)
    await expect(aggregateReport(llm, SELECTION, inputsOf(['s1']), STATS, undefined, 2000)).rejects.toBeInstanceOf(
      InsightTruncatedError,
    )
    // 第一次就顶到上限，第二次重试没有意义，只发一次。
    expect(trace.maxTokens).toEqual([2000])
  })

  it('截断时提示还没写完、并给出下一步', async () => {
    const llm = llmOf([
      { type: 'text-delta', text: '{"glance":{"working":"先写' },
      { type: 'finish', reason: { kind: 'max-tokens' } },
    ])
    const error = await aggregateReport(llm, SELECTION, inputsOf(['s1']), STATS).catch((error_: unknown) => error_)
    expect(error).toBeInstanceOf(InsightTruncatedError)
    expect((error as Error).message).toMatch(/截断/)
    expect((error as Error).message).not.toMatch(/JSON 解析失败/)
  })
})
