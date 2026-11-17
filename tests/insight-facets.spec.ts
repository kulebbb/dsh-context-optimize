/**
 * 标签缓存：读写、损坏容错、失效判断。
 *
 * 缓存决定第二次分析要不要重花 token，坏文件不能把整轮挡住。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import { facetStale, facetsDirOf, loadFacets, saveFacet } from '../src/host/insight/facets.ts'
import type { InsightFacetRecord, InsightSessionDigest } from '../src/shared/insight.ts'
import { makeTmpDir, removeTmpDir } from './helpers.ts'

let tmp = ''

beforeEach(async () => {
  tmp = await makeTmpDir('dco-facets')
})

afterEach(async () => {
  await removeTmpDir(tmp)
})

/** 造一条缓存记录。 */
function recordOf(sessionId: string, digestHash: string): InsightFacetRecord {
  return {
    sessionId,
    digestHash,
    lastSeq: 10,
    updatedAt: '2026-11-17T00:00:00.000Z',
    facet: { goal: 'g', outcome: 'o', sessionType: 't', frictions: [], wins: [], summary: 's' },
  }
}

/** 只关心摘要哈希的会话对象。 */
function digestOf(digestHash: string): InsightSessionDigest {
  return {
    id: 's1',
    title: 't',
    project: 'p',
    createdAt: 1,
    updatedAt: 2,
    turns: 1,
    steps: 1,
    userMessages: 1,
    assistantMessages: 1,
    toolCalls: 0,
    toolFailures: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    filesTouched: 0,
    models: [],
    lastSeq: 10,
    digest: 'd',
    digestHash,
  }
}

describe('facets 缓存', () => {
  it('写进去能读出来', async () => {
    await saveFacet(tmp, recordOf('s1', 'h1'))
    const loaded = await loadFacets(tmp)
    expect(loaded.get('s1')?.facet.goal).toBe('g')
    expect(loaded.get('s1')?.digestHash).toBe('h1')
  })

  it('目录不存在时返回空表', async () => {
    const loaded = await loadFacets(join(tmp, 'missing'))
    expect(loaded.size).toBe(0)
  })

  it('坏 JSON 被跳过，不影响其它条目', async () => {
    await saveFacet(tmp, recordOf('good', 'h1'))
    await mkdir(facetsDirOf(tmp), { recursive: true })
    await writeFile(join(facetsDirOf(tmp), 'bad.json'), '{ not json', 'utf8')
    const loaded = await loadFacets(tmp)
    expect(loaded.size).toBe(1)
    expect(loaded.has('good')).toBe(true)
  })

  it('摘要变了才算失效', () => {
    expect(facetStale(undefined, digestOf('h1'))).toBe(true)
    expect(facetStale(recordOf('s1', 'h1'), digestOf('h1'))).toBe(false)
    expect(facetStale(recordOf('s1', 'h1'), digestOf('h2'))).toBe(true)
  })
})
