/**
 * 频次记账：把会话日志折叠成「哪个 skill 哪天被用了几次」。
 *
 * 两个来源：
 * 1. **历史回溯**：首次启用时把本机全部会话日志读一遍（本机实测约 45 秒），结果落盘；
 * 2. **实时增量**：会话跑着的时候订阅 `session/event`，按 seq 水位去重后直接加。
 *
 * 计的是「模型通过 skill 工具加载该 skill」的次数，外加用户手敲 `/skill名` 直接触发的次数。
 */
import { toDateKey } from '../shared/catalog.ts'
import type { SessionDays, SessionUsageRecord } from './frequency-cache.ts'

/** 会话事件的最小结构；v0/v3/v4 日志与实时推送共用。 */
export interface SessionEventLike {
  type?: string
  seq?: number
  time?: number
  data?: unknown
}

/** 一个 skill 的用量汇总。 */
export interface UsageEntry {
  /** 全部历史次数。 */
  calls: number
  /** 近 30 天次数。 */
  calls30d: number
  /** 最后一次使用的日期 `YYYY-MM-DD`。 */
  lastUsedAt: string | null
}

/** 近 30 天的毫秒数。 */
const RECENT_WINDOW_MS = 30 * 86_400_000

/**
 * 从一条事件里取出它加载的 skill 名。
 *
 * 认两种形态：
 * - `tool/call` 且工具名是 `skill`，参数里带 `name`；
 * - `user/message` 且 `source.kind === 'skill-invocation'`（用户手敲 `/skill名`）。
 *
 * @param event - 一条会话事件。
 * @returns skill 名；不是这两类事件时返回 undefined。
 */
export function skillNameOf(event: SessionEventLike): string | undefined {
  const data = event.data
  if (typeof data !== 'object' || data === null) return undefined
  const record = data as Record<string, unknown>
  if (event.type === 'tool/call') {
    if (record['name'] !== 'skill') return undefined
    const raw = record['arguments']
    if (typeof raw !== 'string') return undefined
    try {
      const parsed: unknown = JSON.parse(raw)
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const name = (parsed as Record<string, unknown>)['name']
      return typeof name === 'string' && name !== '' ? name : undefined
    } catch {
      return undefined
    }
  }
  if (event.type === 'user/message') {
    const source = record['source']
    if (typeof source !== 'object' || source === null) return undefined
    const kind = (source as Record<string, unknown>)['kind']
    if (kind !== 'skill-invocation') return undefined
    const name = (source as Record<string, unknown>)['name']
    return typeof name === 'string' && name !== '' ? name : undefined
  }
  return undefined
}

/**
 * 把一批事件折叠进一个会话的记账里。
 *
 * 入参 `record` 会被原地修改；`lastSeq` 只增不减，因此同一批事件重复折叠不会重复计数。
 *
 * **事件必须按 seq 递增传入**：实现是顺序推进水位、跳过 `seq <= lastSeq` 的事件，
 * 乱序传入会把低 seq 的事件当成已处理而丢掉。回溯（日志本身有序）与实时推送（单条）
 * 都满足这个前提；将来若批量重放，先排序再调用。
 *
 * @param record - 该会话的记账（可以是新建的空账本）。
 * @param events - 事件列表，按 seq 递增。
 * @returns 更新后的记账。
 */
export function foldEvents(record: SessionUsageRecord, events: readonly SessionEventLike[]): SessionUsageRecord {
  for (const event of events) {
    const seq = typeof event.seq === 'number' ? event.seq : -1
    if (seq <= record.lastSeq) continue
    record.lastSeq = seq
    const name = skillNameOf(event)
    if (name === undefined) continue
    const time = typeof event.time === 'number' ? event.time : Date.now()
    const day = toDateKey(time)
    const perDay = record.days[name] ?? {}
    perDay[day] = (perDay[day] ?? 0) + 1
    record.days[name] = perDay
  }
  return record
}

/**
 * 新建一个空账本。
 * @param cwd - 会话工作目录。
 * @param createdAt - 会话创建时刻（毫秒）；用于算统计范围的起止日期。
 * @returns 空记账。
 */
export function newSessionRecord(cwd: string | null, createdAt?: number): SessionUsageRecord {
  return { lastSeq: -1, cwd, days: {}, ...(createdAt === undefined ? {} : { createdAt }) }
}

/**
 * 把整份缓存汇总成 skill → 用量。可按工作目录前缀过滤，用于项目范围。
 *
 * @param sessions - 会话记账表。
 * @param now - 基准时刻。
 * @param cwdUnder - 仅统计 cwd 落在该前缀下的会话；省略表示全部。
 * @returns 汇总结果。
 */
export function indexUsage(
  sessions: Readonly<Record<string, SessionUsageRecord>>,
  now: Date = new Date(),
  cwdUnder?: string,
): Map<string, UsageEntry> {
  const cutoff = toDateKey(now.getTime() - RECENT_WINDOW_MS)
  const index = new Map<string, UsageEntry>()
  for (const record of Object.values(sessions)) {
    if (cwdUnder !== undefined && !isUnder(record.cwd, cwdUnder)) continue
    for (const [name, perDay] of Object.entries(record.days)) {
      const current = index.get(name) ?? { calls: 0, calls30d: 0, lastUsedAt: null }
      for (const [day, count] of Object.entries(perDay)) {
        current.calls += count
        if (day >= cutoff) current.calls30d += count
        if (current.lastUsedAt === null || day > current.lastUsedAt) current.lastUsedAt = day
      }
      index.set(name, current)
    }
  }
  return index
}

/**
 * 判断 cwd 是否落在某个目录下。
 * @param cwd - 会话工作目录。
 * @param prefix - 目录前缀。
 * @returns 是否在目录下。
 */
function isUnder(cwd: string | null, prefix: string): boolean {
  if (cwd === null) return false
  const normalizedPrefix = prefix.replace(/[\\/]+$/, '')
  return cwd === normalizedPrefix || cwd.startsWith(`${normalizedPrefix}/`) || cwd.startsWith(`${normalizedPrefix}\\`)
}

/**
 * 合并两个用量（同一 skill 出现多次时用）。
 * @param into - 目标。
 * @param extra - 追加。
 * @returns 目标本身。
 */
export function mergeUsage(into: UsageEntry, extra: UsageEntry): UsageEntry {
  into.calls += extra.calls
  into.calls30d += extra.calls30d
  if (extra.lastUsedAt !== null && (into.lastUsedAt === null || extra.lastUsedAt > into.lastUsedAt)) {
    into.lastUsedAt = extra.lastUsedAt
  }
  return into
}

/** 供测试与诊断：把一个会话的全部明细摊平成日期 → 次数。 */
export function flattenDays(days: SessionDays): Record<string, number> {
  const flat: Record<string, number> = {}
  for (const perDay of Object.values(days)) {
    for (const [day, count] of Object.entries(perDay)) {
      flat[day] = (flat[day] ?? 0) + count
    }
  }
  return flat
}
