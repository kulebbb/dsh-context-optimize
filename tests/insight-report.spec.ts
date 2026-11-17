/**
 * 报告落盘：结构组装、索引、HTML 导出（含转义）。
 *
 * 这里不调模型，直接喂构造好的统计与汇总结果。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { access, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  appendIndex,
  buildReport,
  historyEntryOf,
  loadIndex,
  markIndexRead,
  readReport,
  removeIndexEntry,
  removeRun,
  runIdOf,
  writeReport,
} from '../src/host/insight/report.ts'
import { escapeHtml, renderReportHtml } from '../src/host/insight/html.ts'
import type { AggregateResult } from '../src/host/insight/analyze.ts'
import type { CollectResult } from '../src/host/insight/collect.ts'
import { makeTmpDir, removeTmpDir } from './helpers.ts'

let tmp = ''

beforeEach(async () => {
  tmp = await makeTmpDir('dco-report')
})

afterEach(async () => {
  await removeTmpDir(tmp)
})

/** 最小可用的采集结果。 */
function collectOf(): CollectResult {
  return {
    sessions: [],
    projects: [{ name: 'demo', sessions: 2 }],
    tools: [{ name: 'read', calls: 3, failures: 0 }],
    hours: Array.from({ length: 24 }, (_unused, hour) => ({ hour, sessions: hour === 9 ? 2 : 0 })),
    stats: {
      sessions: 2,
      messages: 3,
      toolCalls: 3,
      toolFailures: 0,
      activeDays: 1,
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      durationMs: 60_000,
      characters: 100,
      excludedSubagent: 4,
      excludedOld: 1,
      excludedCapped: 0,
    },
  }
}

/** 最小可用的汇总结果。 */
function aggregateOf(): AggregateResult {
  return {
    glance: { working: '先写约束', friction: '需求分几次说', next: '加一条复述规则' },
    frictions: [
      {
        title: '需求分几次说全',
        detail: '方向到第三轮才发现不对',
        count: 2,
        examples: [{ quote: '不是这个意思', project: 'demo', date: '2026-11-12', sessionId: 's1' }],
      },
    ],
    wins: [{ title: '先写设计约束', detail: '返工更少' }],
    suggestions: [{ title: '先复述再动手', detail: '确认后再改', where: 'agents', snippet: '先复述目标' }],
    fun: '凌晨两点还在改树',
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
  }
}

/** 组装一份报告。 */
function reportOf(id = '2026-11-17T16-20-00') {
  return buildReport({
    id,
    startedAt: new Date('2026-11-17T08:20:00.000Z'),
    finishedAt: new Date('2026-11-17T08:24:12.000Z'),
    days: 30,
    provider: 'magpie',
    model: 'demo-model',
    inputTokens: 1000,
    outputTokens: 200,
    cacheReadTokens: 0,
    failedSessions: 0,
    collect: collectOf(),
    aggregate: aggregateOf(),
    hygiene: { active: 14, unused30d: 5, unusedTokens: 531, examples: ['image-diff'], complete: true },
  })
}

describe('buildReport', () => {
  it('把两层结果合成一份报告', () => {
    const report = reportOf()
    expect(report.meta.tokens).toBe(1200)
    expect(report.meta.durationMs).toBe(252_000)
    expect(report.stats.sessions).toBe(2)
    expect(report.frictions[0]?.count).toBe(2)
    expect(report.hygiene?.unused30d).toBe(5)
  })

  it('索引行从报告派生', () => {
    const entry = historyEntryOf(reportOf(), 'done')
    expect(entry.sessions).toBe(2)
    expect(entry.status).toBe('done')
    expect(entry.days).toBe(30)
  })
})

describe('运行 id', () => {
  it('是文件名安全的本地时间', () => {
    const id = runIdOf(new Date(2026, 10, 17, 16, 20, 5))
    expect(id).toBe('2026-11-17T16-20-05')
  })
})

describe('落盘与索引', () => {
  it('写报告后能读回来，并生成 HTML', async () => {
    const report = reportOf()
    const { htmlPath } = await writeReport(tmp, report)
    await expect(access(htmlPath)).resolves.toBeUndefined()
    const loaded = await readReport(tmp, report.meta.id)
    expect(loaded?.meta.id).toBe(report.meta.id)
    const runs = await readdir(join(tmp, 'runs'))
    expect(runs).toEqual([report.meta.id])
  })

  it('索引追加、覆盖同 id、删除', async () => {
    await appendIndex(tmp, historyEntryOf(reportOf('a'), 'done'))
    await appendIndex(tmp, historyEntryOf(reportOf('b'), 'done'))
    await appendIndex(tmp, { ...historyEntryOf(reportOf('a'), 'done'), sessions: 9 })
    let index = await loadIndex(tmp)
    expect(index.entries).toHaveLength(2)
    expect(index.entries.find((item) => item.id === 'a')?.sessions).toBe(9)

    await removeIndexEntry(tmp, 'a')
    index = await loadIndex(tmp)
    expect(index.entries.map((item) => item.id)).toEqual(['b'])
  })

  it('删除报告目录', async () => {
    const report = reportOf()
    await writeReport(tmp, report)
    await expect(removeRun(tmp, report.meta.id)).resolves.toBe(true)
    await expect(readReport(tmp, report.meta.id)).resolves.toBeNull()
  })

  it('非法 id 不读不删', async () => {
    await expect(readReport(tmp, '../etc/passwd')).resolves.toBeNull()
    await expect(removeRun(tmp, '../etc/passwd')).resolves.toBe(false)
  })
})

describe('HTML 导出', () => {
  it('转义用户文本，不执行标签', () => {
    const report = reportOf()
    const html = renderReportHtml({
      ...report,
      glance: { ...report.glance, working: '<script>alert(1)</script>' },
      fun: '<img src=x onerror=1>',
    })
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;img src=x onerror=1&gt;')
  })

  it('是自包含的：没有外部脚本、样式或图片引用', async () => {
    const html = renderReportHtml(reportOf())
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/<link\b/i)
    expect(html).not.toMatch(/<img\b/i)
    expect(html).toContain('<style>')
  })

  it('包含主要板块', () => {
    const html = renderReportHtml(reportOf())
    for (const text of ['先看这三条', '反复卡住的', '有效的习惯', '上下文卫生', '顺手记下的一幕']) {
      expect(html).toContain(text)
    }
  })

  it('escapeHtml 处理五个字符', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;')
  })

  it('导出的文件写在运行目录里', async () => {
    const { htmlPath } = await writeReport(tmp, reportOf())
    const html = await readFile(htmlPath, 'utf8')
    expect(html.startsWith('<!doctype html>')).toBe(true)
  })
})

describe('未读状态', () => {
  it('新报告默认未读，标已读只写一次', async () => {
    const report = buildReport({
      id: '2026-11-17T16-20-00',
      startedAt: new Date('2026-11-17T16:20:00+08:00'),
      finishedAt: new Date('2026-11-17T16:24:00+08:00'),
      days: 30,
      provider: 'p',
      model: 'm',
      inputTokens: 10,
      outputTokens: 5,
      cacheReadTokens: 0,
      failedSessions: 0,
      collect: collectOf(),
      aggregate: aggregateOf(),
      hygiene: null,
    })
    const entry = historyEntryOf(report, 'done')
    expect(entry.readAt).toBeNull()

    await appendIndex(tmp, entry)
    await expect(markIndexRead(tmp, entry.id, '2026-11-17T17:00:00.000Z')).resolves.toBe(true)
    const index = await loadIndex(tmp)
    expect(index.entries[0]?.readAt).toBe('2026-11-17T17:00:00.000Z')

    // 已经读过的再标一次不覆盖时间，也不报错。
    await expect(markIndexRead(tmp, entry.id, '2026-11-18T00:00:00.000Z')).resolves.toBe(true)
    const again = await loadIndex(tmp)
    expect(again.entries[0]?.readAt).toBe('2026-11-17T17:00:00.000Z')

    await expect(markIndexRead(tmp, 'missing', '2026-11-18T00:00:00.000Z')).resolves.toBe(false)
  })

  it('旧索引没有 readAt 时当作已读，不会凭空多出未读点', async () => {
    const legacy = {
      version: 1,
      entries: [
        {
          id: '2026-11-01T10-00-00',
          startedAt: '2026-11-01T10:00:00.000Z',
          finishedAt: '2026-11-01T10:05:00.000Z',
          status: 'done',
          days: 30,
          sessions: 3,
          tokens: 100,
          provider: 'p',
          model: 'm',
          durationMs: 300000,
          failedSessions: 0,
        },
      ],
    }
    const { writeFile } = await import('node:fs/promises')
    await writeFile(join(tmp, 'index.json'), JSON.stringify(legacy), 'utf8')
    const index = await loadIndex(tmp)
    expect(index.entries[0]?.readAt).toBe('2026-11-01T10:05:00.000Z')
  })
})
