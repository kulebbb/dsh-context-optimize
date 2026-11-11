/**
 * 频次记账：事件识别、按 seq 水位去重、汇总与按项目切分。
 *
 * 这些函数直接决定面板上「调用 0 次」的结论；把非 skill 事件误认成调用会导致
 * “这个 skill 没用过”变成“用得很勤”，进而让归档建议完全反过来。
 */
import { describe, expect, it } from 'vitest'
import {
  flattenDays,
  foldEvents,
  indexUsage,
  mergeUsage,
  newSessionRecord,
  skillNameOf,
} from '../src/host/frequency.ts'
import type { SessionEventLike } from '../src/host/frequency.ts'
import type { SessionUsageRecord } from '../src/host/frequency-cache.ts'
import { localDayOffset, localDateKey } from './helpers.ts'

describe('skillNameOf', () => {
  it('认 tool/call：工具名是 skill，arguments 是带 name 的 JSON 字符串', () => {
    const event: SessionEventLike = {
      type: 'tool/call',
      data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) },
    }
    expect(skillNameOf(event)).toBe('alpha')
  })

  it('认 user/message：source.kind 是 skill-invocation（用户手敲 /skill名）', () => {
    const event: SessionEventLike = {
      type: 'user/message',
      data: { source: { kind: 'skill-invocation', name: 'beta' } },
    }
    expect(skillNameOf(event)).toBe('beta')
  })

  it('其他工具、坏 JSON、缺 name、空 name 一律返回 undefined', () => {
    const cases: SessionEventLike[] = [
      { type: 'tool/call', data: { name: 'bash', arguments: JSON.stringify({ name: 'alpha' }) } },
      { type: 'tool/call', data: { name: 'skill', arguments: 'not-json{' } },
      { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ path: 'x' }) } },
      { type: 'tool/call', data: { name: 'skill', arguments: JSON.stringify({ name: '' }) } },
      { type: 'tool/call', data: { name: 'skill', arguments: { name: 'alpha' } } },
      { type: 'tool/call', data: { name: 'skill' } },
    ]
    for (const event of cases) expect(skillNameOf(event)).toBeUndefined()
  })

  it('其他事件类型、缺 data、data 非对象都返回 undefined', () => {
    const cases: SessionEventLike[] = [
      { type: 'tool/result', data: { name: 'skill', arguments: '{"name":"a"}' } },
      { type: 'session/update', data: {} },
      { type: 'user/message', data: { source: { kind: 'text', name: 'alpha' } } },
      { type: 'user/message', data: { source: 'skill-invocation' } },
      { type: 'tool/call' },
      { type: 'tool/call', data: null },
      { type: 'tool/call', data: 'just-a-string' },
    ]
    for (const event of cases) expect(skillNameOf(event)).toBeUndefined()
  })
})

describe('foldEvents 水位去重', () => {
  const day0 = new Date(2026, 10, 11, 10, 0, 0).getTime()
  const day1 = new Date(2026, 10, 12, 10, 0, 0).getTime()

  const batch: SessionEventLike[] = [
    { type: 'tool/call', seq: 1, time: day0, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    { type: 'user/message', seq: 2, time: day0, data: { source: { kind: 'skill-invocation', name: 'beta' } } },
    { type: 'tool/call', seq: 3, time: day1, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    { type: 'tool/call', seq: 4, time: day0, data: { name: 'bash', arguments: '{}' } },
  ]

  it('按技能与日期记账，lastSeq 推进到最大 seq', () => {
    const record = newSessionRecord('/work/proj')
    foldEvents(record, batch)
    expect(record.lastSeq).toBe(4)
    expect(record.days['alpha']).toEqual({ [localDateKey(new Date(day0))]: 1, [localDateKey(new Date(day1))]: 1 })
    expect(record.days['beta']).toEqual({ [localDateKey(new Date(day0))]: 1 })
    expect(flattenDays(record.days)).toEqual({
      [localDateKey(new Date(day0))]: 2,
      [localDateKey(new Date(day1))]: 1,
    })
  })

  it('同一批事件折叠两次，计数不变（实时增量与回溯不会重复记）', () => {
    const record = newSessionRecord('/work/proj')
    foldEvents(record, batch)
    const snapshot = JSON.stringify(record)
    foldEvents(record, batch)
    expect(JSON.stringify(record)).toBe(snapshot)
    expect(record.lastSeq).toBe(4)
  })

  it('水位以下的旧事件不再计数，水位以上的新事件继续累加', () => {
    const record = newSessionRecord('/work/proj')
    foldEvents(record, batch)
    foldEvents(record, [
      { type: 'tool/call', seq: 4, time: day0, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
      { type: 'tool/call', seq: 5, time: day0, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    ])
    expect(record.lastSeq).toBe(5)
    expect(Object.values(record.days['alpha'] ?? {}).reduce((sum, count) => sum + count, 0)).toBe(3)
  })

  it('非 skill 事件也会推进水位，避免以后重复扫', () => {
    const record = newSessionRecord(null)
    foldEvents(record, [{ type: 'tool/call', seq: 9, data: { name: 'bash' } }])
    expect(record.lastSeq).toBe(9)
    expect(record.days).toEqual({})
    foldEvents(record, [
      { type: 'tool/call', seq: 2, data: { name: 'skill', arguments: JSON.stringify({ name: 'alpha' }) } },
    ])
    expect(record.days).toEqual({})
  })

  it('缺 seq 的事件被跳过（不猜一个水位出来）', () => {
    const record = newSessionRecord(null)
    foldEvents(record, [{ type: 'user/message', data: { source: { kind: 'skill-invocation', name: 'alpha' } } }])
    expect(record.lastSeq).toBe(-1)
    expect(record.days).toEqual({})
  })
})

describe('newSessionRecord', () => {
  it('空账本：水位 -1、无明细、cwd 可空', () => {
    expect(newSessionRecord('/work/proj')).toEqual({ lastSeq: -1, cwd: '/work/proj', days: {} })
    expect(newSessionRecord(null)).toEqual({ lastSeq: -1, cwd: null, days: {} })
  })
})

describe('indexUsage', () => {
  const now = new Date(2026, 10, 11, 12, 0, 0)
  const day = (offset: number): string => localDayOffset(now, offset)

  const sessions: Record<string, SessionUsageRecord> = {
    s1: {
      lastSeq: 10,
      cwd: '/work/proj',
      days: {
        alpha: { [day(0)]: 2, '2026-10-01': 1 },
        beta: { [day(5)]: 1 },
      },
    },
    s2: {
      lastSeq: 3,
      cwd: '/work/proj/sub',
      days: { alpha: { [day(2)]: 3 } },
    },
    s3: {
      lastSeq: 1,
      cwd: '/work/project-alpha',
      days: { alpha: { [day(0)]: 100 } },
    },
    s4: {
      lastSeq: 0,
      cwd: null,
      days: { gamma: { '2026-11-01': 1 } },
    },
  }

  it('汇总 total / 近 30 天 / lastUsedAt', () => {
    const usage = indexUsage(sessions, now)
    expect(usage.get('alpha')).toEqual({ calls: 106, calls30d: 105, lastUsedAt: day(0) })
    expect(usage.get('beta')).toEqual({ calls: 1, calls30d: 1, lastUsedAt: day(5) })
    expect(usage.get('gamma')).toEqual({ calls: 1, calls30d: 1, lastUsedAt: '2026-11-01' })
  })

  it('30 天窗口按日期字符串比较，窗口外的旧调用不计入 calls30d', () => {
    const usage = indexUsage(
      {
        old: { lastSeq: 1, cwd: '/w', days: { alpha: { [day(31)]: 4, [day(29)]: 2 } } },
      },
      now,
    )
    expect(usage.get('alpha')).toEqual({ calls: 6, calls30d: 2, lastUsedAt: day(29) })
  })

  it('传入 cwdUnder 时按工作目录前缀切分到某个项目', () => {
    const usage = indexUsage(sessions, now, '/work/proj')
    expect(usage.get('alpha')).toEqual({ calls: 6, calls30d: 5, lastUsedAt: day(0) })
    expect(usage.get('beta')).toEqual({ calls: 1, calls30d: 1, lastUsedAt: day(5) })
    expect(usage.has('gamma')).toBe(false)
  })

  it('前缀匹配有边界：/work/project-alpha 不算 /work/proj 下的项目', () => {
    const usage = indexUsage(sessions, now, '/work/proj')
    // 若实现用裸 startsWith('../'), s3 的 100 次会被错误地算进这个项目。
    expect(usage.get('alpha')?.calls).toBe(6)
  })

  it('前缀末尾带分隔符时结果一致', () => {
    const usage = indexUsage(sessions, now, '/work/proj/')
    expect(usage.get('alpha')?.calls).toBe(6)
  })

  it('cwd 为 null 的会话不归入任何项目，但算全局', () => {
    expect(indexUsage(sessions, now, '/work/proj').has('gamma')).toBe(false)
    expect(indexUsage(sessions, now).get('gamma')?.calls).toBe(1)
  })

  it('空会话表返回空 Map', () => {
    expect(indexUsage({}, now).size).toBe(0)
  })
})

describe('mergeUsage', () => {
  it('次数相加，lastUsedAt 取较晚的日期', () => {
    const into = { calls: 2, calls30d: 1, lastUsedAt: '2026-11-01' }
    mergeUsage(into, { calls: 3, calls30d: 2, lastUsedAt: '2026-11-05' })
    expect(into).toEqual({ calls: 5, calls30d: 3, lastUsedAt: '2026-11-05' })
    mergeUsage(into, { calls: 1, calls30d: 0, lastUsedAt: null })
    expect(into).toEqual({ calls: 6, calls30d: 3, lastUsedAt: '2026-11-05' })
  })
})
