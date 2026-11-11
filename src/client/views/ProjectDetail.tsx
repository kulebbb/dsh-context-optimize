/**
 * 项目详情：面包屑返回 + 路径与小结数字 + 与全局页同一套「范围分段 + 三态筛选 + 排序」+ 同一张 skill 表。
 *
 * 归档在这里不是单独一块版面，而是列表的第三种状态——和全局页同构，
 * 这样不会出现「上面的表空着、下面的归档箱有东西」这种同屏矛盾。
 */
import type { ProjectEntry, SkillEntry, SkillStateFilter } from '../../shared/types.ts'
import type { Translate } from '../dsh.ts'
import { formatNumber } from '../format.ts'
import { ChevronLeftIcon, FolderIcon } from '../icons.tsx'
import { SegNav } from './SegNav.tsx'
import type { RangeView } from './SegNav.tsx'
import { SkillList } from './SkillList.tsx'

/** 项目页三个筛选态各自的数量；`counts.active` 是生效中的条目数。 */
export interface ProjectCounts {
  readonly active: number
  readonly never: number
  readonly neverTokens: number
  readonly archived: number
}

export interface ProjectDetailProps {
  t: Translate
  project: ProjectEntry
  /** 当前筛选态下的条目（Panel 已按状态过滤并排好序）。 */
  entries: readonly SkillEntry[]
  filter: SkillStateFilter
  sortBy: 'calls' | 'tokens'
  counts: ProjectCounts
  /** 生效中列表的汇总；拿不到数据（请求失败）时为 null，界面显示「—」而不是 0。 */
  totals: { readonly count: number; readonly tokens: number; readonly calls: number } | null
  loading: boolean
  error: string | null
  canOpen: boolean
  pendingKey: string | null
  view: RangeView
  callsTip: string
  onSelectView(view: RangeView): void
  onBack(): void
  onRetry(): void
  onOpenPath(path: string): void
  onFilter(filter: SkillStateFilter): void
  onToggleSort(): void
  onArchive(entry: SkillEntry): void
  onRestore(entry: SkillEntry): void
  onOpenDir(entry: SkillEntry): void
}

export function ProjectDetail(props: ProjectDetailProps): JSX.Element {
  const { t, project, entries, filter, sortBy, counts, totals, loading, error, canOpen, pendingKey, view, callsTip } =
    props
  const { onSelectView, onBack, onRetry, onOpenPath, onFilter, onToggleSort } = props
  const { onArchive, onRestore, onOpenDir } = props

  const archived = filter === 'archived'
  const emptyText = archived
    ? t('table.emptyArchived')
    : filter === 'never-called'
      ? t('table.emptyNever')
      : t('table.emptyAll')

  // 拿不到数据（请求失败）时计数显示「—」：说 0 等于断言「确实一个都没有」。
  const countText = (count: number): string => (totals === null ? '—' : formatNumber(count))
  const chip = (state: SkillStateFilter, label: string, count: number): JSX.Element => (
    <button type="button" className="dscx-chip" aria-pressed={filter === state} onClick={() => onFilter(state)}>
      {label}
      <span className="dscx-chip-n">{countText(count)}</span>
    </button>
  )

  return (
    <>
      <div className="dscx-crumb">
        <button type="button" onClick={onBack}>
          <ChevronLeftIcon />
          {t('detail.crumb')}
        </button>
        <span className="sep">/</span>
        <span>{project.title}</span>
      </div>
      <div className="dscx-ph">
        <div className="dscx-ph-title">
          <h1 className="dscx-h1">{project.title}</h1>
          {/* 路径单独一行、三个数字单独一行：数字变大后单行会被「打开项目目录」挤到换行，换行点落在分隔点上很难看 */}
          <div className="dscx-pmeta">
            <code>{project.path}</code>
            {project.exists ? null : <span className="dscx-tag dscx-tag-warn">{t('detail.missing')}</span>}
          </div>
          <div className="dscx-pmeta">
            <span>
              <b>{countText(counts.active)}</b>
              {t('detail.skillCountSuffix')}
            </span>
            <span className="dscx-dotsep" />
            <span>
              <b>{totals === null ? '—' : formatNumber(totals.tokens)}</b>
              {t('detail.tokensUnit')}
            </span>
            <span className="dscx-dotsep" />
            <span>
              <b>{totals === null ? '—' : formatNumber(totals.calls)}</b>
              {t('detail.callsSuffix')}
            </span>
          </div>
        </div>
        <div className="dscx-ph-acts">
          <button
            type="button"
            className="dscx-btn dscx-btn-sm"
            disabled={!project.exists}
            onClick={() => onOpenPath(project.path)}
          >
            <FolderIcon />
            {t('action.openProjectLabel')}
          </button>
        </div>
      </div>
      <div className="dscx-segrow">
        <SegNav t={t} view={view} onSelect={onSelectView} />
        <div className="dscx-chips">
          {chip('all', t('filter.all'), counts.active)}
          {chip('never-called', t('filter.never'), counts.never)}
          {chip('archived', t('filter.archived'), counts.archived)}
        </div>
        {/* 归档态不显示排序：条目少，且全局页同样隐藏，两边行为保持一致 */}
        {archived ? null : (
          <button type="button" className="dscx-btn dscx-btn-sm dscx-sort" onClick={onToggleSort}>
            {sortBy === 'tokens' ? t('sort.byTokens') : t('sort.byCalls')}
          </button>
        )}
      </div>
      {filter === 'never-called' ? (
        <div className="dscx-fbar">
          {t('filter.neverSummary', {
            count: formatNumber(counts.never),
            tokens: formatNumber(counts.neverTokens),
          })}
        </div>
      ) : null}
      <SkillList
        t={t}
        entries={entries}
        mode={archived ? 'archived' : 'active'}
        loading={loading}
        error={error}
        canOpen={canOpen}
        pendingKey={pendingKey}
        callsTip={callsTip}
        emptyText={emptyText}
        onRetry={onRetry}
        onArchive={onArchive}
        onRestore={onRestore}
        onOpenDir={onOpenDir}
      />
    </>
  )
}
