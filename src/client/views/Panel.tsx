/**
 * 「Skill 管理」中央面板的外壳：数据加载、范围/状态切换、预算卡、表格、归档动作与撤销提示。
 *
 * 面板不是会话绑定的，所以只认宿主路由，不订阅 DSH 内部事件；
 * 唯一的轮询是首次回溯进行中时每 5 秒刷新一次 overview（接住进度）。
 * 归档 / 还原后统一 `refresh` 一次，让总账与列表一起重算。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  MoveRequest,
  ProjectEntry,
  RootScope,
  SkillEntry,
  SkillStateFilter,
} from '../../shared/types.ts'
import { compareByCalls, compareByTokens } from '../../shared/catalog.ts'
import type { ContextOptimizeApi } from '../api.ts'
import { OptimizeRequestError } from '../api.ts'
import type { Translate } from '../dsh.ts'
import { errorMessage, formatNumber } from '../format.ts'
import { ProjectDetail } from './ProjectDetail.tsx'
import { ProjectsView } from './ProjectsView.tsx'
import { ProgressStrip } from './ProgressStrip.tsx'
import { SegNav } from './SegNav.tsx'
import type { RangeView } from './SegNav.tsx'
import { SkillList } from './SkillList.tsx'
import { entryKey } from './SkillRow.tsx'
import { StateBlock } from './StateBlock.tsx'
import { Toast } from './Toast.tsx'

/** 归档时间倒序；同一时间按名字稳定排。 */
function sortArchived(entries: readonly SkillEntry[]): SkillEntry[] {
  return [...entries].sort(
    (a, b) => (b.archivedAt ?? '').localeCompare(a.archivedAt ?? '') || a.name.localeCompare(b.name),
  )
}

/** 请求异常 → 错误码字符串；界面只按码选文案。 */
function errorCodeOf(error: unknown): string {
  return error instanceof OptimizeRequestError ? error.code : 'internal'
}

interface Resource<T> {
  data: T | null
  /** 请求错误码；null 表示没有错误。 */
  error: string | null
  loading: boolean
}

interface ResourceHandle<T> extends Resource<T> {
  reload(): void
}

/**
 * 极简数据加载 hook：显式传依赖，手动 `reload()`。
 *
 * 没有引入数据层依赖（面板只有几个 GET），但要保证每次切范围/筛选都换请求、
 * 旧请求被 abort，且重试与刷新走同一条路径。
 */
function useResource<T>(
  load: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
  enabled = true,
): ResourceHandle<T> {
  const [state, setState] = useState<Resource<T>>({ data: null, error: null, loading: enabled })
  const [nonce, setNonce] = useState(0)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!enabled) {
      setState({ data: null, error: null, loading: false })
      return
    }
    const controller = new AbortController()
    setState((previous) => ({ data: previous.data, error: null, loading: true }))
    loadRef.current(controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setState({ data, error: null, loading: false })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ data: null, error: errorCodeOf(error), loading: false })
      },
    )
    return () => controller.abort()
    // deps 由调用方给出；nonce 用于手动 reload。
  }, [...deps, enabled, nonce])

  return { ...state, reload: () => setNonce((value) => value + 1) }
}

export interface PanelProps {
  t: Translate
  api: ContextOptimizeApi
}

type SortBy = 'calls' | 'tokens'

interface ToastState {
  message: string
  seq: number
  actionLabel?: string
  onAction?: () => void
}

function BudgetCard(props: {
  t: Translate
  activeCount: number
  catalogTokens: number
  archivedCount: number
  archivedTokens: number
  calls: number
  calls30d: number
  top: readonly SkillEntry[]
  topTokens: number
  restCount: number
  restTokens: number
}): JSX.Element {
  const { t, catalogTokens, activeCount, archivedCount, archivedTokens, calls, calls30d, top, restCount, restTokens } =
    props
  const total = Math.max(1, catalogTokens)
  let accumulated = 0
  const bands = top.map((entry, index) => {
    const width = (entry.approxTokens / total) * 100
    accumulated += width
    return (
      <i
        key={entryKey(entry)}
        className={`dscx-band-${String((index % 7) + 1)}`}
        style={{ width: `${width.toFixed(2)}%` }}
      />
    )
  })
  const restWidth = Math.max(0, 100 - accumulated)
  return (
    <div className="dscx-budget">
      <div className="dscx-b-top">
        <span className="dscx-big">
          {formatNumber(catalogTokens)}
          <small>{t('budget.tokensUnit')}</small>
        </span>
        <span className="dscx-cap">{t('budget.fixedCost', { count: activeCount })}</span>
        {/* 空归档时不报「省 0t」：用成功色报零等于把「什么都没省」说成收益。 */}
        {archivedCount > 0 ? (
          <span className="dscx-saved">
            {t('budget.archivedSaving', { count: archivedCount, tokens: formatNumber(archivedTokens) })}
          </span>
        ) : null}
      </div>
      <div className="dscx-stack">
        {bands}
        <i className="dscx-band-rest" style={{ width: `${restWidth.toFixed(2)}%` }} />
      </div>
      <div className="dscx-legend">
        {top.map((entry, index) => (
          <span key={entryKey(entry)}>
            <i className={`dscx-band-${String((index % 7) + 1)}`} />
            {entry.name}
          </span>
        ))}
        <span>
          <i className="dscx-band-rest" />
          {t('budget.legendRest', { count: restCount, tokens: formatNumber(restTokens) })}
        </span>
      </div>
      <div className="dscx-b-counts">
        <span>
          <b>{formatNumber(activeCount)}</b>
          {t('budget.activeSkills')}
        </span>
        <span>
          <b>{formatNumber(calls)}</b>
          {t('budget.historyCalls')}
        </span>
        <span>
          <b>{formatNumber(calls30d)}</b>
          {t('budget.calls30d')}
        </span>
        <span>
          <b>{formatNumber(archivedCount)}</b>
          {t('budget.archivedCount')}
        </span>
      </div>
    </div>
  )
}

export function Panel(props: PanelProps): JSX.Element {
  const { t, api } = props

  const [view, setView] = useState<RangeView>('global')
  const [filter, setFilter] = useState<SkillStateFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('calls')
  const [project, setProject] = useState<ProjectEntry | null>(null)
  const [canOpen, setCanOpen] = useState(false)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const [refresh, setRefresh] = useState(0)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const toastSeq = useRef(0)

  const projectId = project?.id ?? null
  const overview = useResource((signal) => api.overview(signal), [api, refresh])
  const globalActive = useResource(
    (signal) => api.skills({ scope: 'global', state: 'all' }, signal),
    [api, refresh],
    view === 'global',
  )
  const globalArchived = useResource(
    (signal) => api.skills({ scope: 'global', state: 'archived' }, signal),
    [api, refresh],
    view === 'global',
  )
  const projects = useResource((signal) => api.projects(signal), [api, refresh], view === 'projects' && project === null)
  const projectActive = useResource(
    (signal) => api.skills({ scope: 'project', workspaceId: projectId ?? '', state: 'all' }, signal),
    [api, refresh, projectId],
    projectId !== null,
  )
  const projectArchived = useResource(
    (signal) => api.skills({ scope: 'project', workspaceId: projectId ?? '', state: 'archived' }, signal),
    [api, refresh, projectId],
    projectId !== null,
  )

  const backfill = overview.data?.backfill
  const backfillRunning = backfill?.state === 'running'

  // 回溯进行中：每 5 秒刷一次总账，进度条与后续列表能自己接上。
  useEffect(() => {
    if (!backfillRunning) return
    const timer = setInterval(() => overview.reload(), 5000)
    return () => clearInterval(timer)
  }, [backfillRunning])

  // 回溯刚结束：调用次数变了，整体重拉一次。
  const previousBackfill = useRef<string | null>(null)
  useEffect(() => {
    const state = backfill?.state ?? null
    if (previousBackfill.current === 'running' && state !== 'running') setRefresh((value) => value + 1)
    previousBackfill.current = state
  }, [backfill?.state])

  // 「从未被调用」默认按占用排：先砍最贵的（视觉稿定稿行为）。
  useEffect(() => {
    setSortBy(filter === 'never-called' ? 'tokens' : 'calls')
  }, [filter])

  useEffect(() => {
    let alive = true
    void api.canOpenPath().then((value) => {
      if (alive) setCanOpen(value)
    })
    return () => {
      alive = false
    }
  }, [api])

  // 切范围 / 筛选 / 进入详情都回到顶部，和原型一致。
  useEffect(() => {
    const node = scrollRef.current
    if (node !== null) node.scrollTop = 0
  }, [view, filter, projectId])

  const activeEntries = useMemo(
    () => (globalActive.data?.entries ?? []).filter((entry) => entry.effective),
    [globalActive.data],
  )
  const archivedEntries = useMemo(() => sortArchived(globalArchived.data?.entries ?? []), [globalArchived.data])
  const neverEntries = useMemo(() => activeEntries.filter((entry) => entry.calls === 0), [activeEntries])
  const globalEntries = useMemo(() => {
    if (filter === 'archived') return archivedEntries
    const base = filter === 'never-called' ? neverEntries : activeEntries
    return [...base].sort(sortBy === 'tokens' ? compareByTokens : compareByCalls)
  }, [filter, archivedEntries, activeEntries, neverEntries, sortBy])

  const detailEntries = useMemo(() => {
    const list = (projectActive.data?.entries ?? []).filter((entry) => entry.effective)
    return [...list].sort(compareByCalls)
  }, [projectActive.data])
  const detailArchivedEntries = useMemo(
    () => sortArchived(projectArchived.data?.entries ?? []),
    [projectArchived.data],
  )

  const totals = overview.data?.totals
  const budget = useMemo(() => {
    const fallbackTokens = activeEntries.reduce((sum, entry) => sum + entry.approxTokens, 0)
    const catalogTokens = totals?.catalogTokens ?? fallbackTokens
    const top = [...activeEntries]
      .filter((entry) => entry.approxTokens > 0)
      .sort(compareByTokens)
      .slice(0, 7)
    const topTokens = top.reduce((sum, entry) => sum + entry.approxTokens, 0)
    const archivedTokens = archivedEntries.reduce((sum, entry) => sum + entry.approxTokens, 0)
    const neverCount = totals?.neverCalled ?? neverEntries.length
    const neverTokens =
      totals?.neverCalledTokens ?? neverEntries.reduce((sum, entry) => sum + entry.approxTokens, 0)
    return {
      activeCount: totals?.active ?? activeEntries.length,
      removed: totals?.removed ?? 0,
      catalogTokens,
      archivedCount: totals?.archived ?? archivedEntries.length,
      archivedTokens,
      calls: totals?.calls ?? activeEntries.reduce((sum, entry) => sum + entry.calls, 0),
      calls30d: totals?.calls30d ?? activeEntries.reduce((sum, entry) => sum + entry.calls30d, 0),
      neverCount,
      neverTokens,
      top,
      topTokens,
      restCount: Math.max(0, (totals?.active ?? activeEntries.length) - top.length),
      restTokens: Math.max(0, catalogTokens - topTokens),
    }
  }, [activeEntries, archivedEntries, neverEntries, totals])

  // 「调用」列 tooltip 的会话口径：优先用宿主给的统计范围；没有会话时退化成不带数字的说法。
  const corpus = overview.data?.corpusRange
  const callsTip =
    corpus !== undefined &&
    corpus.sessions > 0 &&
    corpus.from !== null &&
    corpus.to !== null
      ? t('tip.calls', {
          sessions: formatNumber(corpus.sessions),
          from: corpus.from,
          to: corpus.to,
        })
      : t('tip.callsPlain')

  const reloadAll = (): void => setRefresh((value) => value + 1)

  const showToast = (message: string, action?: { label: string; run: () => void }): void => {
    toastSeq.current += 1
    setToast({ message, seq: toastSeq.current, actionLabel: action?.label, onAction: action?.run })
  }

  const runMove = async (
    kind: 'archive' | 'restore',
    request: MoveRequest,
    displayName: string,
  ): Promise<void> => {
    if (pendingKey !== null) return
    setPendingKey(`${request.rootId}/${request.dirName}`)
    try {
      const payload = kind === 'archive' ? await api.archive(request) : await api.restore(request)
      setRefresh((value) => value + 1)
      if (kind === 'archive') {
        // 重名时宿主会顺手改名；撤销必须用改名后的目录名才找得到。
        const undoRequest: MoveRequest = { ...request, dirName: payload.renamedTo ?? request.dirName }
        showToast(t('toast.archived', { name: displayName }), {
          label: t('toast.undo'),
          run: () => {
            void runMove('restore', undoRequest, displayName)
          },
        })
      } else {
        showToast(t('toast.restored', { name: displayName }))
      }
    } catch (error) {
      showToast(errorMessage(t, errorCodeOf(error)))
    } finally {
      setPendingKey(null)
    }
  }

  const moveRequest = (entry: SkillEntry, scope: RootScope, workspaceId?: string): MoveRequest => {
    const request: MoveRequest = { scope, rootId: entry.rootId, dirName: entry.dirName }
    return workspaceId === undefined ? request : { ...request, workspaceId }
  }
  const handleArchive = (entry: SkillEntry, scope: RootScope, workspaceId?: string): void => {
    const request = moveRequest(entry, scope, workspaceId)
    void runMove('archive', request, entry.name)
  }
  const handleRestore = (entry: SkillEntry, scope: RootScope, workspaceId?: string): void => {
    const request = moveRequest(entry, scope, workspaceId)
    void runMove('restore', request, entry.name)
  }

  const handleOpenPath = (path: string): void => {
    void (async () => {
      if (await api.openPath(path)) return
      const copied = await api.copyPath(path)
      showToast(copied ? t('toast.openFailedCopied') : t('toast.openFailed'))
    })()
  }

  const selectView = (next: RangeView): void => {
    setView(next)
    setProject(null)
  }

  const globalView = (): JSX.Element => {
    const archived = filter === 'archived'
    const failed = overview.error !== null && overview.data === null
    // 总账没拿到时仍保留「全局 / 项目」切换：项目看板不依赖 overview，别让用户卡在错误页。
    const navOnly = (
      <div className="dscx-segrow">
        <SegNav t={t} view={view} onSelect={selectView} />
      </div>
    )
    let body: JSX.Element
    if (failed) {
      body = (
        <>
          {navOnly}
          <StateBlock
            t={t}
            kind="error"
            title={t('error.title')}
            desc={t('error.desc')}
            onRetry={reloadAll}
          />
        </>
      )
    } else if (overview.data === null) {
      body = (
        <>
          {navOnly}
          <StateBlock t={t} kind="loading" />
        </>
      )
    } else {
      body = (
        <>
          {backfillRunning && overview.data.backfill.state === 'running' ? (
            <ProgressStrip t={t} backfill={overview.data.backfill} />
          ) : null}
          <BudgetCard t={t} {...budget} />
          <div className="dscx-segrow">
            <SegNav t={t} view={view} onSelect={selectView} />
            <div className="dscx-chips">
              <button
                type="button"
                className="dscx-chip"
                aria-pressed={filter === 'all'}
                onClick={() => setFilter('all')}
              >
                {t('filter.all')}
                <span className="dscx-chip-n">{formatNumber(budget.activeCount)}</span>
              </button>
              <button
                type="button"
                className="dscx-chip"
                aria-pressed={filter === 'never-called'}
                onClick={() => setFilter('never-called')}
              >
                {t('filter.never')}
                <span className="dscx-chip-n">{formatNumber(budget.neverCount)}</span>
              </button>
              <button
                type="button"
                className="dscx-chip"
                aria-pressed={filter === 'archived'}
                onClick={() => setFilter('archived')}
              >
                {t('filter.archived')}
                <span className="dscx-chip-n">{formatNumber(budget.archivedCount)}</span>
              </button>
            </div>
          </div>
          {filter === 'never-called' ? (
            <div className="dscx-fbar">
              {t('filter.neverSummary', {
                count: formatNumber(budget.neverCount),
                tokens: formatNumber(budget.neverTokens),
              })}
            </div>
          ) : null}
          <SkillList
            t={t}
            entries={globalEntries}
            mode={archived ? 'archived' : 'active'}
            loading={archived ? globalArchived.loading : globalActive.loading}
            error={archived ? globalArchived.error : globalActive.error}
            canOpen={canOpen}
            pendingKey={pendingKey}
            callsTip={callsTip}
            emptyText={
              archived
                ? t('table.emptyArchived')
                : filter === 'never-called'
                  ? t('table.emptyNever')
                  : t('table.emptyAll')
            }
            onRetry={reloadAll}
            onArchive={(entry) => handleArchive(entry, 'global')}
            onRestore={(entry) => handleRestore(entry, 'global')}
            onOpenDir={(entry) => handleOpenPath(entry.dirRealPath)}
          />
          {filter === 'all' && budget.removed > 0 ? (
            <div className="dscx-note">{t('note.removed', { count: formatNumber(budget.removed) })}</div>
          ) : null}
        </>
      )
    }
    return (
      <>
        <div className="dscx-ph">
          <div className="dscx-ph-title">
            <h1 className="dscx-h1">{t('panel')}</h1>
          </div>
          {archived ? null : (
            <div className="dscx-ph-acts">
              <button
                type="button"
                className="dscx-btn dscx-btn-sm"
                onClick={() => setSortBy(sortBy === 'calls' ? 'tokens' : 'calls')}
              >
                {sortBy === 'tokens' ? t('sort.byTokens') : t('sort.byCalls')}
              </button>
            </div>
          )}
        </div>
        {body}
      </>
    )
  }

  let content: JSX.Element
  if (project !== null) {
    content = (
      <ProjectDetail
        t={t}
        project={project}
        entries={detailEntries}
        archivedEntries={detailArchivedEntries}
        activeLoading={projectActive.loading}
        activeError={projectActive.error}
        archivedLoading={projectArchived.loading}
        archivedError={projectArchived.error}
        canOpen={canOpen}
        pendingKey={pendingKey}
        view={view}
        callsTip={callsTip}
        onSelectView={selectView}
        onBack={() => setProject(null)}
        onRetry={reloadAll}
        onOpenPath={handleOpenPath}
        onArchive={(entry) => handleArchive(entry, 'project', project.id)}
        onRestore={(entry) => handleRestore(entry, 'project', project.id)}
        onOpenDir={(entry) => handleOpenPath(entry.dirRealPath)}
      />
    )
  } else if (view === 'projects') {
    content = (
      <ProjectsView
        t={t}
        payload={projects.data}
        loading={projects.loading}
        error={projects.error}
        canOpen={canOpen}
        view={view}
        onSelectView={selectView}
        onRetry={reloadAll}
        onOpenProject={(entry) => setProject(entry)}
        onOpenPath={handleOpenPath}
      />
    )
  } else {
    content = globalView()
  }

  return (
    <div className="dscx-root" ref={scrollRef}>
      <div className="dscx-page">{content}</div>
      {toast === null ? null : (
        <Toast
          message={toast.message}
          seq={toast.seq}
          actionLabel={toast.actionLabel}
          onAction={toast.onAction}
          onExpire={() => setToast(null)}
        />
      )}
    </div>
  )
}
