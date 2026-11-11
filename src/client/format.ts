/**
 * 客户端展示用的小工具：数字分组、归档时间、错误码 → 文案。
 *
 * 相对时间（今天 / 昨天 / N 天前）统一走 shared/catalog.ts 的 `lastUsedLabel`，
 * 这里不再实现第二份，避免两处口径漂移。
 */
import type { Translate } from './dsh.ts'

/** 千分位分组；原型用 en-US 分组（2,833），保持一致。 */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US')
}

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value)
}

/**
 * 归档时间：ISO 字符串 → 本地 `YYYY-MM-DD HH:mm`。
 *
 * 宿主若已给出可读文本（解析失败），原样展示，不吞掉信息。
 */
export function formatArchivedAt(value: string | undefined): string {
  if (value === undefined || value === '') return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 请求错误码 → 文案；未知码归为「操作失败」。 */
export function errorMessage(t: Translate, code: string | null): string {
  switch (code) {
    case 'readonly-root':
      return t('error.readonlyRoot')
    case 'target-exists':
      return t('error.targetExists')
    case 'not-found':
      return t('error.notFound')
    case 'path-escape':
    case 'invalid-request':
    case 'unknown-root':
      return t('error.invalidRequest')
    case 'timeout':
      return t('error.timeout')
    case 'network':
      return t('error.network')
    default:
      return t('error.internal')
  }
}
