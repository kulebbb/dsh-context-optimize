/**
 * 宿主（node 半）入口：注册认证路由、订阅会话事件做频次增量、启动时读缓存并后台补齐历史。
 *
 * 依赖两个 DSH 宿主服务：
 *   - `connection`：认证路由（与 dsh-output 同一套写法）；
 *   - `sessionQuery` / `workspaceRegistry`：可选注入——缺了也能跑，只是频次为空 / 项目页为空；
 *   - `llm` / `agentDefaultModel`：可选注入——缺了只是「洞察」不能发起分析，历史报告仍可看。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ContextOptimizeService } from './host/service.ts'
import type { SessionQueryLike, WorkspaceRegistryLike } from './host/service.ts'
import type { SessionEventLike } from './host/frequency.ts'
import { InsightService } from './host/insight/service.ts'
import type { InsightModelSelection, LlmLike } from './host/insight/analyze.ts'
import type { SessionSource } from './host/insight/collect.ts'
import { ROUTES, ROUTE_PREFIX } from './shared/types.ts'
import { profileDirOfContext, resolveProfileDir } from './host/release-check.ts'

/** Cordis 函数插件名。 */
export const name = '@kulebbb/dsh-context-optimize'

/** 只有路由载体是硬依赖；其余服务用 scoped inject 可选接入。 */
export const inject = ['connection']

interface ConnectionRoute {
  path: string
  methods: string[]
  requestBody: 'buffered'
  fetch: (request: Request) => Promise<Response>
}

interface HostContext {
  connection: { fetch: { register(route: ConnectionRoute): () => void } }
  /** Cordis 上下文的按名取服务；缺服务时返回 undefined。 */
  get?<T = unknown>(name: string): T | undefined
  logger?: { warn?(...args: unknown[]): void; debug?(...args: unknown[]): void }
  effect(factory: () => (() => void) | void, label?: string): () => void
  inject(services: string[], callback: (scope: Record<string, unknown>) => void): void
  on(
    event: 'session/event',
    // 监听器收到的是 Session 实例：id/cwd/createdAt 都在 header 上，实例本身没有 cwd
    listener: (
      session: { id?: unknown; header?: { cwd?: unknown; createdAt?: unknown } },
      event: SessionEventLike,
    ) => void,
  ): () => void
}

/** 洞察端点的公共前缀：以后只往 ROUTES 加一条也会自动归到洞察服务。 */
const INSIGHT_PREFIX = `${ROUTE_PREFIX}.insight.`

/** 走 POST 的洞察端点。 */
const INSIGHT_WRITE_ROUTES: ReadonlySet<string> = new Set([
  ROUTES.insightStart,
  ROUTES.insightCancel,
  ROUTES.insightRemove,
  ROUTES.insightRead,
])

/**
 * 注册插件。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx: HostContext): void {
  const dshHome = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh')
  const cachePath = join(dshHome, 'storages', 'dsh-context-optimize', 'frequency.v2.json')

  // 可选服务：用 scoped inject 接入，宿主没有该服务时静默降级，而不是整个插件加载失败。
  let sessionQuery: SessionQueryLike | undefined
  let workspaceRegistry: WorkspaceRegistryLike | undefined
  let llm: LlmLike | undefined
  let defaultSelection: (() => InsightModelSelection | null) | undefined
  ctx.inject(['sessionQuery'], (scope) => {
    sessionQuery = scope['sessionQuery'] as SessionQueryLike
  })
  ctx.inject(['workspaceRegistry'], (scope) => {
    workspaceRegistry = scope['workspaceRegistry'] as WorkspaceRegistryLike
  })
  ctx.inject(['llm'], (scope) => {
    llm = scope['llm'] as unknown as LlmLike
  })
  ctx.inject(['agentDefaultModel'], (scope) => {
    const service = scope['agentDefaultModel'] as { currentSelection(): InsightModelSelection } | undefined
    if (service === undefined) return
    defaultSelection = () => {
      try {
        const selection = service.currentSelection()
        return { provider: selection.provider, model: selection.model }
      } catch {
        return null
      }
    }
  })

  const service = new ContextOptimizeService({
    dshHome,
    cachePath,
    // 宿主进程里以 profileContext 为准；环境变量只在 CLI / 开发场景兜底。
    profileDir: profileDirOfContext(ctx) ?? resolveProfileDir(process.env, dshHome),
    logger: ctx.logger,
    get sessionQuery() {
      return sessionQuery
    },
    get workspaceRegistry() {
      return workspaceRegistry
    },
  })

  const insight = new InsightService({
    dir: join(dshHome, 'insight'),
    logger: ctx.logger,
    get llm() {
      return llm
    },
    get sessionQuery() {
      return sessionQuery as SessionSource | undefined
    },
    get defaultSelection() {
      return defaultSelection
    },
    hygiene: () => service.hygieneSnapshot(),
  })

  ctx.effect(
    () => {
      void service.initialize()
      return () => {
        void service.dispose()
      }
    },
    'dsh-context-optimize: cache',
  )

  ctx.effect(
    () => () => {
      void insight.dispose()
    },
    'dsh-context-optimize: insight',
  )

  for (const path of Object.values(ROUTES)) {
    const owner = path.startsWith(INSIGHT_PREFIX) ? insight : service
    const methods =
      path === ROUTES.archive || path === ROUTES.restore || INSIGHT_WRITE_ROUTES.has(path) ? ['POST'] : ['GET']
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path,
          methods,
          requestBody: 'buffered',
          fetch: (request) => owner.handle(request),
        }),
      `dsh-context-optimize: ${path}`,
    )
  }

  ctx.effect(
    () =>
      ctx.on('session/event', (session, event) => {
        const id = session?.id === undefined ? '' : String(session.id)
        if (id === '') return
        const cwd = typeof session.header?.cwd === 'string' ? session.header.cwd : null
        const createdAt = typeof session.header?.createdAt === 'number' ? session.header.createdAt : undefined
        service.ingest(id, cwd, createdAt, event)
      }),
    'dsh-context-optimize: live session events',
  )
}
