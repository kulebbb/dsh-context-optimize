// @vitest-environment jsdom
/**
 * 挂载护栏：「新版本」入口必须同时出现在三个页头（全局列表、项目看板、项目详情）。
 *
 * 这是方案里最容易漏的一处——只在全局页挂，常用项目页的用户就永远看不到。
 * 这里用最省的假数据把两个页面各渲染一次，只断言入口在不在。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import type { Root } from 'react-dom/client'
import type { ContextOptimizeApi } from '../src/client/api.ts'
import type { Translate } from '../src/client/dsh.ts'
import type { ProjectEntry, VersionPayload } from '../src/shared/types.ts'
import { Panel } from '../src/client/views/Panel.tsx'
import { ProjectsView } from '../src/client/views/ProjectsView.tsx'
import { ProjectDetail } from '../src/client/views/ProjectDetail.tsx'
import { resetUpdateHintCache } from '../src/client/views/UpdateHint.tsx'

const t: Translate = (key, vars) =>
  key === 'update.tip' ? `发现新版本 v${String(vars?.version ?? '')}` : '新版本'

const AVAILABLE: VersionPayload = {
  current: '0.1.2',
  latest: '0.9.9',
  updateAvailable: true,
  installSource: 'registry',
}

const PROJECT: ProjectEntry = {
  id: 'w1',
  title: 'Demo',
  path: '/tmp/demo',
  exists: true,
  root: '/tmp/demo',
  skillCount: 0,
  archivedCount: 0,
  approxTokens: 0,
  preview: [],
}

/** 数据请求一律失败：页面会落到错误态，但页头必须照常渲染。 */
function makeApi(): ContextOptimizeApi {
  const reject = (): Promise<never> => Promise.reject(new Error('unavailable'))
  return {
    overview: reject,
    skills: reject,
    projects: reject,
    archive: reject,
    restore: reject,
    version: async () => AVAILABLE,
    openPluginPage: () => true,
    canOpenPath: async () => false,
    openPath: async () => false,
    copyPath: async () => false,
  } as unknown as ContextOptimizeApi
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

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe('新版本入口的挂载位置', () => {
  it('全局列表页头出现', async () => {
    await act(async () => {
      root.render(<Panel t={t} api={makeApi()} />)
    })
    await flush()
    expect(container.querySelector('.dscx-update')).not.toBeNull()
  })

  it('项目看板页头出现', async () => {
    const noop = (): void => undefined
    await act(async () => {
      root.render(
        <ProjectsView
          t={t}
          api={makeApi()}
          payload={{ projects: [], total: 0, missing: 0 }}
          loading={false}
          error={null}
          canOpen={false}
          view="projects"
          onSelectView={noop}
          onRetry={noop}
          onOpenProject={noop}
          onOpenPath={noop}
        />,
      )
    })
    await flush()
    expect(container.querySelector('.dscx-update')).not.toBeNull()
  })

  it('项目详情页头出现', async () => {
    const noop = (): void => undefined
    await act(async () => {
      root.render(
        <ProjectDetail
          t={t}
          api={makeApi()}
          project={PROJECT}
          entries={[]}
          filter="all"
          sortBy="calls"
          counts={{ active: 0, never: 0, neverTokens: 0, archived: 0 }}
          totals={{ count: 0, tokens: 0, calls: 0 }}
          loading={false}
          error={null}
          canOpen={false}
          pendingKey={null}
          view="projects"
          callsTip=""
          onSelectView={noop}
          onBack={noop}
          onRetry={noop}
          onOpenPath={noop}
          onFilter={noop}
          onToggleSort={noop}
          onArchive={noop}
          onRestore={noop}
          onOpenDir={noop}
        />,
      )
    })
    await flush()
    expect(container.querySelector('.dscx-update')).not.toBeNull()
  })
})
