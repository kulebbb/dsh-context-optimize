/**
 * 模型层：两次调用——逐会话打标签、全局汇总。
 *
 * 这里只管「怎么问、怎么解析、怎么兜底」，不关心并发、缓存和落盘（那是 service 的事）。
 * 解析失败统一重试一次；仍失败就抛出，由上层决定跳过这个会话还是整轮失败。
 */
import { toLocalDateKey } from './collect.ts'
import type {
  InsightFacet,
  InsightFriction,
  InsightGlance,
  InsightSessionDigest,
  InsightSuggestion,
  InsightSuggestionWhere,
  InsightWin,
} from '../../shared/insight.ts'

/** 选中的模型路由。 */
export interface InsightModelSelection {
  readonly provider: string
  readonly model: string
}

/** 一次模型调用的结果。 */
export interface LlmCompletion {
  readonly text: string
  readonly inputTokens: number
  readonly outputTokens: number
  /** 缓存命中的输入 token；和 inputTokens 是互斥计数，报告里也要算进总消耗。 */
  readonly cacheReadTokens: number
  /** 收尾原因是 max-tokens：文本可能不完整，由调用方在解析失败时决定怎么报。 */
  readonly truncated: boolean
}

/** 默认单次调用超时。 */
const DEFAULT_TIMEOUT_MS = 180_000

/**
 * 宿主 `ctx.llm` 里用到的最小结构；不 import DSH 的类型包。
 *
 * `listProviders` / `listModels` 只有兜底路由用到，缺了也能正常分析。
 */
export interface LlmLike {
  listProviders?(): readonly { id: string; name: string }[]
  listModels?(provider: string): Promise<readonly { provider: string; id: string; name: string }[]>
  /** 查模型的输出上限；缺了按「不知道上限」处理。 */
  resolveModelInfo?(provider: string, model: string, signal?: AbortSignal): Promise<{ defaultMaxTokens?: number }>
  stream(options: {
    provider: string
    model: string
    system?: string
    messages: readonly { role: 'user'; content: readonly { type: 'text'; text: string }[] }[]
    signal?: AbortSignal
    maxTokens?: number
    temperature?: number
  }): AsyncIterable<unknown>
}

/** 调用选项。 */
export interface CallOptions {
  readonly system: string
  readonly prompt: string
  readonly signal?: AbortSignal
  readonly maxTokens?: number
  readonly temperature?: number
  /** 单次调用超时；默认 180 秒。 */
  readonly timeoutMs?: number
}

/** 模型返回了无法解析的内容。 */
export class InsightModelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InsightModelError'
  }
}

/** 模型输出被 maxTokens 截断；单列出来，免得只剩一句「JSON 解析失败」。 */
export class InsightTruncatedError extends InsightModelError {
  constructor(limit: number) {
    super(
      `模型输出太长被截断（已经放宽到 ${String(limit)} token 还没写完），这次没拿到完整 JSON；` +
        '可以把范围缩小一档，或换一个输出上限更大的模型',
    )
    this.name = 'InsightTruncatedError'
  }
}

/** 单次调用超时；重试只会再等一轮，所以调用方不再重试。 */
export class InsightTimeoutError extends InsightModelError {
  constructor(timeoutMs: number) {
    super(`模型 ${String(Math.round(timeoutMs / 1000))} 秒内没写完，已中止；可以缩小范围或换更快的模型`)
    this.name = 'InsightTimeoutError'
  }
}

/** 从文本里抠出第一个 JSON 对象；容忍 ```json 围栏和前后废话。 */
export function extractJsonObject(text: string): unknown {
  let body = text.trim()
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(body)
  if (fence !== null && fence[1] !== undefined) body = fence[1].trim()
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) throw new InsightModelError('模型没有返回 JSON 对象')
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch (error) {
    throw new InsightModelError(`模型返回的 JSON 解析失败：${error instanceof Error ? error.message : '未知错误'}`)
  }
}

/** 把未知值读成字符串，顺带截断。 */
function str(value: unknown, max: number): string {
  if (typeof value !== 'string') return ''
  const clean = value.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

/** 把未知值读成字符串数组。 */
function strList(value: unknown, max: number, maxItems: number): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    const text = str(item, max)
    if (text !== '') out.push(text)
    if (out.length >= maxItems) break
  }
  return out
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

/**
 * 调一次模型并收集文本。
 *
 * 流必须正常收尾；`error` / `aborted` / 超时一律变成异常，交给上层决定跳过还是中止。
 * 截断（max-tokens）不在这里抛：文本可能已经是完整 JSON，只有解析失败才算真失败。
 */
export async function complete(
  llm: LlmLike,
  selection: InsightModelSelection,
  options: CallOptions,
): Promise<LlmCompletion> {
  const controller = new AbortController()
  const onAbort = (): void => controller.abort()
  options.signal?.addEventListener('abort', onAbort, { once: true })
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  let timedOut = false
  let timer: ReturnType<typeof setTimeout> | undefined
  if (timeoutMs > 0) {
    timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
    timer.unref?.()
  }

  let text = ''
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let failure: string | null = null
  let truncated = false
  let finished = false
  let streamError: unknown
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      system: options.system,
      messages: [{ role: 'user', content: [{ type: 'text', text: options.prompt }] }],
      signal: controller.signal,
      ...(options.maxTokens === undefined ? {} : { maxTokens: options.maxTokens }),
      ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    })
    try {
      for await (const raw of stream) {
        const chunk = recordOf(raw)
        if (chunk['type'] === 'text-delta' && typeof chunk['text'] === 'string') {
          text += chunk['text']
        } else if (chunk['type'] === 'usage') {
          const usage = recordOf(chunk['usage'])
          if (typeof usage['inputTokens'] === 'number') inputTokens += usage['inputTokens']
          if (typeof usage['outputTokens'] === 'number') outputTokens += usage['outputTokens']
          if (typeof usage['cacheReadTokens'] === 'number') cacheReadTokens += usage['cacheReadTokens']
        } else if (chunk['type'] === 'finish') {
          finished = true
          const reason = recordOf(chunk['reason'])
          if (reason['kind'] === 'error' || reason['kind'] === 'aborted') {
            const detail = recordOf(reason['failure'])
            const code = typeof detail['code'] === 'string' ? detail['code'] : reason['kind']
            const message = typeof detail['message'] === 'string' ? detail['message'] : ''
            failure = `${code}${message === '' ? '' : `：${message}`}`
          } else if (reason['kind'] === 'max-tokens') {
            truncated = true
          }
        }
      }
    } catch (error) {
      // 适配器直接抛出（而不是发 finish）时，也要能和超时/取消区分开。
      streamError = error
    }
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }

  const usage = { text, inputTokens, outputTokens, cacheReadTokens, truncated }
  if (options.signal?.aborted === true) throw new Error('已取消')
  if (timedOut) throw new InsightTimeoutError(timeoutMs)
  if (failure !== null) throw new InsightModelError(failure)
  if (streamError !== undefined) {
    throw new InsightModelError(streamError instanceof Error ? streamError.message : '模型调用失败')
  }
  if (!finished) throw new InsightModelError('模型流意外中断，没有收到结束标记')
  if (text.trim() === '') throw new InsightModelError('模型返回了空内容')
  return usage
}

/** 打标签的输出上限：标签本身很短，这里只是防跑飞。 */
const FACET_MAX_TOKENS = 1200

/**
 * 汇总的输出上限。
 *
 * 上限本身不产生费用（模型写完就停），但给太小会被截断、只留下一句「JSON 解析失败」，
 * 所以按「够用 + 宽裕」给：实测汇总正文 2~4k token。
 */
const AGGREGATE_MAX_TOKENS = 16_000

/**
 * 模型这轮真正能写多少 token。
 *
 * 显式传给 `ctx.llm` 的 maxTokens 不会被钳制，超过模型上限时 provider 直接拒绝，
 * 所以先用 `resolveModelInfo` 问清楚；问不到就当没有上限。
 */
export async function outputLimitOf(
  llm: LlmLike,
  selection: InsightModelSelection,
  timeoutMs = 5_000,
): Promise<number> {
  if (llm.resolveModelInfo === undefined) return Number.POSITIVE_INFINITY
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  try {
    const info = await llm.resolveModelInfo(selection.provider, selection.model, controller.signal)
    const limit = info.defaultMaxTokens
    return typeof limit === 'number' && limit > 0 ? limit : Number.POSITIVE_INFINITY
  } catch {
    return Number.POSITIVE_INFINITY
  } finally {
    clearTimeout(timer)
  }
}

/** 本轮预算：想要的量和模型上限取小。 */
function budgetOf(desired: number, attempt: number, limit: number): number {
  return Math.min(desired * (attempt + 1), limit)
}

/** 按预算估一个超时；预算越大给的时间越长，免得写完一半就被掐断。 */
function timeoutFor(budget: number): number {
  if (!Number.isFinite(budget)) return 600_000
  return Math.min(900_000, Math.max(240_000, budget * 25))
}

/**
 * 这次失败还值不值得再调一次。
 *
 * 超时重试只会再等一轮；截断则要预算还能翻倍才有意义。
 */
export function shouldRetry(error: unknown, budget: number, limit: number): boolean {
  if (error instanceof InsightTimeoutError) return false
  if (error instanceof InsightTruncatedError) return budget < limit
  return true
}

/** 解析模型输出的 JSON；被截断时换成「截断」的说法，而不是解析器的报错。 */
function parseOrThrow(text: string, truncated: boolean, limit: number): Record<string, unknown> {
  try {
    return recordOf(extractJsonObject(text))
  } catch (error) {
    if (truncated) throw new InsightTruncatedError(limit)
    throw error
  }
}

/** 打标签的系统提示。 */
const FACET_SYSTEM = [
  '你是 DSH（DeepSeek Harness）的使用方式分析师。',
  '你会读到一次编程会话的压缩摘要，需要判断这次会话做了什么、结果如何、哪里卡住、哪里配合得好。',
  '只输出一个 JSON 对象，不要任何解释、Markdown 或代码围栏。',
  '字段：goal（用户想做什么，20 字内）、outcome（结果：完成/部分完成/放弃/方向被推翻，20 字内）、',
  'sessionType（调试/新功能/重构/文档/调研/其他，10 字内）、frictions（字符串数组，0-3 条，每条 30 字内，用户在这一轮里卡住的点）、',
  'wins（字符串数组，0-3 条，每条 30 字内，配合得好或省事的地方）、summary（一句话总结，40 字内）。',
  '信息不足时按已知内容保守填写，不要编造。',
].join('\n')

/** 汇总的系统提示。 */
const AGGREGATE_SYSTEM = [
  '你是 DSH（DeepSeek Harness）的使用方式分析师，正在为一位开发者写月度工作方式复盘。',
  '你会读到很多会话的标签，需要归纳出跨会话的模式。只输出一个 JSON 对象，不要解释、Markdown 或代码围栏。',
  '要求：结论必须能落到「下一次怎么做」，不要写空话；例子必须来自给出的会话。',
].join('\n')

/** 打标签的结果：标签 + 这项花费。 */
export interface LabelledSession {
  readonly facet: InsightFacet
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
}

/** 单会话打标签；`limit` 是模型这轮能写的 token 上限。 */
export async function labelSession(
  llm: LlmLike,
  selection: InsightModelSelection,
  session: InsightSessionDigest,
  signal?: AbortSignal,
  limit = Number.POSITIVE_INFINITY,
): Promise<LabelledSession> {
  const prompt = [
    '下面是这次会话的摘要：',
    '---',
    session.digest,
    '---',
    '请输出标签 JSON。',
  ].join('\n')

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // 上次若是被截断，这次把预算翻倍（但不超过模型上限）。
    const budget = budgetOf(FACET_MAX_TOKENS, attempt, limit)
    try {
      const result = await complete(llm, selection, {
        system: FACET_SYSTEM,
        prompt,
        signal,
        maxTokens: budget,
        temperature: 0.2,
      })
      const value = parseOrThrow(result.text, result.truncated, budget)
      return {
        facet: {
          goal: str(value['goal'], 80),
          outcome: str(value['outcome'], 40),
          sessionType: str(value['sessionType'], 30),
          frictions: strList(value['frictions'], 80, 3),
          wins: strList(value['wins'], 80, 3),
          summary: str(value['summary'], 120),
        },
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens,
      }
    } catch (error) {
      lastError = error
      if (signal?.aborted === true) throw error
      if (!shouldRetry(error, budget, limit)) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new InsightModelError('打标签失败')
}

/** 汇总阶段的结果。 */
export interface AggregateResult {
  readonly glance: InsightGlance
  readonly frictions: readonly InsightFriction[]
  readonly wins: readonly InsightWin[]
  readonly suggestions: readonly InsightSuggestion[]
  readonly fun: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
}

/** 参与汇总的一个会话。 */
export interface AggregateInput {
  readonly session: InsightSessionDigest
  readonly facet: InsightFacet
}

const WHERE_VALUES: readonly InsightSuggestionWhere[] = ['agents', 'skill', 'workflow', 'config', 'other']

/** 把模型给的 where 归一到固定枚举。 */
function whereOf(value: unknown): InsightSuggestionWhere {
  return typeof value === 'string' && (WHERE_VALUES as readonly string[]).includes(value)
    ? (value as InsightSuggestionWhere)
    : 'other'
}

/** 汇总上限：超出的会话按时间取最新的一批，避免 prompt 无限膨胀。 */
const MAX_AGGREGATE_SESSIONS = 400

/**
 * 把全部会话标签汇总成报告主体。
 *
 * 摩擦的「次数」由 host 从模型给的会话编号反推，而不是信模型给的数字——
 * 模型擅长归类，不擅长计数。
 */
export async function aggregateReport(
  llm: LlmLike,
  selection: InsightModelSelection,
  inputs: readonly AggregateInput[],
  stats: { sessions: number; messages: number; toolCalls: number; projects: number },
  signal?: AbortSignal,
  limit = Number.POSITIVE_INFINITY,
): Promise<AggregateResult> {
  const kept = inputs.slice(0, MAX_AGGREGATE_SESSIONS)
  const corpus = kept.map((item, index) => ({
    n: index + 1,
    project: item.session.project,
    date: toLocalDateKey(item.session.createdAt),
    digits: {
      turns: item.session.turns,
      toolCalls: item.session.toolCalls,
      messages: item.session.userMessages,
    },
    facet: item.facet,
  }))

  const prompt = [
    `本次分析覆盖 ${String(stats.sessions)} 个会话、${String(stats.messages)} 条用户消息、${String(stats.toolCalls)} 次工具调用、${String(stats.projects)} 个目录。`,
    '会话标签如下（JSON 数组，字段 n 是会话编号）：',
    '---',
    JSON.stringify(corpus),
    '---',
    '请输出汇总 JSON，结构：',
    '{',
    '  "glance": {"working": "什么在起作用，60 字内", "friction": "什么最拖后腿，60 字内", "next": "先改哪一件事，60 字内，要具体"},',
    '  "frictions": [{"title": "摩擦类型，20 字内", "detail": "为什么反复发生，80 字内", "sessions": [出现该问题的会话编号，如 3], "examples": [{"n": 会话编号, "quote": "该会话里的原话或行为，40 字内"}]}],',
    '  "wins": [{"title": "有效习惯，20 字内", "detail": "为什么有效，80 字内"}],',
    '  "suggestions": [{"title": "建议，20 字内", "detail": "怎么做，80 字内", "where": "agents|skill|workflow|config|other", "snippet": "可直接复制的文字或命令，没有就给空串"}],',
    '  "fun": "从会话里挑一个有趣或难忘的瞬间，50 字内"',
    '}',
    '约束：frictions 最多 3 条，wins 最多 3 条，suggestions 最多 4 条；每条 frictions 至少给 1 个 example，examples 最多 2 条；',
    'sessions 里写编号数字（不是 id 字符串），必须来自上面出现过的 n；不要编造编号、数字或原话；',
    '输出单行 JSON，不要缩进、换行或多余空格。',
  ].join('\n')

  let lastError: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    // 上次若是被截断，这次把预算翻倍（但不超过模型上限）；超时按写满预算估。
    const budget = budgetOf(AGGREGATE_MAX_TOKENS, attempt, limit)
    try {
      const result = await complete(llm, selection, {
        system: AGGREGATE_SYSTEM,
        prompt,
        signal,
        maxTokens: budget,
        temperature: 0.3,
        timeoutMs: timeoutFor(budget),
      })
      const value = parseOrThrow(result.text, result.truncated, budget)
      const byId = new Map(kept.map((item) => [item.session.id, item]))
      /** 编号（1 起）→ 会话；越界一律丢掉。 */
      const byNumber = (raw: unknown): AggregateInput | undefined => {
        const index = typeof raw === 'string' && /^\d+$/.test(raw) ? Number(raw) : raw
        if (typeof index !== 'number' || !Number.isInteger(index)) return undefined
        return kept[index - 1]
      }
      /** 模型可能回编号，也可能（不听话时）回 id，两种都认。 */
      const refOf = (raw: unknown): AggregateInput | undefined => {
        if (typeof raw === 'string') {
          const hit = byId.get(str(raw, 80))
          if (hit !== undefined) return hit
        }
        return byNumber(raw)
      }
      const glanceRaw = recordOf(value['glance'])
      const glance: InsightGlance = {
        working: str(glanceRaw['working'], 160),
        friction: str(glanceRaw['friction'], 160),
        next: str(glanceRaw['next'], 160),
      }

      const frictions: InsightFriction[] = []
      for (const item of Array.isArray(value['frictions']) ? value['frictions'] : []) {
        const raw = recordOf(item)
        const ids: string[] = []
        const entries = Array.isArray(raw['sessions']) ? raw['sessions'].slice(0, MAX_AGGREGATE_SESSIONS) : []
        for (const entry of entries) {
          const session = refOf(entry)
          if (session === undefined) continue
          if (!ids.includes(session.session.id)) ids.push(session.session.id)
        }
        const examples: InsightFriction['examples'][number][] = []
        for (const example of Array.isArray(raw['examples']) ? raw['examples'] : []) {
          const exampleRecord = recordOf(example)
          const session = refOf(exampleRecord['n']) ?? refOf(exampleRecord['sessionId'])
          if (session === undefined) continue
          examples.push({
            quote: str(exampleRecord['quote'], 120),
            project: session.session.project,
            date: toLocalDateKey(session.session.createdAt),
            sessionId: session.session.id,
          })
          if (examples.length >= 2) break
        }
        frictions.push({
          title: str(raw['title'], 60),
          detail: str(raw['detail'], 200),
          // 模型偶尔只给例子不给统计：这时用例子涉及的会话数兜底，避免报告写「0 次」。
          count: ids.length > 0 ? ids.length : new Set(examples.map((example) => example.sessionId)).size,
          examples,
        })
        if (frictions.length >= 3) break
      }

      const wins: InsightWin[] = []
      for (const item of Array.isArray(value['wins']) ? value['wins'] : []) {
        const raw = recordOf(item)
        const title = str(raw['title'], 60)
        if (title === '') continue
        wins.push({ title, detail: str(raw['detail'], 200) })
        if (wins.length >= 3) break
      }

      const suggestions: InsightSuggestion[] = []
      for (const item of Array.isArray(value['suggestions']) ? value['suggestions'] : []) {
        const raw = recordOf(item)
        const title = str(raw['title'], 60)
        if (title === '') continue
        suggestions.push({
          title,
          detail: str(raw['detail'], 200),
          where: whereOf(raw['where']),
          snippet: str(raw['snippet'], 400),
        })
        if (suggestions.length >= 4) break
      }

      return {
        glance,
        frictions,
        wins,
        suggestions,
        fun: str(value['fun'], 160),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        cacheReadTokens: result.cacheReadTokens,
      }
    } catch (error) {
      lastError = error
      if (signal?.aborted === true) throw error
      if (!shouldRetry(error, budget, limit)) throw error
    }
  }
  throw lastError instanceof Error ? lastError : new InsightModelError('汇总失败')
}
