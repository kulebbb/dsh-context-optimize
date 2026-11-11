/**
 * 两半共用的错误码与宿主侧抛错工具。
 *
 * 只放常量与一个轻量 Error 子类；客户端按 `code` 决定提示文案，不解析 message。
 */
import type { ErrorCode } from './types.ts'

/** 宿主侧统一抛出的错误：带 code，路由层原样映射成 HTTP 状态与错误体。 */
export class OptimizeError extends Error {
  readonly code: ErrorCode

  constructor(code: ErrorCode, message: string) {
    super(message)
    this.name = 'OptimizeError'
    this.code = code
  }
}

/** 错误码 → HTTP 状态。 */
export const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  'invalid-request': 400,
  'unknown-root': 400,
  'readonly-root': 403,
  'not-found': 404,
  'target-exists': 409,
  'path-escape': 400,
  'move-failed': 500,
  internal: 500,
}

/**
 * 把任意异常归一成 `{ code, message }`。
 *
 * @param error - 捕获到的异常。
 * @returns 已知错误保留 code，其余归为 internal。
 */
export function normalizeError(error: unknown): { code: ErrorCode; message: string } {
  if (error instanceof OptimizeError) return { code: error.code, message: error.message }
  if (error instanceof Error) return { code: 'internal', message: error.message }
  return { code: 'internal', message: '未知错误' }
}
