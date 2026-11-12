/**
 * 归档 / 还原：真正的目录移动。
 *
 * 全流程**没有删除**。归档 = 把 skill 从 skills 目录搬到同级的 skills-archived；
 * 还原 = 搬回来。所以两个动作天然可逆，失败时也不会丢数据。
 */
import { mkdir, rename } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { OptimizeError } from '../shared/errors.ts'
import { archiveDirFor, archiveSuffix } from '../shared/roots.ts'
import { assertDirectChild, assertSafeDirName } from './paths.ts'
import { pathExists } from './workspaces.ts'

/** 一次移动的结果。 */
export interface MoveResult {
  /** 移动后的绝对路径。 */
  readonly to: string
  /**
   * 归档时因重名而改的新名字（**不含扩展名**，可直接当 dirName 用）。
   * 只返回后缀会让扁平 `.md` 的调用方拼出 `foo@….md.md`，撤销必然失败。
   */
  readonly renamedTo?: string
}

/** skill 在磁盘上的定位结果。 */
interface SkillLocation {
  /** 实际路径：目录包是目录，扁平型是 .md 文件。 */
  readonly path: string
  /** 移动时用的名字，含扩展名。 */
  readonly fileName: string
}

/**
 * 在一个根里定位 skill：先当目录找，再当扁平 `.md` 找。
 *
 * @param rootDir - 根目录绝对路径。
 * @param dirName - 客户端传来的目录名（扁平型不带扩展名）。
 * @returns 定位结果。
 * @throws OptimizeError 两边都不存在时抛 not-found。
 */
async function locateSkill(rootDir: string, dirName: string): Promise<SkillLocation> {
  const asDirectory = join(rootDir, dirName)
  if (await pathExists(asDirectory)) {
    return { path: assertDirectChild(rootDir, asDirectory), fileName: dirName }
  }
  const asFlat = join(rootDir, `${dirName}.md`)
  if (await pathExists(asFlat)) {
    return { path: assertDirectChild(rootDir, asFlat), fileName: `${dirName}.md` }
  }
  throw new OptimizeError('not-found', `在 ${rootDir} 里找不到 ${dirName}`)
}

/**
 * 把一条 skill 移进它的归档目录。
 *
 * 目标已存在时**绝不覆盖**：自动追加时间后缀并回传，界面如实展示。
 *
 * @param skillsDir - 根目录绝对路径。
 * @param dirName - skill 目录名（扁平型不带扩展名）。
 * @param now - 当前时刻，用于重名后缀。
 * @returns 移动结果。
 */
export async function moveToArchive(skillsDir: string, dirName: string, now: Date = new Date()): Promise<MoveResult> {
  assertSafeDirName(dirName)
  const source = await locateSkill(skillsDir, dirName)
  const archiveDir = archiveDirFor(skillsDir)
  await mkdir(archiveDir, { recursive: true })
  const baseName = source.fileName
  const extension = extname(baseName)
  const stem = extension === '' ? baseName : baseName.slice(0, -extension.length)
  let target = join(archiveDir, baseName)
  let renamedTo: string | undefined
  if (await pathExists(target)) {
    // 同一秒内连续归档同名 skill 会算出同一个后缀，所以这里要循环探到空位为止；
    // 早期版本只判断一次，第三次归档会直接 rename 到已存在的目标——目录型报 ENOTEMPTY、
    // 扁平 .md 型会被静默覆盖，两种情况都违背「绝不覆盖」。
    const suffix = archiveSuffix(now)
    let attempt = 1
    for (;;) {
      const candidate = attempt === 1 ? `${stem}${suffix}${extension}` : `${stem}${suffix}-${String(attempt)}${extension}`
      const candidatePath = join(archiveDir, candidate)
      if (!(await pathExists(candidatePath))) {
        target = candidatePath
        // 对外统一给「不含扩展名的名字」，和 archive/restore 的 dirName 语义保持一致
        renamedTo = attempt === 1 ? `${stem}${suffix}` : `${stem}${suffix}-${String(attempt)}`
        break
      }
      attempt += 1
      if (attempt > 100) {
        throw new OptimizeError('target-exists', `归档目录里已有太多同名条目：${stem}`)
      }
    }
  }
  assertDirectChild(archiveDir, target)
  try {
    await rename(source.path, target)
  } catch (error) {
    throw new OptimizeError('move-failed', `归档失败：${errorText(error)}`)
  }
  return renamedTo === undefined ? { to: target } : { to: target, renamedTo }
}

/**
 * 把一条 skill 从归档目录放回 skills 目录。
 *
 * 原位已有同名条目时直接拒绝，不猜也不覆盖——让用户先处理冲突。
 *
 * @param skillsDir - 根目录绝对路径。
 * @param dirName - skill 目录名（扁平型不带扩展名）。
 * @returns 移动结果。
 */
export async function restoreFromArchive(skillsDir: string, dirName: string): Promise<MoveResult> {
  assertSafeDirName(dirName)
  const archiveDir = archiveDirFor(skillsDir)
  const source = await locateSkill(archiveDir, dirName)
  // 还原时去掉归档重名后缀：`foo@20261111-134501` → `foo`
  const restoredName = stripArchiveSuffix(source.fileName)
  await mkdir(skillsDir, { recursive: true })
  const target = join(skillsDir, restoredName)
  assertDirectChild(skillsDir, target)
  // 两种形态都要查：`skills/foo` 与 `skills/foo.md` 在 DSH 眼里是同一个 name
  const conflict = target.endsWith('.md') ? target.slice(0, -3) : `${target}.md`
  if ((await pathExists(target)) || (await pathExists(conflict))) {
    throw new OptimizeError('target-exists', `原位已有 ${restoredName.replace(/\.md$/, '')}，请先处理冲突`)
  }
  try {
    await rename(source.path, target)
  } catch (error) {
    throw new OptimizeError('move-failed', `还原失败：${errorText(error)}`)
  }
  return { to: target }
}

/**
 * 去掉归档时追加的时间后缀。
 * @param fileName - 归档里的文件名（可能含 `@YYYYMMDD-HHmmss`）。
 * @returns 还原后的文件名。
 */
export function stripArchiveSuffix(fileName: string): string {
  const extension = extname(fileName)
  const stem = extension === '' ? fileName : fileName.slice(0, -extension.length)
  // 第二次及以后的重名会追加 `-2`、`-3`，一起去掉才算回到原名
  return `${stem.replace(/@\d{8}-\d{6}(?:-\d+)?$/, '')}${extension}`
}

/** 取错误文本，非 Error 也能读。 */
function errorText(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
