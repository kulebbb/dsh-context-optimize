/**
 * 洞察服务：一次分析的完整生命周期（开始 → 采集 → 打标签 → 汇总 → 落盘）与路由。
 *
 * 设计约束：
 * - 同一时间只允许一次运行，第二次直接 busy；
 * - 运行状态只在内存里，进程重启后变回 idle（已完成的报告仍在磁盘上）；
 * - 任何一层失败都落成 `failed` 并把原因带出来，不用猜；
 * - 取消靠 AbortController 贯穿读取、模型调用和落盘前的检查。
 */
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  InsightFacet,
  InsightFacetRecord,
  InsightHistoryEntry,
  InsightHistoryPayload,
  InsightHygiene,
  InsightModelOption,
  InsightModelsPayload,
  InsightReport,
  InsightReportPayload,
  InsightRunStatus,
  InsightStartRequest,
  InsightStatusPayload,
} from '../../shared/insight.ts'
import { OptimizeError, STATUS_BY_CODE, normalizeError } from '../../shared/errors.ts'
import { ROUTES } from '../../shared/types.ts'
import type { ErrorPayload } from '../../shared/types.ts'
import { aggregateReport, labelSession, outputLimitOf } from './analyze.ts'
import type { AggregateInput, InsightModelSelection, LlmLike } from './analyze.ts'
import { collectCorpus } from './collect.ts'
import type { SessionSource } from './collect.ts'
import { facetStale, loadFacets, saveFacet } from './facets.ts'
import {
  appendIndex,
  buildReport,
  historyEntryOf,
  listRunIds,
  loadIndex,
  markIndexRead,
  readReport,
  removeIndexEntry,
  removeRun,
  runDirOf,
  runIdOf,
  runsDirOf,
  writeReport,
} from './report.ts'

/** 阶段顺序；进度条按它渲染。 */
const PHASES = ['collect', 'facets', 'aggregate', 'write'] as const

/** 打标签的并发；太高会把模型额度打到限流。 */
const FACET_CONCURRENCY = 3

/** 单次分析最多处理多少个会话。 */
const MAX_SESSIONS = 300

/** `GET .insight.models` 里探测每个 provider 的超时。 */
const MODEL_LIST_TIMEOUT_MS = 4000

/** 服务依赖；测试里全部注入假实现。 */
export interface InsightServiceDeps {
  /** `~/.dsh/insight` 的绝对路径。 */
  readonly dir: string
  readonly llm?: LlmLike | undefined
  readonly sessionQuery?: SessionSource | undefined
  /** 当前 DSH 默认模型；缺服务时返回 null。 */
  readonly defaultSelection?: (() => InsightModelSelection | null) | undefined
  /** 配置卫生快照；缺省时报告里不出现这一块。 */
  readonly hygiene?: (() => Promise<InsightHygiene | null>) | undefined
  readonly now?: (() => Date) | undefined
  readonly logger?: { warn?(...args: unknown[]): void } | undefined
  readonly concurrency?: number | undefined
  readonly readTimeoutMs?: number | undefined
  /** 测试用：覆盖会话上限。 */
  readonly maxSessions?: number | undefined
  /** 测试用：覆盖打标签并发。 */
  readonly facetConcurrency?: number | undefined
}

/** 可变运行状态；只在 service 内部改。 */
interface MutableRun {
  readonly id: string
  status: InsightRunStatus
  phases: { key: (typeof PHASES)[number]; state: 'pending' | 'running' | 'done' | 'skipped'; done: number; total: number }[]
  current: string | null
  readonly startedAt: number
  finishedAt: number | null
  error: string | null
  reportId: string | null
  readonly controller: AbortController
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
}

/** 并发受限的 map；结果顺序与输入一致，单个失败返回 undefined。 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined)
  let cursor = 0
  const run = async (): Promise<void> => {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      const item = items[index]
      if (item === undefined) continue
      results[index] = await worker(item, index).catch(() => undefined)
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, run))
  return results
}

/** 给 promise 加超时。 */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`${label} 超时`))
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
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** 校验非空短字符串。 */
function requiredString(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OptimizeError('invalid-request', `${field} 不能为空`)
  }
  const clean = value.trim()
  if (clean.length > max) throw new OptimizeError('invalid-request', `${field} 太长`)
  if (/[\u0000-\u001f]/.test(clean)) throw new OptimizeError('invalid-request', `${field} 含非法字符`)
  return clean
}

/** 校验分析窗口。 */
function parseDays(value: unknown): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3650) {
    throw new OptimizeError('invalid-request', 'days 必须是 1–3650 的整数或 null')
  }
  return value
}

export class InsightService {
  private readonly deps: InsightServiceDeps
  private run: MutableRun | null = null
  /** 正在做准备（校验 + 占目录）的同步占位；挡住并发 start 的检查窗口。 */
  private starting = false

  constructor(deps: InsightServiceDeps) {
    this.deps = deps
  }

  /** 停掉正在跑的分析；插件卸载时调用。 */
  async dispose(): Promise<void> {
    this.run?.controller.abort()
  }

  /** 路由入口。 */
  async handle(request: Request): Promise<Response> {
    const url = new URL(request.url)
    try {
      switch (url.pathname) {
        case ROUTES.insightStatus:
          return json(this.status())
        case ROUTES.insightModels:
          return json(await this.models())
        case ROUTES.insightHistory:
          return json(await this.history())
        case ROUTES.insightReport: {
          const id = url.searchParams.get('id') ?? ''
          return json(await this.report(id))
        }
        case ROUTES.insightStart:
          return json(await this.start(await readJson(request)))
        case ROUTES.insightCancel:
          return json(this.cancel())
        case ROUTES.insightRemove: {
          const body = await readJson(request)
          return json(await this.remove(parseId(body)))
        }
        case ROUTES.insightRead: {
          const body = await readJson(request)
          return json(await this.markRead(parseId(body)))
        }
        default:
          throw new OptimizeError('not-found', `未知端点 ${url.pathname}`)
      }
    } catch (error) {
      const { code, message } = normalizeError(error)
      const payload: ErrorPayload = { error: { code, message } }
      return json(payload, STATUS_BY_CODE[code])
    }
  }

  /** `GET .insight.status` */
  status(): InsightStatusPayload {
    const run = this.run
    if (run === null) {
      return {
        status: 'idle',
        runId: null,
        phases: PHASES.map((key) => ({ key, state: 'pending', done: 0, total: 0 })),
        current: null,
        startedAt: null,
        elapsedMs: 0,
        error: null,
        reportId: null,
      }
    }
    const end = run.finishedAt ?? this.now().getTime()
    return {
      status: run.status,
      runId: run.id,
      phases: run.phases.map((phase) => ({ ...phase })),
      current: run.current,
      startedAt: new Date(run.startedAt).toISOString(),
      elapsedMs: Math.max(0, end - run.startedAt),
      error: run.error,
      reportId: run.reportId,
    }
  }

  /** `POST .insight.start` */
  async start(body: unknown): Promise<InsightStatusPayload> {
    if (this.deps.sessionQuery === undefined) {
      throw new OptimizeError('analysis-failed', '宿主没有会话服务，无法读取会话日志')
    }
    if (this.deps.llm === undefined) {
      throw new OptimizeError('analysis-failed', '宿主没有模型服务，无法分析')
    }
    if (this.run?.status === 'running' || this.starting) {
      throw new OptimizeError('busy', '已有一次分析在进行，等它结束或先取消')
    }
    if (typeof body !== 'object' || body === null) {
      throw new OptimizeError('invalid-request', '请求体必须是对象')
    }
    // 先把占位立起来，再进入任何 await：两个并发请求只有第一个能过这道门。
    this.starting = true
    try {
      const record = body as Record<string, unknown>
      const request: InsightStartRequest = {
        days: parseDays(record['days']),
        provider: requiredString(record['provider'], 'provider', 200),
        model: requiredString(record['model'], 'model', 200),
      }
      const now = this.now()
      const id = await this.reserveRunId(now)
      const run: MutableRun = {
        id,
        status: 'running',
        phases: PHASES.map((key) => ({ key, state: 'pending', done: 0, total: 0 })),
        current: null,
        startedAt: now.getTime(),
        finishedAt: null,
        error: null,
        reportId: null,
        controller: new AbortController(),
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
      }
      this.run = run
      void this.execute(run, request)
      return this.status()
    } finally {
      this.starting = false
    }
  }

  /**
   * 用「建目录」而不是「查目录」来抢运行 id。
   *
   * 同一秒内重复发起、甚至桌面端与 CLI 同时发起时，mkdir 的原子性保证只有一个能拿到该 id；
   * 空目录同时充当这次运行的占位，失败或取消时会被清掉。
   */
  private async reserveRunId(now: Date): Promise<string> {
    await mkdir(runsDirOf(this.deps.dir), { recursive: true })
    const base = runIdOf(now)
    for (let suffix = 1; suffix <= 20; suffix += 1) {
      const id = suffix === 1 ? base : `${base}-${String(suffix)}`
      try {
        await mkdir(runDirOf(this.deps.dir, id), { recursive: false })
        return id
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
    }
    throw new OptimizeError('analysis-failed', '无法分配报告目录')
  }

  /** `POST .insight.cancel` */
  cancel(): InsightStatusPayload {
    if (this.run?.status === 'running') this.run.controller.abort()
    return this.status()
  }

  /** `GET .insight.history` */
  async history(): Promise<InsightHistoryPayload> {
    const index = await loadIndex(this.deps.dir)
    let entries = [...index.entries]
    // 索引丢了但目录还在时，从报告文件反推一遍，避免历史「消失」。
    if (entries.length === 0) entries = await this.recoverIndex()
    entries.sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    return { entries, running: this.run?.status === 'running' }
  }

  /** `GET .insight.report?id=` */
  async report(id: string): Promise<InsightReportPayload> {
    if (id === '') throw new OptimizeError('invalid-request', '缺少报告 id')
    const report = await readReport(this.deps.dir, id)
    if (report === null) throw new OptimizeError('not-found', '这份报告不存在或已删除')
    return { id, report, htmlPath: join(runDirOf(this.deps.dir, id), 'report.html') }
  }

  /** `POST .insight.remove` */
  async remove(id: string): Promise<{ ok: true }> {
    if (this.run?.status === 'running' && this.run.id === id) {
      throw new OptimizeError('busy', '正在分析的这一次不能删除')
    }
    const removed = await removeRun(this.deps.dir, id)
    if (!removed) throw new OptimizeError('not-found', '这份报告不存在或已删除')
    await removeIndexEntry(this.deps.dir, id)
    return { ok: true }
  }

  /** `GET .insight.models`：客户端拿不到 DSH 模型目录时的兜底。 */
  async models(): Promise<InsightModelsPayload> {
    const llm = this.deps.llm
    const selection = this.deps.defaultSelection?.() ?? null
    if (llm === undefined) {
      return {
        options: [],
        defaultProvider: selection?.provider ?? null,
        defaultModel: selection?.model ?? null,
        error: '宿主没有模型服务',
      }
    }
    const options: InsightModelOption[] = []
    let error: string | null = null
    let providers: readonly { id: string; name: string }[] = []
    try {
      providers = llm.listProviders?.() ?? []
    } catch (cause) {
      error = cause instanceof Error ? cause.message : '读取模型列表失败'
    }
    for (const provider of providers) {
      if (llm.listModels === undefined) break
      try {
        const models = await withTimeout(llm.listModels(provider.id), MODEL_LIST_TIMEOUT_MS, '读取模型列表')
        for (const model of models) {
          options.push({
            provider: provider.id,
            providerName: provider.name,
            model: model.id,
            name: model.name,
            isDefault: selection !== null && selection.provider === provider.id && selection.model === model.id,
          })
        }
      } catch (cause) {
        error ??= `${provider.name}: ${cause instanceof Error ? cause.message : '读取失败'}`
      }
    }
    if (selection !== null && !options.some((option) => option.isDefault)) {
      options.unshift({
        provider: selection.provider,
        providerName: selection.provider,
        model: selection.model,
        name: selection.model,
        isDefault: true,
      })
    }
    return {
      options,
      defaultProvider: selection?.provider ?? null,
      defaultModel: selection?.model ?? null,
      error,
    }
  }

  /** 当前时刻；测试可注入。 */
  private now(): Date {
    return this.deps.now?.() ?? new Date()
  }

  /** 把某个阶段切到 running 并记下总量。 */
  private beginPhase(run: MutableRun, key: (typeof PHASES)[number], total: number): void {
    for (const phase of run.phases) {
      if (phase.key === key) {
        phase.state = 'running'
        phase.total = total
        phase.done = 0
      }
    }
  }

  /** 收尾一个阶段。 */
  private endPhase(run: MutableRun, key: (typeof PHASES)[number], state: 'done' | 'skipped'): void {
    for (const phase of run.phases) {
      if (phase.key === key) phase.state = state
    }
  }

  /** 更新阶段进度。 */
  private progress(run: MutableRun, key: (typeof PHASES)[number], done: number, total: number): void {
    for (const phase of run.phases) {
      if (phase.key === key) {
        phase.done = done
        phase.total = total
      }
    }
  }

  /** 真正跑一次分析。 */
  private async execute(run: MutableRun, request: InsightStartRequest): Promise<void> {
    const startedAt = new Date(run.startedAt)
    const selection: InsightModelSelection = { provider: request.provider, model: request.model }
    let written = false
    try {
      const source = this.deps.sessionQuery
      const llm = this.deps.llm
      if (source === undefined || llm === undefined) throw new Error('服务未就绪')
      // 模型能写多少 token 由它自己说了算；传超了 provider 会直接拒绝。
      const outputLimit = await outputLimitOf(llm, selection)

      this.beginPhase(run, 'collect', 0)
      const collect = await collectCorpus({
        source,
        days: request.days,
        now: () => this.now(),
        signal: run.controller.signal,
        concurrency: this.deps.concurrency ?? 4,
        ...(this.deps.readTimeoutMs === undefined ? {} : { readTimeoutMs: this.deps.readTimeoutMs }),
        maxSessions: this.deps.maxSessions ?? MAX_SESSIONS,
        logger: this.deps.logger,
        onProgress: (done, total, title) => {
          this.progress(run, 'collect', done, total)
          run.current = title
        },
      })
      this.endPhase(run, 'collect', 'done')
      if (run.controller.signal.aborted) throw new Error('已取消')

      this.beginPhase(run, 'facets', collect.sessions.length)
      const cached = await loadFacets(this.deps.dir)
      const stale = collect.sessions.filter((session) => facetStale(cached.get(session.id), session))
      const reused = collect.sessions.length - stale.length
      this.progress(run, 'facets', reused, collect.sessions.length)
      let failedSessions = 0
      const facets = new Map<string, InsightFacet>()
      for (const session of collect.sessions) {
        const hit = cached.get(session.id)
        if (hit !== undefined && !facetStale(hit, session)) facets.set(session.id, hit.facet)
      }

      let done = reused
      await mapLimit(stale, this.deps.facetConcurrency ?? FACET_CONCURRENCY, async (session) => {
        if (run.controller.signal.aborted) throw new Error('已取消')
        run.current = session.title
        try {
          const labelled = await labelSession(llm, selection, session, run.controller.signal, outputLimit)
          facets.set(session.id, labelled.facet)
          run.inputTokens += labelled.inputTokens
          run.outputTokens += labelled.outputTokens
          run.cacheReadTokens += labelled.cacheReadTokens
          const record: InsightFacetRecord = {
            sessionId: session.id,
            digestHash: session.digestHash,
            lastSeq: session.lastSeq,
            updatedAt: this.now().toISOString(),
            facet: labelled.facet,
          }
          await saveFacet(this.deps.dir, record)
        } catch (error) {
          failedSessions += 1
          this.deps.logger?.warn?.(`[dsh-context-optimize] 洞察：会话 ${session.id} 打标签失败`, error)
        } finally {
          done += 1
          this.progress(run, 'facets', done, collect.sessions.length)
        }
      })
      this.endPhase(run, 'facets', failedSessions >= collect.sessions.length ? 'skipped' : 'done')
      if (run.controller.signal.aborted) throw new Error('已取消')
      if (facets.size === 0) throw new Error('所有会话都没能打上标签，请检查模型是否可用')

      this.beginPhase(run, 'aggregate', 1)
      const inputs: AggregateInput[] = []
      for (const session of collect.sessions) {
        const facet = facets.get(session.id)
        if (facet !== undefined) inputs.push({ session, facet })
      }
      const aggregate = await aggregateReport(
        llm,
        selection,
        inputs,
        {
          sessions: collect.stats.sessions,
          messages: collect.stats.messages,
          toolCalls: collect.stats.toolCalls,
          projects: collect.projects.length,
        },
        run.controller.signal,
        outputLimit,
      )
      run.inputTokens += aggregate.inputTokens
      run.outputTokens += aggregate.outputTokens
      run.cacheReadTokens += aggregate.cacheReadTokens
      this.progress(run, 'aggregate', 1, 1)
      this.endPhase(run, 'aggregate', 'done')
      if (run.controller.signal.aborted) throw new Error('已取消')

      this.beginPhase(run, 'write', 1)
      if (run.controller.signal.aborted) throw new Error('已取消')
      const hygiene = this.deps.hygiene === undefined ? null : await this.deps.hygiene().catch(() => null)
      if (run.controller.signal.aborted) throw new Error('已取消')
      const report = buildReport({
        id: run.id,
        startedAt,
        finishedAt: this.now(),
        days: request.days,
        provider: selection.provider,
        model: selection.model,
        inputTokens: run.inputTokens,
        outputTokens: run.outputTokens,
        cacheReadTokens: run.cacheReadTokens,
        failedSessions,
        collect,
        aggregate,
        hygiene,
      })
      await writeReport(this.deps.dir, report)
      written = true
      await appendIndex(this.deps.dir, historyEntryOf(report, 'done'))
      this.progress(run, 'write', 1, 1)
      this.endPhase(run, 'write', 'done')

      run.status = 'done'
      run.reportId = run.id
      run.current = null
      run.finishedAt = this.now().getTime()
    } catch (error) {
      run.finishedAt = this.now().getTime()
      run.current = null
      if (run.controller.signal.aborted || (error instanceof Error && error.message === '已取消')) {
        run.status = 'cancelled'
        run.error = null
      } else {
        run.status = 'failed'
        run.error = error instanceof Error ? error.message : '分析失败'
        this.deps.logger?.warn?.('[dsh-context-optimize] 洞察分析失败', error)
      }
      // 没写出报告时把占位目录清掉，避免历史里留下空目录。
      if (!written) await removeRun(this.deps.dir, run.id).catch(() => undefined)
    }
  }

  /** `POST .insight.read`：报告真正显示出来时由客户端调用。 */
  async markRead(id: string): Promise<{ ok: true }> {
    if (id === '') throw new OptimizeError('invalid-request', '缺少报告 id')
    const marked = await markIndexRead(this.deps.dir, id, this.now().toISOString())
    if (!marked) throw new OptimizeError('not-found', '这份报告不存在或已删除')
    return { ok: true }
  }

  /** 索引为空时，从磁盘上的报告反推历史条目。 */
  private async recoverIndex(): Promise<InsightHistoryEntry[]> {
    const ids = await listRunIds(this.deps.dir)
    const entries: InsightHistoryEntry[] = []
    for (const id of ids.slice(0, 50)) {
      const report = await readReport(this.deps.dir, id)
      if (report === null) continue
      // 反推出来的历史没有已读记录，当作看过，避免升级后凭空多出一堆未读点。
      entries.push(historyEntryOf(report, 'done', report.meta.finishedAt))
    }
    return entries
  }
}

/** 读 JSON 请求体；空体返回 null。 */
async function readJson(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.trim() === '') return null
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new OptimizeError('invalid-request', '请求体不是合法 JSON')
  }
}

/** 从请求体里取 id。 */
function parseId(body: unknown): string {
  if (typeof body !== 'object' || body === null) throw new OptimizeError('invalid-request', '请求体必须是对象')
  const id = (body as Record<string, unknown>)['id']
  if (typeof id !== 'string' || id === '') throw new OptimizeError('invalid-request', '缺少报告 id')
  return id
}