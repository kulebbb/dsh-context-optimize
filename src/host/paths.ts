/**
 * 路径安全：把「客户端给的根 ID + 目录名」变成可信的绝对路径。
 *
 * 边界只有一条：**客户端永远不传绝对路径**。它能传的只有根 ID（枚举）、工作区 ID 和目录名，
 * 绝对路径全部由宿主自己拼。拼完还要过三道检查，防止 `../` 穿越到根外面。
 */
import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { OptimizeError } from '../shared/errors.ts'

/** 目录名长度上限，避免构造出超长路径。 */
const MAX_NAME_LENGTH = 128

/**
 * 校验一个「skill 目录名」是否单段、非特殊、不含分隔符。
 *
 * DSH 的 skill 目录名可以和 frontmatter 里的 name 不同，所以这里不按 kebab-case 校验，
 * 只保证它是根的**直接子项**、跳不出去。
 *
 * @param dirName - 客户端传来的目录名（目录包或扁平 .md 的文件名，不含扩展名）。
 * @returns 校验通过的目录名（原样）。
 * @throws OptimizeError 当名字为空、过长、含分隔符、或为 `.` / `..` 时。
 */
export function assertSafeDirName(dirName: string): string {
  if (typeof dirName !== 'string' || dirName.length === 0) {
    throw new OptimizeError('invalid-request', '目录名不能为空')
  }
  if (dirName.length > MAX_NAME_LENGTH) {
    throw new OptimizeError('invalid-request', `目录名超过 ${String(MAX_NAME_LENGTH)} 个字符`)
  }
  if (dirName === '.' || dirName === '..') {
    throw new OptimizeError('path-escape', '目录名不能是 . 或 ..')
  }
  if (dirName.includes('/') || dirName.includes('\\') || dirName.includes('\0')) {
    throw new OptimizeError('path-escape', '目录名不能包含路径分隔符')
  }
  if (isAbsolute(dirName)) {
    throw new OptimizeError('path-escape', '目录名不能是绝对路径')
  }
  return dirName
}

/**
 * 断言 `child` 确实是 `parent` 的直接子项（不做软链解析，纯字符串层面）。
 *
 * @param parent - 父目录绝对路径。
 * @param child - 待检查的绝对路径。
 * @returns 校验通过的 child。
 * @throws OptimizeError 当 child 不在 parent 下、或不是直接子项时。
 */
export function assertDirectChild(parent: string, child: string): string {
  const normalizedParent = resolve(parent)
  const normalizedChild = resolve(child)
  const rel = relative(normalizedParent, normalizedChild)
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new OptimizeError('path-escape', '目标路径不在预期的目录里')
  }
  if (rel.includes(sep)) {
    throw new OptimizeError('path-escape', '目标必须是指定目录的直接子项')
  }
  return normalizedChild
}

/**
 * 解软链；路径不存在时原样返回。
 *
 * 「打开目录」必须用解过软链的真实路径——DSH 校验路径的方式是「解一次软链再要求与传入值完全相等」，
 * 传拼接路径在软链 skill 上会被拒绝，表现为点了没反应。
 *
 * @param path - 绝对路径。
 * @returns 真实路径，解不出时返回入参。
 */
export async function safeRealpath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}
