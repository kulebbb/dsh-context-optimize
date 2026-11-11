/**
 * 扫描 skill 根：frontmatter 解析、扁平 .md、软链与层级边界。
 *
 * 这里是真 bug 的高发区，且两个已经修过的坑必须留用例守住：
 * 1. `description: |` 块语法必须被正确解析（手写正则会读成空串，token 统计跟着失真）；
 * 2. 软链 skill 必须被扫到（靠 stat 跟随软链，而不是 dirent.isDirectory()）。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import {
  globalRoots,
  homePaths,
  projectRoots,
  readSkillMeta,
  scanArchiveDir,
  scanSkillRoot,
} from '../src/host/skill-scan.ts'
import type { HomePaths, ResolvedRoot } from '../src/host/skill-scan.ts'
import {
  makeFlatSkill,
  makeSkillDir,
  makeSymlinkSkill,
  makeTmpDir,
  removeTmpDir,
  writeAt,
} from './helpers.ts'

let tmp = ''
let skillsDir = ''

/** 一个临时的 user-agents 根。 */
function rootOf(path = skillsDir): ResolvedRoot {
  return { id: 'user-agents', path, display: '~/.agents/skills', removable: true }
}

beforeEach(async () => {
  tmp = await makeTmpDir('dco-scan')
  skillsDir = join(tmp, 'agents', 'skills')
  await mkdir(skillsDir, { recursive: true })
})

afterEach(async () => {
  await removeTmpDir(tmp)
})

describe('frontmatter 的三种写法', () => {
  it('单行 description 能解析出 name 与 description', async () => {
    await makeSkillDir(
      skillsDir,
      'single-dir',
      '---\nname: single-line\ndescription: 单行描述\n---\n\n# 正文\n',
    )
    const [entry] = await scanSkillRoot(rootOf())
    expect(entry).toMatchObject({ dirName: 'single-dir', name: 'single-line', description: '单行描述' })
  })

  it('块语法 description: | 的多行描述完整保留（不能被解析成空串）', async () => {
    await makeSkillDir(
      skillsDir,
      'block-dir',
      '---\nname: block-skill\ndescription: |\n  第一行描述\n  第二行描述\n---\n',
    )
    const [entry] = await scanSkillRoot(rootOf())
    expect(entry?.name).toBe('block-skill')
    expect(entry?.description).toBe('第一行描述\n第二行描述')
    expect(entry?.description.length).toBeGreaterThan(0)
  })

  it('完全没有 frontmatter 时 name 退回目录名，description 为空', async () => {
    await makeSkillDir(skillsDir, 'plain-dir', '# 只有正文\n没有 frontmatter\n')
    const [entry] = await scanSkillRoot(rootOf())
    expect(entry).toMatchObject({ dirName: 'plain-dir', name: 'plain-dir', description: '' })
  })

  it('有 frontmatter 但缺 name 时退回目录名，description 仍然解析', async () => {
    await makeSkillDir(skillsDir, 'only-description', '---\ndescription: 只写了描述\n---\n')
    const [entry] = await scanSkillRoot(rootOf())
    expect(entry).toMatchObject({ name: 'only-description', description: '只写了描述' })
  })

  it('YAML 损坏时降级返回目录名与空描述，不抛错', async () => {
    await makeSkillDir(skillsDir, 'broken-yaml', '---\ndescription: [未闭合\n---\n')
    const entries = await scanSkillRoot(rootOf())
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ name: 'broken-yaml', description: '' })
  })

  it('readSkillMeta 在文件读不到时返回 undefined', async () => {
    await expect(readSkillMeta(join(tmp, 'nope.md'), 'fallback')).resolves.toBeUndefined()
  })
})

describe('扁平 .md 型 skill', () => {
  it('根下第一层的 .md 被扫到，kind 为 flat，dirName 去掉扩展名', async () => {
    await makeFlatSkill(skillsDir, 'flat-skill', '---\nname: flat-name\ndescription: 扁平型\n---\n')
    const [entry] = await scanSkillRoot(rootOf())
    expect(entry?.kind).toBe('flat')
    expect(entry?.dirName).toBe('flat-skill')
    expect(entry?.name).toBe('flat-name')
    expect(entry?.skillFile.endsWith('flat-skill.md')).toBe(true)
    // 扁平型没有自己的目录，「打开目录」指向根目录。
    expect(entry?.dirRealPath).toBe(await realpath(skillsDir))
  })

  it('无 frontmatter 的扁平 skill 用文件名（去扩展名）当 name', async () => {
    await makeFlatSkill(skillsDir, 'bare-flat', '# 裸文件\n')
    const [entry] = await scanSkillRoot(rootOf())
    expect(entry).toMatchObject({ dirName: 'bare-flat', name: 'bare-flat', kind: 'flat' })
  })

  it('非 .md 文件不会被当成 skill', async () => {
    await writeAt(join(skillsDir, 'README.txt'), '---\nname: nope\n---\n')
    await expect(scanSkillRoot(rootOf())).resolves.toEqual([])
  })
})

describe('软链 skill', () => {
  it('指向别处的软链目录必须被扫到，dirRealPath 是真实目标路径', async () => {
    const external = join(tmp, 'external', 'linked-skill')
    await makeSkillDir(join(tmp, 'external'), 'linked-skill', '---\nname: linked\ndescription: 软链来的\n---\n')
    await makeSymlinkSkill(skillsDir, 'linked', external)

    const entries = await scanSkillRoot(rootOf())
    const linked = entries.find((entry) => entry.dirName === 'linked')
    expect(linked).toBeDefined()
    expect(linked).toMatchObject({ name: 'linked', kind: 'directory', description: '软链来的' })
    // DSH 校验「打开目录」时要求与 realpath 完全相等，这里必须解过软链。
    expect(linked?.dirRealPath).toBe(await realpath(external))
    expect(linked?.dirRealPath).not.toBe(join(skillsDir, 'linked'))
  })

  it('指向别处的软链 .md 也能当扁平 skill 扫到', async () => {
    const externalFile = join(tmp, 'external', 'linked-flat.md')
    await writeAt(externalFile, '---\nname: linked-flat\n---\n')
    await makeSymlinkSkill(skillsDir, 'linked-flat.md', externalFile)

    const entries = await scanSkillRoot(rootOf())
    expect(entries.find((entry) => entry.dirName === 'linked-flat')).toMatchObject({
      kind: 'flat',
      name: 'linked-flat',
    })
  })
})

describe('扫描边界', () => {
  it('只看根下第一层：skills/foo/bar/SKILL.md 不算（foo 自己没有 SKILL.md）', async () => {
    await makeSkillDir(join(skillsDir, 'foo'), 'bar', '---\nname: nested\n---\n')
    await expect(scanSkillRoot(rootOf())).resolves.toEqual([])
  })

  it('真正的第一层 skill 与深处目录同时存在时，只返回第一层', async () => {
    await makeSkillDir(skillsDir, 'top', '---\nname: top\n---\n')
    await makeSkillDir(join(skillsDir, 'top'), 'nested', '---\nname: nested\n---\n')
    const entries = await scanSkillRoot(rootOf())
    expect(entries.map((entry) => entry.name)).toEqual(['top'])
  })

  it('点开头的隐藏条目被跳过', async () => {
    await makeSkillDir(skillsDir, '.hidden', '---\nname: hidden\n---\n')
    await expect(scanSkillRoot(rootOf())).resolves.toEqual([])
  })

  it('根不存在时返回空数组而不是抛错', async () => {
    await expect(scanSkillRoot(rootOf(join(tmp, 'no-such-dir')))).resolves.toEqual([])
  })

  it('结果按 name 升序，保证面板顺序稳定', async () => {
    await makeSkillDir(skillsDir, 'zzz-dir', '---\nname: zeta\n---\n')
    await makeSkillDir(skillsDir, 'aaa-dir', '---\nname: alpha\n---\n')
    const entries = await scanSkillRoot(rootOf())
    expect(entries.map((entry) => entry.name)).toEqual(['alpha', 'zeta'])
  })
})

describe('上下文字符数与 token 估算', () => {
  it('descriptionChars = name.length + description.length + 8，token 由它换算', async () => {
    // name 10 字符，description 7 字符，固定分隔 8 → 25，round(25 / 3.5) = 7
    await makeSkillDir(
      skillsDir,
      'chars-dir',
      '---\nname: chars-test\ndescription: 一二三四五六七\n---\n',
    )
    const [entry] = await scanSkillRoot(rootOf())
    expect(entry?.name).toBe('chars-test')
    expect(entry?.description).toBe('一二三四五六七')
    expect(entry?.descriptionChars).toBe(25)
    expect(entry?.approxTokens).toBe(7)
  })
})

describe('scanArchiveDir', () => {
  it('扫归档目录：条目 effective=false、带 archivedAt、频次归零', async () => {
    const archiveDir = join(tmp, 'agents', 'skill-archive')
    await makeSkillDir(archiveDir, 'old-skill', '---\nname: old\ndescription: 归档的\n---\n')
    const entries = await scanArchiveDir(archiveDir, 'user-agents')
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      dirName: 'old-skill',
      name: 'old',
      effective: false,
      calls: 0,
      calls30d: 0,
      lastUsedAt: null,
    })
    expect(entries[0]?.archivedAt).toBeTypeOf('string')
  })

  it('归档目录不存在时返回空数组', async () => {
    await expect(scanArchiveDir(join(tmp, 'no-archive'), 'user-dsh')).resolves.toEqual([])
  })
})

describe('根路径推导', () => {
  const paths: HomePaths = { dshHome: '/home/me/.dsh', agentsHome: '/home/me/.agents' }

  it('全局只有两个根；给了内置目录才出现只读的第三个根', () => {
    expect(globalRoots(paths).map((root) => root.id)).toEqual(['user-dsh', 'user-agents'])
    expect(globalRoots(paths).map((root) => root.path)).toEqual([
      '/home/me/.dsh/skills',
      '/home/me/.agents/skills',
    ])
    const withBundled = globalRoots({ ...paths, bundledSkillDir: '/app/office-skills' })
    expect(withBundled.map((root) => root.id)).toEqual(['user-dsh', 'user-agents', 'bundled'])
    expect(withBundled[2]?.removable).toBe(false)
    expect(withBundled[0]?.removable).toBe(true)
  })

  it('项目两个根在项目根下的 .dsh/skills 与 .agents/skills', () => {
    const roots = projectRoots('/work/proj')
    expect(roots.map((root) => root.id)).toEqual(['project-dsh', 'project-agents'])
    expect(roots.map((root) => root.path)).toEqual(['/work/proj/.dsh/skills', '/work/proj/.agents/skills'])
    expect(roots.every((root) => root.removable)).toBe(true)
  })

  it('homePaths 只认环境变量，不落到真实 home（保证测试可移植）', () => {
    const saved = {
      DSH_HOME: process.env.DSH_HOME,
      DSH_AGENTS_HOME: process.env.DSH_AGENTS_HOME,
      DSH_BUNDLED_SKILL_DIR: process.env.DSH_BUNDLED_SKILL_DIR,
    }
    try {
      process.env.DSH_HOME = '/tmp/fake-dsh-home'
      process.env.DSH_AGENTS_HOME = '/tmp/fake-agents-home'
      process.env.DSH_BUNDLED_SKILL_DIR = '/tmp/fake-bundled'
      expect(homePaths()).toEqual({
        dshHome: '/tmp/fake-dsh-home',
        agentsHome: '/tmp/fake-agents-home',
        bundledSkillDir: '/tmp/fake-bundled',
      })
      delete process.env.DSH_BUNDLED_SKILL_DIR
      expect(homePaths().bundledSkillDir).toBeUndefined()
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
    }
  })
})

describe('扫描结果字段完整性', () => {
  it('每条条目都带 dirRealPath / skillFile / removable / source', async () => {
    await makeSkillDir(skillsDir, 'complete', '---\nname: complete\ndescription: 完整字段\n---\n')
    await makeFlatSkill(skillsDir, 'complete-flat', '---\nname: complete-flat\n---\n')
    const entries = await scanSkillRoot(rootOf())
    expect(entries).toHaveLength(2)
    for (const entry of entries) {
      expect(entry.dirRealPath).toBeTypeOf('string')
      expect(entry.dirRealPath.length).toBeGreaterThan(0)
      expect(entry.skillFile.startsWith(skillsDir)).toBe(true)
      expect(entry.removable).toBe(true)
      expect(entry.source).toBe('user-agents')
      expect(entry.rootId).toBe('user-agents')
    }
  })
})

describe('软链的 dirent 事实', () => {
  it('软链在 readdir 里不是普通目录 —— 证明上面的用例真的覆盖了 stat 跟随分支', async () => {
    const external = join(tmp, 'external2', 'linked2')
    await makeSkillDir(join(tmp, 'external2'), 'linked2', '---\nname: l2\n---\n')
    await makeSymlinkSkill(skillsDir, 'linked2', external)
    const dirents = await readdir(skillsDir, { withFileTypes: true })
    const link = dirents.find((dirent) => dirent.name === 'linked2')
    // 如果源码改回 dirent.isDirectory()，这条断言会提醒：软链会被整批漏掉。
    expect(link?.isSymbolicLink()).toBe(true)
    expect(link?.isDirectory()).toBe(false)
  })
})
