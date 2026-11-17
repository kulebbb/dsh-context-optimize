/**
 * 报告落盘：把各层结果组装成一份 `report.json`，并写出 `report.html` 与索引。
 *
 * 目录约定（`~/.dsh/insight/`）：
 *   - `runs/<id>/report.json`、`runs/<id>/report.html`
 *   - `facets/<sessionId>.json`
 *   - `index.json`
 */
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  InsightHistoryEntry,
  InsightHygiene,
  InsightIndexFile,
  InsightReport,
  InsightReportMeta,
} from '../../shared/insight.ts'
import type { AggregateResult } from './analyze.ts'
import type { CollectResult } from './collect.ts'
import { renderReportHtml } from './html.ts'

/** 索引里最多留多少条；旧报告仍在磁盘上，只是不再列出来。 */
const MAX_INDEX_ENTRIES = 50

/** runs 目录。 */
export function runsDirOf(insightDir: string): string {
  return join(insightDir, 'runs')
}

/** 单次运行的目录。 */
export function runDirOf(insightDir: string, id: string): string {
  return join(runsDirOf(insightDir), id)
}

/** 运行 id 只允许这些字符，防止路径穿越。 */
export const RUN_ID_PATTERN = /^[0-9A-Za-z-]{8,40}$/

/**
 * 用本地时间生成运行 id：`2026-11-17T16-20-00`。
 *
 * 不做时区转换（用户看到的就是本地时间），同一秒内重复时由调用方加后缀。
 */
export function runIdOf(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return [
    `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  ].join('')
}

/** 组装报告。 */
export interface BuildReportInput {
  readonly id: string
  readonly startedAt: Date
  readonly finishedAt: Date
  readonly days: number | null
  readonly provider: string
  readonly model: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly failedSessions: number
  readonly collect: CollectResult
  readonly aggregate: AggregateResult
  readonly hygiene: InsightHygiene | null
}

/** 把两层结果合成一份可渲染的报告。 */
export function buildReport(input: BuildReportInput): InsightReport {
  const { collect, aggregate } = input
  const meta: InsightReportMeta = {
    id: input.id,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    days: input.days,
    provider: input.provider,
    model: input.model,
    durationMs: input.finishedAt.getTime() - input.startedAt.getTime(),
    tokens: input.inputTokens + input.outputTokens + input.cacheReadTokens,
  }
  return {
    version: 1,
    meta,
    glance: aggregate.glance,
    stats: { ...collect.stats, failedSessions: input.failedSessions },
    projects: collect.projects,
    tools: collect.tools,
    hours: collect.hours,
    frictions: aggregate.frictions,
    wins: aggregate.wins,
    suggestions: aggregate.suggestions,
    hygiene: input.hygiene,
    fun: aggregate.fun,
  }
}

/** 从报告派生索引行。 */
export function historyEntryOf(report: InsightReport, status: InsightHistoryEntry['status']): InsightHistoryEntry {
  return {
    id: report.meta.id,
    startedAt: report.meta.startedAt,
    finishedAt: report.meta.finishedAt,
    status,
    days: report.meta.days,
    sessions: report.stats.sessions,
    tokens: report.meta.tokens,
    provider: report.meta.provider,
    model: report.meta.model,
    durationMs: report.meta.durationMs,
    failedSessions: report.stats.failedSessions,
  }
}

/**
 * 写一份报告：先写临时目录再改名，避免面板读到半个文件。
 *
 * @param insightDir - `~/.dsh/insight`。
 * @param report - 组装好的报告。
 * @returns 报告目录与 HTML 绝对路径。
 */
export async function writeReport(
  insightDir: string,
  report: InsightReport,
): Promise<{ dir: string; htmlPath: string }> {
  const dir = runDirOf(insightDir, report.meta.id)
  const temp = `${dir}.tmp`
  await rm(temp, { recursive: true, force: true })
  await mkdir(temp, { recursive: true })
  await writeFile(join(temp, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  await writeFile(join(temp, 'report.html'), renderReportHtml(report), 'utf8')
  await rm(dir, { recursive: true, force: true })
  await rename(temp, dir)
  return { dir, htmlPath: join(dir, 'report.html') }
}

/** 读一份报告；不存在或损坏时抛错，由路由层转成 404。 */
export async function readReport(insightDir: string, id: string): Promise<InsightReport | null> {
  if (!RUN_ID_PATTERN.test(id)) return null
  try {
    const raw = await readFile(join(runDirOf(insightDir, id), 'report.json'), 'utf8')
    const parsed = JSON.parse(raw) as InsightReport
    return parsed.version === 1 ? parsed : null
  } catch {
    return null
  }
}

/** 删除一次运行的目录；索引条目由调用方一并清掉。 */
export async function removeRun(insightDir: string, id: string): Promise<boolean> {
  if (!RUN_ID_PATTERN.test(id)) return false
  const dir = runDirOf(insightDir, id)
  try {
    await access(dir)
  } catch {
    return false
  }
  try {
    await rm(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

/** 目录里实际存在的报告 id（新的在前）。 */
export async function listRunIds(insightDir: string): Promise<string[]> {
  try {
    const names = await readdir(runsDirOf(insightDir))
    return names.filter((name) => RUN_ID_PATTERN.test(name)).sort().reverse()
  } catch {
    return []
  }
}

/** 读索引；没有或损坏时返回空索引。 */
export async function loadIndex(insightDir: string): Promise<InsightIndexFile> {
  try {
    const raw = await readFile(join(insightDir, 'index.json'), 'utf8')
    const parsed = JSON.parse(raw) as Partial<InsightIndexFile>
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) return { version: 1, entries: [] }
    const entries = parsed.entries.filter(
      (entry): entry is InsightHistoryEntry =>
        typeof entry === 'object' && entry !== null && typeof (entry as InsightHistoryEntry).id === 'string',
    )
    return { version: 1, entries }
  } catch {
    return { version: 1, entries: [] }
  }
}

/** 写索引；同样先写临时文件再改名。 */
export async function saveIndex(insightDir: string, entries: readonly InsightHistoryEntry[]): Promise<void> {
  await mkdir(insightDir, { recursive: true })
  const sorted = [...entries]
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, MAX_INDEX_ENTRIES)
  const target = join(insightDir, 'index.json')
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify({ version: 1, entries: sorted }, null, 2), 'utf8')
  await rename(temp, target)
}

/** 追加一条索引（同 id 覆盖，新的在前）。 */
export async function appendIndex(insightDir: string, entry: InsightHistoryEntry): Promise<void> {
  const index = await loadIndex(insightDir)
  const rest = index.entries.filter((item) => item.id !== entry.id)
  await saveIndex(insightDir, [entry, ...rest])
}

/** 从索引里删掉一条。 */
export async function removeIndexEntry(insightDir: string, id: string): Promise<void> {
  const index = await loadIndex(insightDir)
  await saveIndex(insightDir, index.entries.filter((item) => item.id !== id))
}
