/**
 * 「洞察」视图：发起分析、看进度、翻历史、打开报告。
 *
 * 数据全部走宿主路由；模型下拉优先用 DSH 官方模型目录（和设置里那份一致），
 * 拿不到时退回宿主兜底接口。运行中每 1.5 秒拉一次状态，跑完自动打开报告。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { InsightHistoryEntry, InsightReportPayload, InsightStatusPayload } from '../../shared/insight.ts'
import type { ContextOptimizeApi, InsightModelOptions } from '../api.ts'
import { OptimizeRequestError } from '../api.ts'
import type { Translate } from '../dsh.ts'
import { errorMessage, formatArchivedAt, formatNumber } from '../format.ts'
import { InsightReportView, formatDuration } from './InsightReport.tsx'

export interface InsightViewProps {
  t: Translate
  api: ContextOptimizeApi
  /** 宿主能不能在系统里打开文件；false 时隐藏「打开 HTML」。 */
  canOpen: boolean
  onOpenPath(path: string): void
  /** 回到 skill 列表。 */
  onClose(): void
  /** 报告里「去归档」跳回 skill 列表。 */
  onArchiveSkills(): void
}

/** 模型选项的稳定 key。 */
function keyOf(option: { provider: string; model: string }): string {
  return `${option.provider}\u0000${option.model}`
}

/** 范围 chip 的取值。 */
const SCOPES: readonly (number | null)[] = [30, 90, null]

/** 范围 → 文案。 */
function scopeLabel(t: Translate, days: number | null): string {
  if (days === null) return t('insight.scopeAll')
  if (days === 30) return t('insight.scope30')
  if (days === 90) return t('insight.scope90')
  return `${String(days)} ${t('insight.scopeDays')}`
}

/** 请求错误 → 文案。 */
function messageOf(t: Translate, error: unknown, fallback: string): string {
  if (error instanceof OptimizeRequestError) {
    if (error.code === 'busy') return t('insight.busy')
    if (error.code === 'analysis-failed') return error.message
    return errorMessage(t, error.code)
  }
  return fallback
}

export function InsightView(props: InsightViewProps): JSX.Element {
  const { t, api, canOpen, onOpenPath, onClose, onArchiveSkills } = props

  const [status, setStatus] = useState<InsightStatusPayload | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [history, setHistory] = useState<readonly InsightHistoryEntry[]>([])
  const [models, setModels] = useState<InsightModelOptions | null>(null)
  const [days, setDays] = useState<number | null>(30)
  const [modelKey, setModelKey] = useState('')
  const [report, setReport] = useState<InsightReportPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingReport, setLoadingReport] = useState(false)

  const running = status?.status === 'running'
  /** 本次挂载里是否真的见过 running：只有这样才能在跑完后自动打开报告，而不是每次进面板都弹上次那份。 */
  const seenRunning = useRef(false)
  /** 连续轮询失败次数；宿主重启时别让界面永远停在「分析中」。 */
  const pollFailures = useRef(0)

  const refreshHistory = useCallback(async (): Promise<void> => {
    try {
      const payload = await api.insightHistory()
      setHistory(payload.entries)
    } catch {
      // 历史读不到不挡主流程，列表留空即可。
    }
  }, [api])

  const openReport = useCallback(
    async (id: string): Promise<void> => {
      setLoadingReport(true)
      setError(null)
      try {
        const payload = await api.insightReport(id)
        setReport(payload)
      } catch (cause) {
        setError(messageOf(t, cause, t('insight.reportFailed')))
      } finally {
        setLoadingReport(false)
      }
    },
    [api, t],
  )

  // 首次加载：状态、历史、模型目录。
  useEffect(() => {
    let alive = true
    void api
      .insightStatus()
      .then((value) => {
        if (!alive) return
        setStatus(value)
        setStatusError(null)
      })
      .catch((cause: unknown) => {
        if (alive) setStatusError(messageOf(t, cause, t('insight.loadFailed')))
      })
    void refreshHistory()
    void api
      .modelOptions()
      .then((value) => {
        if (!alive) return
        setModels(value)
        const preferred = value.options.find((option) => option.isDefault) ?? value.options[0]
        setModelKey(preferred === undefined ? '' : keyOf(preferred))
      })
      .catch(() => {
        if (alive) setModels({ options: [], defaultProvider: null, defaultModel: null, error: 'unavailable' })
      })
    return () => {
      alive = false
    }
  }, [api, refreshHistory, t])

  // 运行中轮询状态。
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => {
      void api
        .insightStatus()
        .then((value) => {
          pollFailures.current = 0
          setStatus(value)
        })
        .catch(() => {
          pollFailures.current += 1
          if (pollFailures.current >= 5) setStatusError(t('insight.loadFailed'))
        })
    }, 1500)
    return () => clearInterval(timer)
  }, [running, api, t])

  useEffect(() => {
    if (running) seenRunning.current = true
  }, [running])

  // 跑完自动打开报告；只对「本次亲眼看着它跑完」的那一次生效。
  useEffect(() => {
    if (status?.status !== 'done' || !seenRunning.current) return
    seenRunning.current = false
    const id = status.reportId ?? status.runId
    if (id !== null) void openReport(id)
    void refreshHistory()
  }, [status?.status, status?.reportId, status?.runId, openReport, refreshHistory])

  const start = async (): Promise<void> => {
    const option = models?.options.find((item) => keyOf(item) === modelKey)
    if (option === undefined) {
      setError(t('insight.noModel'))
      return
    }
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const next = await api.insightStart({ days, provider: option.provider, model: option.model })
      setStatus(next)
    } catch (cause) {
      setError(messageOf(t, cause, t('insight.startFailed')))
    } finally {
      setBusy(false)
    }
  }

  const cancel = async (): Promise<void> => {
    try {
      setStatus(await api.insightCancel())
    } catch (cause) {
      setError(messageOf(t, cause, t('insight.startFailed')))
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm(t('insight.deleteConfirm'))) return
    try {
      await api.insightRemove(id)
      if (report?.id === id) setReport(null)
      await refreshHistory()
    } catch (cause) {
      setError(messageOf(t, cause, t('error.internal')))
    }
  }

  const openHtml = async (id: string): Promise<void> => {
    const known = report?.id === id ? report.htmlPath : null
    if (known !== null) {
      onOpenPath(known)
      return
    }
    try {
      const payload = await api.insightReport(id)
      onOpenPath(payload.htmlPath)
    } catch (cause) {
      setError(messageOf(t, cause, t('insight.reportFailed')))
    }
  }

  // 「预计」一栏用同范围的上一次结果做参照，比一句「开始后才知道」有用。
  const lastSameScope = history.find((entry) => entry.days === days && entry.status === 'done')

  const phases = status?.phases ?? []
  const finishedPhases = phases.filter((phase) => phase.state === 'done' || phase.state === 'skipped').length
  const activePhase = phases.find((phase) => phase.state === 'running')
  const phaseRatio =
    activePhase !== undefined && activePhase.total > 0 ? activePhase.done / activePhase.total : 0
  const percent = running ? Math.min(99, Math.round(((finishedPhases + phaseRatio) / 4) * 100)) : 0
  const phaseLabelOf = (key: string): string => {
    switch (key) {
      case 'collect':
        return t('insight.phase.collect')
      case 'facets':
        return t('insight.phase.facets')
      case 'aggregate':
        return t('insight.phase.aggregate')
      default:
        return t('insight.phase.write')
    }
  }

  const head = (
    <div className="dscx-i-head">
      <div className="dscx-ph-title">
        <h1 className="dscx-h1">{t('insight.title')}</h1>
        <p className="dscx-sub">{t('insight.subtitle')}</p>
      </div>
      <div className="dscx-ph-acts">
        <button type="button" className="dscx-btn dscx-btn-sm" onClick={onClose}>
          ← {t('insight.back')}
        </button>
      </div>
    </div>
  )

  const form = (
    <div className="dscx-i-card">
      <div className="dscx-i-card-h">{t('insight.startTitle')}</div>
      <p className="dscx-i-lead">{t('insight.lead')}</p>
      <div className="dscx-i-flow">
        <span>{t('insight.phase.collect')}</span>
        <span aria-hidden="true">→</span>
        <span>{t('insight.phase.facets')}</span>
        <span aria-hidden="true">→</span>
        <span>{t('insight.phase.aggregate')}</span>
        <span aria-hidden="true">→</span>
        <span>{t('insight.phase.write')}</span>
      </div>
      <div className="dscx-i-form">
        <div className="dscx-i-field">
          <label>{t('insight.scope')}</label>
          <div className="dscx-chips">
            {SCOPES.map((scope) => (
              <button
                key={String(scope)}
                type="button"
                className="dscx-chip"
                aria-pressed={days === scope}
                onClick={() => setDays(scope)}
              >
                {scopeLabel(t, scope)}
              </button>
            ))}
          </div>
        </div>
        <div className="dscx-i-field">
          <label>{t('insight.model')}</label>
          {models === null ? (
            <span className="v">{t('state.loading')}</span>
          ) : models.options.length === 0 ? (
            <span className="v">{t('insight.noModel')}</span>
          ) : (
            <select
              className="dscx-i-select"
              value={modelKey}
              onChange={(event) => setModelKey(event.target.value)}
            >
              {models.options.map((option) => (
                <option key={keyOf(option)} value={keyOf(option)}>
                  {option.providerName} · {option.name}
                  {option.isDefault ? ` (${t('insight.modelDefault')})` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="dscx-i-field">
          <label>{t('insight.estimate')}</label>
          <span className="v">
            {lastSameScope === undefined
              ? t('insight.estimateUnknown')
              : t('insight.estimateLast', {
                  sessions: formatNumber(lastSameScope.sessions),
                  time: formatDuration(lastSameScope.durationMs),
                })}
          </span>
        </div>
      </div>
      <div className="dscx-i-actions">
        <button
          type="button"
          className="dscx-i-primary"
          onClick={() => void start()}
          disabled={busy || models === null || models.options.length === 0}
        >
          {t('insight.start')}
        </button>
        <span className="dscx-i-privacy">{t('insight.privacy')}</span>
      </div>
    </div>
  )

  const runningCard = (
    <div className="dscx-i-card dscx-i-run">
      <div className="dscx-i-run-top">
        <span className="dscx-i-badge">{t('insight.running')}</span>
        <b style={{ font: 'var(--dsw-font-xs-13)' }}>
          {activePhase === undefined ? t('insight.running') : phaseLabelOf(activePhase.key)}
        </b>
        <span className="elapsed">{formatDuration(status?.elapsedMs ?? 0)}</span>
      </div>
      <div className="dscx-i-bar">
        <i style={{ width: `${String(Math.max(2, percent))}%` }} />
      </div>
      <div className="dscx-i-phases">
        {phases.map((phase) => (
          <div
            key={phase.key}
            className={`dscx-i-phase${phase.state === 'done' || phase.state === 'skipped' ? ' done' : ''}${
              phase.state === 'running' ? ' now' : ''
            }`}
          >
            <b>{phaseLabelOf(phase.key)}</b>
            <span>
              {phase.total === 0
                ? t('insight.phase.waiting')
                : `${String(phase.done)} / ${String(phase.total)}`}
            </span>
          </div>
        ))}
      </div>
      {status?.current === null || status?.current === undefined ? null : (
        <div className="dscx-i-current">
          <span>{t('insight.current')}</span>
          <span className="t">{status.current}</span>
        </div>
      )}
      <div className="dscx-i-actions">
        <button type="button" className="dscx-btn dscx-btn-sm" onClick={() => void cancel()}>
          {t('insight.cancel')}
        </button>
        <span className="dscx-i-privacy">{t('insight.keepRunning')}</span>
      </div>
    </div>
  )

  const historyCard = (
    <div className="dscx-i-card">
      <div className="dscx-i-card-h">
        {t('insight.history')}
        <span className="right">{t('insight.historyCount', { count: String(history.length) })}</span>
      </div>
      {history.length === 0 ? (
        <div className="dscx-i-empty">{t('insight.empty')}</div>
      ) : (
        <div className="dscx-i-list">
          {history.map((entry) => (
            <div className="dscx-i-row" key={entry.id}>
              <span className="when">{formatArchivedAt(entry.startedAt)}</span>
              <span className="meta">
                <span>{scopeLabel(t, entry.days)}</span>
                <span>·</span>
                <b>{formatNumber(entry.sessions)}</b>
                <span>{t('insight.sessions')}</span>
                <span>·</span>
                <b>{formatDuration(entry.durationMs)}</b>
                {entry.failedSessions > 0 ? (
                  <span>· {t('insight.failedSessions', { count: String(entry.failedSessions) })}</span>
                ) : null}
              </span>
              <span className="acts">
                <button type="button" className="dscx-btn dscx-btn-sm" onClick={() => void openReport(entry.id)}>
                  {t('insight.openReport')}
                </button>
                {canOpen ? (
                  <button type="button" className="dscx-btn dscx-btn-sm" onClick={() => void openHtml(entry.id)}>
                    {t('insight.openHtml')}
                  </button>
                ) : null}
                <button type="button" className="dscx-btn dscx-btn-sm" onClick={() => void remove(entry.id)}>
                  {t('insight.delete')}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )

  let body: JSX.Element
  if (report !== null) {
    body = (
      <div className="dscx-i-report">
        <div className="dscx-i-crumb">
          <button type="button" className="dscx-i-back" onClick={() => setReport(null)}>
            ← {t('insight.history')}
          </button>
        </div>
        <InsightReportView t={t} report={report.report} onArchiveSkills={onArchiveSkills} />
        <div className="dscx-i-foot">
          <span>{t('insight.duration', { time: formatDuration(report.report.meta.durationMs) })}</span>
          <span className="right">
            {canOpen ? (
              <button type="button" className="dscx-btn dscx-btn-sm" onClick={() => onOpenPath(report.htmlPath)}>
                {t('insight.openHtml')}
              </button>
            ) : null}
            <button type="button" className="dscx-btn dscx-btn-sm" onClick={() => void remove(report.id)}>
              {t('insight.delete')}
            </button>
          </span>
        </div>
      </div>
    )
  } else if (running) {
    body = (
      <>
        {runningCard}
        {historyCard}
      </>
    )
  } else {
    body = (
      <>
        {status?.status === 'failed' && status.error !== null ? (
          <div className="dscx-i-err">
            {t('insight.failedTitle')}：{status.error}
          </div>
        ) : null}
        {status?.status === 'cancelled' ? <div className="dscx-i-note">{t('insight.cancelled')}</div> : null}
        {form}
        {historyCard}
      </>
    )
  }

  return (
    <>
      {head}
      {statusError !== null || error !== null ? (
        <div className="dscx-i-err">{statusError ?? error}</div>
      ) : null}
      {loadingReport ? <div className="dscx-i-empty">{t('state.loading')}</div> : null}
      {body}
    </>
  )
}
