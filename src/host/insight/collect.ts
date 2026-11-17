/**
 * 采集层：把会话日志折叠成「确定性统计 + 一段可读摘要」。
 *
 * 这一层刻意不碰模型：所有数字都能从事件里直接数出来，测试不需要 LLM。
 * 摘要的口径（每段截多少字）集中在本文件，改口径只改这里。
 */
import type {
  InsightHourBucket,
  InsightProjectStat,
  InsightSessionDigest,
  InsightToolStat,
} from '../../shared/insight.ts'

/** 会话头的字段；只声明用到的，DSH 加字段不会破坏这里。 */
export interface SessionHeaderLike {
  readonly id: string
  readonly cwd?: string
  /** 会话创建时间（毫秒）。 */
  readonly createdAt?: number
  /** 父会话 id；有值的都是子代理会话。 */
  readonly parentSession?: string
  /** `subagent` 表示这条会话是代理派生的。 */
  readonly origin?: string
  /** 会话深度；子代理 > 0。 */
  readonly delegationDepth?: number
  /** 由父会话播种出来的会话，不算独立的人工会话。 */
  readonly isSeeded?: boolean
}

/** 会话服务里我们用到的两个方法。 */
export interface SessionSource {
  listSessions(signal?: AbortSignal): Promise<readonly { header: SessionHeaderLike; live: boolean }[]>
  readSession(sessionId: string): Promise<{ session?: { cwd?: string } | null; events: readonly unknown[] }>
}

/** 一个会话的压缩预算；超出的部分直接丢弃并在摘要里标注。 */
export interface DigestBudget {
  /** 你的消息：最多取几条、每条截多少字。 */
  readonly userLines: number
  readonly userChars: number
  /** 助手结论：最多取几条、每条截多少字。 */
  readonly assistantLines: number
  readonly assistantChars: number
  /** 失败命令：最多记几条、每条截多少字。 */
  readonly failureLines: number
  readonly failureChars: number
  /** 整段摘要的硬上限。 */
  readonly maxChars: number
}

/** 会改动文件的工具；用来从 tool/result 的 meta 里数「改了几个文件」。 */
const WRITE_TOOLS: ReadonlySet<string> = new Set(['write', 'edit', 'apply_patch', 'str_replace_editor'])

/** 默认预算：与 Claude Code 的口径接近，够模型判断模式又不至于烧 token。 */
export const DEFAULT_DIGEST_BUDGET: DigestBudget = {
  userLines: 10,
  userChars: 400,
  assistantLines: 4,
  assistantChars: 240,
  failureLines: 5,
  failureChars: 120,
  maxChars: 6000,
}

/** 采集选项。 */
export interface CollectOptions {
  readonly source: SessionSource
  /** 分析窗口天数；null = 全部历史。 */
  readonly days: number | null
  /** 当前时间，用于窗口与进度；测试注入。 */
  readonly now: () => Date
  readonly signal?: AbortSignal
  /** 并发读会话数；默认 4，与频次回溯一致。 */
  readonly concurrency?: number
  /** 单会话读取超时；默认 20 秒。 */
  readonly readTimeoutMs?: number
  /** 单次分析最多处理多少个会话；默认 300，超出按时间保留最新的。 */
  readonly maxSessions?: number
  /** 进度回调：已处理数、总数、当前会话标题。 */
  readonly onProgress?: (done: number, total: number, title: string) => void
  readonly logger?: { warn?(...args: unknown[]): void } | undefined
  readonly budget?: DigestBudget
}

/** 采集结果：会话摘要 + 分类统计。 */
export interface CollectResult {
  readonly sessions: readonly InsightSessionDigest[]
  readonly stats: {
    readonly sessions: number
    readonly messages: number
    readonly toolCalls: number
    readonly toolFailures: number
    readonly activeDays: number
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly durationMs: number
    readonly characters: number
    readonly excludedSubagent: number
    readonly excludedOld: number
    readonly excludedCapped: number
  }
  readonly projects: readonly InsightProjectStat[]
  readonly tools: readonly InsightToolStat[]
  readonly hours: readonly InsightHourBucket[]
}

/** 会话里出现的一种事件；只读用到字段。 */
type EventRecord = Record<string, unknown>

/** 把一个未知值当对象读；不是对象就给空对象。 */
function asRecord(value: unknown): EventRecord {
  return typeof value === 'object' && value !== null ? (value as EventRecord) : {}
}

/** 从事件 data 里取数组字段。 */
function contentBlocks(value: unknown): unknown[] {
  const content = asRecord(value)['content']
  return Array.isArray(content) ? content : []
}

/** 把内容块里的文本拼起来；没有文本返回空串。 */
function textOf(blocks: readonly unknown[]): string {
  const parts: string[] = []
  for (const block of blocks) {
    const record = asRecord(block)
    if (record['type'] !== 'text') continue
    const text = record['text']
    if (typeof text === 'string') parts.push(text)
  }
  return parts.join('\n').trim()
}

/** 截断到 n 个字符，超出加省略号。 */
export function clip(text: string, n: number): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= n ? clean : `${clean.slice(0, n)}…`
}

/** 本地时区的 `YYYY-MM-DD`。 */
export function toLocalDateKey(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 本地时区的小时（0–23）。 */
export function toLocalHour(timestamp: number): number {
  return new Date(timestamp).getHours()
}

/** FNV-1a 32 位哈希，够用来判断摘要是否变化。 */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/**
 * 判断一个会话是不是「人工会话」。
 *
 * 子代理会话会大幅拉偏结论（本机 803 个会话里 632 个是子代理），
 * 播种会话（isSeeded）是父会话的副本，都不计入。
 */
export function isHumanSession(header: SessionHeaderLike): boolean {
  if (header.parentSession !== undefined && header.parentSession !== '') return false
  if (header.origin === 'subagent') return false
  if ((header.delegationDepth ?? 0) > 0) return false
  if (header.isSeeded === true) return false
  return true
}

/** 取 cwd 的最后一段作为项目名；路径为空时给 `unknown`。 */
export function projectNameOf(cwd: string | null | undefined): string {
  if (cwd === null || cwd === undefined || cwd === '') return 'unknown'
  const parts = cwd.split(/[\\/]/).filter((part) => part !== '')
  return parts.length === 0 ? cwd : (parts[parts.length - 1] ?? cwd)
}

/** 从 `exit code: 2` / `signal: SIGTERM` 判断这次命令算不算失败。 */
function failureOfJob(status: unknown, detail: unknown): boolean {
  if (status === 'failed' || status === 'killed') return true
  if (typeof detail !== 'string') return false
  const match = /exit code:\s*(\d+)/i.exec(detail)
  if (match !== null) return (match[1] ?? '0') !== '0'
  return /signal:/i.test(detail)
}

/** 会话折叠的中间结果。 */
interface FoldedSession {
  digest: InsightSessionDigest
  /** 每个工具被调用的次数，用于全局分布。 */
  toolCounts: Map<string, number>
  /** 每个工具的失败次数。 */
  toolFailures: Map<string, number>
}

/**
 * 把一个会话的事件折叠成摘要 + 统计。
 *
 * @param header - 会话头（id / cwd / createdAt）。
 * @param events - `readSession` 返回的原始事件。
 * @param budget - 摘要预算；测试可注入更小的值。
 */
export function foldSession(
  header: SessionHeaderLike,
  events: readonly unknown[],
  budget: DigestBudget = DEFAULT_DIGEST_BUDGET,
): FoldedSession {
  const createdAt = typeof header.createdAt === 'number' ? header.createdAt : 0
  let firstTime = Number.POSITIVE_INFINITY
  let lastTime = 0
  let turns = 0
  let steps = 0
  let userMessages = 0
  let assistantMessages = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let title = ''
  let lastSeq = 0
  const models = new Set<string>()
  const filePaths = new Set<string>()
  const userTexts: string[] = []
  const assistantTexts: string[] = []
  const failures: string[] = []
  const toolCounts = new Map<string, number>()
  /** 失败的调用 id；job 与 tool/result 两路来源在这里去重。 */
  const failedCalls = new Set<string>()
  const callNames = new Map<string, string>()

  for (const raw of events) {
    const event = asRecord(raw)
    const type = event['type']
    const time = event['time']
    if (typeof time === 'number') {
      if (time < firstTime) firstTime = time
      if (time > lastTime) lastTime = time
    }
    const seq = event['seq']
    if (typeof seq === 'number' && seq > lastSeq) lastSeq = seq
    const data = asRecord(event['data'])

    if (type === 'turn/start') {
      turns += 1
    } else if (type === 'step/end') {
      steps += 1
    } else if (type === 'user/message') {
      const source = asRecord(data['source'])
      if (source['kind'] !== 'user') continue
      const text = textOf(contentBlocks(data))
      if (text === '') continue
      userMessages += 1
      if (userTexts.length < budget.userLines) userTexts.push(clip(text, budget.userChars))
    } else if (type === 'assistant/message') {
      assistantMessages += 1
      const message = asRecord(data['message'])
      const text = textOf(contentBlocks(message))
      if (text !== '') {
        assistantTexts.push(clip(text, budget.assistantChars))
        if (assistantTexts.length > budget.assistantLines) assistantTexts.shift()
      }
      const usage = asRecord(data['usage'])
      inputTokens += typeof usage['inputTokens'] === 'number' ? usage['inputTokens'] : 0
      outputTokens += typeof usage['outputTokens'] === 'number' ? usage['outputTokens'] : 0
      cacheReadTokens += typeof usage['cacheReadTokens'] === 'number' ? usage['cacheReadTokens'] : 0
      const source = asRecord(message['source'])
      if (typeof source['provider'] === 'string' && typeof source['model'] === 'string') {
        models.add(`${source['provider']}/${source['model']}`)
      }
    } else if (type === 'tool/call') {
      const name = data['name']
      const callId = data['callId']
      if (typeof name === 'string') {
        const known = typeof callId === 'string' ? callNames.get(callId) : undefined
        if (known === undefined) toolCounts.set(name, (toolCounts.get(name) ?? 0) + 1)
        if (typeof callId === 'string') callNames.set(callId, name)
      }
    } else if (type === 'job/settled') {
      if (failureOfJob(data['status'], data['detail'])) {
        const call = asRecord(data['toolCall'])
        const callId = call['callId']
        if (typeof callId === 'string') failedCalls.add(callId)
        const detail = data['detail']
        const label = data['label']
        const text =
          typeof label === 'string' && label !== ''
            ? `${label}${typeof detail === 'string' && detail !== '' ? ` (${detail})` : ''}`
            : typeof detail === 'string'
              ? detail
              : ''
        if (text !== '' && failures.length < budget.failureLines) {
          failures.push(clip(text, budget.failureChars))
        }
      }
    } else if (type === 'tool/result') {
      const meta = asRecord(data['meta'])
      const callId = data['toolCallId']
      const name = typeof callId === 'string' ? callNames.get(callId) : undefined
      // 工具自己标的错误（edit 找不到 old_string、read 不存在、沙箱拒绝等），
      // 和 job/settled 的退出码一起按 callId 去重。
      if (asRecord(data['message'])['isError'] === true && typeof callId === 'string' && !failedCalls.has(callId)) {
        failedCalls.add(callId)
        if (failures.length < budget.failureLines) {
          failures.push(clip(`${name ?? '工具'} 返回错误`, budget.failureChars))
        }
      }
      if (name !== undefined && WRITE_TOOLS.has(name)) {
        const path = meta['path']
        if (typeof path === 'string' && path !== '') filePaths.add(path)
        // apply_patch 没有顶层 path，只有一个 diff 列表，每个 diff 自带路径。
        const diffs = meta['diffs']
        if (Array.isArray(diffs)) {
          for (const diff of diffs) {
            const diffPath = asRecord(diff)['path']
            if (typeof diffPath === 'string' && diffPath !== '') filePaths.add(diffPath)
          }
        }
      }
    } else if (type === 'session/title') {
      const next = data['title']
      if (typeof next === 'string' && next.trim() !== '') title = next.trim()
    }
  }

  const start = Number.isFinite(firstTime) ? firstTime : createdAt
  const end = lastTime > 0 ? lastTime : start
  const toolCalls = [...toolCounts.values()].reduce((sum, value) => sum + value, 0)
  const toolFailures = new Map<string, number>()
  for (const callId of failedCalls) {
    const name = callNames.get(callId)
    if (name !== undefined) toolFailures.set(name, (toolFailures.get(name) ?? 0) + 1)
  }
  const toolFailuresTotal = failedCalls.size
  const project = projectNameOf(header.cwd)

  // 摘要按「看得懂的最小信息」组织：模型需要的不是全文，而是目标、结论、工具轨迹和失败点。
  const lines: string[] = []
  lines.push(`项目：${project}`)
  if (title !== '') lines.push(`标题：${clip(title, 120)}`)
  lines.push(
    `日期：${toLocalDateKey(start)} · 时长 ${String(Math.max(1, Math.round((end - start) / 60000)))} 分钟 · ${String(turns)} 轮 · ${String(userMessages)} 条你的消息`,
  )
  if (userTexts.length > 0) {
    lines.push('你说了：')
    for (const text of userTexts) lines.push(`- ${text}`)
  }
  if (assistantTexts.length > 0) {
    lines.push('助手结论：')
    for (const text of assistantTexts) lines.push(`- ${text}`)
  }
  const toolSummary = [...toolCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([name, count]) => `${name}×${String(count)}`)
    .join(' ')
  if (toolSummary !== '') lines.push(`工具：${toolSummary}`)
  if (filePaths.size > 0) lines.push(`改动文件：${String(filePaths.size)} 个`)
  if (failures.length > 0) {
    lines.push('失败：')
    for (const failure of failures) lines.push(`- ${failure}`)
  }

  let digest = lines.join('\n')
  if (digest.length > budget.maxChars) digest = `${digest.slice(0, budget.maxChars)}\n（已截断）`

  return {
    digest: {
      id: header.id,
      title: title === '' ? clip(userTexts[0] ?? project, 60) : clip(title, 60),
      project,
      createdAt,
      updatedAt: end,
      turns,
      steps,
      userMessages,
      assistantMessages,
      toolCalls,
      toolFailures: toolFailuresTotal,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      filesTouched: filePaths.size,
      models: [...models],
      lastSeq,
      digest,
      digestHash: hashText(digest),
    },
    toolCounts,
    toolFailures,
  }
}

/** 给 promise 加超时。 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} 超时（${String(ms)}ms）`))
        }, ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** 并发受限的 map；保持结果顺序与输入一致。 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined)
  let cursor = 0
  const run = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item === undefined) continue
      results[index] = await worker(item, index).catch(() => undefined)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run))
  return results
}

/**
 * 扫描并折叠全部人工会话。
 *
 * 先按时间和类型过滤，再并发读日志；单个会话读失败只跳过它，不会让整轮失败。
 */
export async function collectCorpus(options: CollectOptions): Promise<CollectResult> {
  const { source, signal } = options
  const now = options.now().getTime()
  const windowMs = options.days === null ? null : options.days * 86_400_000
  const budget = options.budget ?? DEFAULT_DIGEST_BUDGET
  const listed = await source.listSessions(signal)

  let excludedSubagent = 0
  let excludedOld = 0
  let excludedCapped = 0
  const selected: { header: SessionHeaderLike; createdAt: number }[] = []
  for (const item of listed) {
    const header = item.header
    if (!isHumanSession(header)) {
      excludedSubagent += 1
      continue
    }
    const createdAt = typeof header.createdAt === 'number' ? header.createdAt : 0
    if (windowMs !== null && now - createdAt > windowMs) {
      excludedOld += 1
      continue
    }
    selected.push({ header, createdAt })
  }
  selected.sort((a, b) => b.createdAt - a.createdAt)
  const maxSessions = options.maxSessions ?? 300
  if (selected.length > maxSessions) {
    excludedCapped = selected.length - maxSessions
    selected.length = maxSessions
  }

  let done = 0
  const total = selected.length
  const folded = await mapLimit(selected, options.concurrency ?? 4, async (item) => {
    if (signal?.aborted) throw new Error('aborted')
    let events: readonly unknown[] = []
    try {
      const read = await withTimeout(
        source.readSession(item.header.id),
        options.readTimeoutMs ?? 20_000,
        `读取会话 ${item.header.id}`,
      )
      events = read.events
    } catch (error) {
      options.logger?.warn?.(`[dsh-context-optimize] 洞察：读取会话 ${item.header.id} 失败`, error)
      events = []
    }
    const result = foldSession(item.header, events, budget)
    done += 1
    options.onProgress?.(done, total, result.digest.title)
    if (signal?.aborted) throw new Error('aborted')
    return result
  })

  const sessions: InsightSessionDigest[] = []
  const projectCounts = new Map<string, number>()
  const toolCounts = new Map<string, { calls: number; failures: number }>()
  const hourCounts = new Array<number>(24).fill(0)
  const activeDates = new Set<string>()
  let messages = 0
  let toolCalls = 0
  let toolFailures = 0
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let durationMs = 0
  let characters = 0

  for (const item of folded) {
    if (item === undefined) continue
    const digest = item.digest
    sessions.push(digest)
    projectCounts.set(digest.project, (projectCounts.get(digest.project) ?? 0) + 1)
    activeDates.add(toLocalDateKey(digest.createdAt))
    hourCounts[toLocalHour(digest.createdAt)] = (hourCounts[toLocalHour(digest.createdAt)] ?? 0) + 1
    messages += digest.userMessages
    toolCalls += digest.toolCalls
    toolFailures += digest.toolFailures
    inputTokens += digest.inputTokens
    outputTokens += digest.outputTokens
    cacheReadTokens += digest.cacheReadTokens
    durationMs += Math.max(0, digest.updatedAt - digest.createdAt)
    characters += digest.digest.length
    for (const [name, count] of item.toolCounts) {
      const entry = toolCounts.get(name) ?? { calls: 0, failures: 0 }
      entry.calls += count
      toolCounts.set(name, entry)
    }
    for (const [name, count] of item.toolFailures) {
      const entry = toolCounts.get(name) ?? { calls: 0, failures: 0 }
      entry.failures += count
      toolCounts.set(name, entry)
    }
  }

  const projects: InsightProjectStat[] = [...projectCounts.entries()]
    .map(([name, sessions]) => ({ name, sessions }))
    .sort((a, b) => b.sessions - a.sessions)
  const tools: InsightToolStat[] = [...toolCounts.entries()]
    .map(([name, stat]) => ({ name, calls: stat.calls, failures: stat.failures }))
    .sort((a, b) => b.calls - a.calls)
  const hours: InsightHourBucket[] = hourCounts.map((sessions, hour) => ({ hour, sessions }))

  return {
    sessions,
    projects,
    tools,
    hours,
    stats: {
      sessions: sessions.length,
      messages,
      toolCalls,
      toolFailures,
      activeDays: activeDates.size,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      durationMs,
      characters,
      excludedSubagent,
      excludedOld,
      excludedCapped,
    },
  }
}
