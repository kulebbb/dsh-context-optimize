/**
 * 项目详情：面包屑返回 + 路径与小结数字 + 与全局页同一张 skill 表 + 本项目归档箱。
 *
 * 表格复用 SkillList，归档箱也复用同一张表（mode=archived），
 * 不另做一套「项目专用」行，保证两边行为一致。
 */
import { useMemo } from 'react'
import type { ProjectEntry, SkillEntry } from '../../shared/types.ts'
import { totalsOf } from '../../shared/catalog.ts'
import type { Translate } from '../dsh.ts'
import { errorMessage, formatNumber } from '../format.ts'
import { ChevronLeftIcon, FolderIcon } from '../icons.tsx'
import { SegNav } from './SegNav.tsx'
import type { RangeView } from './SegNav.tsx'
import { SkillList } from './SkillList.tsx'
import { StateBlock } from './StateBlock.tsx'

export interface ProjectDetailProps {
  t: Translate
  project: ProjectEntry
  /** 生效中条目（Panel 已按 effective 过滤并按调用次数排序）。 */
  entries: readonly SkillEntry[]
  /** 本项目归档箱里的条目（按归档时间倒序）。 */
  archivedEntries: readonly SkillEntry[]
  activeLoading: boolean
  activeError: string | null
  archivedLoading: boolean
  archivedError: string | null
  canOpen: boolean
  pendingKey: string | null
  view: RangeView
  callsTip: string
  onSelectView(view: RangeView): void
  onBack(): void
  onRetry(): void
  onOpenPath(path: string): void
  onArchive(entry: SkillEntry): void
  onRestore(entry: SkillEntry): void
  onOpenDir(entry: SkillEntry): void
}

export function ProjectDetail(props: ProjectDetailProps): JSX.Element {
  const { t, project, entries, archivedEntries, activeLoading, activeError, canOpen, pendingKey } = props
  const { archivedLoading, archivedError, view, callsTip } = props
  const { onSelectView, onBack, onRetry, onOpenPath, onArchive, onRestore, onOpenDir } = props

  const totals = useMemo(() => totalsOf(entries), [entries])
  // 首屏还没拿到列表时先用项目看板给的汇总，避免数字闪一下 0。
  const loaded = !activeLoading || entries.length > 0
  const skillCount = loaded ? totals.count : project.skillCount
  const tokens = loaded ? totals.tokens : project.approxTokens

  let archiveBody: JSX.Element
  if (archivedLoading && archivedEntries.length === 0) {
    archiveBody = <StateBlock t={t} kind="loading" />
  } else if (archivedError !== null) {
    archiveBody = (
      <StateBlock
        t={t}
        kind="error"
        title={t('error.detailTitle')}
        desc={errorMessage(t, archivedError)}
        onRetry={onRetry}
      />
    )
  } else if (archivedEntries.length === 0) {
    archiveBody = <div className="dscx-emptybox">{t('detail.archiveEmpty')}</div>
  } else {
    archiveBody = (
      <SkillList
        t={t}
        entries={archivedEntries}
        mode="archived"
        loading={false}
        error={null}
        canOpen={canOpen}
        pendingKey={pendingKey}
        callsTip={callsTip}
        emptyText={t('detail.archiveEmpty')}
        onRetry={onRetry}
        onArchive={onArchive}
        onRestore={onRestore}
        onOpenDir={onOpenDir}
      />
    )
  }

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
          <div className="dscx-pmeta">
            <code>{project.path}</code>
            <span className="dscx-dotsep" />
            <span>
              <b>{formatNumber(skillCount)}</b>
              {t('detail.skillCountSuffix')}
            </span>
            <span className="dscx-dotsep" />
            <span>
              <b>{formatNumber(tokens)}</b>
              {t('detail.tokensUnit')}
            </span>
            <span className="dscx-dotsep" />
            <span>
              <b>{totals.calls}</b>
              {t('detail.callsSuffix')}
            </span>
            {project.exists ? null : <span className="dscx-tag dscx-tag-warn">{t('detail.missing')}</span>}
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
      <SegNav t={t} view={view} onSelect={onSelectView} />
      <SkillList
        t={t}
        entries={entries}
        mode="active"
        loading={activeLoading}
        error={activeError}
        canOpen={canOpen}
        pendingKey={pendingKey}
        callsTip={callsTip}
        emptyText={t('table.emptyAll')}
        onRetry={onRetry}
        onArchive={onArchive}
        onRestore={onRestore}
        onOpenDir={onOpenDir}
      />
      <div className="dscx-subsec">
        {t('detail.archiveBox')}
        {archivedEntries.length > 0 ? <span className="c">{archivedEntries.length}</span> : null}
      </div>
      {archiveBody}
    </>
  )
}
