/**
 * 「洞察」的跨半边契约：宿主管线算出来的报告、客户端面板消费的载荷。
 *
 * 与 `types.ts` 的分工：这里只放洞察自己的结构，路由常量仍集中在 `types.ts`。
 * 不 import 任何 node 内置模块，客户端 bundle 也能安全引用。
 */

/** 一次分析的运行阶段；顺序即进度条的顺序。 */
export type InsightPhaseKey = 'collect' | 'facets' | 'aggregate' | 'write'

/** 单个阶段的状态。 */
export interface InsightPhaseState {
  readonly key: InsightPhaseKey
  readonly state: 'pending' | 'running' | 'done' | 'skipped'
  /** 已处理数量；`collect` 是会话数，`facets` 是标签数。 */
  readonly done: number
  /** 总量；未知时为 0。 */
  readonly total: number
}

/** 运行的整体状态。 */
export type InsightRunStatus = 'idle' | 'running' | 'done' | 'failed' | 'cancelled'

/** `GET .insight.status` */
export interface InsightStatusPayload {
  readonly status: InsightRunStatus
  /** 本次运行的 id；idle 时为 null。 */
  readonly runId: string | null
  readonly phases: readonly InsightPhaseState[]
  /** 当前正在处理的会话标题；没有时为 null。 */
  readonly current: string | null
  readonly startedAt: string | null
  readonly elapsedMs: number
  /** 失败原因；非 failed 时为 null。 */
  readonly error: string | null
  /** 跑完后报告的 id（等于 runId），供面板直接打开。 */
  readonly reportId: string | null
}

/** 发起一次分析。`days` 为 null 表示全部历史；provider/model 必填。 */
export interface InsightStartRequest {
  readonly days: number | null
  readonly provider: string
  readonly model: string
}

/** 历史列表里的一行。 */
export interface InsightHistoryEntry {
  readonly id: string
  readonly startedAt: string
  readonly finishedAt: string | null
  readonly status: 'done' | 'failed' | 'cancelled'
  /** 分析窗口天数；null = 全部。 */
  readonly days: number | null
  readonly sessions: number
  readonly tokens: number
  readonly provider: string
  readonly model: string
  readonly durationMs: number
  /** 因为模型返回不合法或超时被跳过的会话数。 */
  readonly failedSessions: number
  /** 用户第一次看到报告的时间；null = 还没看过（侧边栏会带未读点）。 */
  readonly readAt: string | null
}

/** `GET .insight.history` */
export interface InsightHistoryPayload {
  readonly entries: readonly InsightHistoryEntry[]
  /** 是否已有一次运行在进行（面板据此禁用「开始分析」）。 */
  readonly running: boolean
}

/** `GET .insight.report?id=` */
export interface InsightReportPayload {
  readonly id: string
  readonly report: InsightReport
  /** 导出的自包含 HTML 绝对路径，面板用于「打开 HTML」。 */
  readonly htmlPath: string
}

/** 模型下拉里的一项（宿主侧兜底接口返回；正常走 DSH 的 modelCatalog）。 */
export interface InsightModelOption {
  readonly provider: string
  readonly providerName: string
  readonly model: string
  readonly name: string
  readonly isDefault: boolean
}

/** `GET .insight.models` */
export interface InsightModelsPayload {
  readonly options: readonly InsightModelOption[]
  readonly defaultProvider: string | null
  readonly defaultModel: string | null
  /** 读不到模型的原因；正常为 null。 */
  readonly error: string | null
}

/** 顶部三条结论。 */
export interface InsightGlance {
  /** 什么在起作用。 */
  readonly working: string
  /** 什么最拖后腿。 */
  readonly friction: string
  /** 先改哪一件事。 */
  readonly next: string
}

/** 确定性统计；全部由本地事件折叠，不含模型判断。 */
export interface InsightStats {
  readonly sessions: number
  /** 你的消息条数（只算 source.kind === 'user'）。 */
  readonly messages: number
  readonly toolCalls: number
  readonly toolFailures: number
  readonly activeDays: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  /** 这些会话的墙钟总时长（含挂机，报告里要注明）。 */
  readonly durationMs: number
  /** 拼给模型的总字符数（压缩后）。 */
  readonly characters: number
  /** 被排除的子代理会话数。 */
  readonly excludedSubagent: number
  /** 被时间窗口排除的会话数。 */
  readonly excludedOld: number
  /** 超过单次分析上限被舍弃的会话数（按时间保留最新的）。 */
  readonly excludedCapped: number
  /** 打标签失败的会话数。 */
  readonly failedSessions: number
}

/** 项目维度的一行。 */
export interface InsightProjectStat {
  readonly name: string
  readonly sessions: number
}

/** 工具维度的一行。 */
export interface InsightToolStat {
  readonly name: string
  readonly calls: number
  readonly failures: number
}

/** 一天 24 小时的会话分布。 */
export interface InsightHourBucket {
  readonly hour: number
  readonly sessions: number
}

/** 摩擦例子：带会话 id，面板与 HTML 可按需展示出处。 */
export interface InsightFrictionExample {
  readonly quote: string
  readonly project: string
  /** `YYYY-MM-DD` */
  readonly date: string
  readonly sessionId: string
}

/** 一类反复出现的摩擦。 */
export interface InsightFriction {
  readonly title: string
  /** 这类摩擦出现的次数。 */
  readonly count: number
  readonly detail: string
  readonly examples: readonly InsightFrictionExample[]
}

/** 一个有效习惯。 */
export interface InsightWin {
  readonly title: string
  readonly detail: string
}

/** 一条建议的落地位置。 */
export type InsightSuggestionWhere = 'agents' | 'skill' | 'workflow' | 'config' | 'other'

/** 一条可执行的建议。 */
export interface InsightSuggestion {
  readonly title: string
  readonly detail: string
  readonly where: InsightSuggestionWhere
  /** 可直接复制的片段；没有时为空串。 */
  readonly snippet: string
}

/** 配置卫生快照；宿主没给 skill 数据时为 null。 */
export interface InsightHygiene {
  /** 生效中的 skill 数。 */
  readonly active: number
  /** 近 30 天一次都没被调用过的条数（口径是 calls30d === 0）。 */
  readonly unused30d: number
  /** 这些条目占的估算 token。 */
  readonly unusedTokens: number
  readonly examples: readonly string[]
  /** 频次回溯是否已完成；未完成时上面的数字偏高，报告要如实标注。 */
  readonly complete: boolean
}

/** 报告元数据。 */
export interface InsightReportMeta {
  readonly id: string
  readonly startedAt: string
  readonly finishedAt: string
  /** 分析窗口天数；null = 全部。 */
  readonly days: number | null
  readonly provider: string
  readonly model: string
  readonly durationMs: number
  /** 本次分析消耗的 token 合计。 */
  readonly tokens: number
}

/**
 * 一份完整报告。
 *
 * `report.json` 与 `report.html` 都从它渲染：面板拿 JSON 原生渲染，HTML 是同一份数据的
 * 静态导出，避免两处内容漂移。
 */
export interface InsightReport {
  readonly version: 1
  readonly meta: InsightReportMeta
  readonly glance: InsightGlance
  readonly stats: InsightStats
  readonly projects: readonly InsightProjectStat[]
  readonly tools: readonly InsightToolStat[]
  readonly hours: readonly InsightHourBucket[]
  readonly frictions: readonly InsightFriction[]
  readonly wins: readonly InsightWin[]
  readonly suggestions: readonly InsightSuggestion[]
  readonly hygiene: InsightHygiene | null
  /** 彩蛋：一句轻松的话。 */
  readonly fun: string
}

/** 单个会话的标签（模型输出，落盘缓存）。 */
export interface InsightFacet {
  readonly goal: string
  readonly outcome: string
  readonly sessionType: string
  /** 这次会话里出现的摩擦点，短句。 */
  readonly frictions: readonly string[]
  /** 这次会话里配合得好的地方。 */
  readonly wins: readonly string[]
  readonly summary: string
}

/** `~/.dsh/insight/facets/<sessionId>.json` 的落盘结构。 */
export interface InsightFacetRecord {
  readonly sessionId: string
  /** 摘要文本的哈希；变了就重算。 */
  readonly digestHash: string
  /** 会话最后一个事件的 seq；只增不减。 */
  readonly lastSeq: number
  readonly updatedAt: string
  readonly facet: InsightFacet
}

/** `~/.dsh/insight/index.json` 的落盘结构。 */
export interface InsightIndexFile {
  readonly version: 1
  readonly entries: readonly InsightHistoryEntry[]
}

/** 一次会话的确定性统计 + 摘要文本；不落盘，只在内存里流转。 */
export interface InsightSessionDigest {
  readonly id: string
  readonly title: string
  readonly project: string
  readonly createdAt: number
  /** 该会话最后一个事件的时间；没有事件时等于 createdAt。 */
  readonly updatedAt: number
  readonly turns: number
  readonly steps: number
  readonly userMessages: number
  readonly assistantMessages: number
  readonly toolCalls: number
  readonly toolFailures: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly filesTouched: number
  readonly models: readonly string[]
  readonly lastSeq: number
  /** 压缩后的会话摘要，喂给模型打标签。 */
  readonly digest: string
  /** 摘要的稳定哈希，用于缓存失效判断。 */
  readonly digestHash: string
}
