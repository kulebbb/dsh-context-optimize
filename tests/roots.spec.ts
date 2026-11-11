/**
 * 五个 skill 根的定义与纯推导逻辑。
 *
 * 这些常量决定「同名 skill 谁生效」和「归档挪到哪」，写错了不会报错、只会静默错位，
 * 所以这里一律拿精确值断言，而不是断言「大概有序」。
 */
import { describe, expect, it } from 'vitest'
import {
  GLOBAL_ROOTS,
  PROJECT_ROOTS,
  ROOT_RANK,
  archiveDirFor,
  archiveSuffix,
  displayPath,
  isRemovableRoot,
  scopeOfRoot,
  sourceOfRoot,
} from '../src/shared/roots.ts'
import type { RootId } from '../src/shared/types.ts'

const ALL_ROOTS: readonly RootId[] = ['project-dsh', 'project-agents', 'user-dsh', 'user-agents', 'bundled']

describe('ROOT_RANK', () => {
  it('五个根按 DSH 的优先级精确排列（数字小的赢）', () => {
    expect(ROOT_RANK).toEqual({
      'project-dsh': 100,
      'project-agents': 200,
      'user-dsh': 400,
      'user-agents': 500,
      bundled: 600,
    })
  })

  it('优先级严格递增，没有并列（并列会让同名覆盖结果不确定）', () => {
    const ranks = ALL_ROOTS.map((id) => ROOT_RANK[id])
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks)
    expect(new Set(ranks).size).toBe(ALL_ROOTS.length)
  })
})

describe('范围与来源推导', () => {
  it('两个项目根属于 project，其余属于 global', () => {
    const project = ALL_ROOTS.filter((id) => scopeOfRoot(id) === 'project')
    const global = ALL_ROOTS.filter((id) => scopeOfRoot(id) === 'global')
    expect(project).toEqual(['project-dsh', 'project-agents'])
    expect(global).toEqual(['user-dsh', 'user-agents', 'bundled'])
    expect(PROJECT_ROOTS).toEqual(project)
    expect(GLOBAL_ROOTS).toEqual(global)
  })

  it('source 标签与根 ID 一一对应', () => {
    for (const id of ALL_ROOTS) expect(sourceOfRoot(id)).toBe(id)
  })
})

describe('isRemovableRoot', () => {
  it('只有内置根只读，其余四个根可归档', () => {
    expect(isRemovableRoot('bundled')).toBe(false)
    for (const id of ['project-dsh', 'project-agents', 'user-dsh', 'user-agents'] as const) {
      expect(isRemovableRoot(id)).toBe(true)
    }
  })
})

describe('archiveDirFor', () => {
  it('归档目录和 skills 目录同级，不是建在 skills 里面', () => {
    expect(archiveDirFor('/x/.agents/skills')).toBe('/x/.agents/skill-archive')
    expect(archiveDirFor('/Users/me/.dsh/skills')).toBe('/Users/me/.dsh/skill-archive')
  })

  it('末尾带分隔符时推导结果一致', () => {
    expect(archiveDirFor('/x/.agents/skills/')).toBe('/x/.agents/skill-archive')
  })

  it('多级路径只替换最后一段', () => {
    expect(archiveDirFor('/a/b/c/skills')).toBe('/a/b/c/skill-archive')
  })

  it('结果确实不在 skills 目录内部（防止归档箱建进仓库）', () => {
    const result = archiveDirFor('/x/.agents/skills')
    expect(result.startsWith('/x/.agents/skills/')).toBe(false)
    expect(result.split('/').includes('skills')).toBe(false)
  })
})

describe('displayPath', () => {
  it('home 下的路径渲染成 ~/...', () => {
    expect(displayPath('/Users/me/.agents/skills', '/Users/me')).toBe('~/.agents/skills')
    expect(displayPath('/Users/me/.dsh/skills', '/Users/me')).toBe('~/.dsh/skills')
  })

  it('home 自身渲染成 ~', () => {
    expect(displayPath('/Users/me', '/Users/me')).toBe('~')
  })

  it('home 外面的路径原样返回', () => {
    expect(displayPath('/opt/app/skills', '/Users/me')).toBe('/opt/app/skills')
  })

  it('home 末尾带分隔符时也能正确渲染', () => {
    expect(displayPath('/Users/me/.agents/skills', '/Users/me/')).toBe('~/.agents/skills')
  })

  it('前缀相同时不会把 /Users/me2 误认成 home 下的路径', () => {
    expect(displayPath('/Users/me2/skills', '/Users/me')).toBe('/Users/me2/skills')
  })
})

describe('archiveSuffix', () => {
  it('按本地时间生成 @YYYYMMDD-HHmmss，个位数补零', () => {
    const now = new Date(2026, 0, 2, 3, 4, 5)
    expect(archiveSuffix(now)).toBe('@20260102-030405')
  })
})
