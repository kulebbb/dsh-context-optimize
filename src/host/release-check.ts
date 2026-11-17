/**
 * 版本检查：只在「从 npm 同名安装」时给面板一个「新版本」入口。
 *
 * 判据与 DSH 插件页保持一致——否则会出现「我们点亮了、插件页却没有更新按钮」的死路：
 * 1. 安装来源必须是 registry（依赖值是版本号 / 范围 / tag）；`link:`、`file:`、Git 一律不参与；
 * 2. 只认 `dist-tags.latest` 指向的正式版（latest 端点只返回正式版；带 `-` 的预发布不提示），
 *    且该版本清单里声明了 `dsh.bundle`（否则装了也起不来）；
 * 3. 只有比当前版本高才提示。
 *
 * 失败一律静默：网络、超时、坏 JSON 都返回「不提示」，不给面板添噪音。
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PACKAGE_NAME } from '../shared/types.ts'
import type { InstallSource, VersionPayload } from '../shared/types.ts'

/** 安装源：先官方源，失败再问国内镜像（与 dsh-context 的做法一致）。 */
export const RELEASE_REGISTRIES = ['https://registry.npmjs.org', 'https://registry.npmmirror.com'] as const

const OK_TTL_MS = 60 * 60 * 1000
const FAIL_TTL_MS = 5 * 60 * 1000
const TIMEOUT_MS = 4000

/** 预发布阶段的大小：同一版本号下 alpha < beta < rc < 正式版。 */
const PRE_RANK: Record<string, number> = { alpha: 1, beta: 2, rc: 3 }

const STABLE_RANK = 4

interface ParsedVersion {
  readonly major: number
  readonly minor: number
  readonly patch: number
  readonly rank: number
  readonly serial: number
}

/**
 * 解析 `1.2.3` / `v1.2.3` / `1.2.3-rc.1` 这类版本串；不认识的返回 null。
 * 只覆盖本包会用到的形态，不追求完整的 semver。
 */
export function parseVersion(input: string): ParsedVersion | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)(?:\.(\d+))?)?(?:\+[0-9a-z.-]+)?$/i.exec(input.trim())
  if (match === null) return null
  const stage = match[4]?.toLowerCase()
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    rank: stage === undefined ? STABLE_RANK : (PRE_RANK[stage] ?? 0),
    serial: match[5] === undefined ? 0 : Number(match[5]),
  }
}

/** 比较两个版本；任一不可解析时返回 null（调用方按「不提示」处理）。 */
export function compareVersions(left: string, right: string): number | null {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (a === null || b === null) return null
  const keys = ['major', 'minor', 'patch', 'rank', 'serial'] as const
  for (const key of keys) {
    if (a[key] !== b[key]) return a[key] - b[key]
  }
  return 0
}

/** 是否是正式版（无 alpha/beta/rc 后缀）。 */
export function isStableVersion(input: string): boolean {
  return parseVersion(input)?.rank === STABLE_RANK
}

/**
 * 把 profile 依赖值分类。只有 registry 才可能应用内更新。
 *
 * 形如 `0.1.2`、`^0.1.2`、`latest` 的都算 registry；`link:`、`file:`、`workspace:`、
 * `git+https://…#sha`、`github:owner/repo`、裸 URL 与本地路径都算 other。
 */
export function classifyInstallSource(spec: string | undefined): InstallSource {
  if (spec === undefined || spec.trim() === '') return 'unknown'
  const value = spec.trim()
  if (/^(link|file|workspace|portal):/i.test(value)) return 'other'
  if (/^(git\+|git:|github:|gitlab:|bitbucket:|ssh:)/i.test(value)) return 'other'
  // npm:/patch:/catalog: 是别名或补丁协议，不是「同名 registry 安装」；scp 形式的 Git（git@host:path）也算 other
  if (/^(npm|patch|catalog):/i.test(value)) return 'other'
  if (/^[\w.-]+@[\w.-]+:/.test(value)) return 'other'
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return 'other'
  // 本地路径：./ ../ / 与 ~/ 算目录；注意 `~0.2.0` 是 semver 范围，不能一起归到 other
  if (/^(\.{1,2}\/|\/|~\/)/.test(value)) return 'other'
  // Windows 盘符路径与 UNC 共享目录
  if (/^[a-z]:[\\/]/i.test(value) || /^\\\\/.test(value)) return 'other'
  return 'registry'
}

/**
 * 推导 profile 目录：优先用 DSH 注入的 `DSH_PROFILE_DIR`，其次按 `DSH_PROFILE` 拼。
 * 两者都没有时返回 undefined——此时安装来源未知，不提示。
 */
export function resolveProfileDir(env: NodeJS.ProcessEnv, dshHome: string): string | undefined {
  const explicit = env.DSH_PROFILE_DIR?.trim()
  if (explicit !== undefined && explicit !== '') return explicit
  const profile = env.DSH_PROFILE?.trim()
  if (profile !== undefined && profile !== '') return join(dshHome, 'profiles', profile)
  return undefined
}

/** 从 profile 的 package.json 里取本包的依赖值；三类依赖都看一遍。 */
export function installSpecOf(manifest: unknown, packageName: string): string | undefined {
  if (typeof manifest !== 'object' || manifest === null) return undefined
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies'] as const) {
    const deps = (manifest as Record<string, unknown>)[field]
    if (typeof deps !== 'object' || deps === null) continue
    const spec = (deps as Record<string, unknown>)[packageName]
    if (typeof spec === 'string') return spec
  }
  return undefined
}

/** 读 profile 清单里的依赖值；文件缺失或坏 JSON 都当作「未知」。 */
async function readInstallSpec(profileDir: string | undefined, packageName: string): Promise<string | undefined> {
  if (profileDir === undefined) return undefined
  try {
    const text = await readFile(join(profileDir, 'package.json'), 'utf8')
    return installSpecOf(JSON.parse(text), packageName)
  } catch {
    return undefined
  }
}

/**
 * 读本包自己的版本号：打包后 `lib/index.js` 的上一级是包根；
 * 直接跑源码时（`src/host/`）要再上一级。用包名做校验，避免误读别的 package.json。
 */
async function readOwnVersion(): Promise<string | null> {
  for (const candidate of ['../package.json', '../../package.json']) {
    try {
      const text = await readFile(new URL(candidate, import.meta.url), 'utf8')
      const parsed: unknown = JSON.parse(text)
      if (typeof parsed !== 'object' || parsed === null) continue
      const record = parsed as Record<string, unknown>
      if (record.name !== PACKAGE_NAME) continue
      if (typeof record.version !== 'string' || record.version === '') continue
      return record.version
    } catch {
      // 换下一个候选
    }
  }
  return null
}

/**
 * 从宿主的 `profileContext` 服务取 profile 目录。
 *
 * 注意：`DSH_PROFILE_DIR` 只存在于「shell 工具调用」的环境快照里，宿主进程环境本身没有它，
 * 所以这里必须以服务为准，环境变量只作为 CLI / 开发场景的兜底。
 */
export function profileDirOfContext(ctx: {
  get?<T = unknown>(name: string): T | undefined
}): string | undefined {
  try {
    const profile = ctx.get?.<{ dir?: unknown }>('profileContext')
    const dir = profile?.dir
    return typeof dir === 'string' && dir !== '' ? dir : undefined
  } catch {
    return undefined
  }
}

interface LatestLookup {
  readonly version: string
  /** 该版本是否声明了 `dsh.bundle`（能作为插件安装）。 */
  readonly hasBundle: boolean
}

/** 问一个安装源「latest 是哪个版本、能不能装」；失败返回 null。 */
async function fetchLatest(
  base: string,
  name: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<LatestLookup | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // scoped 包名的 `/` 必须编码成 %2F，`@` 保留即可被 npm 接受。
    // 解构后再调：某些环境的 fetch 依赖 this，直接当方法调会抛 Illegal invocation。
    const doFetch = fetchImpl
    const response = await doFetch(`${base}/${encodeURIComponent(name).replace(/^%40/, '@')}/latest`, {
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) return null
    const body: unknown = await response.json()
    const manifest = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null
    const version = typeof manifest?.version === 'string' ? manifest.version : null
    if (version === null || version === '') return null
    const dsh = typeof manifest?.dsh === 'object' && manifest.dsh !== null ? (manifest.dsh as Record<string, unknown>) : null
    return { version, hasBundle: dsh?.bundle !== undefined && dsh.bundle !== null }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export interface ReleaseCheckOptions {
  readonly packageName?: string | undefined
  /** profile 目录；缺失时安装来源未知，不提示。 */
  readonly profileDir?: string | undefined
  readonly registries?: readonly string[] | undefined
  readonly fetchImpl?: typeof fetch | undefined
  readonly now?: (() => number) | undefined
  readonly timeoutMs?: number | undefined
  readonly okTtlMs?: number | undefined
  readonly failTtlMs?: number | undefined
  /** 覆盖「读自身版本」；测试用。 */
  readonly readVersion?: (() => Promise<string | null>) | undefined
  /** 覆盖「读安装来源」；测试用。 */
  readonly readSpec?: (() => Promise<string | undefined>) | undefined
}

/**
 * 版本检查器：带 1 小时成功缓存 / 5 分钟失败缓存 + 并发去重。
 * 一个进程一个实例即可，面板反复挂载不会重复请求安装源。
 */
export class ReleaseCheck {
  private readonly packageName: string
  private readonly registries: readonly string[]
  private readonly fetchImpl: typeof fetch
  private readonly now: () => number
  private readonly timeoutMs: number
  private readonly okTtlMs: number
  private readonly failTtlMs: number
  private readonly readVersion: () => Promise<string | null>
  private readonly readSpec: () => Promise<string | undefined>
  private cache: { at: number; ok: boolean; payload: VersionPayload } | null = null
  private inflight: Promise<VersionPayload> | null = null

  constructor(options: ReleaseCheckOptions = {}) {
    this.packageName = options.packageName ?? PACKAGE_NAME
    this.registries = options.registries ?? RELEASE_REGISTRIES
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? Date.now
    this.timeoutMs = options.timeoutMs ?? TIMEOUT_MS
    this.okTtlMs = options.okTtlMs ?? OK_TTL_MS
    this.failTtlMs = options.failTtlMs ?? FAIL_TTL_MS
    this.readVersion = options.readVersion ?? readOwnVersion
    this.readSpec =
      options.readSpec ?? (() => readInstallSpec(options.profileDir, this.packageName))
  }

  /** 查一次版本；缓存有效时直接返回上次结果，并发调用共享同一个请求。 */
  async check(): Promise<VersionPayload> {
    const cached = this.cache
    if (cached !== null && this.now() - cached.at < (cached.ok ? this.okTtlMs : this.failTtlMs)) {
      return cached.payload
    }
    if (this.inflight !== null) return this.inflight
    const run = this.run().finally(() => {
      this.inflight = null
    })
    this.inflight = run
    return run
  }

  private settle(ok: boolean, payload: VersionPayload): VersionPayload {
    this.cache = { at: this.now(), ok, payload }
    return payload
  }

  private async run(): Promise<VersionPayload> {
    const current = await this.readVersion()
    if (current === null) {
      return this.settle(false, { current: '', latest: null, updateAvailable: false, installSource: 'unknown' })
    }
    const installSource = classifyInstallSource(await this.readSpec())
    if (installSource !== 'registry') {
      return this.settle(true, { current, latest: null, updateAvailable: false, installSource })
    }

    let found: LatestLookup | null = null
    for (const base of this.registries) {
      found = await fetchLatest(base, this.packageName, this.fetchImpl, this.timeoutMs)
      if (found !== null) break
    }
    if (found === null) {
      return this.settle(false, { current, latest: null, updateAvailable: false, installSource })
    }

    const order = compareVersions(found.version, current)
    const updateAvailable =
      found.hasBundle && isStableVersion(found.version) && order !== null && order > 0
    return this.settle(true, { current, latest: found.version, updateAvailable, installSource })
  }
}
