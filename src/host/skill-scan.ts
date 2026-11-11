/**
 * 扫描 skill 根：把磁盘上的目录结构读成条目。
 *
 * 扫描规则和 DSH 自己的 `dsh-skill-filesystem` 保持一致：
 * - 根下**第一层**的目录，且内含 `SKILL.md` → 目录型 skill；
 * - 根下**第一层**的 `.md` 文件 → 扁平型 skill；
 * - 其余一律忽略（所以归档目录放在 skills 里面也不会被误认，但我们仍把它放同级）。
 */
import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, extname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { approxTokens, descriptionChars } from '../shared/catalog.ts'
import { displayPath, isRemovableRoot, sourceOfRoot } from '../shared/roots.ts'
import { safeRealpath } from './paths.ts'
import type { RootId, SkillEntry, SkillKind } from '../shared/types.ts'

/** 扫描出来的条目：频次与生效标记由后续步骤补上。 */
export type ScannedSkill = Omit<SkillEntry, 'calls' | 'calls30d' | 'lastUsedAt' | 'effective' | 'overriddenBy'>

/** DSH 的路径事实：三个与 skill 有关的位置。 */
export interface HomePaths {
  /** DSH home，默认 `~/.dsh`。 */
  readonly dshHome: string
  /** 共享 agent 根，默认 `~/.agents`。 */
  readonly agentsHome: string
  /** 内置 skill 目录（App 安装包内），未设置时为 undefined。 */
  readonly bundledSkillDir?: string
}

/**
 * 解析 DSH 的三个路径。环境变量名与 `@deepseek-ai/dsh-home-paths` 一致，避免和宿主判断不一致。
 * @returns 路径集合。
 */
export function homePaths(): HomePaths {
  const home = homedir()
  const dshHome = process.env.DSH_HOME?.trim() || join(home, '.dsh')
  const agentsHome = process.env.DSH_AGENTS_HOME?.trim() || join(home, '.agents')
  const bundled = process.env.DSH_BUNDLED_SKILL_DIR?.trim()
  return {
    dshHome,
    agentsHome,
    ...(bundled !== undefined && bundled.length > 0 ? { bundledSkillDir: bundled } : {}),
  }
}

/** 全局范围的三个根（按优先级排列）及其绝对路径。 */
export interface ResolvedRoot {
  readonly id: RootId
  readonly path: string
  readonly display: string
  readonly removable: boolean
}

/**
 * 全局三个根的绝对路径与展示名。
 * @param paths - 已解析的 home 路径。
 * @returns 根列表；内置根缺失时不出现在列表里。
 */
export function globalRoots(paths: HomePaths): ResolvedRoot[] {
  const home = homedir()
  const roots: ResolvedRoot[] = [
    {
      id: 'user-dsh',
      path: join(paths.dshHome, 'skills'),
      display: displayPath(join(paths.dshHome, 'skills'), home),
      removable: true,
    },
    {
      id: 'user-agents',
      path: join(paths.agentsHome, 'skills'),
      display: displayPath(join(paths.agentsHome, 'skills'), home),
      removable: true,
    },
  ]
  if (paths.bundledSkillDir !== undefined) {
    roots.push({
      id: 'bundled',
      path: paths.bundledSkillDir,
      display: 'App 内置 office-skills',
      removable: false,
    })
  }
  return roots
}

/**
 * 项目范围的两个根。
 * @param projectRoot - 项目根绝对路径。
 * @returns 根列表。
 */
export function projectRoots(projectRoot: string): ResolvedRoot[] {
  return [
    {
      id: 'project-dsh',
      path: join(projectRoot, '.dsh', 'skills'),
      display: '.dsh/skills',
      removable: true,
    },
    {
      id: 'project-agents',
      path: join(projectRoot, '.agents', 'skills'),
      display: '.agents/skills',
      removable: true,
    },
  ]
}

/** 解析一条 skill 的 frontmatter 元信息。 */
interface SkillMeta {
  readonly name: string
  readonly description: string
  /** frontmatter 里是否真的声明了 name；false 表示这不是一个合法 skill。 */
  readonly declared: boolean
}

/**
 * 读 SKILL.md 的 frontmatter，取 name 与 description。
 *
 * 用真正的 YAML 解析器而不是正则：本机就有 skill 用了 `description: |` 块语法，
 * 手写正则会把这类描述解析成空串，token 统计随之失真。
 *
 * @param file - SKILL.md 或扁平 .md 的绝对路径。
 * @param fallbackName - frontmatter 缺 name 时用的名字（目录名 / 文件名）。
 * @returns 元信息；文件读不到时返回 undefined。
 */
export async function readSkillMeta(file: string, fallbackName: string): Promise<SkillMeta | undefined> {
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch {
    return undefined
  }
  // 与 DSH 的 parseSkillFile 对齐：没有 frontmatter、YAML 坏、或没有 name 的，
  // 一律不算 skill。放宽会把 skills 根下的 README.md、坏掉的目录也列进来，
  // 虚增「从未被调用」并让 token 统计失真。
  const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(raw)
  if (match === null) return { name: fallbackName, description: '', declared: false }
  let frontmatter: unknown
  try {
    frontmatter = parseYaml(match[1] ?? '')
  } catch {
    return { name: fallbackName, description: '', declared: false }
  }
  if (typeof frontmatter !== 'object' || frontmatter === null) {
    return { name: fallbackName, description: '', declared: false }
  }
  const record = frontmatter as Record<string, unknown>
  const rawName = record['name']
  if (typeof rawName !== 'string' || rawName.trim() === '') {
    return { name: fallbackName, description: '', declared: false }
  }
  const description = typeof record['description'] === 'string' ? record['description'].trim() : ''
  return { name: rawName.trim(), description, declared: true }
}

/**
 * 扫描一个 skill 根。
 *
 * @param root - 根定义（绝对路径、ID、可卸载性）。
 * @returns 条目列表；根不存在时返回空数组。
 */
export async function scanSkillRoot(root: ResolvedRoot): Promise<ScannedSkill[]> {
  let names: string[]
  try {
    const dirents = await readdir(root.path, { withFileTypes: true })
    names = dirents.map((dirent) => dirent.name)
  } catch {
    return []
  }
  const skills: ScannedSkill[] = []
  for (const entryName of names) {
    if (entryName.startsWith('.')) continue
    const childPath = join(root.path, entryName)
    // 用 stat（跟随软链）而不是 dirent.isDirectory()：本机有 3 个 skill 是指向
    // ~/.claude/skills 的软链，按 dirent 判断会被整批漏掉，而 DSH 自己是跟随软链的。
    const info = await safeStat(childPath)
    if (info === undefined) continue
    const isSymlink = await isSymlinkPath(childPath)
    let kind: SkillKind
    let skillFile: string
    let dirName: string
    if (info.isDirectory) {
      kind = 'directory'
      skillFile = join(childPath, 'SKILL.md')
      dirName = entryName
      if (!(await isFile(skillFile))) continue
    } else if (extname(entryName) === '.md') {
      kind = 'flat'
      skillFile = childPath
      dirName = basename(entryName, '.md')
    } else {
      continue
    }
    const meta = await readSkillMeta(skillFile, dirName)
    if (meta === undefined || !meta.declared) continue
    const chars = descriptionChars(meta.name, meta.description)
    skills.push({
      dirName,
      name: meta.name,
      description: meta.description,
      rootId: root.id,
      source: sourceOfRoot(root.id),
      kind,
      dirRealPath: await safeRealpath(kind === 'directory' ? childPath : root.path),
      skillFile,
      removable: root.removable && isRemovableRoot(root.id),
      isSymlink,
      descriptionChars: chars,
      approxTokens: approxTokens(chars),
    })
  }
  return skills.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 扫描一个归档目录，条目带上归档时间。
 *
 * @param archiveDir - 归档目录绝对路径。
 * @param rootId - 条目原本所属的根。
 * @returns 归档条目；目录不存在时返回空数组。
 */
export async function scanArchiveDir(archiveDir: string, rootId: RootId): Promise<SkillEntry[]> {
  let dirents
  try {
    dirents = await readdir(archiveDir, { withFileTypes: true })
  } catch {
    return []
  }
  const entries: SkillEntry[] = []
  for (const dirent of dirents) {
    if (dirent.name.startsWith('.')) continue
    const childPath = join(archiveDir, dirent.name)
    const info = await safeStat(childPath)
    if (info === undefined) continue
    const isDir = info.isDirectory
    const dirName = isDir ? dirent.name : basename(dirent.name, '.md')
    if (!isDir && extname(dirent.name) !== '.md') continue
    const skillFile = isDir ? join(childPath, 'SKILL.md') : childPath
    const meta = await readSkillMeta(skillFile, dirName)
    if (meta === undefined || !meta.declared) continue
    const chars = descriptionChars(meta.name, meta.description)
    entries.push({
      dirName,
      name: meta.name,
      description: meta.description,
      rootId,
      source: sourceOfRoot(rootId),
      kind: isDir ? 'directory' : 'flat',
      dirRealPath: await safeRealpath(isDir ? childPath : archiveDir),
      skillFile,
      removable: true,
      isSymlink: await isSymlinkPath(childPath),
      effective: false,
      descriptionChars: chars,
      approxTokens: approxTokens(chars),
      calls: 0,
      calls30d: 0,
      lastUsedAt: null,
      // 用 ctime 而不是 mtime：move 会保留 mtime（那是 skill 自己的修改时间），
      // 只有 ctime 会更新成移动时刻，才对得上表头的「归档时间」。
      ...(info === undefined ? {} : { archivedAt: new Date(info.ctimeMs).toISOString() }),
    })
  }
  return entries.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
}

/** 是否是软链（用 lstat，不跟进目标）。 */
async function isSymlinkPath(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink()
  } catch {
    return false
  }
}

/** 是否是普通文件。 */
async function isFile(path: string): Promise<boolean> {
  const info = await safeStat(path)
  return info?.isFile === true
}

/** stat 的安全版本，出错返回 undefined。 */
async function safeStat(
  path: string,
): Promise<{ isFile: boolean; isDirectory: boolean; mtimeMs: number; ctimeMs: number } | undefined> {
  try {
    const info = await stat(path)
    return { isFile: info.isFile(), isDirectory: info.isDirectory(), mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs }
  } catch {
    return undefined
  }
}
