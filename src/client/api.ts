/**
 * 客户端半的数据桥：拉宿主路由 + 走 DSH 官方桌面通道打开目录。
 *
 * 约定：
 * - 路由用 shared 里的相对路径（不带前导 `/`），DSH 挂在子路径 / 反向代理下也不会绕过；
 * - 客户端永远不传绝对路径给归档 / 还原，只传 (scope, workspaceId?, rootId, dirName)；
 * - 所有失败归一成带 code 的 `OptimizeRequestError`，界面按 code 选文案，不解析 message。
 */
import type {
  InsightHistoryPayload,
  InsightModelOption,
  InsightModelsPayload,
  InsightReportPayload,
  InsightStartRequest,
  InsightStatusPayload,
} from '../shared/insight.ts'
import type {
  ErrorCode,
  ErrorPayload,
  MovePayload,
  MoveRequest,
  OverviewPayload,
  ProjectsPayload,
  SkillsPayload,
  SkillsQuery,
  VersionPayload,
} from '../shared/types.ts'
import { PACKAGE_NAME, ROUTES } from '../shared/types.ts'
import type { ClientContext, ModelCatalog, PluginNavigationService, RemoteSessionService } from './dsh.ts'

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

/** 模型下拉的数据：DSH 官方目录优先，宿主兜底接口次之。 */
export interface InsightModelOptions {
  readonly options: readonly InsightModelOption[]
  readonly defaultProvider: string | null
  readonly defaultModel: string | null
  /** 读模型列表时的诊断信息；正常为 null。 */
  readonly error: string | null
}

export interface ContextOptimizeApi {
  overview(signal?: AbortSignal): Promise<OverviewPayload>
  skills(query: SkillsQuery, signal?: AbortSignal): Promise<SkillsPayload>
  projects(signal?: AbortSignal): Promise<ProjectsPayload>
  archive(request: MoveRequest): Promise<MovePayload>
  restore(request: MoveRequest): Promise<MovePayload>
  /** 查安装源上有没有更高版本；任何失败都返回「不提示」，由界面静默处理。 */
  version(signal?: AbortSignal): Promise<VersionPayload>
  /** 打开 DSH 插件页里本包的详情页（更新在那一版），没有该服务时返回 false。 */
  openPluginPage(): boolean
  /** 宿主有没有「在系统里打开目录」的能力；false 时界面隐藏该按钮而不是留死按钮。 */
  canOpenPath(): Promise<boolean>
  /** 在系统默认应用里打开目录；返回是否成功。 */
  openPath(path: string): Promise<boolean>
  /** 复制路径，作为打开失败时的降级动作。 */
  copyPath(path: string): Promise<boolean>
  /** 洞察：读模型下拉（优先 DSH 官方模型目录，失败时走宿主兜底）。 */
  modelOptions(signal?: AbortSignal): Promise<InsightModelOptions>
  /** 洞察：发起一次分析。 */
  insightStart(request: InsightStartRequest): Promise<InsightStatusPayload>
  /** 洞察：当前运行状态。 */
  insightStatus(signal?: AbortSignal): Promise<InsightStatusPayload>
  /** 洞察：取消正在跑的分析。 */
  insightCancel(): Promise<InsightStatusPayload>
  /** 洞察：历史报告列表。 */
  insightHistory(signal?: AbortSignal): Promise<InsightHistoryPayload>
  /** 洞察：读一份报告。 */
  insightReport(id: string, signal?: AbortSignal): Promise<InsightReportPayload>
  /** 洞察：删除一份报告。 */
  insightRemove(id: string): Promise<{ ok: true }>
  /** 洞察：把一份报告标为已读（用户真正看到报告时调用）。 */
  insightRead(id: string): Promise<{ ok: true }>
  /** 洞察：宿主兜底的模型列表。 */
  insightModels(signal?: AbortSignal): Promise<InsightModelsPayload>
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

    version(signal) {
      return request<VersionPayload>(ROUTES.version, { method: 'GET' }, signal)
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

    openPluginPage() {
      try {
        const navigation = ctx.get?.<PluginNavigationService | null>('pluginNavigation')
        if (navigation === null || navigation === undefined) return false
        if (typeof navigation.openBundle !== 'function') return false
        navigation.openBundle(PACKAGE_NAME)
        return true
      } catch {
        return false
      }
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

    async modelOptions(signal) {
      const session = remoteSession()
      if (session?.modelCatalog !== undefined) {
        try {
          const response = await session.modelCatalog()
          if (response.ok && response.value !== undefined) {
            return fromCatalog(response.value)
          }
        } catch {
          // 老版本 DSH 或目录加载失败时退回宿主兜底。
        }
      }
      return request<InsightModelsPayload>(ROUTES.insightModels, { method: 'GET' }, signal)
    },

    insightModels(signal) {
      return request<InsightModelsPayload>(ROUTES.insightModels, { method: 'GET' }, signal)
    },

    insightStatus(signal) {
      return request<InsightStatusPayload>(ROUTES.insightStatus, { method: 'GET' }, signal)
    },

    insightStart(body) {
      return request<InsightStatusPayload>(
        ROUTES.insightStart,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        },
        undefined,
      )
    },

    insightCancel() {
      return request<InsightStatusPayload>(ROUTES.insightCancel, { method: 'POST' }, undefined)
    },

    insightHistory(signal) {
      return request<InsightHistoryPayload>(ROUTES.insightHistory, { method: 'GET' }, signal)
    },

    insightReport(id, signal) {
      return request<InsightReportPayload>(
        `${ROUTES.insightReport}?${new URLSearchParams({ id }).toString()}`,
        { method: 'GET' },
        signal,
      )
    },

    insightRemove(id) {
      return request<{ ok: true }>(
        ROUTES.insightRemove,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        },
        undefined,
      )
    },

    insightRead(id) {
      return request<{ ok: true }>(
        ROUTES.insightRead,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id }),
        },
        undefined,
      )
    },
  }
}

/** 把 DSH 的模型目录拍平成下拉选项；默认模型置顶。 */
function fromCatalog(catalog: ModelCatalog): InsightModelOptions {
  const options: InsightModelOption[] = []
  for (const group of catalog.groups) {
    for (const model of group.models) {
      options.push({
        provider: group.id,
        providerName: group.name,
        model: model.id,
        name: model.name,
        isDefault: group.id === catalog.default.provider && model.id === catalog.default.model,
      })
    }
  }
  if (!options.some((option) => option.isDefault)) {
    options.unshift({
      provider: catalog.default.provider,
      providerName: catalog.default.provider,
      model: catalog.default.model,
      name: catalog.default.model,
      isDefault: true,
    })
  }
  return {
    options,
    defaultProvider: catalog.default.provider,
    defaultModel: catalog.default.model,
    error: null,
  }
}
