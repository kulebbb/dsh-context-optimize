/**
 * 频次缓存的读写与降级。
 *
 * 缓存是「首次运行体验」的关键：读不出来必须降级成空缓存重扫，绝不能把面板打崩；
 * 写入必须是原子的，否则断电留下半个 JSON 会让下次启动一直读空。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  CACHE_VERSION,
  emptyCache,
  loadCache,
  pruneSessions,
  saveCache,
} from '../src/host/frequency-cache.ts'
import type { FrequencyCache, SessionUsageRecord } from '../src/host/frequency-cache.ts'
import { makeTmpDir, removeTmpDir } from './helpers.ts'

let tmp = ''
let cachePath = ''

beforeEach(async () => {
  tmp = await makeTmpDir('dco-cache')
  cachePath = join(tmp, 'storages', 'dco', 'frequency.v1.json')
})

afterEach(async () => {
  await removeTmpDir(tmp)
})

/** 一份带真实结构的小缓存。 */
function sampleCache(): FrequencyCache {
  const sessions: Record<string, SessionUsageRecord> = {
    'session-a': {
      lastSeq: 7,
      cwd: '/work/proj',
      days: { alpha: { '2026-11-10': 2, '2026-11-11': 1 }, beta: { '2026-11-01': 1 } },
    },
    'session-b': { lastSeq: 2, cwd: null, days: { alpha: { '2026-11-11': 1 } } },
  }
  return {
    version: CACHE_VERSION,
    generatedAt: 123,
    sessions,
    backfill: { state: 'done', done: 12, total: 12 },
  }
}

describe('emptyCache', () => {
  it('空缓存结构合法、版本号是当前版本、回溯状态为 idle', () => {
    const cache = emptyCache()
    expect(cache.version).toBe(CACHE_VERSION)
    expect(cache.sessions).toEqual({})
    expect(cache.backfill).toEqual({ state: 'idle', done: 0, total: 0 })
  })
})

describe('loadCache 的降级路径', () => {
  it('文件不存在时返回空缓存，不抛错（首次运行是正常路径）', async () => {
    const cache = await loadCache(cachePath)
    expect(cache).toEqual(emptyCache())
    expect(cache.sessions).toEqual({})
  })

  it('文件内容损坏（不是 JSON）时返回空缓存', async () => {
    await saveCache(cachePath, emptyCache())
    await writeFile(cachePath, '{ this is not json', 'utf8')
    const cache = await loadCache(cachePath)
    expect(cache.version).toBe(CACHE_VERSION)
    expect(cache.sessions).toEqual({})
  })

  it('version 不匹配时忽略旧文件并返回空缓存（改结构后自动重扫）', async () => {
    await saveCache(cachePath, emptyCache())
    const stale = { ...sampleCache(), version: CACHE_VERSION - 1 }
    await writeFile(cachePath, JSON.stringify(stale), 'utf8')
    const cache = await loadCache(cachePath)
    expect(cache.sessions).toEqual({})
    expect(cache.version).toBe(CACHE_VERSION)
  })

  it('顶层不是对象（比如数组或 null）时返回空缓存', async () => {
    await saveCache(cachePath, emptyCache())
    for (const raw of ['[]', 'null', '"text"']) {
      await writeFile(cachePath, raw, 'utf8')
      const cache = await loadCache(cachePath)
      expect(cache.sessions).toEqual({})
    }
  })

  it('sessions 字段缺失或为 null 时返回空缓存', async () => {
    await saveCache(cachePath, emptyCache())
    await writeFile(cachePath, JSON.stringify({ version: CACHE_VERSION, sessions: null }), 'utf8')
    expect((await loadCache(cachePath)).sessions).toEqual({})
    await writeFile(cachePath, JSON.stringify({ version: CACHE_VERSION }), 'utf8')
    expect((await loadCache(cachePath)).sessions).toEqual({})
  })

  it('backfill 字段不合法时归一成 idle，而不是把脏数据透传给面板', async () => {
    await saveCache(cachePath, emptyCache())
    await writeFile(
      cachePath,
      JSON.stringify({ version: CACHE_VERSION, sessions: {}, backfill: { state: 'weird', done: 'x' } }),
      'utf8',
    )
    expect((await loadCache(cachePath)).backfill).toEqual({ state: 'idle', done: 0, total: 0 })
  })
})

describe('saveCache / loadCache 往返', () => {
  it('落盘后能原样读回会话明细与回溯状态', async () => {
    const original = sampleCache()
    await saveCache(cachePath, original)
    const loaded = await loadCache(cachePath)
    expect(loaded.version).toBe(CACHE_VERSION)
    expect(loaded.sessions).toEqual(original.sessions)
    expect(loaded.backfill).toEqual(original.backfill)
    // generatedAt 由 saveCache 覆盖成写入时刻，只验证它是数字。
    expect(typeof loaded.generatedAt).toBe('number')
    expect(loaded.generatedAt).toBeGreaterThan(0)
  })

  it('缓存目录不存在时会自动创建', async () => {
    const deep = join(tmp, 'a', 'b', 'c', 'cache.json')
    await saveCache(deep, sampleCache())
    await expect(readFile(deep, 'utf8')).resolves.toContain('session-a')
  })

  it('覆盖写已有文件（从损坏内容恢复）', async () => {
    await saveCache(cachePath, emptyCache())
    await writeFile(cachePath, 'broken', 'utf8')
    await saveCache(cachePath, sampleCache())
    expect((await loadCache(cachePath)).sessions['session-a']?.days['alpha']).toEqual({
      '2026-11-10': 2,
      '2026-11-11': 1,
    })
  })
})

describe('原子写', () => {
  it('写完后目录里不留 .tmp 文件', async () => {
    await saveCache(cachePath, sampleCache())
    const files = await readdir(dirname(cachePath))
    expect(files).toEqual(['frequency.v1.json'])
    expect(files.some((name) => name.endsWith('.tmp'))).toBe(false)
  })

  it('连续写两次也不留临时文件', async () => {
    await saveCache(cachePath, emptyCache())
    await saveCache(cachePath, sampleCache())
    const files = await readdir(dirname(cachePath))
    expect(files.filter((name) => name.endsWith('.tmp'))).toEqual([])
  })
})

describe('pruneSessions', () => {
  it('会话数超过上限时裁剪到 5000，并优先保留有调用记录的会话', () => {
    // 上限 5000 是源码契约：避免长期使用后缓存无界增长。
    const sessions: Record<string, SessionUsageRecord> = {}
    for (let i = 0; i < 5001; i += 1) {
      sessions[`s-${String(i).padStart(4, '0')}`] = { lastSeq: i, cwd: null, days: {} }
    }
    sessions['with-usage'] = { lastSeq: 0, cwd: '/p', days: { alpha: { '2026-11-11': 1 } } }

    const pruned = pruneSessions({ ...emptyCache(), sessions })
    const ids = Object.keys(pruned.sessions)
    expect(ids).toHaveLength(5000)
    expect(ids).toContain('with-usage')
    expect(Object.keys(sessions)).toHaveLength(5002)
  })

  it('未超上限时原样返回，不做无谓复制', () => {
    const cache = { ...emptyCache(), sessions: sampleCache().sessions }
    expect(pruneSessions(cache)).toBe(cache)
  })
})
