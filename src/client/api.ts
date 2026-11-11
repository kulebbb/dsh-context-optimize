/**
 * 客户端半的数据桥：拉宿主路由 + 走 DSH 官方桌面通道打开目录。
 *
 * 约定：
 * - 路由用 shared 里的相对路径（不带前导 `/`），DSH 挂在子路径 / 反向代理下也不会绕过；
 * - 客户端永远不传绝对路径给归档 / 还原，只传 (scope, workspaceId?, rootId, dirName)；
 * - 所有失败归一成带 code 的 `OptimizeRequestError`，界面按 code 选文案，不解析 message。
 */
import type {
  ErrorCode,
  ErrorPayload,
  MovePayload,
  MoveRequest,
  OverviewPayload,
  ProjectsPayload,
  SkillsPayload,
  SkillsQuery,
} from '../shared/types.ts'
import { ROUTES } from '../shared/types.ts'
import type { ClientContext, RemoteSessionService } from './dsh.ts'

/** 客户端请求超时：超过这个时间给可重试错误，而不是一直转圈。 */
export const FETCH_TIMEOUT_MS = 30_000

/** 请求错误的码：宿主错误码 + 客户端自己产生的 timeout / network。 */
export type RequestErrorCode = ErrorCode | 'timeout' | 'network'

export class OptimizeRequestError extends Error {
  readonly code: RequestErrorCode
  readonly status: number

  constructor(message: string, code: RequestErrorCode, status: number) {
    super(message)
    this.name = 'OptimizeRequestError'
    this.code = code
    this.status = status
  }
}

export interface ContextOptimizeApi {
  overview(signal?: AbortSignal): Promise<OverviewPayload>
  skills(query: SkillsQuery, signal?: AbortSignal): Promise<SkillsPayload>
  projects(signal?: AbortSignal): Promise<ProjectsPayload>
  archive(request: MoveRequest): Promise<MovePayload>
  restore(request: MoveRequest): Promise<MovePayload>
  /** 宿主有没有「在系统里打开目录」的能力；false 时界面隐藏该按钮而不是留死按钮。 */
  canOpenPath(): Promise<boolean>
  /** 在系统默认应用里打开目录；返回是否成功。 */
  openPath(path: string): Promise<boolean>
  /** 复制路径，作为打开失败时的降级动作。 */
  copyPath(path: string): Promise<boolean>
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  if (typeof value !== 'object' || value === null) return false
  const error = (value as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return false
  return typeof (error as { code?: unknown }).code === 'string'
}

/** 带超时地发一次请求并解析 JSON；调用方 abort 时不误报超时。 */
async function request<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS)
  const merged = signal === undefined ? timeout.signal : AbortSignal.any([signal, timeout.signal])
  let response: Response
  try {
    response = await fetch(path, {
      ...init,
      signal: merged,
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...init.headers },
    })
  } catch (error) {
    if (signal?.aborted) throw error
    if (timeout.signal.aborted) throw new OptimizeRequestError('Request timed out.', 'timeout', 0)
    throw new OptimizeRequestError(error instanceof Error ? error.message : 'network error', 'network', 0)
  } finally {
    clearTimeout(timer)
  }
  const body: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    if (isErrorPayload(body)) {
      throw new OptimizeRequestError(body.error.message, body.error.code, response.status)
    }
    throw new OptimizeRequestError(`request failed (${String(response.status)})`, 'internal', response.status)
  }
  if (body === null) throw new OptimizeRequestError('empty response body', 'internal', response.status)
  return body as T
}

/** 拼 skills 查询串；项目范围才带 workspaceId。 */
function skillsQuery(query: SkillsQuery): string {
  const params = new URLSearchParams({ scope: query.scope, state: query.state })
  if (query.workspaceId !== undefined) params.set('workspaceId', query.workspaceId)
  return params.toString()
}

/**
 * 为一个客户端上下文创建 api。`remote` 在纯网页宿主里可能不存在，
 * 所有打开类方法都退化成 false，由界面隐藏按钮。
 */
export function createContextOptimizeApi(ctx: ClientContext): ContextOptimizeApi {
  const remoteSession = (): RemoteSessionService | undefined => ctx.remote?.session

  return {
    overview(signal) {
      return request<OverviewPayload>(ROUTES.overview, { method: 'GET' }, signal)
    },

    skills(query, signal) {
      return request<SkillsPayload>(`${ROUTES.skills}?${skillsQuery(query)}`, { method: 'GET' }, signal)
    },

    projects(signal) {
      return request<ProjectsPayload>(ROUTES.projects, { method: 'GET' }, signal)
    },

    archive(body) {
      return request<MovePayload>(
        ROUTES.archive,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        undefined,
      )
    },

    restore(body) {
      return request<MovePayload>(
        ROUTES.restore,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        undefined,
      )
    },

    async canOpenPath() {
      const session = remoteSession()
      if (!session) return false
      try {
        const result = await session.canOpenWorkspacePath()
        return result?.ok === true && result.value === true
      } catch {
        return false
      }
    },

    async openPath(path) {
      const session = remoteSession()
      if (!session) return false
      try {
        const result = await session.openWorkspacePath({ path })
        return result?.ok === true
      } catch {
        return false
      }
    },

    async copyPath(path) {
      try {
        await navigator.clipboard.writeText(path)
        return true
      } catch {
        return false
      }
    },
  }
}
