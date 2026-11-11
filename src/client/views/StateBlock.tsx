/**
 * 加载态 / 错误态的统一块。
 *
 * 四个视图（全局、项目看板、项目详情、归档）都会遇到这两种状态，
 * 收在一个组件里，避免某处漏掉加载中或错误提示。
 */
import type { Translate } from '../dsh.ts'

export interface StateBlockProps {
  t: Translate
  kind: 'loading' | 'error'
  /** 错误标题；loading 时不需要。 */
  title?: string
  /** 错误说明（错误码翻译后的文案）。 */
  desc?: string
  onRetry?: () => void
}

export function StateBlock(props: StateBlockProps): JSX.Element {
  const { t, kind, title, desc, onRetry } = props
  if (kind === 'loading') {
    return (
      <div className="dscx-state">
        <span className="dscx-spinner" />
        <span className="dscx-state-title">{t('state.loading')}</span>
      </div>
    )
  }
  return (
    <div className="dscx-state">
      <span className="dscx-state-title">{title ?? t('error.title')}</span>
      {desc === undefined ? null : <span className="dscx-state-desc">{desc}</span>}
      {onRetry === undefined ? null : (
        <button type="button" className="dscx-state-action" onClick={onRetry}>
          {t('error.retry')}
        </button>
      )}
    </div>
  )
}
