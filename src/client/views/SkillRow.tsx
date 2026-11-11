/**
 * skill 表格的单行：名称 / 描述、来源标签、三个右对齐数字列、行尾操作。
 *
 * 生效中与已归档两种形态共用这一行，只是列组成与行尾按钮不同；
 * 列宽常量放在这里，表头（SkillList）与行引用同一份，避免两处对不上。
 */
import type { SkillEntry, SourceTag } from '../../shared/types.ts'
import { lastUsedLabel } from '../../shared/catalog.ts'
import type { Translate } from '../dsh.ts'
import { formatArchivedAt } from '../format.ts'
import { ArchiveIcon, FolderIcon, RestoreIcon } from '../icons.tsx'

export const ACTIVE_COLUMNS = 'minmax(0,1fr) 68px 54px 96px 80px 64px'
export const ARCHIVED_COLUMNS = 'minmax(0,1fr) 68px 150px 80px 64px'

/** 来源 → 标签文案 key 与配色；与原型 SRC 表一致。 */
const SOURCE_TAG: Record<SourceTag, { key: string; tone: string }> = {
  'user-agents': { key: 'source.user-agents', tone: 'dscx-tag-blue' },
  'user-dsh': { key: 'source.user-dsh', tone: 'dscx-tag-blue' },
  'project-agents': { key: 'source.project-agents', tone: 'dscx-tag-green' },
  'project-dsh': { key: 'source.project-dsh', tone: 'dscx-tag-green' },
  bundled: { key: 'source.bundled', tone: 'dscx-tag-dim' },
}

export interface SkillRowProps {
  t: Translate
  entry: SkillEntry
  mode: 'active' | 'archived'
  /** 宿主有没有桌面打开能力；false 时连按钮都不渲染。 */
  canOpen: boolean
  /** 该行有归档 / 还原请求在飞时禁用按钮，防止连点。 */
  busy: boolean
  onArchive(entry: SkillEntry): void
  onRestore(entry: SkillEntry): void
  onOpenDir(entry: SkillEntry): void
}

/** 行的稳定 key：根 + 目录名，同一目录在归档前后的身份不变。 */
export function entryKey(entry: SkillEntry): string {
  return `${entry.rootId}/${entry.dirName}`
}

export function SkillRow(props: SkillRowProps): JSX.Element {
  const { t, entry, mode, canOpen, busy, onArchive, onRestore, onOpenDir } = props
  const source = SOURCE_TAG[entry.source]
  const tokens = entry.approxTokens > 0 ? `${String(entry.approxTokens)}t` : '—'
  const tokensClass = entry.approxTokens > 0 ? 'dscx-num-r' : 'dscx-num-r dscx-zero'

  const name = (
    <div className="dscx-c-name">
      <div className="t">
        <b>{entry.name}</b>
        {entry.isSymlink ? (
          <span className="dscx-tag dscx-tag-dim" title={t('tip.symlink')}>
            {t('row.symlink')}
          </span>
        ) : null}
      </div>
      <div className="d">{entry.description === '' ? t('table.noDescription') : entry.description}</div>
    </div>
  )
  const tag = (
    <span>
      <span className={`dscx-tag ${source.tone}`}>{t(source.key)}</span>
    </span>
  )

  if (mode === 'archived') {
    return (
      <div className="dscx-tr" style={{ gridTemplateColumns: ARCHIVED_COLUMNS }}>
        {name}
        {tag}
        <span className="dscx-time-r">{formatArchivedAt(entry.archivedAt)}</span>
        <span className={tokensClass}>{tokens}</span>
        <div className="dscx-ops">
          <button
            type="button"
            className="dscx-iconbtn"
            title={t('action.restore')}
            aria-label={t('action.restore')}
            disabled={busy}
            onClick={() => onRestore(entry)}
          >
            <RestoreIcon />
          </button>
        </div>
      </div>
    )
  }

  const archiveTitle = entry.removable ? t('action.archive') : t('action.archiveBlocked')
  const agoZero = entry.calls === 0 ? 'dscx-ago-r dscx-zero' : 'dscx-ago-r'
  const callsZero = entry.calls === 0 ? 'dscx-num-r dscx-zero' : 'dscx-num-r'

  return (
    <div className="dscx-tr" style={{ gridTemplateColumns: ACTIVE_COLUMNS }}>
      {name}
      {tag}
      <span className={callsZero}>{entry.calls}</span>
      <span className={agoZero}>{lastUsedLabel(entry.lastUsedAt, entry.calls)}</span>
      <span className={tokensClass}>{tokens}</span>
      <div className="dscx-ops">
        {canOpen ? (
          <button
            type="button"
            className="dscx-iconbtn"
            title={t('action.openDir')}
            aria-label={t('action.openDir')}
            onClick={() => onOpenDir(entry)}
          >
            <FolderIcon />
          </button>
        ) : null}
        <button
          type="button"
          className="dscx-iconbtn"
          title={archiveTitle}
          aria-label={archiveTitle}
          disabled={!entry.removable || busy}
          onClick={() => onArchive(entry)}
        >
          <ArchiveIcon />
        </button>
      </div>
    </div>
  )
}
