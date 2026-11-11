/**
 * 项目详情：面包屑返回 + 路径与小结数字 + 与全局页同一套「范围分段 + 三态筛选 + 排序」+ 同一张 skill 表。
 *
 * 归档在这里不是单独一块版面，而是列表的第三种状态——和全局页同构，
 * 这样不会出现「上面的表空着、下面的归档箱有东西」这种同屏矛盾。
 *
 * 数字全部区分「未知」与「零」：拿不到数据时显示「—」，不拿空列表算 0。
 */
import type { ProjectEntry, SkillEntry, SkillStateFilter } from '../../shared/types.ts'
import type { Translate } from '../dsh.ts'
import { formatNumber } from '../format.ts'
import { ChevronLeftIcon, FolderIcon } from '../icons.tsx'
import { SegNav } from './SegNav.tsx'
import type { RangeView } from './SegNav.tsx'
import { SkillList } from './SkillList.tsx'

/** 项目页三个筛选态各自的数量；null 表示还没拿到数据，界面显示「—」。 */
export interface ProjectCounts {
  readonly active: number | null
  readonly never: number | null
  readonly neverTokens: number | null
  readonly archived: number | null
}

/** 头部小结：数量和占用可以先用项目看板的汇总兜底，调用次数要等列表到齐才知道。 */
export interface ProjectTotals {
  readonly count: number
  readonly tokens: number
  readonly calls: number | null
}

export interface ProjectDetailProps {
  t: Translate
  project: ProjectEntry
  /** 当前筛选态下的条目（Panel 已按状态过滤并排好序）。 */
  entries: readonly SkillEntry[]
  filter: SkillStateFilter
  sortBy: 'calls' | 'tokens'
  counts: ProjectCounts
  /** 生效中列表的汇总；请求失败且没有任何数据时为 null。 */
  totals: ProjectTotals | null
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

/** 未知数字的占位符。 */
const DASH = '—'

export function ProjectDetail(props: ProjectDetailProps): JSX.Element {
  const { t, project, entries, filter, sortBy, counts, totals, loading, error, canOpen, pendingKey, view, callsTip } =
    props
  const { onSelectView, onBack, onRetry, onOpenPath, onFilter, onToggleSort } = props
  const { onArchive, onRestore, onOpenDir } = props

  const archived = filter === 'archived'
  const neverCalled = filter === 'never-called'
  const emptyText = archived
    ? t('table.emptyArchived')
    : neverCalled
      ? t('table.emptyNever')
      : t('table.emptyAll')

  const fmt = (value: number | null): string => (value === null ? DASH : formatNumber(value))
  const chip = (state: SkillStateFilter, label: string, count: number | null): JSX.Element => (
    <button type="button" className="dscx-chip" aria-pressed={filter === state} onClick={() => onFilter(state)}>
      {label}
      <span className="dscx-chip-n">{fmt(count)}</span>
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
              <b>{totals === null ? DASH : formatNumber(totals.count)}</b>
              {t('detail.skillCountSuffix')}
            </span>
            <span className="dscx-dotsep" />
            <span>
              <b>{totals === null ? DASH : formatNumber(totals.tokens)}</b>
              {t('detail.tokensUnit')}
            </span>
            <span className="dscx-dotsep" />
            <span>
              <b>{fmt(totals?.calls ?? null)}</b>
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
        {/* 归档态与「从未被调用」不显示排序：前者条目少；后者调用次数都是 0，两种排序得到的是同一个顺序 */}
        {archived || neverCalled ? null : (
          <button type="button" className="dscx-btn dscx-btn-sm dscx-sort" onClick={onToggleSort}>
            {sortBy === 'tokens' ? t('sort.byTokens') : t('sort.byCalls')}
          </button>
        )}
      </div>
      {neverCalled && counts.never !== null && counts.neverTokens !== null ? (
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
