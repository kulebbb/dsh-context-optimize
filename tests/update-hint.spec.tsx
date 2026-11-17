// @vitest-environment jsdom
/**
 * 「新版本」入口的显示与点击：jsdom 里挂真组件，api 用假对象。
 *
 * 只测界面自己的判断（显示 / 不显示 / 点击去哪），安装来源判定在 release-check.spec.ts。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import type { ContextOptimizeApi } from '../src/client/api.ts'
import type { Translate } from '../src/client/dsh.ts'
import { UpdateHint, resetUpdateHintCache } from '../src/client/views/UpdateHint.tsx'
import { PACKAGE_NAME } from '../src/shared/types.ts'
import type { VersionPayload } from '../src/shared/types.ts'

const t: Translate = (key, vars) =>
  key === 'update.tip' ? `发现新版本 v${String(vars?.version ?? '')}` : '新版本'

const AVAILABLE: VersionPayload = {
  current: '0.1.2',
  latest: '0.9.9',
  updateAvailable: true,
  installSource: 'registry',
}

const UP_TO_DATE: VersionPayload = { ...AVAILABLE, updateAvailable: false, latest: '0.1.2' }

interface FakeApi {
  api: ContextOptimizeApi
  version: ReturnType<typeof vi.fn>
  openPluginPage: ReturnType<typeof vi.fn>
}

function makeApi(result: VersionPayload | Error, opensPage = true): FakeApi {
  const version = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)))
  const openPluginPage = vi.fn(() => opensPage)
  return { api: { version, openPluginPage } as unknown as ContextOptimizeApi, version, openPluginPage }
}

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  resetUpdateHintCache()
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
  vi.restoreAllMocks()
})

/** 挂载并等 effect 里的那次请求落地。 */
async function render(api: ContextOptimizeApi): Promise<void> {
  await act(async () => {
    root.render(<UpdateHint t={t} api={api} />)
  })
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('UpdateHint', () => {
  it('有新版时显示「新版本 + 版本号」，并带上提示文案', async () => {
    const { api } = makeApi(AVAILABLE)
    await render(api)
    const button = container.querySelector('button.dscx-update')
    expect(button).not.toBeNull()
    expect(button?.textContent).toContain('新版本')
    expect(button?.textContent).toContain('v0.9.9')
    expect(button?.getAttribute('aria-label')).toBe('发现新版本 v0.9.9')
  })

  it('已是最新时不渲染任何节点', async () => {
    const { api } = makeApi(UP_TO_DATE)
    await render(api)
    expect(container.innerHTML).toBe('')
  })

  it('请求失败时静默，不渲染也不抛错', async () => {
    const { api } = makeApi(new Error('offline'))
    await render(api)
    expect(container.innerHTML).toBe('')
  })

  it('点击优先让 DSH 插件页打开本包', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { api, openPluginPage } = makeApi(AVAILABLE, true)
    await render(api)
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(openPluginPage).toHaveBeenCalledTimes(1)
    expect(open).not.toHaveBeenCalled()
  })

  it('没有插件页服务时退化为打开 npm 页面', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const { api } = makeApi(AVAILABLE, false)
    await render(api)
    await act(async () => {
      container.querySelector('button')?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(open).toHaveBeenCalledTimes(1)
    expect(String(open.mock.calls[0]?.[0])).toBe(`https://www.npmjs.com/package/${PACKAGE_NAME}`)
  })

  it('失败结果也进缓存：重复挂载不重查', async () => {
    const { api, version } = makeApi(new Error('offline'))
    await render(api)
    expect(container.innerHTML).toBe('')
    act(() => {
      root.unmount()
    })
    root = createRoot(container)
    await render(api)
    expect(version).toHaveBeenCalledTimes(1)
  })

  it('同一页面里重复挂载只查一次版本', async () => {
    const { api, version } = makeApi(AVAILABLE)
    await render(api)
    act(() => {
      root.unmount()
    })
    root = createRoot(container)
    await render(api)
    expect(version).toHaveBeenCalledTimes(1)
  })
})
