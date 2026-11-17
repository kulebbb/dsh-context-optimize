/**
 * 报告渲染：把宿主算好的 `report.json` 画成面板里的页面。
 *
 * 约定：这里不请求数据、不判断业务，只做展示；所有数字已经在宿主侧算好，
 * 「模型判断」和「本地统计」在视觉上分开（前者带彩色底，后者是中性统计条）。
 */
import { useEffect, useRef, useState } from 'react'
import type { InsightReport, InsightSuggestionWhere } from '../../shared/insight.ts'
import type { Translate } from '../dsh.ts'
import { formatArchivedAt, formatNumber } from '../format.ts'

/** 建议落地位置 → 展示文案。 */
const WHERE_LABEL: Record<InsightSuggestionWhere, string> = {
  agents: 'AGENTS.md',
  skill: 'skill',
  workflow: 'workflow',
  config: 'config',
  other: 'other',
}

/** 毫秒 → `4m12s` 这种紧凑写法；不足一分钟只给秒。 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  if (minutes === 0) return `${String(seconds)}s`
  return `${String(minutes)}m${String(seconds).padStart(2, '0')}s`
}

export interface InsightReportViewProps {
  t: Translate
  report: InsightReport
  /** 点「去归档」跳回 skill 列表。 */
  onArchiveSkills?(): void
}

/** 一条建议：带复制按钮。 */
function SuggestionRow(props: { t: Translate; item: InsightReport['suggestions'][number] }): JSX.Element {
  const { t, item } = props
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(
    () => () => {
      if (timer.current !== undefined) clearTimeout(timer.current)
    },
    [],
  )
  const copy = (): void => {
    if (item.snippet === '') return
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard
    if (clipboard === undefined) return
    void clipboard
      .writeText(item.snippet)
      .then(() => {
        setCopied(true)
        if (timer.current !== undefined) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => undefined)
  }
  return (
    <div className="dscx-i-sugg">
      <span className="dscx-i-where">{WHERE_LABEL[item.where]}</span>
      <span className="what">
        <b>{item.title}</b>
        {item.detail}
        {item.snippet === '' ? null : <code>{item.snippet}</code>}
      </span>
      {item.snippet === '' ? (
        <span />
      ) : (
        <button type="button" className="dscx-btn dscx-btn-sm" onClick={copy}>
          {copied ? t('insight.copied') : t('insight.copy')}
        </button>
      )}
    </div>
  )
}

/** 条形列表：项目 / 工具共用。 */
function BarList(props: { items: readonly { label: string; value: number; suffix?: string }[] }): JSX.Element {
  const max = Math.max(1, ...props.items.map((item) => item.value))
  return (
    <div className="dscx-i-bars">
      {props.items.map((item) => (
        <div className="dscx-i-brow" key={item.label}>
          <span className="lab">{item.label}</span>
          <span className="track">
            <i style={{ width: `${String(Math.max(2, Math.round((item.value / max) * 100)))}%` }} />
          </span>
          <span className="n">
            {formatNumber(item.value)}
            {item.suffix ?? ''}
          </span>
        </div>
      ))}
    </div>
  )
}

export function InsightReportView(props: InsightReportViewProps): JSX.Element {
  const { t, report, onArchiveSkills } = props
  const { meta, glance, stats, projects, tools, hours } = report
  const maxHour = Math.max(1, ...hours.map((item) => item.sessions))

  return (
    <div className="dscx-i-report">
      <div className="dscx-i-crumb">
        <span className="code">{formatArchivedAt(meta.startedAt)}</span>
        <span className="dscx-i-tag">
          {meta.days === null ? t('insight.scopeAll') : `${String(meta.days)} ${t('insight.scopeDays')}`}
        </span>
        <span className="dscx-i-tag">{String(stats.sessions)} {t('insight.sessions')}</span>
        <span className="dscx-i-tag ok">{t('insight.duration', { time: formatDuration(meta.durationMs) })}</span>
        <span className="dscx-i-tag">
          {meta.provider} / {meta.model}
        </span>
        {stats.failedSessions > 0 ? (
          <span className="dscx-i-tag">{t('insight.failedSessions', { count: String(stats.failedSessions) })}</span>
        ) : null}
      </div>

      <div className="dscx-i-card">
        <div className="dscx-i-card-h">
          {t('insight.atGlance')}
          <span className="right">{t('insight.modelNote')}</span>
        </div>
        <div className="dscx-i-g3">
          <div className="dscx-i-g good">
            <span className="k">{t('insight.working')}</span>
            <span className="v">{glance.working}</span>
          </div>
          <div className="dscx-i-g bad">
            <span className="k">{t('insight.friction')}</span>
            <span className="v">{glance.friction}</span>
          </div>
          <div className="dscx-i-g next">
            <span className="k">{t('insight.next')}</span>
            <span className="v">{glance.next}</span>
          </div>
        </div>
      </div>

      <div className="dscx-i-stats">
        <div className="dscx-i-stat">
          <b>{formatNumber(stats.sessions)}</b>
          <span>{t('insight.statSessions')}</span>
        </div>
        <div className="dscx-i-stat">
          <b>{formatNumber(stats.messages)}</b>
          <span>{t('insight.statMessages')}</span>
        </div>
        <div className="dscx-i-stat">
          <b>{formatNumber(stats.toolCalls)}</b>
          <span>{t('insight.statTools')}</span>
        </div>
        <div className="dscx-i-stat">
          <b>{formatNumber(stats.activeDays)}</b>
          <span>{t('insight.statDays')}</span>
        </div>
        <div className="dscx-i-stat">
          <b>
            {meta.tokens >= 10_000 ? `${(meta.tokens / 10_000).toFixed(1)} 万` : formatNumber(meta.tokens)}
          </b>
          <span>{t('insight.statTokens')}</span>
        </div>
      </div>

      <div className="dscx-i-card">
        <div className="dscx-i-card-h">
          {t('insight.projects')}
          <span className="right">{t('insight.sessionCount')}</span>
        </div>
        <BarList
          items={projects.slice(0, 8).map((item) => ({ label: item.name, value: item.sessions }))}
        />
      </div>

      <div className="dscx-i-card">
        <div className="dscx-i-card-h">
          {t('insight.tools')}
          <span className="right">{t('insight.callCount')}</span>
        </div>
        <BarList
          items={tools.slice(0, 8).map((item) => ({
            label: item.name,
            value: item.calls,
            suffix: item.failures > 0 ? ` · ${String(item.failures)}✗` : '',
          }))}
        />
      </div>

      <div className="dscx-i-card">
        <div className="dscx-i-card-h">{t('insight.hours')}</div>
        <div className="dscx-i-hours" aria-hidden="true">
          {hours.map((item) => (
            <i
              key={item.hour}
              className={item.hour >= 21 || item.hour === 0 ? 'hot' : ''}
              style={{ height: `${String(Math.max(2, Math.round((item.sessions / maxHour) * 100)))}%` }}
            />
          ))}
        </div>
        <div className="dscx-i-hours-x">
          {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => (
            <span key={hour}>{String(hour)}</span>
          ))}
        </div>
      </div>

      {report.frictions.length === 0 ? null : (
        <div className="dscx-i-card">
          <div className="dscx-i-card-h">
            {t('insight.frictions', { count: String(report.frictions.length) })}
            <span className="right">{t('insight.examples')}</span>
          </div>
          {report.frictions.map((friction, index) => (
            <details className="dscx-i-fric" key={`${friction.title}-${String(index)}`} open={index === 0}>
              <summary>
                <span className="n">{String(index + 1).padStart(2, '0')}</span>
                {friction.title}
                <span className="cnt">{t('insight.times', { count: String(friction.count) })}</span>
              </summary>
              {friction.detail === '' ? null : <div className="d">{friction.detail}</div>}
              {friction.examples.map((example) => (
                <div className="dscx-i-ex" key={`${example.sessionId}-${example.quote}`}>
                  「{example.quote}」
                  <div className="src">
                    {example.project} · {example.date}
                  </div>
                </div>
              ))}
            </details>
          ))}
        </div>
      )}

      {report.wins.length === 0 ? null : (
        <div className="dscx-i-card">
          <div className="dscx-i-card-h">{t('insight.wins')}</div>
          <ol className="dscx-i-ol">
            {report.wins.map((win, index) => (
              <li key={`${win.title}-${String(index)}`}>
                <span className="n">{String(index + 1).padStart(2, '0')}</span>
                <span>
                  <b>{win.title}</b>
                  {win.detail === '' ? null : ` ${win.detail}`}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {report.suggestions.length === 0 ? null : (
        <div className="dscx-i-card">
          <div className="dscx-i-card-h">{t('insight.suggestions')}</div>
          {report.suggestions.map((item, index) => (
            <SuggestionRow key={`${item.title}-${String(index)}`} t={t} item={item} />
          ))}
        </div>
      )}

      {report.hygiene === null ? null : (
        <div className="dscx-i-card">
          <div className="dscx-i-card-h">{t('insight.hygiene')}</div>
          <div className="dscx-i-hyg">
            <div>
              <div className="big">
                {report.hygiene.active}
                <small>{t('insight.hygieneActive')}</small>
              </div>
              <div className="cap">{t('insight.hygieneFixed')}</div>
            </div>
            <div>
              <div className="big" style={{ color: 'var(--dsw-alias-state-warn-primary)' }}>
                {report.hygiene.unused30d}
                <small>{t('insight.hygieneNever')}</small>
              </div>
              <div className="cap">
                {t('insight.hygieneTokens', { tokens: formatNumber(report.hygiene.unusedTokens) })}
              </div>
            </div>
            {report.hygiene.examples.length > 0 ? (
              <div className="cap" style={{ maxWidth: '32ch' }}>
                {report.hygiene.examples.join('、')}
              </div>
            ) : null}
            {report.hygiene.complete ? null : (
              <div
                className="cap"
                style={{ color: 'var(--dsw-alias-state-warn-primary)', flexBasis: '100%' }}
              >
                {t('insight.hygieneIncomplete')}
              </div>
            )}
            {onArchiveSkills === undefined ? null : (
              <button type="button" className="dscx-btn dscx-btn-sm" style={{ marginLeft: 'auto' }} onClick={onArchiveSkills}>
                {t('insight.hygieneGo')}
              </button>
            )}
          </div>
        </div>
      )}

      {report.fun === '' ? null : (
        <div className="dscx-i-card">
          <div className="dscx-i-card-h">{t('insight.fun')}</div>
          <p className="dscx-i-lead">{report.fun}</p>
        </div>
      )}
    </div>
  )
}
