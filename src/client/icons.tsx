/**
 * 侧边栏入口图标 + 行内小图标。
 *
 * 全部 `stroke="currentColor"`、`fill="none"`，颜色由使用处的 token 决定，
 * 不在这里写死色值。路径取自定稿原型。
 */
import { useSyncExternalStore } from 'react'
import type { InsightNavState } from './navState.ts'
import { navGetSnapshot, navSubscribe } from './navState.ts'

/** 没有 store 时的静态状态，避免重复建对象。 */
const IDLE: InsightNavState = { running: false, unread: 0, failed: false }

/**
 * 侧边栏入口：DSH 会传 `size`（展开 16 / 收起 18）与 `active`。
 *
 * 外面的 `span.dscx-nav` 是状态钩子：它的 `data-dco-nav` 让样式表能把扫光和未读点
 * 挂到 DSH 自己渲染的那行文字上，不必依赖 DSH 的哈希类名。
 */
export function SidebarPanelIcon(props: { size?: number; active?: boolean }): JSX.Element {
  const size = props.size ?? 16
  // 订阅函数身份稳定，内部委托给当前 store：热更新换掉 store 也能跟上。
  const state = useSyncExternalStore(navSubscribe, navGetSnapshot, () => IDLE)
  const status = state.running ? 'running' : state.failed ? 'failed' : state.unread > 0 ? 'unread' : 'idle'
  return (
    <span className="dscx-nav" data-dco-nav={status}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M8 2.2 13.6 5 8 7.8 2.4 5 8 2.2Z" />
        <path d="M2.4 8 8 10.8 13.6 8" />
        <path d="M2.4 11 8 13.8l5.6-2.8" />
      </svg>
      {status === 'unread' || status === 'failed' ? (
        <i className="dscx-nav-dot" data-kind={status} aria-hidden="true" />
      ) : null}
    </span>
  )
}

export function FolderIcon(): JSX.Element {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 4.6A1.4 1.4 0 0 1 3.4 3.2h2.4l1.3 1.5h4.5A1.4 1.4 0 0 1 13 6.1v5.5a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 11.6V4.6Z" />
    </svg>
  )
}

export function ArchiveIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="2.2" y="2.8" width="11.6" height="3" rx="1" />
      <path d="M3.4 5.8v6a1.2 1.2 0 0 0 1.2 1.2h6.8a1.2 1.2 0 0 0 1.2-1.2v-6" />
      <path d="M6.4 8.6h3.2" />
    </svg>
  )
}

export function RestoreIcon(): JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" />
      <path d="M3 2.6v3.2h3.2" />
    </svg>
  )
}

export function ChevronLeftIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9.5 3.5 5 8l4.5 4.5" />
    </svg>
  )
}
