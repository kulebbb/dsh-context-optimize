/**
 * 测试公用工具：临时目录、skill fixture、SkillEntry 构造。
 *
 * 纪律：所有落盘用例只在 os.tmpdir() 下造目录，绝不碰用户真实的 ~/.dsh / ~/.agents，
 * 这样测试在任何机器、任何 CI 上都能跑。
 */
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { SkillEntry } from '../src/shared/types.ts'

/** 建一个独立的临时目录（调用方负责在 afterEach 里删掉）。 */
export async function makeTmpDir(prefix = 'dco'): Promise<string> {
  return mkdtemp(join(tmpdir(), `${prefix}-`))
}

/** 递归删除临时目录；force 让清理本身不会掩盖真正的失败。 */
export async function removeTmpDir(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true })
}

/** 写文件并自动建父目录。 */
export async function writeAt(file: string, content: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, content, 'utf8')
}

/** 在 root 下造一个目录型 skill：<root>/<dirName>/SKILL.md。 */
export async function makeSkillDir(root: string, dirName: string, content: string): Promise<string> {
  const dir = join(root, dirName)
  await writeAt(join(dir, 'SKILL.md'), content)
  return dir
}

/** 在 root 下造一个扁平 skill：<root>/<fileName>.md。 */
export async function makeFlatSkill(root: string, fileName: string, content: string): Promise<string> {
  const file = join(root, `${fileName}.md`)
  await writeAt(file, content)
  return file
}

/** 在 root 下造一个指向 target 的软链 skill（模拟本机指向 ~/.claude/skills 的那批）。 */
export async function makeSymlinkSkill(root: string, name: string, target: string): Promise<string> {
  await mkdir(root, { recursive: true })
  const link = join(root, name)
  await symlink(target, link)
  return link
}

/** 路径是否存在（不关心类型）。 */
export async function exists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/** 造一条 SkillEntry，只覆盖用例真正关心的字段。 */
export function makeEntry(partial: Partial<SkillEntry> & Pick<SkillEntry, 'name'>): SkillEntry {
  return {
    dirName: partial.name,
    description: '',
    rootId: 'user-dsh',
    source: 'user-dsh',
    kind: 'directory',
    dirRealPath: `/tmp/${partial.name}`,
    skillFile: `/tmp/${partial.name}/SKILL.md`,
    removable: true,
    isSymlink: false,
    effective: true,
    descriptionChars: 8,
    approxTokens: 2,
    calls: 0,
    calls30d: 0,
    lastUsedAt: null,
    ...partial,
  }
}

/** 本地时区的 `YYYY-MM-DD`；不要用 toISOString，那会按 UTC 切日。 */
export function localDateKey(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${String(date.getFullYear())}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** 以 base 的本地自然日往前推 days 天，返回 `YYYY-MM-DD`。 */
export function localDayOffset(base: Date, days: number): string {
  return localDateKey(new Date(base.getFullYear(), base.getMonth(), base.getDate() - days))
}
