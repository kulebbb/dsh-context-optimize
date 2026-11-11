/**
 * 通用 skill 表格：表头（含列名 tooltip）、加载 / 错误 / 空态、行列表。
 *
 * 全局页、项目看板之外的项目详情、以及项目归档箱都复用这一份；
 * 列名与数字列的对齐规则只在 SkillRow 的列宽常量里定义一次。
 */
import type { SkillEntry } from '../../shared/types.ts'
import type { Translate } from '../dsh.ts'
import { errorMessage } from '../format.ts'
import { SkillRow, ACTIVE_COLUMNS, ARCHIVED_COLUMNS, entryKey } from './SkillRow.tsx'
import { StateBlock } from './StateBlock.tsx'

export interface SkillListProps {
  t: Translate
  entries: readonly SkillEntry[]
  mode: 'active' | 'archived'
  loading: boolean
  /** 请求错误码；null 表示没有错误。 */
  error: string | null
  canOpen: boolean
  /** 正在归档 / 还原的条目 key（entryKey 的返回值）。 */
  pendingKey: string | null
  /** 「调用」列 tooltip 的正文（会话数由 Panel 插值好）。 */
  callsTip: string
  emptyText: string
  onRetry(): void
  onArchive(entry: SkillEntry): void
  onRestore(entry: SkillEntry): void
  onOpenDir(entry: SkillEntry): void
}

/**
 * 列名旁的圆圈问号。
 *
 * 位置跟着对齐方向走：右对齐列把问号放列名前面、左对齐列放后面，
 * 这样列名文字和下方数据的边界才能对齐（原型量过像素的唯一摆法）。
 */
function HeaderHint(props: { label: string; tip: string; align?: 'right' }): JSX.Element {
  const { label, tip, align } = props
  return (
    <span className="dscx-hint" data-align={align}>
      {align === 'right' ? (
        <>
          <span className="q">?</span>
          <span className="lb">{label}</span>
        </>
      ) : (
        <>
          <span className="lb">{label}</span>
          <span className="q">?</span>
        </>
      )}
      <span className="dscx-tip">{tip}</span>
    </span>
  )
}

function TableHead(props: { t: Translate; mode: 'active' | 'archived'; callsTip: string }): JSX.Element {
  const { t, mode, callsTip } = props
  if (mode === 'archived') {
    return (
      <div className="dscx-thead" style={{ gridTemplateColumns: ARCHIVED_COLUMNS }}>
        <span>{t('table.archivedSkill')}</span>
        <HeaderHint label={t('table.source')} tip={t('tip.source')} />
        <span className="dscx-rh">
          <HeaderHint label={t('table.archivedAt')} tip={t('tip.archivedAt')} align="right" />
        </span>
        <span className="dscx-rh">
          <HeaderHint label={t('table.tokens')} tip={t('tip.tokens')} align="right" />
        </span>
        <span />
      </div>
    )
  }
  return (
    <div className="dscx-thead" style={{ gridTemplateColumns: ACTIVE_COLUMNS }}>
      <span>{t('table.skill')}</span>
      <HeaderHint label={t('table.source')} tip={t('tip.source')} />
      <span className="dscx-rh">
        <HeaderHint label={t('table.calls')} tip={callsTip} align="right" />
      </span>
      <span className="dscx-rh">
        <HeaderHint label={t('table.lastUsed')} tip={t('tip.last')} align="right" />
      </span>
      <span className="dscx-rh">
        <HeaderHint label={t('table.tokens')} tip={t('tip.tokens')} align="right" />
      </span>
      <span />
    </div>
  )
}

export function SkillList(props: SkillListProps): JSX.Element {
  const { t, entries, mode, loading, error, canOpen, pendingKey, callsTip, emptyText } = props
  const { onRetry, onArchive, onRestore, onOpenDir } = props

  let body: JSX.Element
  if (loading && entries.length === 0) {
    body = <StateBlock t={t} kind="loading" />
  } else if (error !== null) {
    body = (
      <StateBlock
        t={t}
        kind="error"
        title={t('error.skillsTitle')}
        desc={errorMessage(t, error)}
        onRetry={onRetry}
      />
    )
  } else if (entries.length === 0) {
    body = <div className="dscx-empty">{emptyText}</div>
  } else {
    body = (
      <>
        {entries.map((entry) => (
          <SkillRow
            key={entryKey(entry)}
            t={t}
            entry={entry}
            mode={mode}
            canOpen={canOpen}
            busy={pendingKey === entryKey(entry)}
            onArchive={onArchive}
            onRestore={onRestore}
            onOpenDir={onOpenDir}
          />
        ))}
      </>
    )
  }

  return (
    <div className="dscx-tbl">
      <TableHead t={t} mode={mode} callsTip={callsTip} />
      {body}
    </div>
  )
}
