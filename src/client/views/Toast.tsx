/**
 * 归档 / 还原成功后的 3 秒可撤销提示条。
 *
 * 计时器归组件所有：`seq` 每次动作递增，同一句文案连续出现时也能重新计时。
 */
import { useEffect, useRef } from 'react'

export interface ToastProps {
  message: string
  /** 递增序号，变化即重新计时。 */
  seq: number
  actionLabel?: string
  onAction?(): void
  onExpire(): void
}

const TOAST_MS = 3000

export function Toast(props: ToastProps): JSX.Element {
  const { message, seq, actionLabel, onAction, onExpire } = props
  const expireRef = useRef(onExpire)
  expireRef.current = onExpire

  useEffect(() => {
    const timer = setTimeout(() => expireRef.current(), TOAST_MS)
    return () => clearTimeout(timer)
  }, [seq])

  return (
    <div className="dscx-toast" role="status">
      <span>{message}</span>
      {actionLabel === undefined || onAction === undefined ? null : (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      )}
    </div>
  )
}
