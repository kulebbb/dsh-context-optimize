/** 会话事件的最小结构；v0/v3/v4 日志与实时推送共用。 */
interface SessionEventLike {
  type?: string;
  seq?: number;
  time?: number;
  data?: unknown;
}
/** Cordis 函数插件名。 */
declare const name = "@kulebbb/dsh-context-optimize";
/** 只有路由载体是硬依赖；其余服务用 scoped inject 可选接入。 */
declare const inject: string[];
interface ConnectionRoute {
  path: string;
  methods: string[];
  requestBody: 'buffered';
  fetch: (request: Request) => Promise<Response>;
}
interface HostContext {
  connection: {
    fetch: {
      register(route: ConnectionRoute): () => void;
    };
  };
  logger?: {
    warn?(...args: unknown[]): void;
    debug?(...args: unknown[]): void;
  };
  effect(factory: () => (() => void) | void, label?: string): () => void;
  inject(services: string[], callback: (scope: Record<string, unknown>) => void): void;
  on(event: 'session/event', listener: (session: {
    id?: unknown;
    cwd?: unknown;
  }, event: SessionEventLike) => void): () => void;
}
/**
 * 注册插件。
 * @param ctx - 宿主上下文。
 */
declare function apply(ctx: HostContext): void;
export { apply, inject, name };