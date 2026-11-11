/**
 * 宿主（node 半）入口：注册五条认证路由、订阅会话事件做频次增量、启动时读缓存并后台补齐历史。
 *
 * 依赖两个 DSH 宿主服务：
 *   - `connection`：认证路由（与 dsh-output 同一套写法）；
 *   - `sessionQuery` / `workspaceRegistry`：可选注入——缺了也能跑，只是频次为空 / 项目页为空。
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ContextOptimizeService } from './host/service.ts'
import type { SessionQueryLike, WorkspaceRegistryLike } from './host/service.ts'
import type { SessionEventLike } from './host/frequency.ts'
import { ROUTES } from './shared/types.ts'

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
  ctx.inject(['sessionQuery'], (scope) => {
    sessionQuery = scope['sessionQuery'] as SessionQueryLike
  })
  ctx.inject(['workspaceRegistry'], (scope) => {
    workspaceRegistry = scope['workspaceRegistry'] as WorkspaceRegistryLike
  })

  const service = new ContextOptimizeService({
    dshHome,
    cachePath,
    logger: ctx.logger,
    get sessionQuery() {
      return sessionQuery
    },
    get workspaceRegistry() {
      return workspaceRegistry
    },
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

  for (const path of Object.values(ROUTES)) {
    const methods = path === ROUTES.archive || path === ROUTES.restore ? ['POST'] : ['GET']
    ctx.effect(
      () =>
        ctx.connection.fetch.register({
          path,
          methods,
          requestBody: 'buffered',
          fetch: (request) => service.handle(request),
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
