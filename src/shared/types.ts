/**
 * dsh-context-optimize 的跨半边契约：宿主算出来的数据、客户端面板消费的载荷。
 *
 * 这里只放类型与纯常量，不 import 任何 node 内置模块，客户端 bundle 也能安全引用。
 */

/** 路由前缀；五个端点都是 `${ROUTE_PREFIX}.<action>` 的形式。 */
export const ROUTE_PREFIX = '/api/context-optimize'

/** 面板会用到的全部端点（相对路径，客户端直接 fetch）。 */
export const ROUTES = {
  overview: `${ROUTE_PREFIX}.overview`,
  skills: `${ROUTE_PREFIX}.skills`,
  projects: `${ROUTE_PREFIX}.projects`,
  archive: `${ROUTE_PREFIX}.archive`,
  restore: `${ROUTE_PREFIX}.restore`,
} as const

export type RouteName = keyof typeof ROUTES

/** 两个范围维度：全局 / 项目。 */
export type RootScope = 'global' | 'project'

/**
 * 五个 skill 根。和 DSH 自己的 `dsh-skill-filesystem` 一一对应：
 * 项目 `.dsh` / 项目 `.agents` / 用户 `.dsh` / 用户 `.agents` / 内置只读。
 */
export type RootId =
  | 'project-dsh'
  | 'project-agents'
  | 'user-dsh'
  | 'user-agents'
  | 'bundled'

/** 面板上的来源标签，比 RootId 更短，直接用于分组与徽标。 */
export type SourceTag = 'project-dsh' | 'project-agents' | 'user-dsh' | 'user-agents' | 'bundled'

/** skill 在磁盘上的两种形态：目录包（内含 SKILL.md）或根下第一层的扁平 .md。 */
export type SkillKind = 'directory' | 'flat'

/** 面板的状态筛选，三者互斥。 */
export type SkillStateFilter = 'all' | 'never-called' | 'archived'

/** 一个根的可展示信息。 */
export interface RootInfo {
  readonly id: RootId
  readonly scope: RootScope
  /** 展示用符号路径，例如 `~/.agents/skills`；内置根给 App 内相对路径。 */
  readonly display: string
  /** 绝对路径（宿主内部用；面板只用于展示时也足够）。 */
  readonly path: string
  /** 只读根（内置 office skill）不能归档。 */
  readonly removable: boolean
  /** 该根当前是否存在。 */
  readonly exists: boolean
  /** 该根下的条目数（生效中的，不含归档）。 */
  readonly count: number
}

/** 一条 skill 的完整展示数据。 */
export interface SkillEntry {
  /** 目录名或文件名（不含扩展名）；归档 / 还原按它定位，可能和 name 不同。 */
  readonly dirName: string
  /** frontmatter 里的 skill 名；缺失时退回 dirName。 */
  readonly name: string
  readonly description: string
  readonly rootId: RootId
  readonly source: SourceTag
  readonly kind: SkillKind
  /** 目录真实路径（解过软链），供「打开目录」使用；DSH 校验路径时要求与 realpath 完全相等。 */
  readonly dirRealPath: string
  /** SKILL.md 的绝对路径。 */
  readonly skillFile: string
  /** 该根是否允许归档。 */
  readonly removable: boolean
  /**
   * 该条目的目录/文件本身是不是软链（指向别处的 skill）。
   *
   * 移动时只移动链接本身、不跟进目标，界面上要如实标出来，避免用户以为挪走了真身。
   */
  readonly isSymlink: boolean
  /** 是否在合并后的目录里生效；被更高优先级同名条目压住时为 false。 */
  readonly effective: boolean
  /** 压住它的来源（effective 为 false 时给出）。 */
  readonly overriddenBy?: SourceTag
  /** 名称 + 描述 + 分隔符的字符数，用于估算上下文占用。 */
  readonly descriptionChars: number
  /** 估算 token：字符数 / 3.5。 */
  readonly approxTokens: number
  /** 历史调用次数（全部会话）。 */
  readonly calls: number
  /** 近 30 天调用次数。 */
  readonly calls30d: number
  /** 最后一次被加载的日期 `YYYY-MM-DD`；从未调用为 null。 */
  readonly lastUsedAt: string | null
  /** 归档时间 ISO 字符串；仅在 `state=archived` 的条目上出现。 */
  readonly archivedAt?: string
}

/** 后端回溯进度。 */
export interface BackfillState {
  readonly state: 'idle' | 'running' | 'done' | 'partial'
  /** 已处理会话数。 */
  readonly done: number
  /** 总会话数；running 时可能还在增长。 */
  readonly total: number
}

/** 顶部总账。 */
export interface OverviewTotals {
  /** 生效中的 skill 数（含内置）。 */
  readonly active: number
  /** 全局归档箱里的条目数。 */
  readonly archived: number
  /** 生效中条目的目录文本字符数合计。 */
  readonly catalogChars: number
  /** 生效中条目的估算 token 合计。 */
  readonly catalogTokens: number
  /** 全部历史调用次数。 */
  readonly calls: number
  /** 近 30 天调用次数。 */
  readonly calls30d: number
  /** 从未被调用过的生效条目数。 */
  readonly neverCalled: number
  /** 从未被调用条目的估算 token 合计。 */
  readonly neverCalledTokens: number
  /**
   * 历史上有调用记录、但磁盘上已经不存在的 skill 名数量。
   *
   * 这一类不在任何列表里（没有目录可展示、也不能归档），只在总账里报一个数，
   * 否则用户会觉得「我明明用过，怎么列表里没有」。
   */
  readonly removed: number
}

/** 频次统计覆盖的会话范围，供 tooltip 如实写口径。 */
export interface CorpusRange {
  /** 最早的会话创建日期 `YYYY-MM-DD`；没有会话时为 null。 */
  readonly from: string | null
  /** 最晚的会话创建日期 `YYYY-MM-DD`；没有会话时为 null。 */
  readonly to: string | null
  /** 参与统计的会话数。 */
  readonly sessions: number
}

/** `GET /api/context-optimize.overview` */
export interface OverviewPayload {
  readonly generatedAt: string
  readonly roots: readonly RootInfo[]
  readonly totals: OverviewTotals
  readonly backfill: BackfillState
  /** 频次统计覆盖的会话范围。 */
  readonly corpusRange: CorpusRange
  /**
   * 全局**主**归档目录的绝对路径（展示用，取 `~/.agents/skill-archive`）。
   *
   * 与 {@link SkillsPayload.archiveDir} 同理：全局归档列表还会合并 `~/.dsh/skill-archive`。
   */
  readonly globalArchiveDir: string
}

/** `GET /api/context-optimize.skills` 的查询参数。 */
export interface SkillsQuery {
  readonly scope: RootScope
  readonly workspaceId?: string
  readonly state: SkillStateFilter
}

/** `GET /api/context-optimize.skills` */
export interface SkillsPayload {
  readonly scope: RootScope
  readonly workspaceId?: string
  readonly state: SkillStateFilter
  readonly entries: readonly SkillEntry[]
  /** 该范围下的总数（按 state 过滤后）。 */
  readonly total: number
  /**
   * 该范围的**主**归档目录（用于展示与默认落点）；项目范围时是项目自己的 skill-archive。
   *
   * 注意：`state=archived` 的列表会合并同范围的多个根（全局 `~/.dsh/skill-archive` +
   * `~/.agents/skill-archive`，项目 `.dsh/skill-archive` + `.agents/skill-archive`），
   * 所以单值的 archiveDir 不覆盖全部归档位置，不要用它反推每一条的出处。
   */
  readonly archiveDir: string | null
}

/** 项目看板里的一行。 */
export interface ProjectEntry {
  readonly id: string
  readonly title: string
  readonly path: string
  /** 目录是否仍存在；失效的工作区不可点进、不可操作。 */
  readonly exists: boolean
  /** 项目根（最近的含 .git 的祖先，没有则为工作区自身）。 */
  readonly root: string
  readonly skillCount: number
  readonly archivedCount: number
  readonly approxTokens: number
  /** 预览用的前几条，完整列表走 `.skills?scope=project`。 */
  readonly preview: readonly SkillEntry[]
}

/** `GET /api/context-optimize.projects` */
export interface ProjectsPayload {
  readonly projects: readonly ProjectEntry[]
  /** 工作区总数与失效数，供顶部一行文案使用。 */
  readonly total: number
  readonly missing: number
}

/** 归档 / 还原请求。根由 (scope, workspaceId?, rootId) 三元组定位，客户端永远不传绝对路径。 */
export interface MoveRequest {
  readonly scope: RootScope
  readonly workspaceId?: string
  readonly rootId: RootId
  readonly dirName: string
}

/** 归档 / 还原成功响应。 */
export interface MovePayload {
  readonly ok: true
  readonly rootId: RootId
  readonly dirName: string
  /** 移动后的绝对路径。 */
  readonly to: string
  /** 该范围的归档目录。 */
  readonly archiveDir: string
  /** 归档目录里发生重名时追加的后缀，便于界面如实展示。 */
  readonly renamedTo?: string
}

/** 错误响应体。 */
export interface ErrorPayload {
  readonly error: {
    readonly code: ErrorCode
    readonly message: string
  }
}

/** 错误码；宿主抛、客户端按它决定提示文案。 */
export type ErrorCode =
  | 'invalid-request'
  | 'unknown-root'
  | 'readonly-root'
  | 'not-found'
  | 'target-exists'
  | 'path-escape'
  | 'move-failed'
  | 'internal'
