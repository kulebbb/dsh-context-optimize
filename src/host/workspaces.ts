/**
 * 工作区 → 项目根。
 *
 * DSH 判断「项目根」的方式是**往上找最近一个含 `.git` 的目录**，找不到就用工作区路径本身。
 * 项目级 skill 就放在项目根下的 `.dsh/skills` 与 `.agents/skills`。
 *
 * 注意这和 DSH 的工作区列表是两件事：工作区是用户在侧边栏看到的东西，项目根是磁盘上的事实。
 * 面板以工作区为准（用户心智），每个工作区再按这条规则解析项目根（DSH 事实）。
 */
import { access, realpath } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'

/** 面板需要的工作区最小结构；领居服务 `ctx.workspaceRegistry.list()` 的元素即可直接传入。 */
export interface WorkspaceLike {
  readonly id: string
  readonly title: string
  readonly path: string
}

/**
 * 判断路径是否存在（不关心类型）。
 * @param path - 绝对路径。
 * @returns 是否存在。
 */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

/**
 * 从工作区路径往上找最近一个含 `.git` 的目录。
 *
 * 到根目录还没找到时返回入参本身——和 DSH 的行为一致，避免把 skill 根算到文件系统根上。
 *
 * @param workspacePath - 工作区绝对路径。
 * @returns 项目根绝对路径。
 */
export async function resolveProjectRoot(workspacePath: string): Promise<string> {
  const start = resolve(workspacePath)
  let current = start
  for (;;) {
    if (await pathExists(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return start
    current = parent
  }
}

/**
 * 取工作区路径的真实路径；目录已失效时返回入参。
 *
 * 用 realpath 是为了让「按 cwd 前缀过滤会话」这一判断能对上——会话日志里记的是真实路径。
 *
 * @param path - 工作区路径。
 * @returns 真实路径或原路径。
 */
export async function realWorkspacePath(path: string): Promise<string> {
  try {
    return await realpath(path)
  } catch {
    return path
  }
}
