/**
 * 宿主半的中枢：把「磁盘上的 skill」「工作区列表」「会话日志里的调用记录」三件事拼成面板要的数据，
 * 并承担归档 / 还原这两个会动磁盘的写操作。
 *
 * 设计约束（来自 docs/02-项目结构.html）：
 * - 客户端只传根 ID、工作区 ID、目录名，绝对路径全部由这里拼；
 * - 依赖全部注入，测试里不启动 DSH 也能跑；
 * - 读操作可以先给近似值（回溯未完成时频次为空），绝不为统计把面板卡住。
 */
import { join } from 'node:path'
import { filterByState, markEffective, compareByCalls, compareByTokens, toDateKey } from '../shared/catalog.ts'
import { OptimizeError, STATUS_BY_CODE, normalizeError } from '../shared/errors.ts'
import { archiveDirFor } from '../shared/roots.ts'
import { ROUTES } from '../shared/types.ts'
import type {
  BackfillState,
  ErrorPayload,
  MovePayload,
  MoveRequest,
  OverviewPayload,
  ProjectEntry,
  ProjectsPayload,
  RootId,
  RootInfo,
  RootScope,
  SkillEntry,
  SkillsPayload,
  SkillStateFilter,
} from '../shared/types.ts'
import { moveToArchive, restoreFromArchive } from './archive.ts'
import {
  globalRoots,
  homePaths,
  projectRoots,
  scanArchiveDir,
  scanSkillRoot,
} from './skill-scan.ts'
import type { HomePaths, ScannedSkill } from './skill-scan.ts'
import {
  emptyCache,
  loadCache,
  saveCache,
} from './frequency-cache.ts'
import type { FrequencyCache, SessionUsageRecord } from './frequency-cache.ts'
import { foldEvents, indexUsage, newSessionRecord } from './frequency.ts'
import type { SessionEventLike, UsageEntry } from './frequency.ts'
import { pathExists, realWorkspacePath, resolveProjectRoot } from './workspaces.ts'
import type { WorkspaceLike } from './workspaces.ts'

/** `ctx.sessionQuery` 里我们用到的最小结构。 */
export interface SessionQueryLike {
  listSessions(
    signal?: AbortSignal,
  ): Promise<readonly { header: { id: string; cwd?: string; createdAt?: number }; live: boolean }[]>
  readSession(sessionId: string): Promise<{ session?: { cwd?: string } | null; events: readonly unknown[] }>
}

/** `ctx.workspaceRegistry` 里我们用到的最小结构。 */
export interface WorkspaceRegistryLike {
  list(): readonly WorkspaceLike[]
}

/** 注入依赖；生产环境接 DSH 服务，测试里塞假的。 */
export interface ServiceDeps {
  /** DSH home；也作为 home 路径集合的默认 dshHome。 */
  readonly dshHome: string
  readonly cachePath: string
  /**
   * 覆盖 home 路径集合。省略时按 `dshHome` + 进程环境推导——
   * 测试要把根指到临时目录时用它，不必改 `process.env`。
   */
  readonly home?:
    | { readonly dshHome?: string; readonly agentsHome?: string; readonly bundledSkillDir?: string }
    | undefined
  readonly sessionQuery?: SessionQueryLike | undefined
  readonly workspaceRegistry?: WorkspaceRegistryLike | undefined
  readonly now?: (() => Date) | undefined
  readonly logger?: { warn?(...args: unknown[]): void } | undefined
  /** 单个会话读日志的超时，避免某个坏会话卡住整轮回溯。 */
  readonly sessionReadTimeoutMs?: number | undefined
}

/** 扫描结果的内存缓存时长：面板 5 秒轮询一次，没必要每次都把磁盘读一遍。 */
const SCAN_TTL_MS = 2000

/** 落盘防抖：实时事件可能很密，攒一下再写。 */
const SAVE_DEBOUNCE_MS = 2000

/** 回溯并发；太高会把 CPU 打满，本机实测 4 很稳。 */
const BACKFILL_CONCURRENCY = 4

/** 一次扫描的缓存条目。 */
interface ScanMemo {
  readonly at: number
  /** 全局 + 所有项目根上出现过的 skill 名，用于判断某个历史调用是否真的「已移除」。 */
  readonly knownNames: ReadonlySet<string>
  /** 生成这份快照时的频次版本；频次一变就必须重建，否则会拿到「频次还是 0」的旧表。 */
  readonly usageRevision: number
  readonly roots: readonly RootInfo[]
  readonly entries: readonly SkillEntry[]
  readonly archived: readonly SkillEntry[]
}

export class ContextOptimizeService {
  private readonly deps: ServiceDeps
  private readonly home: HomePaths
  private cache: FrequencyCache = emptyCache()
  private memo: ScanMemo | undefined
  /**
   * 频次数据的版本号。任何改变频次的动作（回溯完成、实时事件落账）都要 +1，
   * 让扫描缓存失效——否则面板会短暂显示「有目录但调用次数全是 0」的错表。
   */
  private usageRevision = 0
  /** 缓存读完之前收到的实时事件先排队，读完再重放，避免被 initialize 覆盖掉。 */
  private ready = false
  private readonly pendingEvents: { id: string; cwd: string | null; createdAt?: number; event: SessionEventLike }[] = []
  /** 按根串行化 move，堵住 check-then-rename 的并发窗口。 */
  private readonly moveChains = new Map<string, Promise<unknown>>()
  /** 串行化落盘，避免多个 flush 抢同一个临时文件、用旧快照盖新数据。 */
  private flushChain: Promise<void> = Promise.resolve()
  private backfillPromise: Promise<void> | undefined
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private disposed = false

  constructor(deps: ServiceDeps) {
    this.deps = deps
    const envHome = homePaths()
    const bundled = deps.home?.bundledSkillDir ?? envHome.bundledSkillDir
    this.home = {
      dshHome: deps.home?.dshHome ?? deps.dshHome,
      agentsHome: deps.home?.agentsHome ?? envHome.agentsHome,
      ...(bundled === undefined ? {} : { bundledSkillDir: bundled }),
    }
  }

  /** 当前时刻；测试可注入。 */
  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /** 读缓存并启动首次回溯（后台，不阻塞任何请求）。 */
  async initialize(): Promise<void> {
    const loaded = await loadCache(this.deps.cachePath)
    // 合并而不是覆盖：初始化期间可能已经收下实时事件，直接替换会丢
    this.cache = { ...loaded, sessions: { ...loaded.sessions } }
    this.ready = true
    const queued = this.pendingEvents.splice(0, this.pendingEvents.length)
    for (const item of queued) this.ingest(item.id, item.cwd, item.createdAt, item.event)
    if (this.cache.backfill.state !== 'done') this.startBackfill()
  }

  /** 停掉后台任务并冲一次盘。 */
  async dispose(): Promise<void> {
    this.disposed = true
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    await this.flush()
  }

  /** 收到一条实时会话事件。 */
  ingest(sessionId: string, cwd: string | null, createdAt: number | undefined, event: SessionEventLike): void {
    if (!this.ready) {
      this.pendingEvents.push({ id: sessionId, cwd, ...(createdAt === undefined ? {} : { createdAt }), event })
      return
    }
    const existing = this.cache.sessions[sessionId]
    const record = existing ?? newSessionRecord(cwd, createdAt)
    if (record.cwd === null && cwd !== null) record.cwd = cwd
    const before = record.lastSeq
    foldEvents(record, [event])
    if (record.lastSeq === before) return
    this.cache.sessions[sessionId] = record
    this.usageRevision += 1
    this.scheduleSave()
  }

  /** 路由入口：按 `request.url` 的 pathname 分发。 */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      switch (url.pathname) {
        case ROUTES.overview:
          return json(await this.overview())
        case ROUTES.skills:
          return json(await this.skills(parseSkillsQuery(url)))
        case ROUTES.projects:
          return json(await this.projects())
        case ROUTES.archive:
          return json(await this.move(request, 'archive'))
        case ROUTES.restore:
          return json(await this.move(request, 'restore'))
        default:
          throw new OptimizeError('not-found', `未知端点 ${url.pathname}`)
      }
    } catch (error) {
      const { code, message } = normalizeError(error)
      const payload: ErrorPayload = { error: { code, message } }
      return json(payload, STATUS_BY_CODE[code])
    }
  }

  /** `GET .overview` */
  async overview(): Promise<OverviewPayload> {
    const scan = await this.scan()
    const effective = scan.entries.filter((entry) => entry.effective)
    const neverCalled = effective.filter((entry) => entry.calls === 0)
    const onDisk = new Set<string>(scan.knownNames)
    for (const entry of scan.entries) onDisk.add(entry.name)
    for (const entry of scan.archived) onDisk.add(entry.name)
    const usageNames = indexUsage(this.cache.sessions, this.now())
    let removed = 0
    for (const name of usageNames.keys()) if (!onDisk.has(name)) removed += 1
    return {
      generatedAt: this.now().toISOString(),
      roots: scan.roots,
      totals: {
        active: effective.length,
        archived: scan.archived.length,
        catalogChars: effective.reduce((sum, entry) => sum + entry.descriptionChars, 0),
        catalogTokens: effective.reduce((sum, entry) => sum + entry.approxTokens, 0),
        calls: effective.reduce((sum, entry) => sum + entry.calls, 0),
        calls30d: effective.reduce((sum, entry) => sum + entry.calls30d, 0),
        neverCalled: neverCalled.length,
        neverCalledTokens: neverCalled.reduce((sum, entry) => sum + entry.approxTokens, 0),
        removed,
      },
      backfill: this.cache.backfill,
      corpusRange: this.corpusRange(),
      globalArchiveDir: archiveDirFor(join(this.home.agentsHome, 'skills')),
    }
  }

  /** 频次统计覆盖的会话起止日期与会话数。 */
  private corpusRange(): { from: string | null; to: string | null; sessions: number } {
    let from: number | null = null
    let to: number | null = null
    const sessions = Object.values(this.cache.sessions)
    for (const record of sessions) {
      const createdAt = record.createdAt
      if (createdAt === undefined) continue
      if (from === null || createdAt < from) from = createdAt
      if (to === null || createdAt > to) to = createdAt
    }
    return {
      from: from === null ? null : toDateKey(from),
      to: to === null ? null : toDateKey(to),
      sessions: sessions.length,
    }
  }

  /** `GET .skills` */
  async skills(query: { scope: RootScope; workspaceId?: string; state: SkillStateFilter }): Promise<SkillsPayload> {
    if (query.scope === 'global') {
      const scan = await this.scan()
      const selected = filterByState(scan.entries, query.state, scan.archived)
      const entries = query.state === 'archived' ? [...selected] : [...selected].sort(compareByCalls)
      return {
        scope: 'global',
        state: query.state,
        entries,
        total: entries.length,
        archiveDir: archiveDirFor(join(this.home.agentsHome, 'skills')),
      }
    }
    const workspaceId = query.workspaceId
    if (workspaceId === undefined || workspaceId === '') {
      throw new OptimizeError('invalid-request', '项目范围必须带 workspaceId')
    }
    const workspace = this.findWorkspace(workspaceId)
    if (workspace === undefined) throw new OptimizeError('not-found', '找不到该工作区')
    if (!(await pathExists(workspace.path))) {
      throw new OptimizeError('not-found', '该工作区路径已失效，不能读取或操作它的 skill')
    }
    const projectRoot = await this.projectRootOf(workspace)
    const roots = projectRoots(projectRoot)
    const usage = indexUsage(this.cache.sessions, this.now(), projectRoot)
    const scanned: ScannedSkill[] = []
    for (const root of roots) scanned.push(...(await scanSkillRoot(root)))
    const marked = markEffective(withUsage(scanned, usage))
    const archived: SkillEntry[] = []
    for (const root of roots) {
      archived.push(...(await scanArchiveDir(archiveDirFor(root.path), root.id)))
    }
    const selected = filterByState(marked, query.state, archived)
    const entries = query.state === 'archived' ? [...selected] : [...selected].sort(compareByCalls)
    return {
      scope: 'project',
      workspaceId,
      state: query.state,
      entries,
      total: entries.length,
      archiveDir: archiveDirFor(roots[0]?.path ?? projectRoot),
    }
  }

  /** `GET .projects` */
  async projects(): Promise<ProjectsPayload> {
    const workspaces = this.deps.workspaceRegistry?.list() ?? []
    const projects: ProjectEntry[] = []
    for (const workspace of workspaces) {
      const exists = await pathExists(workspace.path)
      const projectRoot = exists ? await this.projectRootOf(workspace) : workspace.path
      const roots = projectRoots(projectRoot)
      const scanned: ScannedSkill[] = []
      if (exists) {
        for (const root of roots) scanned.push(...(await scanSkillRoot(root)))
      }
      const usage = indexUsage(this.cache.sessions, this.now(), projectRoot)
      const marked = markEffective(withUsage(scanned, usage)).filter((entry) => entry.effective)
      marked.sort(compareByTokens)
      let archivedCount = 0
      if (exists) {
        for (const root of roots) archivedCount += (await scanArchiveDir(archiveDirFor(root.path), root.id)).length
      }
      projects.push({
        id: workspace.id,
        title: workspace.title,
        path: workspace.path,
        exists,
        root: projectRoot,
        skillCount: marked.length,
        archivedCount,
        approxTokens: marked.reduce((sum, entry) => sum + entry.approxTokens, 0),
        preview: marked.slice(0, 6),
      })
    }
    projects.sort((a, b) => b.skillCount - a.skillCount || a.title.localeCompare(b.title))
    return {
      projects,
      total: projects.length,
      missing: projects.filter((project) => !project.exists).length,
    }
  }

  /** 归档 / 还原。 */
  private async move(request: Request, action: 'archive' | 'restore'): Promise<MovePayload> {
    if (request.method !== 'POST') throw new OptimizeError('invalid-request', '该端点只接受 POST')
    let body: unknown
    try {
      body = await request.json()
    } catch {
      throw new OptimizeError('invalid-request', '请求体不是合法 JSON')
    }
    const parsed = parseMoveRequest(body)
    const skillsDir = await this.resolveRootDir(parsed)
    // 同一根上的 move 串行执行：否则两个并发归档都会认为目标不存在，
    // 扁平 .md 在 POSIX 下会被后一个 rename 静默覆盖。
    const result = await this.serializeMove(skillsDir, async () =>
      action === 'archive'
        ? await moveToArchive(skillsDir, parsed.dirName, this.now())
        : await restoreFromArchive(skillsDir, parsed.dirName),
    )
    this.memo = undefined
    const payload: MovePayload = {
      ok: true,
      rootId: parsed.rootId,
      dirName: parsed.dirName,
      to: result.to,
      archiveDir: archiveDirFor(skillsDir),
      ...(result.renamedTo === undefined ? {} : { renamedTo: result.renamedTo }),
    }
    return payload
  }

  /** 按 key 串行执行一个异步任务。 */
  private serializeMove<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.moveChains.get(key) ?? Promise.resolve()
    const next = previous.then(task, task)
    this.moveChains.set(
      key,
      next.then(
        () => undefined,
        () => undefined,
      ),
    )
    return next
  }

  /** 把 (scope, workspaceId?, rootId) 解析成一个可信的根目录。 */
  private async resolveRootDir(request: MoveRequest): Promise<string> {
    if (request.rootId === 'bundled') {
      throw new OptimizeError('readonly-root', '内置 skill 是 App 自带的只读资源，不能归档')
    }
    const globalIds: readonly RootId[] = ['user-dsh', 'user-agents']
    const projectIds: readonly RootId[] = ['project-dsh', 'project-agents']
    if (request.scope === 'global') {
      if (!globalIds.includes(request.rootId)) {
        throw new OptimizeError('unknown-root', `全局范围不接受根 ${request.rootId}`)
      }
      const root = globalRoots(this.home).find((candidate) => candidate.id === request.rootId)
      if (root === undefined) throw new OptimizeError('unknown-root', `根 ${request.rootId} 当前不可用`)
      return root.path
    }
    if (!projectIds.includes(request.rootId)) {
      throw new OptimizeError('unknown-root', `项目范围不接受根 ${request.rootId}`)
    }
    const workspaceId = request.workspaceId
    if (workspaceId === undefined || workspaceId === '') {
      throw new OptimizeError('invalid-request', '项目范围必须带 workspaceId')
    }
    const workspace = this.findWorkspace(workspaceId)
    if (workspace === undefined) throw new OptimizeError('not-found', '找不到该工作区')
    if (!(await pathExists(workspace.path))) {
      throw new OptimizeError('not-found', '该工作区路径已失效，不能读取或操作它的 skill')
    }
    const projectRoot = await this.projectRootOf(workspace)
    const root = projectRoots(projectRoot).find((candidate) => candidate.id === request.rootId)
    if (root === undefined) throw new OptimizeError('unknown-root', `根 ${request.rootId} 当前不可用`)
    return root.path
  }

  /** 找工作区；没有 workspaceRegistry 时一律找不到。 */
  private findWorkspace(id: string): WorkspaceLike | undefined {
    return this.deps.workspaceRegistry?.list().find((workspace) => workspace.id === id)
  }

  /** 工作区 → 项目根（先解析真实路径，否则会话 cwd 前缀匹配会对不上）。 */
  private async projectRootOf(workspace: WorkspaceLike): Promise<string> {
    // 路径不存在的工区不能往上找 .git：否则会解析到某个祖先仓库，
    // 让「失效工作区」也能列出并归档祖先项目的 skill。
    if (!(await pathExists(workspace.path))) return workspace.path
    return resolveProjectRoot(await realWorkspacePath(workspace.path))
  }

  /** 扫全局三个根，带 2 秒内存缓存。 */
  private async scan(): Promise<ScanMemo> {
    const cached = this.memo
    const at = Date.now()
    if (cached !== undefined && cached.usageRevision === this.usageRevision && at - cached.at < SCAN_TTL_MS) {
      return cached
    }
    // 版本在开头抓一次、在结尾复核：回溯可能正好在这几十毫秒里完成，
    // 那样「扫描到的目录」是新的、「频次」还是旧的，缓存下来的表会错（表现为调用次数全是 0）。
    const startedRevision = this.usageRevision
    const roots = globalRoots(this.home)
    const scanned: ScannedSkill[] = []
    for (const root of roots) scanned.push(...(await scanSkillRoot(root)))
    const usage = indexUsage(this.cache.sessions, this.now())
    const entries = markEffective(withUsage(scanned, usage))
    const rootInfos: RootInfo[] = []
    for (const root of roots) {
      rootInfos.push({
        id: root.id,
        scope: 'global',
        display: root.display,
        path: root.path,
        removable: root.removable,
        exists: await pathExists(root.path),
        count: entries.filter((entry) => entry.rootId === root.id && entry.effective).length,
      })
    }
    const archived: SkillEntry[] = []
    for (const root of roots) {
      if (!root.removable) continue
      archived.push(...(await scanArchiveDir(archiveDirFor(root.path), root.id)))
    }
    archived.sort((a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? ''))
    // 项目根上的 skill 也算「还在磁盘上」：只按全局判断会把项目级 skill 误报成已移除
    const knownNames = new Set<string>()
    for (const entry of entries) knownNames.add(entry.name)
    for (const entry of archived) knownNames.add(entry.name)
    for (const workspace of this.deps.workspaceRegistry?.list() ?? []) {
      if (!(await pathExists(workspace.path))) continue
      const projectRoot = await this.projectRootOf(workspace)
      for (const root of projectRoots(projectRoot)) {
        for (const entry of await scanSkillRoot(root)) knownNames.add(entry.name)
      }
    }
    const memo: ScanMemo = { at, usageRevision: startedRevision, knownNames, roots: rootInfos, entries, archived }
    // 扫描期间频次变过就只返回这一次、不缓存，下一次重新扫，避免留下错误的表。
    this.memo = startedRevision === this.usageRevision ? memo : undefined
    return memo
  }

  /** 启动回溯；重复调用只跑一次。 */
  private startBackfill(): void {
    if (this.backfillPromise !== undefined || this.disposed) return
    this.backfillPromise = this.runBackfill().finally(() => {
      this.backfillPromise = undefined
    })
  }

  /** 把还没处理过的会话日志读一遍。 */
  private async runBackfill(): Promise<void> {
    const query = this.deps.sessionQuery
    if (query === undefined) {
      this.cache.backfill = { state: 'partial', done: 0, total: 0 }
      return
    }
    let records: readonly { header: { id: string; cwd?: string; createdAt?: number }; live?: boolean }[]
    try {
      records = await query.listSessions()
    } catch (error) {
      this.deps.logger?.warn?.('[dsh-context-optimize] 列出会话失败：', error)
      this.cache.backfill = { state: 'partial', done: 0, total: 0 }
      return
    }
    // 待处理 = 缓存里没有的会话 + 当前仍然 live 的会话（它们可能在插件没运行时又追加了事件）。
    // 后者是「增量」的实际落点：靠 seq 水位去重，重读不会重复计数。
    const liveIds = new Set(records.filter((record) => record.live).map((record) => record.header.id))
    const pending = records.filter(
      (record) => this.cache.sessions[record.header.id] === undefined || liveIds.has(record.header.id),
    )
    this.cache.backfill = { state: 'running', done: records.length - pending.length, total: records.length }
    let done = records.length - pending.length
    let failures = 0
    let index = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const current = index
        index += 1
        const record = pending[current]
        if (record === undefined) return
        const id = record.header.id
        try {
          const snapshot = await withTimeout(
            query.readSession(id),
            this.deps.sessionReadTimeoutMs ?? 30_000,
          )
          const createdAt = (snapshot.session as { createdAt?: number } | null | undefined)?.createdAt ?? record.header.createdAt
          // 合并进已有记账而不是替换：实时事件可能已经写进同一条记录
          const usage =
            this.cache.sessions[id] ??
            newSessionRecord(snapshot.session?.cwd ?? record.header.cwd ?? null, createdAt)
          if (usage.cwd === null) usage.cwd = snapshot.session?.cwd ?? record.header.cwd ?? null
          if (usage.createdAt === undefined && createdAt !== undefined) usage.createdAt = createdAt
          foldEvents(usage, snapshot.events as readonly SessionEventLike[])
          this.cache.sessions[id] = usage
        } catch (error) {
          // 失败时不写空记录：写了就再也不会重试，那个会话的历史会永久显示 0 次。
          failures += 1
          this.deps.logger?.warn?.(`[dsh-context-optimize] 读取会话 ${id} 失败，下次启动会重试：`, error)
        }
        done += 1
        this.cache.backfill = { state: 'running', done, total: records.length }
      }
    }
    const workers = Array.from({ length: Math.min(BACKFILL_CONCURRENCY, Math.max(1, pending.length)) }, worker)
    await Promise.all(workers)
    // 有失败就标 partial，下次启动 initialize 会再跑一遍补齐
    this.cache.backfill = {
      state: failures > 0 ? 'partial' : 'done',
      done: records.length - failures,
      total: records.length,
    }
    this.usageRevision += 1
    this.memo = undefined
    await this.flush()
  }

  /** 攒一下再落盘。 */
  private scheduleSave(): void {
    if (this.disposed) return
    if (this.saveTimer !== undefined) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.flush()
    }, SAVE_DEBOUNCE_MS)
    this.saveTimer.unref?.()
  }

  /** 立即落盘；多次调用会串行执行，后一次一定写更新的快照。 */
  private flush(): Promise<void> {
    this.flushChain = this.flushChain.then(() => this.writeCache())
    return this.flushChain
  }

  private async writeCache(): Promise<void> {
    try {
      await saveCache(this.deps.cachePath, this.cache)
    } catch (error) {
      this.deps.logger?.warn?.('[dsh-context-optimize] 写频次缓存失败：', error)
    }
  }
}

/** 给扫描结果补上频次字段。 */
function withUsage(entries: readonly ScannedSkill[], usage: ReadonlyMap<string, UsageEntry>): SkillEntry[] {
  return entries.map((entry) => {
    const stat = usage.get(entry.name)
    return {
      ...entry,
      effective: true,
      calls: stat?.calls ?? 0,
      calls30d: stat?.calls30d ?? 0,
      lastUsedAt: stat?.lastUsedAt ?? null,
    }
  })
}

/** 解析 skills 查询参数。 */
function parseSkillsQuery(url: URL): { scope: RootScope; workspaceId?: string; state: SkillStateFilter } {
  const scope = url.searchParams.get('scope')
  if (scope !== 'global' && scope !== 'project') {
    throw new OptimizeError('invalid-request', 'scope 必须是 global 或 project')
  }
  const rawState = url.searchParams.get('state') ?? 'all'
  if (rawState !== 'all' && rawState !== 'never-called' && rawState !== 'archived') {
    throw new OptimizeError('invalid-request', 'state 不合法')
  }
  const workspaceId = url.searchParams.get('workspaceId') ?? undefined
  return workspaceId === undefined ? { scope, state: rawState } : { scope, workspaceId, state: rawState }
}

/** 解析并校验归档 / 还原请求体。 */
function parseMoveRequest(body: unknown): MoveRequest {
  if (typeof body !== 'object' || body === null) throw new OptimizeError('invalid-request', '请求体必须是对象')
  const record = body as Record<string, unknown>
  const scope = record['scope']
  const rootId = record['rootId']
  const dirName = record['dirName']
  if (scope !== 'global' && scope !== 'project') throw new OptimizeError('invalid-request', 'scope 不合法')
  const legalRoots: readonly RootId[] = ['user-dsh', 'user-agents', 'project-dsh', 'project-agents', 'bundled']
  if (typeof rootId !== 'string' || !legalRoots.includes(rootId as RootId)) {
    throw new OptimizeError('unknown-root', 'rootId 不合法')
  }
  if (typeof dirName !== 'string' || dirName === '') throw new OptimizeError('invalid-request', 'dirName 不能为空')
  const workspaceId = record['workspaceId']
  return {
    scope,
    rootId: rootId as RootId,
    dirName,
    ...(typeof workspaceId === 'string' && workspaceId !== '' ? { workspaceId } : {}),
  }
}

/** 给 promise 加超时。 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  if (ms <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new OptimizeError('internal', `会话读取超时（${String(ms)}ms）`))
        }, ms)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** JSON 响应。 */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/** 供测试读取：当前缓存快照。 */
export function cacheOf(service: ContextOptimizeService): FrequencyCache {
  return (service as unknown as { cache: FrequencyCache }).cache
}

