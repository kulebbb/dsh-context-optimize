/**
 * 工作区 → 项目根。
 *
 * 规则只有一条但错不起：往上找**最近**一个含 `.git` 的祖先，找不到就用工作区自己。
 * 找错会去扫别的项目的 skill，甚至把归档箱建到别人的仓库里。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, realpath, symlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  pathExists,
  realWorkspacePath,
  resolveProjectRoot,
} from '../src/host/workspaces.ts'
import { makeTmpDir, removeTmpDir, writeAt } from './helpers.ts'

let tmp = ''

beforeEach(async () => {
  tmp = await makeTmpDir('dco-ws')
})

afterEach(async () => {
  await removeTmpDir(tmp)
})

describe('resolveProjectRoot', () => {
  it('工作区自身有 .git 时返回它自己', async () => {
    await mkdir(join(tmp, 'proj', '.git'), { recursive: true })
    await expect(resolveProjectRoot(join(tmp, 'proj'))).resolves.toBe(join(tmp, 'proj'))
  })

  it('工作区在项目子目录里时返回含 .git 的祖先', async () => {
    await mkdir(join(tmp, 'proj', '.git'), { recursive: true })
    await mkdir(join(tmp, 'proj', 'packages', 'app'), { recursive: true })
    await expect(resolveProjectRoot(join(tmp, 'proj', 'packages', 'app'))).resolves.toBe(join(tmp, 'proj'))
  })

  it('多层嵌套时取最近的那一个（不是最外层）', async () => {
    await mkdir(join(tmp, 'outer', '.git'), { recursive: true })
    await mkdir(join(tmp, 'outer', 'inner', '.git'), { recursive: true })
    await mkdir(join(tmp, 'outer', 'inner', 'a', 'b'), { recursive: true })
    await expect(resolveProjectRoot(join(tmp, 'outer', 'inner', 'a', 'b'))).resolves.toBe(
      join(tmp, 'outer', 'inner'),
    )
  })

  it('没有 .git 的祖先时返回入参本身（不会算到文件系统根）', async () => {
    const workspace = join(tmp, 'plain', 'deep')
    await mkdir(workspace, { recursive: true })
    await expect(resolveProjectRoot(workspace)).resolves.toBe(resolve(workspace))
  })

  it('.git 是文件（worktree / submodule）时也算项目根', async () => {
    const workspace = join(tmp, 'worktree', 'sub')
    await mkdir(workspace, { recursive: true })
    await writeAt(join(tmp, 'worktree', '.git'), 'gitdir: /somewhere/.git/worktrees/sub\n')
    await expect(resolveProjectRoot(workspace)).resolves.toBe(join(tmp, 'worktree'))
  })

  it('路径已失效时返回入参本身，不抛错', async () => {
    const missing = join(tmp, 'gone', 'deeper')
    await expect(resolveProjectRoot(missing)).resolves.toBe(resolve(missing))
  })

  it('末尾带分隔符时依然解析正确', async () => {
    await mkdir(join(tmp, 'proj', '.git'), { recursive: true })
    await expect(resolveProjectRoot(join(tmp, 'proj') + '/')).resolves.toBe(join(tmp, 'proj'))
  })
})

describe('realWorkspacePath', () => {
  it('软链路径解析成真实路径（会话日志里记的是真实路径）', async () => {
    const real = join(tmp, 'real', 'project')
    await mkdir(real, { recursive: true })
    const link = join(tmp, 'link-to-project')
    await symlink(real, link)
    // macOS 上 /var 本身是 /private/var 的软链，期望值必须同样取 realpath。
    await expect(realWorkspacePath(link)).resolves.toBe(await realpath(real))
  })

  it('路径不存在时返回入参，不抛错', async () => {
    const missing = join(tmp, 'not-there')
    await expect(realWorkspacePath(missing)).resolves.toBe(missing)
  })
})

describe('pathExists', () => {
  it('存在（文件或目录）返回 true，不存在返回 false', async () => {
    await mkdir(join(tmp, 'dir'), { recursive: true })
    await writeAt(join(tmp, 'file.txt'), 'x')
    await expect(pathExists(join(tmp, 'dir'))).resolves.toBe(true)
    await expect(pathExists(join(tmp, 'file.txt'))).resolves.toBe(true)
    await expect(pathExists(join(tmp, 'nope'))).resolves.toBe(false)
  })
})
