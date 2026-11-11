/**
 * 客户端（浏览器半）入口：侧边栏「Skill 管理」图标 + 中央面板。
 *
 * 接线照 DSH 内置「插件」「自动化任务」的同一套槽位：
 *   - `sidebar.panellist`（list 槽位）：`order: 20`，排在插件(0)、自动化任务(10)之后；
 *   - `main`（keyed 槽位）：`key` 必须等于侧边栏入口的 `id`，点击侧边栏才切得过来。
 *
 * 用 `ctx.inject` 拿槽位与远程能力：宿主缺任一服务时整块静默跳过，不留死入口。
 * 文案、样式、面板主体都在各自的文件里，这里只做装配。
 */
import type { ClientContext, MainPanelId } from './dsh.ts'
import { createContextOptimizeApi } from './api.ts'
import { SidebarPanelIcon } from './icons.tsx'
import { NS, en, zh } from './locales.ts'
import { PANEL_CSS } from './styles.ts'
import { Panel } from './views/Panel.tsx'

/** 中央面板 id，同时是侧边栏入口 id 与 main 槽位 key，三者必须一致。 */
export const PANEL_ID = 'context-optimize' as MainPanelId

/** 必需服务：缺任何一个就不注册入口（面板本身依赖槽位与文案）。 */
export const inject = ['slots', 'locale', 'layout', 'remote', 'remote.session']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-context-optimize: dictionaries')

  if (typeof document !== 'undefined') {
    const style = document.createElement('style')
    style.setAttribute('data-plugin', '@kulebbb/dsh-context-optimize')
    style.setAttribute('data-plugin-css', '@kulebbb/dsh-context-optimize/panel.css')
    style.textContent = PANEL_CSS
    document.head.append(style)
    ctx.effect(() => () => style.remove(), 'dsh-context-optimize: styles')
  }

  ctx.inject(inject, (scope) => {
    const t = scope.locale.bind(NS)
    const api = createContextOptimizeApi(scope)

    scope.effect(() => {
      scope.slots.inject('sidebar.panellist', () =>
        scope.slots.register(
          {
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 20,
            locale: NS,
            label: () => t('panel'),
          },
          SidebarPanelIcon,
        ),
      )
    }, 'dsh-context-optimize: sidebar entry')

    scope.effect(() => {
      scope.slots.inject('main', () =>
        scope.slots.register(
          {
            name: 'main',
            key: PANEL_ID,
            locale: NS,
            inject: () => ({ api }),
          },
          Panel,
        ),
      )
    }, 'dsh-context-optimize: main panel')
  })
}
