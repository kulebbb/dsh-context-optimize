/**
 * 纯计算：token 估算、同名覆盖判定、排序、相对时间文案。
 *
 * 这些逻辑两半都要用（宿主算 token、客户端排列表与渲染「上次使用」），
 * 所以放在 shared 里，且不能 import 任何 node 内置模块。
 */
import { ROOT_RANK } from './roots.ts'
import type { RootId, SkillEntry, SkillStateFilter } from './types.ts'

/** 字符 → token 的估算系数；偏保守，宁可高估占用。 */
export const CHARS_PER_TOKEN = 3.5

/**
 * 估算 token 数。
 * @param chars - 字符数。
 * @returns 四舍五入后的 token 数。
 */
export function approxTokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN)
}

/**
 * 一条 skill 在会话目录里占用的字符数：名字 + 描述 + 固定分隔符。
 *
 * 固定 8 个字符对应目录里 `- \`name\`: ` 这段固定前缀与换行，够近似。
 * @param name - skill 名。
 * @param description - 描述正文。
 * @returns 字符数。
 */
export function descriptionChars(name: string, description: string): number {
  return name.length + description.length + 8
}

/**
 * 标记同名覆盖：rank 小的生效，其余标 effective=false 并给出压住它的来源。
 *
 * 入参不会被修改；返回新数组。
 * @param entries - 一个范围内的条目。
 * @returns 带 effective / overriddenBy 的新条目。
 */
export function markEffective(entries: readonly SkillEntry[]): SkillEntry[] {
  const winner = new Map<string, SkillEntry>()
  for (const entry of entries) {
    const current = winner.get(entry.name)
    if (current === undefined || ROOT_RANK[entry.rootId] < ROOT_RANK[current.rootId]) {
      winner.set(entry.name, entry)
    }
  }
  return entries.map((entry) => {
    const best = winner.get(entry.name)
    if (best === undefined || best === entry) return { ...entry, effective: true }
    return { ...entry, effective: false, overriddenBy: best.source }
  })
}

/** 按调用次数降序；同次数按占用降序，再按名字升序保证稳定。 */
export function compareByCalls(a: SkillEntry, b: SkillEntry): number {
  return b.calls - a.calls || b.approxTokens - a.approxTokens || a.name.localeCompare(b.name)
}

/** 按占用降序；同占用按调用次数升序（越没用越靠前）。 */
export function compareByTokens(a: SkillEntry, b: SkillEntry): number {
  return b.approxTokens - a.approxTokens || a.calls - b.calls || a.name.localeCompare(b.name)
}

/**
 * 按状态筛选条目。
 *
 * @param entries - 待筛选条目（archived 状态传归档条目）。
 * @param state - 目标状态。
 * @param archived - 归档条目列表；`state='archived'` 时返回它。
 * @returns 筛选后的条目。
 */
export function filterByState(
  entries: readonly SkillEntry[],
  state: SkillStateFilter,
  archived: readonly SkillEntry[] = [],
): readonly SkillEntry[] {
  if (state === 'archived') return archived
  if (state === 'never-called') return entries.filter((entry) => entry.calls === 0)
  return entries
}

/** 一天的毫秒数。 */
const DAY_MS = 86_400_000

/**
 * 「最近使用」文案：今天 / 昨天 / N 天前 / N 个月前 / N 年前。
 *
 * 按自然日算而不是按时刻差：同一天上午调用一次，不会因为差了 12 小时被算成「昨天」。
 *
 * @param lastUsedAt - `YYYY-MM-DD`；null 表示从未调用。
 * @param calls - 调用次数，为 0 时直接给「从未」。
 * @param now - 基准时刻，默认当前时间。
 * @returns 中文相对时间文案。
 */
export function lastUsedLabel(lastUsedAt: string | null, calls: number, now: Date = new Date()): string {
  if (calls === 0 || lastUsedAt === null) return '从未'
  // 两端都取本地零点再相减：混用 Date.UTC 会在非 UTC 时区差出一整天。
  const last = new Date(`${lastUsedAt}T00:00:00`)
  if (Number.isNaN(last.getTime())) return '—'
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const days = Math.round((today - last.getTime()) / DAY_MS)
  if (days <= 0) return '今天'
  if (days === 1) return '昨天'
  if (days < 30) return `${String(days)} 天前`
  const months = Math.round(days / 30)
  if (months < 12) return `${String(months)} 个月前`
  return `${String(Math.round(months / 12))} 年前`
}

/**
 * 把毫秒时间戳转成 `YYYY-MM-DD`（本地时区）。
 * @param ms - 毫秒时间戳。
 * @returns 日期字符串。
 */
export function toDateKey(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 汇总一组条目：数量、字符数、token、调用次数。 */
export interface CatalogTotals {
  readonly count: number
  readonly chars: number
  readonly tokens: number
  readonly calls: number
}

/**
 * 汇总一组条目。
 * @param entries - 条目列表。
 * @returns 汇总结果。
 */
export function totalsOf(entries: readonly SkillEntry[]): CatalogTotals {
  let chars = 0
  let tokens = 0
  let calls = 0
  for (const entry of entries) {
    chars += entry.descriptionChars
    tokens += entry.approxTokens
    calls += entry.calls
  }
  return { count: entries.length, chars, tokens, calls }
}

