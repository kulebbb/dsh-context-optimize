/**
 * 首次回溯进度条：宿主正在扫历史会话时显示在页头下方。
 *
 * 只有 `backfill.state === 'running'` 才渲染（由 Panel 判断），这里只负责呈现。
 */
import type { BackfillState } from '../../shared/types.ts'
import type { Translate } from '../dsh.ts'

export interface ProgressStripProps {
  t: Translate
  backfill: BackfillState
}

export function ProgressStrip(props: ProgressStripProps): JSX.Element {
  const { t, backfill } = props
  const total = Math.max(backfill.total, backfill.done)
  const percent = total > 0 ? Math.min(100, Math.round((backfill.done / total) * 100)) : 0
  return (
    <div className="dscx-progress">
      <div className="dscx-progress-row">
        <span className="dscx-progress-label">{t('backfill.label')}</span>
        <span className="dscx-progress-count">{t('backfill.count', { done: backfill.done, total })}</span>
      </div>
      <div className="dscx-progress-track">
        <i className="dscx-progress-fill" style={{ width: `${String(percent)}%` }} />
      </div>
    </div>
  )
}
