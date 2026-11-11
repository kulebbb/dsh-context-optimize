/**
 * 五个 skill 根的定义：优先级、可卸载性、归档目录推导。
 *
 * 优先级直接照 DSH 的 `dsh-skill-filesystem`：同名 skill 由 rank 小的赢。
 * 项目 `.dsh`(100) < 项目 `.agents`(200) < 用户 `.dsh`(400) < 用户 `.agents`(500) < 内置(600)。
 */
import type { RootId, RootScope, SourceTag } from './types.ts'

/** 同名冲突时的优先级；数字小的赢，和 DSH 保持一致。 */
export const ROOT_RANK: Readonly<Record<RootId, number>> = {
  'project-dsh': 100,
  'project-agents': 200,
  'user-dsh': 400,
  'user-agents': 500,
  bundled: 600,
}

/** 根 → 范围。 */
export function scopeOfRoot(id: RootId): RootScope {
  return id === 'project-dsh' || id === 'project-agents' ? 'project' : 'global'
}

/** 根 → 面板上的来源标签（目前与 RootId 同名，单独保留一层便于将来合并显示）。 */
export function sourceOfRoot(id: RootId): SourceTag {
  return id
}

/** 项目范围的根。 */
export const PROJECT_ROOTS: readonly RootId[] = ['project-dsh', 'project-agents']

/** 全局范围的根，按优先级排列。 */
export const GLOBAL_ROOTS: readonly RootId[] = ['user-dsh', 'user-agents', 'bundled']

/** 只有内置根是只读的：它是 App 安装包里的资源，升级会被覆盖。 */
export function isRemovableRoot(id: RootId): boolean {
  return id !== 'bundled'
}

/**
 * 由 skills 目录推导归档目录：**与 skills 目录同级**，不建在它里面。
 *
 * 放在 skills 内部虽然也不会被 DSH 当成 skill 扫到（它只认第一层 .md 和含 SKILL.md 的目录），
 * 但等于把垃圾箱建在仓库里，一眼看目录会误会；同级更干净，也不怕将来扫描规则变化。
 *
 * @param skillsDir - 某个根的绝对路径，末尾不带分隔符。
 * @returns 该根的归档目录绝对路径。
 */
export function archiveDirFor(skillsDir: string): string {
  const parent = skillsDir.replace(/[\\/]+$/, '').replace(/[\\/][^\\/]+$/, '')
  return `${parent}/skill-archive`
}

/**
 * 由「用户 home 路径」渲染展示用的符号路径。
 *
 * @param absolute - 绝对路径。
 * @param home - home 目录绝对路径（不带末尾分隔符）。
 * @returns 位于 home 下时返回 `~/...`，否则原样返回。
 */
export function displayPath(absolute: string, home: string): string {
  const normalizedHome = home.replace(/[\\/]+$/, '')
  if (absolute === normalizedHome) return '~'
  if (absolute.startsWith(`${normalizedHome}/`)) return `~${absolute.slice(normalizedHome.length)}`
  return absolute
}

/** 归档目录里给重名文件加的时间后缀，形如 `@20261111-134501`。 */
export function archiveSuffix(now: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `@${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}
