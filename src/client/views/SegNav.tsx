/**
 * 「全局 / 项目」分段控件。
 *
 * 全局页、项目看板、项目详情页顶部都会出现同一条，收敛成一份实现，
 * 保证三处的选中态与切换行为一致。
 */
import type { Translate } from '../dsh.ts'

export type RangeView = 'global' | 'projects'

export interface SegNavProps {
  t: Translate
  view: RangeView
  onSelect(view: RangeView): void
}

export function SegNav(props: SegNavProps): JSX.Element {
  const { t, view, onSelect } = props
  return (
    <div className="dscx-seg" role="group">
      <button type="button" aria-pressed={view === 'global'} onClick={() => onSelect('global')}>
        {t('seg.global')}
      </button>
      <button type="button" aria-pressed={view === 'projects'} onClick={() => onSelect('projects')}>
        {t('seg.projects')}
      </button>
    </div>
  )
}
