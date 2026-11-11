/**
 * 归档 / 还原：真实的磁盘移动。
 *
 * 这是全插件唯一会动用户数据的地方，所以每条用例都同时断言「源没了、目标有了」，
 * 冲突场景还要断言「旧的不被覆盖」——不能只看函数有没有抛错。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { lstat, mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  moveToArchive,
  restoreFromArchive,
  stripArchiveSuffix,
} from '../src/host/archive.ts'
import type { MoveResult } from '../src/host/archive.ts'
import { OptimizeError } from '../src/shared/errors.ts'
import {
  exists,
  makeFlatSkill,
  makeSkillDir,
  makeSymlinkSkill,
  makeTmpDir,
  removeTmpDir,
  writeAt,
} from './helpers.ts'

let tmp = ''
let skillsDir = ''
let archiveDir = ''

/** 固定的归档时刻，让重名后缀可预期。 */
const NOW = new Date(2026, 10, 11, 13, 45, 1)
const SUFFIXED = 'foo@20261111-134501'

beforeEach(async () => {
  tmp = await makeTmpDir('dco-archive')
  skillsDir = join(tmp, 'agents', 'skills')
  archiveDir = join(tmp, 'agents', 'skill-archive')
  await mkdir(skillsDir, { recursive: true })
})

afterEach(async () => {
  await removeTmpDir(tmp)
})

/** 断言被拒绝时抛的是带指定 code 的 OptimizeError。 */
async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  await expect(promise).rejects.toBeInstanceOf(OptimizeError)
  await expect(promise).rejects.toMatchObject({ code })
}

describe('目录型 skill 的归档与还原', () => {
  it('归档到 skills 目录同级的 skill-archive，源目录消失、内容完整', async () => {
    await makeSkillDir(skillsDir, 'foo', '---\nname: foo\ndescription: 描述\n---\n')
    const result = await moveToArchive(skillsDir, 'foo', NOW)

    expect(result.to).toBe(join(archiveDir, 'foo'))
    expect(result.renamedTo).toBeUndefined()
    await expect(exists(join(archiveDir, 'foo', 'SKILL.md'))).resolves.toBe(true)
    await expect(exists(join(skillsDir, 'foo'))).resolves.toBe(false)
    // 归档箱与 skills 同级，不是建在 skills 里面。
    await expect(exists(join(skillsDir, 'skill-archive'))).resolves.toBe(false)
  })

  it('还原能搬回原位', async () => {
    await makeSkillDir(skillsDir, 'foo', '---\nname: foo\n---\n')
    await moveToArchive(skillsDir, 'foo', NOW)
    const result = await restoreFromArchive(skillsDir, 'foo')

    expect(result.to).toBe(join(skillsDir, 'foo'))
    await expect(exists(join(skillsDir, 'foo', 'SKILL.md'))).resolves.toBe(true)
    await expect(exists(join(archiveDir, 'foo'))).resolves.toBe(false)
  })
})

describe('归档重名', () => {
  it('目标已存在时绝不覆盖，自动加 @YYYYMMDD-HHmmss 后缀并回传 renamedTo', async () => {
    // 归档箱里先有一份旧的 foo，放个标记文件证明它没被动过。
    await makeSkillDir(archiveDir, 'foo', '---\nname: old-foo\n---\n')
    await writeAt(join(archiveDir, 'foo', 'MARKER.txt'), 'old')
    await makeSkillDir(skillsDir, 'foo', '---\nname: new-foo\ndescription: 新的\n---\n')

    const result = await moveToArchive(skillsDir, 'foo', NOW)

    expect(result.renamedTo).toBe(SUFFIXED)
    expect(result.to).toBe(join(archiveDir, SUFFIXED))
    await expect(exists(join(archiveDir, 'foo', 'MARKER.txt'))).resolves.toBe(true)
    await expect(exists(join(archiveDir, SUFFIXED, 'SKILL.md'))).resolves.toBe(true)
    await expect(exists(join(skillsDir, 'foo'))).resolves.toBe(false)
    expect((await readdir(archiveDir)).sort()).toEqual(['foo', SUFFIXED])
  })

  it('还原带后缀的归档条目会去掉后缀回到原名', async () => {
    await makeSkillDir(archiveDir, SUFFIXED, '---\nname: foo\n---\n')
    await restoreFromArchive(skillsDir, SUFFIXED)
    await expect(exists(join(skillsDir, 'foo', 'SKILL.md'))).resolves.toBe(true)
    await expect(exists(join(archiveDir, SUFFIXED))).resolves.toBe(false)
  })
})

describe('归档重名循环（回归：同一秒多次归档绝不覆盖）', () => {
  // 同一秒内连续归档同一个名字时，时间后缀会撞在一起；修复后要循环探到空位。
  const TIMES = 4

  it('目录型连续归档同名 4 次：全部成功，条目数对、内容互不覆盖', async () => {
    const results: MoveResult[] = []
    for (let i = 0; i < TIMES; i += 1) {
      await makeSkillDir(skillsDir, 'foo', `---\nname: foo\ndescription: label-${String(i)}\n---\n`)
      results.push(await moveToArchive(skillsDir, 'foo', NOW))
      // 每一步源目录都真的被搬走了，没有留下半个状态。
      await expect(exists(join(skillsDir, 'foo'))).resolves.toBe(false)
    }

    expect(results).toHaveLength(TIMES)
    expect(results[0]?.renamedTo).toBeUndefined()
    expect(results[1]?.renamedTo).toBe(SUFFIXED)
    expect(results[2]?.renamedTo).toBe(`${SUFFIXED}-2`)
    expect(results[3]?.renamedTo).toBe(`${SUFFIXED}-3`)

    // 归档箱里就是这四次归档，一个都不少。
    expect((await readdir(archiveDir)).sort()).toEqual(
      ['foo', SUFFIXED, `${SUFFIXED}-2`, `${SUFFIXED}-3`].sort(),
    )

    // 逐份读回内容：如果哪一步被覆盖，这里会读到别次的 label。
    for (const [index, result] of results.entries()) {
      await expect(readFile(join(result.to, 'SKILL.md'), 'utf8')).resolves.toContain(
        `label-${String(index)}`,
      )
    }
  })

  it('扁平 .md 型连续归档同名 4 次：四份文件都在，内容互不覆盖', async () => {
    const results: MoveResult[] = []
    for (let i = 0; i < TIMES; i += 1) {
      await makeFlatSkill(skillsDir, 'foo', `label-${String(i)}`)
      results.push(await moveToArchive(skillsDir, 'foo', NOW))
      await expect(exists(join(skillsDir, 'foo.md'))).resolves.toBe(false)
    }

    expect(results[0]?.renamedTo).toBeUndefined()
    expect(results[1]?.renamedTo).toBe(`${SUFFIXED}.md`)
    expect(results[2]?.renamedTo).toBe(`${SUFFIXED}-2.md`)
    expect(results[3]?.renamedTo).toBe(`${SUFFIXED}-3.md`)

    expect((await readdir(archiveDir)).sort()).toEqual(
      ['foo.md', `${SUFFIXED}.md`, `${SUFFIXED}-2.md`, `${SUFFIXED}-3.md`].sort(),
    )

    for (const [index, result] of results.entries()) {
      await expect(readFile(result.to, 'utf8')).resolves.toBe(`label-${String(index)}`)
    }
  })

  it('同一秒内 100 个候选名都被占满时抛 target-exists，而不是无限循环', async () => {
    // 预置 foo + foo@S + foo@S-2 ... foo@S-100，源码最多探 100 次。
    await makeFlatSkill(skillsDir, 'foo', 'label-source')
    await makeFlatSkill(archiveDir, 'foo', 'label-0')
    await makeFlatSkill(archiveDir, SUFFIXED, 'label-1')
    for (let i = 2; i <= 100; i += 1) {
      await makeFlatSkill(archiveDir, `${SUFFIXED}-${String(i)}`, `label-${String(i)}`)
    }

    await expectCode(moveToArchive(skillsDir, 'foo', NOW), 'target-exists')
    // 拒绝时源文件还在，用户不会丢数据。
    await expect(exists(join(skillsDir, 'foo.md'))).resolves.toBe(true)
  })
})

describe('还原冲突', () => {
  it('原位已有同名条目时抛 target-exists，两个副本都还在', async () => {
    await makeSkillDir(skillsDir, 'foo', '---\nname: active\n---\n')
    await moveToArchive(skillsDir, 'foo', NOW)
    await makeSkillDir(skillsDir, 'foo', '---\nname: recreated\n---\n')

    await expectCode(restoreFromArchive(skillsDir, 'foo'), 'target-exists')
    await expect(exists(join(archiveDir, 'foo'))).resolves.toBe(true)
    await expect(exists(join(skillsDir, 'foo'))).resolves.toBe(true)
  })
})

describe('路径穿越', () => {
  it('dirName 含分隔符、. / ..、或绝对路径一律抛 path-escape', async () => {
    const evil = ['../evil', 'a/b', 'a\\b', '.', '..', '/etc/passwd']
    for (const dirName of evil) {
      await expectCode(moveToArchive(skillsDir, dirName, NOW), 'path-escape')
    }
  })

  it('穿越请求被拒绝后磁盘没有被动过', async () => {
    await makeSkillDir(skillsDir, 'foo', '---\nname: foo\n---\n')
    await expectCode(moveToArchive(skillsDir, '../agents/skills/foo', NOW), 'path-escape')
    await expect(exists(join(skillsDir, 'foo', 'SKILL.md'))).resolves.toBe(true)
  })

  it('空 dirName 抛 invalid-request', async () => {
    await expectCode(moveToArchive(skillsDir, '', NOW), 'invalid-request')
  })

  it('超长 dirName（>128 字符）抛 invalid-request，避免构造超长路径', async () => {
    await expectCode(moveToArchive(skillsDir, 'a'.repeat(129), NOW), 'invalid-request')
  })

  it('源不存在时抛 not-found', async () => {
    await expectCode(moveToArchive(skillsDir, 'ghost', NOW), 'not-found')
    await expectCode(restoreFromArchive(skillsDir, 'ghost'), 'not-found')
  })
})

describe('扁平 .md 型 skill', () => {
  it('归档后是 skill-archive/foo.md，还原回 skills/foo.md', async () => {
    await makeFlatSkill(skillsDir, 'foo', '---\nname: flat-foo\n---\n')
    const archived = await moveToArchive(skillsDir, 'foo', NOW)
    expect(archived.to).toBe(join(archiveDir, 'foo.md'))
    await expect(exists(join(archiveDir, 'foo.md'))).resolves.toBe(true)
    await expect(exists(join(skillsDir, 'foo.md'))).resolves.toBe(false)

    const restored = await restoreFromArchive(skillsDir, 'foo')
    expect(restored.to).toBe(join(skillsDir, 'foo.md'))
    await expect(exists(join(skillsDir, 'foo.md'))).resolves.toBe(true)
  })

  it('扁平型归档重名时后缀加在扩展名之前（foo@...md），仍可还原', async () => {
    await makeFlatSkill(archiveDir, 'foo', '---\nname: old\n---\n')
    await makeFlatSkill(skillsDir, 'foo', '---\nname: new\n---\n')

    const result = await moveToArchive(skillsDir, 'foo', NOW)
    expect(result.renamedTo).toBe(`${SUFFIXED}.md`)
    await expect(exists(join(archiveDir, `${SUFFIXED}.md`))).resolves.toBe(true)

    // 还原时去掉后缀：foo@20261111-134501.md → foo.md
    await restoreFromArchive(skillsDir, SUFFIXED)
    await expect(exists(join(skillsDir, 'foo.md'))).resolves.toBe(true)
  })

  it('原位已有同名 .md 时还原抛 target-exists', async () => {
    await makeFlatSkill(archiveDir, 'foo', '---\nname: archived\n---\n')
    await makeFlatSkill(skillsDir, 'foo', '---\nname: active\n---\n')
    await expectCode(restoreFromArchive(skillsDir, 'foo'), 'target-exists')
  })
})

describe('软链 skill 只移动链接本身', () => {
  it('归档软链不会把链接目标一起带走', async () => {
    const external = join(tmp, 'external', 'linked')
    await makeSkillDir(join(tmp, 'external'), 'linked', '---\nname: linked\n---\n')
    await makeSymlinkSkill(skillsDir, 'linked', external)

    await moveToArchive(skillsDir, 'linked', NOW)

    // 链接本身被搬走，目标目录原地不动。
    const moved = await lstat(join(archiveDir, 'linked'))
    expect(moved.isSymbolicLink()).toBe(true)
    await expect(exists(join(external, 'SKILL.md'))).resolves.toBe(true)
    await expect(exists(join(skillsDir, 'linked'))).resolves.toBe(false)
  })
})

describe('stripArchiveSuffix', () => {
  it('去掉末尾的 @YYYYMMDD-HHmmss，扩展名保持在最后', () => {
    expect(stripArchiveSuffix('foo@20261111-134501')).toBe('foo')
    expect(stripArchiveSuffix('foo@20261111-134501.md')).toBe('foo.md')
    expect(stripArchiveSuffix('foo')).toBe('foo')
    expect(stripArchiveSuffix('foo.md')).toBe('foo.md')
  })

  it('不误伤名字里本来带 @ 但不是时间后缀的情况', () => {
    expect(stripArchiveSuffix('foo@daily')).toBe('foo@daily')
    expect(stripArchiveSuffix('foo@daily.md')).toBe('foo@daily.md')
  })
})
