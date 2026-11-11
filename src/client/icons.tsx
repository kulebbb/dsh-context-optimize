/**
 * 侧边栏入口图标 + 行内小图标。
 *
 * 全部 `stroke="currentColor"`、`fill="none"`，颜色由使用处的 token 决定，
 * 不在这里写死色值。路径取自定稿原型。
 */
/** 侧边栏入口：DSH 会传 `size`（收起 16 / 展开 18）与 `active`。 */
export function SidebarPanelIcon(props: { size?: number; active?: boolean }): JSX.Element {
  const size = props.size ?? 16
  return (
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
