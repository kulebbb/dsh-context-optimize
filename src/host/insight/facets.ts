/**
 * 标签缓存：每个会话一张标签卡，存在 `<insightDir>/facets/<sessionId>.json`。
 *
 * 缓存的意义不是省磁盘而是省 token：第二次分析只对摘要变化过的会话重新打标签。
 * 缓存损坏时直接跳过（当作没缓存），不能让一份坏文件挡住整轮分析。
 */
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { InsightFacetRecord, InsightSessionDigest } from '../../shared/insight.ts'

/** facets 目录。 */
export function facetsDirOf(insightDir: string): string {
  return join(insightDir, 'facets')
}

/** 只接受看起来像会话 id 的文件名，防止读到目录里的杂物。 */
const FACET_FILE = /^[A-Za-z0-9._-]+\.json$/

/** 会话 id 的合法字符；写入路径前再校验一次，作为纵深防御。 */
const SESSION_ID = /^[A-Za-z0-9._-]+$/

/**
 * 读取全部缓存。
 *
 * @param insightDir - `~/.dsh/insight`。
 * @returns 会话 id → 标签记录；目录不存在或单文件坏掉都给空/跳过。
 */
export async function loadFacets(insightDir: string): Promise<Map<string, InsightFacetRecord>> {
  const dir = facetsDirOf(insightDir)
  const result = new Map<string, InsightFacetRecord>()
  let files: string[]
  try {
    files = await readdir(dir)
  } catch {
    return result
  }
  for (const file of files) {
    if (!FACET_FILE.test(file)) continue
    try {
      const raw = await readFile(join(dir, file), 'utf8')
      const parsed: unknown = JSON.parse(raw)
      const record = parsed as Partial<InsightFacetRecord>
      if (
        typeof record.sessionId !== 'string' ||
        typeof record.digestHash !== 'string' ||
        typeof record.updatedAt !== 'string' ||
        record.facet === undefined
      ) {
        continue
      }
      result.set(record.sessionId, record as InsightFacetRecord)
    } catch {
      // 坏文件当作没有缓存，下轮会重算并覆盖它。
    }
  }
  return result
}

/** 写入一份缓存；先写临时文件再改名，避免进程中断留下半个 JSON。 */
export async function saveFacet(insightDir: string, record: InsightFacetRecord): Promise<void> {
  if (!SESSION_ID.test(record.sessionId) || record.sessionId.includes('..')) {
    throw new Error(`非法的会话 id：${record.sessionId}`)
  }
  const dir = facetsDirOf(insightDir)
  await mkdir(dir, { recursive: true })
  const target = join(dir, `${record.sessionId}.json`)
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify(record, null, 2), 'utf8')
  await rename(temp, target)
}

/** 这条会话的摘要是否变了；变了才需要重新打标签。 */
export function facetStale(
  cached: InsightFacetRecord | undefined,
  digest: InsightSessionDigest,
): boolean {
  if (cached === undefined) return true
  return cached.digestHash !== digest.digestHash
}
