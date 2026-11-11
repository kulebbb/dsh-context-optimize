/**
 * 频次缓存的读写：一次回溯的成果落盘，之后靠增量累加。
 *
 * 缓存结构刻意按「会话」记账而不是按 skill 存一个总数——只有这样才答得了
 * 「这个 skill 在财务项目里用过几次」，以及算得出近 30 天。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { BackfillState } from '../shared/types.ts'

/** 缓存结构版本；改结构就升版本，旧文件会被忽略并重新回溯。 */
export const CACHE_VERSION = 2

/** 一个会话的用量小账本：skill 名 → 日期 → 次数。 */
export type SessionDays = Record<string, Record<string, number>>

/** 一个会话的记账。 */
export interface SessionUsageRecord {
  /** 该会话日志已处理到的最大 seq；实时事件靠它去重。 */
  lastSeq: number
  /** 会话创建时刻（毫秒）；用于算「统计范围」，旧缓存可能没有。 */
  createdAt?: number
  /** 会话工作目录，用于按项目归属；读不到时为 null。 */
  cwd: string | null
  /** 用量明细。 */
  days: SessionDays
}

/** 落盘的缓存。 */
export interface FrequencyCache {
  version: number
  generatedAt: number
  sessions: Record<string, SessionUsageRecord>
  backfill: BackfillState
}

/** 会话保留上限；超出的按「有记录优先、seq 大的优先」裁剪，避免缓存无限增长。 */
const MAX_SESSIONS = 5000

/**
 * 新建空缓存。
 * @returns 初始缓存。
 */
export function emptyCache(): FrequencyCache {
  return {
    version: CACHE_VERSION,
    generatedAt: 0,
    sessions: {},
    backfill: { state: 'idle', done: 0, total: 0 },
  }
}

/**
 * 读缓存。文件不存在、损坏或版本不符时返回空缓存，绝不抛错——首次运行是正常路径。
 *
 * @param path - 缓存文件绝对路径。
 * @returns 缓存对象。
 */
export async function loadCache(path: string): Promise<FrequencyCache> {
  let raw: string
  try {
    raw = await readFile(path, 'utf8')
  } catch {
    return emptyCache()
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return emptyCache()
    const record = parsed as Partial<FrequencyCache>
    if (record.version !== CACHE_VERSION || typeof record.sessions !== 'object' || record.sessions === null) {
      return emptyCache()
    }
    return {
      version: CACHE_VERSION,
      generatedAt: typeof record.generatedAt === 'number' ? record.generatedAt : 0,
      sessions: normalizeSessions(record.sessions),
      backfill: normalizeBackfill(record.backfill),
    }
  } catch {
    return emptyCache()
  }
}

/**
 * 原子写缓存：先写临时文件再 rename，断电或崩溃不会留下半个文件。
 *
 * @param path - 目标路径。
 * @param cache - 缓存对象。
 */
export async function saveCache(path: string, cache: FrequencyCache): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const pruned = pruneSessions({ ...cache, generatedAt: Date.now() })
  // 临时名带随机串：并发 flush 时不会互相覆盖同一个临时文件
  const tmp = `${path}.${String(process.pid)}.${Math.random().toString(36).slice(2, 8)}.tmp`
  await writeFile(tmp, JSON.stringify(pruned), 'utf8')
  await rename(tmp, path)
}

/**
 * 裁剪会话表，避免长期使用后无界增长。
 *
 * 规则：有调用记录的会话优先保留；同组内按已处理 seq 从大到小截断到上限。
 * @param cache - 原缓存。
 * @returns 可能裁剪过的副本。
 */
export function pruneSessions(cache: FrequencyCache): FrequencyCache {
  const ids = Object.keys(cache.sessions)
  if (ids.length <= MAX_SESSIONS) return cache
  const sorted = ids.sort((a, b) => {
    const left = cache.sessions[a]
    const right = cache.sessions[b]
    const leftHas = left !== undefined && Object.keys(left.days).length > 0 ? 1 : 0
    const rightHas = right !== undefined && Object.keys(right.days).length > 0 ? 1 : 0
    return rightHas - leftHas || (right?.lastSeq ?? 0) - (left?.lastSeq ?? 0)
  })
  const kept: Record<string, SessionUsageRecord> = {}
  for (const id of sorted.slice(0, MAX_SESSIONS)) {
    const record = cache.sessions[id]
    if (record !== undefined) kept[id] = record
  }
  return { ...cache, sessions: kept }
}

/**
 * 逐条校验会话记账。结构坏的一条只丢自己，不能因为它让整个面板 500——
 * `indexUsage` 会对 `record.days` 做 Object.entries，null 会让每个请求都炸。
 *
 * @param value - 缓存文件里的 sessions 字段。
 * @returns 只含合法记录的会话表。
 */
export function normalizeSessions(value: unknown): Record<string, SessionUsageRecord> {
  if (typeof value !== 'object' || value === null) return {}
  const out: Record<string, SessionUsageRecord> = {}
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) continue
    const record = raw as Record<string, unknown>
    const days = record['days']
    if (typeof days !== 'object' || days === null || Array.isArray(days)) continue
    const cleanDays: SessionDays = {}
    for (const [name, perDay] of Object.entries(days as Record<string, unknown>)) {
      if (typeof perDay !== 'object' || perDay === null || Array.isArray(perDay)) continue
      const cleanPerDay: Record<string, number> = {}
      for (const [day, count] of Object.entries(perDay as Record<string, unknown>)) {
        if (typeof count === 'number' && Number.isFinite(count) && count > 0) cleanPerDay[day] = count
      }
      if (Object.keys(cleanPerDay).length > 0) cleanDays[name] = cleanPerDay
    }
    const lastSeq = typeof record['lastSeq'] === 'number' && Number.isFinite(record['lastSeq']) ? record['lastSeq'] : -1
    const cwd = typeof record['cwd'] === 'string' ? record['cwd'] : null
    const createdAt = typeof record['createdAt'] === 'number' ? record['createdAt'] : undefined
    out[id] = { lastSeq, cwd, days: cleanDays, ...(createdAt === undefined ? {} : { createdAt }) }
  }
  return out
}

/** 把任意 backfill 字段归一成合法状态。 */
function normalizeBackfill(value: unknown): BackfillState {
  if (typeof value !== 'object' || value === null) return { state: 'idle', done: 0, total: 0 }
  const record = value as Partial<BackfillState>
  const state = record.state
  const legal = state === 'idle' || state === 'running' || state === 'done' || state === 'partial'
  return {
    state: legal ? state : 'idle',
    done: typeof record.done === 'number' ? record.done : 0,
    total: typeof record.total === 'number' ? record.total : 0,
  }
}
