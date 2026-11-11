/**
 * shared/catalog 的纯计算：token 估算、同名覆盖、排序、相对时间文案。
 *
 * 这些函数两半（宿主 / 客户端）都用，且没有副作用，适合用精确输入输出锁住行为；
 * 排序与时间用例尤其要固定输入，避免出现「今天跑绿、下周跑红」的脆弱断言。
 */
import { describe, expect, it } from 'vitest'
import {
  CHARS_PER_TOKEN,
  approxTokens,
  compareByCalls,
  compareByTokens,
  descriptionChars,
  filterByState,
  lastUsedLabel,
  markEffective,
} from '../src/shared/catalog.ts'
import type { SkillEntry } from '../src/shared/types.ts'
import { localDayOffset, makeEntry } from './helpers.ts'

describe('approxTokens', () => {
  it('等于 round(chars / 3.5)', () => {
    expect(CHARS_PER_TOKEN).toBe(3.5)
    for (const chars of [0, 3, 4, 7, 35, 36, 350, 351]) {
      expect(approxTokens(chars)).toBe(Math.round(chars / 3.5))
    }
  })

  it('几个具体值（防止系数被悄悄改成 4 或 3）', () => {
    expect(approxTokens(35)).toBe(10)
    expect(approxTokens(7)).toBe(2)
    expect(approxTokens(4)).toBe(1)
    expect(approxTokens(0)).toBe(0)
  })
})

describe('descriptionChars', () => {
  it('名字 + 描述 + 固定 8 字符分隔前缀', () => {
    expect(descriptionChars('foo', '描述')).toBe(3 + 2 + 8)
    expect(descriptionChars('', '')).toBe(8)
  })
})

describe('markEffective', () => {
  it('同名时 rank 小的生效，另一个标 false 并给出压住它的来源', () => {
    const bundled = makeEntry({ name: 'office', rootId: 'bundled', source: 'bundled', effective: false })
    const userAgents = makeEntry({ name: 'office', rootId: 'user-agents', source: 'user-agents', effective: true })
    const marked = markEffective([bundled, userAgents])

    expect(marked.find((entry) => entry.rootId === 'user-agents')).toMatchObject({ effective: true })
    expect(marked.find((entry) => entry.rootId === 'bundled')).toMatchObject({
      effective: false,
      overriddenBy: 'user-agents',
    })
    expect(marked.find((entry) => entry.rootId === 'bundled')?.overriddenBy).toBe('user-agents')
  })

  it('没有同名冲突的条目全部生效，且不带 overriddenBy', () => {
    const marked = markEffective([makeEntry({ name: 'alpha' }), makeEntry({ name: 'beta' })])
    expect(marked.map((entry) => entry.effective)).toEqual([true, true])
    expect(marked.every((entry) => entry.overriddenBy === undefined)).toBe(true)
  })

  it('三个根同名时只有 rank 最小者生效，其余都被它压住', () => {
    const entries = [
      makeEntry({ name: 'dup', rootId: 'bundled', source: 'bundled' }),
      makeEntry({ name: 'dup', rootId: 'user-agents', source: 'user-agents' }),
      makeEntry({ name: 'dup', rootId: 'project-dsh', source: 'project-dsh' }),
    ]
    const marked = markEffective(entries)
    const effective = marked.filter((entry) => entry.effective)
    expect(effective).toHaveLength(1)
    expect(effective[0]?.rootId).toBe('project-dsh')
    expect(marked.filter((entry) => !entry.effective).map((entry) => entry.overriddenBy)).toEqual([
      'project-dsh',
      'project-dsh',
    ])
  })

  it('结果与输入顺序无关（扫描顺序不能影响谁生效）', () => {
    const a = makeEntry({ name: 'dup', rootId: 'bundled', source: 'bundled' })
    const b = makeEntry({ name: 'dup', rootId: 'project-agents', source: 'project-agents' })
    expect(markEffective([a, b]).map((entry) => entry.effective)).toEqual([false, true])
    expect(markEffective([b, a]).map((entry) => entry.effective)).toEqual([true, false])
  })

  it('不修改入参，返回新对象', () => {
    const input = makeEntry({ name: 'alpha', effective: true })
    const marked = markEffective([input])
    expect(input.effective).toBe(true)
    expect(marked[0]).not.toBe(input)
    expect(marked[0]?.effective).toBe(true)
  })
})

describe('compareByCalls', () => {
  it('按调用次数降序；同次数按 token 降序；再同按名字升序', () => {
    const entries: SkillEntry[] = [
      makeEntry({ name: 'aaa', calls: 5, approxTokens: 10 }),
      makeEntry({ name: 'bbb', calls: 5, approxTokens: 20 }),
      makeEntry({ name: 'ccc', calls: 9, approxTokens: 1 }),
      makeEntry({ name: 'ddd', calls: 0, approxTokens: 100 }),
    ]
    expect([...entries].sort(compareByCalls).map((entry) => entry.name)).toEqual(['ccc', 'bbb', 'aaa', 'ddd'])
  })

  it('三项全同时有确定的次级排序（名字升序），不受输入顺序影响', () => {
    const make = (): SkillEntry[] => [
      makeEntry({ name: 'bbb', calls: 1, approxTokens: 3 }),
      makeEntry({ name: 'aaa', calls: 1, approxTokens: 3 }),
      makeEntry({ name: 'ccc', calls: 1, approxTokens: 3 }),
    ]
    expect(make().sort(compareByCalls).map((entry) => entry.name)).toEqual(['aaa', 'bbb', 'ccc'])
    expect(make().reverse().sort(compareByCalls).map((entry) => entry.name)).toEqual(['aaa', 'bbb', 'ccc'])
  })
})

describe('compareByTokens', () => {
  it('按 token 降序；同 token 按调用次数升序（越没用越靠前）；再同按名字升序', () => {
    const entries: SkillEntry[] = [
      makeEntry({ name: 'aaa', approxTokens: 100, calls: 9 }),
      makeEntry({ name: 'bbb', approxTokens: 100, calls: 2 }),
      makeEntry({ name: 'ccc', approxTokens: 50, calls: 100 }),
    ]
    expect([...entries].sort(compareByTokens).map((entry) => entry.name)).toEqual(['bbb', 'aaa', 'ccc'])
  })
})

describe('filterByState', () => {
  it('all 全返回；never-called 只留 0 次；archived 返回归档列表', () => {
    const entries = [makeEntry({ name: 'used', calls: 3 }), makeEntry({ name: 'unused', calls: 0 })]
    const archived = [makeEntry({ name: 'old', effective: false })]
    expect(filterByState(entries, 'all', archived)).toHaveLength(2)
    expect(filterByState(entries, 'never-called', archived).map((entry) => entry.name)).toEqual(['unused'])
    expect(filterByState(entries, 'archived', archived)).toBe(archived)
  })
})

describe('lastUsedLabel', () => {
  // 基准时刻用「本地时间构造器」而不是 Date.UTC：lastUsedLabel 按本地自然日算，
  // 混用 UTC 会在非 UTC 时区（比如本机 Asia/Shanghai）差出一整天。
  const now = new Date(2026, 10, 11, 10, 0, 0)

  it('0 次调用或没有日期时是「从未」', () => {
    expect(lastUsedLabel(null, 0, now)).toBe('从未')
    expect(lastUsedLabel('2026-11-10', 0, now)).toBe('从未')
    expect(lastUsedLabel(null, 5, now)).toBe('从未')
  })

  it('当天是「今天」，哪怕时间差超过 12 小时（按自然日不按时刻差）', () => {
    const lateNight = new Date(2026, 10, 11, 23, 59, 0)
    expect(lastUsedLabel(localDayOffset(now, 0), 1, lateNight)).toBe('今天')
  })

  it('1 天前是「昨天」', () => {
    expect(lastUsedLabel(localDayOffset(now, 1), 1, now)).toBe('昨天')
  })

  it('2 ~ 29 天显示「N 天前」', () => {
    expect(lastUsedLabel(localDayOffset(now, 2), 1, now)).toBe('2 天前')
    expect(lastUsedLabel(localDayOffset(now, 7), 1, now)).toBe('7 天前')
    expect(lastUsedLabel(localDayOffset(now, 29), 1, now)).toBe('29 天前')
  })

  it('满 30 天改显示「N 个月前」', () => {
    expect(lastUsedLabel(localDayOffset(now, 30), 1, now)).toBe('1 个月前')
    expect(lastUsedLabel(localDayOffset(now, 60), 1, now)).toBe('2 个月前')
    expect(lastUsedLabel(localDayOffset(now, 330), 1, now)).toBe('11 个月前')
  })

  it('满 12 个月改显示「N 年前」', () => {
    expect(lastUsedLabel(localDayOffset(now, 360), 1, now)).toBe('1 年前')
    expect(lastUsedLabel(localDayOffset(now, 720), 1, now)).toBe('2 年前')
  })

  it('日期串无法解析时给占位符，而不是 NaN 天', () => {
    expect(lastUsedLabel('not-a-date', 1, now)).toBe('—')
  })
})
