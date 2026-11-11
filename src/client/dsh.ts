/**
 * 客户端半用到的 DSH 服务的最小结构声明。
 *
 * 照 dsh-output 的路子：只声明真正调用的方法，不把 DSH 的类型包拉成依赖。
 * 每个方法标了来源包，升级 DSH 后按图核对即可：
 *   - locale / slots：client 基础服务；
 *   - layout：`@deepseek-ai/dsh-client-ui-layout`（本插件只用它的槽位体系，不直接调 API）；
 *   - remote.session：`@deepseek-ai/dsh-api-session-controller`（经 typert Remote 包装）。
 */

export type Translate = (key: string, vars?: Record<string, string | number>) => string

/** 中央面板 id 的品牌类型：DSH 的 `MainPanelId` 不对外导出，这里只做编译期标记，防止与侧边栏 id 写岔。 */
declare const mainPanelIdBrand: unique symbol
export type MainPanelId = string & { readonly [mainPanelIdBrand]: true }

export interface LocaleService {
  register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(namespace: string): Translate
}

export interface SlotsRegisterDefinition {
  name: string
  /** keyed 槽位（`main`）的身份；侧边栏入口用 id。 */
  key?: string
  id?: string
  order?: number
  locale?: string
  label?: () => string
  inject?: () => Record<string, unknown>
}

export interface SlotsService {
  inject(name: string, factory: () => unknown): unknown
  register(definition: SlotsRegisterDefinition, component: (props: any) => unknown): unknown
}

/** typert Remote 的返回包装：`{ ok: true, value }` / `{ ok: false, error }`。 */
export interface RemoteResult<T> {
  ok: boolean
  value?: T
  error?: unknown
}

export interface RemoteSessionService {
  /**
   * 在系统默认应用里打开目录（macOS 落到 Finder）。
   *
   * 注意：DSH 的 typert schema 里 `action` 只接受 `'reveal'`，省略才是「默认应用打开」。
   * 传 `'open'` 会被 strictObject 校验拒绝，所以这里按官方 open-in-app 的写法留 action 为空。
   */
  openWorkspacePath(request: { path: string; action?: 'reveal' }): Promise<RemoteResult<unknown>>
  /** 宿主是否具备桌面打开能力；纯网页部署返回 false。 */
  canOpenWorkspacePath(): Promise<RemoteResult<boolean>>
}

export interface RemoteService {
  session: RemoteSessionService
}

export interface ClientContext {
  locale: LocaleService
  slots: SlotsService
  remote?: RemoteService
  effect(factory: () => (() => void) | void, label?: string): () => void
  inject(services: string[], callback: (scope: ClientContext) => void): void
}
