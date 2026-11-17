/**
 * 洞察视图的错误文案：404 要说成「宿主没加载这个版本」，而不是笼统的「操作失败」。
 *
 * 这次踩过的坑：客户端热更新了、宿主还是启动时那份旧代码，接口 404，
 * 界面却只显示「操作失败，请重试」，完全看不出该去重启 DSH。
 */
import { describe, expect, it } from 'vitest'
import { OptimizeRequestError } from '../src/client/api.ts'
import { statusErrorText } from '../src/client/views/InsightView.tsx'
import type { Translate } from '../src/client/dsh.ts'
import { zh } from '../src/client/locales.ts'

const t: Translate = (key) => (zh as Record<string, string>)[key] ?? key

describe('洞察状态接口的错误文案', () => {
  it('404 明确指向宿主没加载新版本', () => {
    const cause = new OptimizeRequestError('request failed (404)', 'internal', 404)
    expect(statusErrorText(t, cause)).toBe(zh['insight.hostStale'])
  })

  it('连不上宿主时给网络文案', () => {
    const cause = new OptimizeRequestError('network error', 'network', 0)
    expect(statusErrorText(t, cause)).toBe(zh['error.network'])
  })

  it('未知异常回落到读取失败', () => {
    expect(statusErrorText(t, new Error('boom'))).toBe(zh['insight.loadFailed'])
  })
})
