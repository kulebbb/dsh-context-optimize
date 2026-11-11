window.__ModuleLoader__.load({
	id: "@kulebbb/dsh-context-optimize",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		// src/shared/types.ts
		/**
		* dsh-context-optimize 的跨半边契约：宿主算出来的数据、客户端面板消费的载荷。
		*
		* 这里只放类型与纯常量，不 import 任何 node 内置模块，客户端 bundle 也能安全引用。
		*/
		/** 路由前缀；五个端点都是 `${ROUTE_PREFIX}.<action>` 的形式。 */
		const ROUTE_PREFIX = "/api/context-optimize";
		/** 面板会用到的全部端点（相对路径，客户端直接 fetch）。 */
		const ROUTES = {
			overview: `${ROUTE_PREFIX}.overview`,
			skills: `${ROUTE_PREFIX}.skills`,
			projects: `${ROUTE_PREFIX}.projects`,
			archive: `${ROUTE_PREFIX}.archive`,
			restore: `${ROUTE_PREFIX}.restore`
		};
		// src/client/api.ts
		/** 客户端请求超时：超过这个时间给可重试错误，而不是一直转圈。 */
		const FETCH_TIMEOUT_MS = 3e4;
		var OptimizeRequestError = class extends Error {
			code;
			status;
			constructor(message, code, status) {
				super(message);
				this.name = "OptimizeRequestError";
				this.code = code;
				this.status = status;
			}
		};
		function isErrorPayload(value) {
			if (typeof value !== "object" || value === null) return false;
			const error = value.error;
			if (typeof error !== "object" || error === null) return false;
			return typeof error.code === "string";
		}
		/** 带超时地发一次请求并解析 JSON；调用方 abort 时不误报超时。 */
		async function request(path, init, signal) {
			const timeout = new AbortController();
			const timer = setTimeout(() => timeout.abort(), FETCH_TIMEOUT_MS);
			const merged = signal === void 0 ? timeout.signal : AbortSignal.any([signal, timeout.signal]);
			let response;
			try {
				response = await fetch(path, {
					...init,
					signal: merged,
					credentials: "same-origin",
					headers: {
						accept: "application/json",
						...init.headers
					}
				});
			} catch (error) {
				if (signal?.aborted) throw error;
				if (timeout.signal.aborted) throw new OptimizeRequestError("Request timed out.", "timeout", 0);
				throw new OptimizeRequestError(error instanceof Error ? error.message : "network error", "network", 0);
			} finally {
				clearTimeout(timer);
			}
			const body = await response.json().catch(() => null);
			if (!response.ok) {
				if (isErrorPayload(body)) throw new OptimizeRequestError(body.error.message, body.error.code, response.status);
				throw new OptimizeRequestError(`request failed (${String(response.status)})`, "internal", response.status);
			}
			if (body === null) throw new OptimizeRequestError("empty response body", "internal", response.status);
			return body;
		}
		/** 拼 skills 查询串；项目范围才带 workspaceId。 */
		function skillsQuery(query) {
			const params = new URLSearchParams({
				scope: query.scope,
				state: query.state
			});
			if (query.workspaceId !== void 0) params.set("workspaceId", query.workspaceId);
			return params.toString();
		}
		/**
		* 为一个客户端上下文创建 api。`remote` 在纯网页宿主里可能不存在，
		* 所有打开类方法都退化成 false，由界面隐藏按钮。
		*/
		function createContextOptimizeApi(ctx) {
			const remoteSession = () => ctx.remote?.session;
			return {
				overview(signal) {
					return request(ROUTES.overview, { method: "GET" }, signal);
				},
				skills(query, signal) {
					return request(`${ROUTES.skills}?${skillsQuery(query)}`, { method: "GET" }, signal);
				},
				projects(signal) {
					return request(ROUTES.projects, { method: "GET" }, signal);
				},
				archive(body) {
					return request(ROUTES.archive, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					}, void 0);
				},
				restore(body) {
					return request(ROUTES.restore, {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify(body)
					}, void 0);
				},
				async canOpenPath() {
					const session = remoteSession();
					if (!session) return false;
					try {
						const result = await session.canOpenWorkspacePath();
						return result?.ok === true && result.value === true;
					} catch {
						return false;
					}
				},
				async openPath(path) {
					const session = remoteSession();
					if (!session) return false;
					try {
						return (await session.openWorkspacePath({ path }))?.ok === true;
					} catch {
						return false;
					}
				},
				async copyPath(path) {
					try {
						await navigator.clipboard.writeText(path);
						return true;
					} catch {
						return false;
					}
				}
			};
		}
		// src/client/icons.tsx
		/**
		* 侧边栏入口图标 + 行内小图标。
		*
		* 全部 `stroke="currentColor"`、`fill="none"`，颜色由使用处的 token 决定，
		* 不在这里写死色值。路径取自定稿原型。
		*/
		/** 侧边栏入口：DSH 会传 `size`（收起 16 / 展开 18）与 `active`。 */
		function SidebarPanelIcon(props) {
			const size = props.size ?? 16;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M8 2.2 13.6 5 8 7.8 2.4 5 8 2.2Z" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.4 8 8 10.8 13.6 8" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2.4 11 8 13.8l5.6-2.8" })
				]
			});
		}
		function FolderIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "15",
				height: "15",
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M2 4.6A1.4 1.4 0 0 1 3.4 3.2h2.4l1.3 1.5h4.5A1.4 1.4 0 0 1 13 6.1v5.5a1.4 1.4 0 0 1-1.4 1.4H3.4A1.4 1.4 0 0 1 2 11.6V4.6Z" })
			});
		}
		function ArchiveIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "15",
				height: "15",
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("rect", {
						x: "2.2",
						y: "2.8",
						width: "11.6",
						height: "3",
						rx: "1"
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.4 5.8v6a1.2 1.2 0 0 0 1.2 1.2h6.8a1.2 1.2 0 0 0 1.2-1.2v-6" }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M6.4 8.6h3.2" })
				]
			});
		}
		function RestoreIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("svg", {
				width: "15",
				height: "15",
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.4",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3.2 8a4.8 4.8 0 1 0 1.5-3.5" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M3 2.6v3.2h3.2" })]
			});
		}
		function ChevronLeftIcon() {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "13",
				height: "13",
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: "1.5",
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", { d: "M9.5 3.5 5 8l4.5 4.5" })
			});
		}
		// src/client/locales.ts
		/**
		* 面板文案（locale 命名空间 `dshContextOptimize`）。
		*
		* `index.tsx` 在 apply 里 `ctx.locale.register(NS, { zh, en })`；
		* 槽位的 `locale: NS` 让宿主把 `t` 注入组件 props。
		* key 是扁平字符串，`{name}` 由 t 的第二个参数插值。
		*/
		/** locale 命名空间，与 `ctx.locale.register(NS, ...)`、槽位 `locale` 保持一致。 */
		const NS = "dshContextOptimize";
		/** 简体中文字典；也是 key 集合的单一真相源。 */
		const zh = {
			panel: "Skill 管理",
			"state.loading": "正在读取…",
			"error.title": "服务未就绪",
			"error.desc": "没有读到数据。可能是宿主半尚未启动，或路由未注册。",
			"error.retry": "重试",
			"error.skillsTitle": "读取 skill 列表失败",
			"error.projectsTitle": "读取工作区失败",
			"error.readonlyRoot": "内置 skill 只读，不能归档",
			"error.targetExists": "目标位置已有同名条目",
			"error.notFound": "目录不存在，可能已经被移动",
			"error.invalidRequest": "请求参数不合法",
			"error.timeout": "请求超时，宿主没有响应",
			"error.network": "连不上宿主，请稍后重试",
			"error.internal": "操作失败，请重试",
			"backfill.label": "正在回溯历史调用",
			"backfill.count": "{done} / {total}",
			"sort.byCalls": "排序：按调用次数",
			"sort.byTokens": "排序：按占用",
			"seg.global": "全局",
			"seg.projects": "项目",
			"filter.all": "生效中",
			"filter.never": "从未被调用",
			"filter.archived": "已归档",
			"filter.neverSummary": "{count} 个从未被调用 · 合计 {tokens}t",
			"budget.tokensUnit": "tokens",
			"budget.fixedCost": "每次会话固定开销 · {count} 个 skill",
			"budget.archivedSaving": "已归档 {count} · 省 {tokens}t",
			"budget.legendRest": "其余 {count} 个 · {tokens}t",
			"budget.activeSkills": "生效中 skill",
			"budget.historyCalls": "历史调用",
			"budget.calls30d": "近 30 天调用",
			"budget.archivedCount": "已归档",
			"table.skill": "SKILL",
			"table.archivedSkill": "已归档的 SKILL",
			"table.source": "来源",
			"table.calls": "调用",
			"table.lastUsed": "最近使用",
			"table.tokens": "占用",
			"table.archivedAt": "归档时间",
			"table.emptyAll": "还没有扫到生效中的 skill",
			"table.emptyNever": "没有从未被调用过的 skill",
			"table.emptyArchived": "还没有归档过 skill",
			"table.noDescription": "—",
			"tip.source": "从哪个目录读到的。同名 skill 的优先级：项目 .dsh > 项目 .agents > 用户 .dsh > 用户 .agents > 内置只读。",
			"tip.calls": "统计范围：本机全部 {sessions} 个会话（{from} → {to}）。计的是模型加载该 skill 的次数，你在对话里用 /skill名 直接触发的也计入。",
			"tip.callsPlain": "统计范围：本机全部会话。计的是模型加载该 skill 的次数，你在对话里用 /skill名 直接触发的也计入。",
			"tip.callsProject": "统计范围：本项目目录下发生过的会话（全部历史）。计的是模型加载该 skill 的次数，你在对话里用 /skill名 直接触发的也计入。",
			"tip.last": "这条 skill 最后一次被加载的时间。按自然日显示：今天 / 昨天 / N 天前 / N 个月前。从未调用过的一律显示「从未」。",
			"tip.tokens": "该 skill 在会话目录里占的文本量：名字 + 描述，按 3.5 个字符约等于 1 token 估算。",
			"tip.archivedAt": "这条 skill 被移出 skills 目录、进入 skill-archive 的时间。点行尾的还原按钮可以放回原位置。",
			"tip.symlink": "这是指向别处的软链，归档只移动链接本身，不会影响目标文件。",
			"row.symlink": "软链",
			"note.removed": "另有 {count} 个已移除，仅保留历史调用记录",
			"source.user-agents": "用户",
			"source.user-dsh": "用户·dsh",
			"source.project-agents": "项目",
			"source.project-dsh": "项目·dsh",
			"source.bundled": "内置",
			"action.openDir": "在 Finder 中打开该 skill 目录",
			"action.archive": "归档（移到 skill-archive）",
			"action.archiveBlocked": "内置 skill 只读，不能归档",
			"action.restore": "还原到 skills 目录",
			"action.openProject": "在 Finder 中打开项目目录",
			"action.openProjectLabel": "打开项目目录",
			"projects.title": "项目",
			"projects.subtitle": "{total} 个工作区 · {withSkills} 个有项目级 skill",
			"projects.colWorkspace": "有项目级 skill 的工作区",
			"projects.colSkills": "项目级 skill",
			"projects.archivedOnly": "已归档 {count} 个",
			"projects.empty": "还没有项目放置了项目级 skill",
			"projects.viewSkills": "查看 skill →",
			"projects.noSkills": "无项目级 skill",
			"projects.rest": "其余 {count} 个工作区无项目级 skill",
			"projects.restExpanded": "已展开其余 {count} 个工作区",
			"projects.expand": "展开",
			"projects.collapse": "收起",
			"projects.missing": "路径失效",
			"projects.moreSkills": "+{count}",
			"detail.crumb": "项目",
			"detail.skillCountSuffix": " 个项目级 skill",
			"detail.tokensUnit": " tokens",
			"detail.callsSuffix": " 次调用",
			"detail.missing": "路径失效",
			"toast.archived": "已归档 {name}",
			"toast.restored": "已还原 {name}",
			"toast.undo": "撤销",
			"toast.openFailedCopied": "无法在 Finder 中打开，路径已复制",
			"toast.openFailed": "无法在 Finder 中打开这个目录"
		};
		/** English dictionary, checked against the Chinese key set. */
		const en = {
			panel: "Skill manager",
			"state.loading": "Loading…",
			"error.title": "Service not ready",
			"error.desc": "No data was returned. The host half may not be running, or its routes are not registered.",
			"error.retry": "Retry",
			"error.skillsTitle": "Could not read the skill list",
			"error.projectsTitle": "Could not read workspaces",
			"error.readonlyRoot": "Bundled skills are read-only and cannot be archived",
			"error.targetExists": "An entry with this name already exists at the target",
			"error.notFound": "The directory no longer exists — it may have been moved",
			"error.invalidRequest": "Invalid request",
			"error.timeout": "The host did not respond in time",
			"error.network": "Cannot reach the host — try again later",
			"error.internal": "The operation failed — try again",
			"backfill.label": "Backfilling call history",
			"backfill.count": "{done} / {total}",
			"sort.byCalls": "Sort: by calls",
			"sort.byTokens": "Sort: by tokens",
			"seg.global": "Global",
			"seg.projects": "Projects",
			"filter.all": "Active",
			"filter.never": "Never called",
			"filter.archived": "Archived",
			"filter.neverSummary": "{count} never called · {tokens}t in total",
			"budget.tokensUnit": "tokens",
			"budget.fixedCost": "Fixed cost per session · {count} skills",
			"budget.archivedSaving": "Archived {count} · saved {tokens}t",
			"budget.legendRest": "Other {count} · {tokens}t",
			"budget.activeSkills": "active skills",
			"budget.historyCalls": "calls all time",
			"budget.calls30d": "calls in 30 days",
			"budget.archivedCount": "archived",
			"table.skill": "SKILL",
			"table.archivedSkill": "ARCHIVED SKILL",
			"table.source": "Source",
			"table.calls": "Calls",
			"table.lastUsed": "Last used",
			"table.tokens": "Size",
			"table.archivedAt": "Archived at",
			"table.emptyAll": "No active skills found yet",
			"table.emptyNever": "No skill was never called",
			"table.emptyArchived": "Nothing archived yet",
			"table.noDescription": "—",
			"tip.source": "The directory this skill came from. Precedence for duplicate names: project .dsh > project .agents > user .dsh > user .agents > bundled read-only.",
			"tip.calls": "Scope: all {sessions} sessions on this machine ({from} → {to}). Counts how often the model loaded this skill, including direct /skill-name invocations in the conversation.",
			"tip.callsProject": "Scope: sessions that ran under this project’s directory (all history). Counts how often the model loaded this skill, including direct /skill-name invocations.",
			"tip.callsPlain": "Scope: all sessions on this machine. Counts how often the model loaded this skill, including direct /skill-name invocations in the conversation.",
			"tip.last": "When this skill was last loaded. Shown by calendar day: today / yesterday / N days / N months ago. Skills never called always show “never”.",
			"tip.tokens": "Text this skill occupies in the session catalog: name + description, estimated at 3.5 characters per token.",
			"tip.archivedAt": "When this skill was moved out of skills into skill-archive. Use the restore button at the end of the row to put it back.",
			"tip.symlink": "This is a symlink to another location. Archiving moves only the link itself and leaves the target file untouched.",
			"row.symlink": "Symlink",
			"note.removed": "Another {count} were removed — only their call history is kept",
			"source.user-agents": "User",
			"source.user-dsh": "User·dsh",
			"source.project-agents": "Project",
			"source.project-dsh": "Project·dsh",
			"source.bundled": "Bundled",
			"action.openDir": "Open this skill folder in Finder",
			"action.archive": "Archive (move to skill-archive)",
			"action.archiveBlocked": "Bundled skill is read-only and cannot be archived",
			"action.restore": "Restore to the skills directory",
			"action.openProject": "Open the project folder in Finder",
			"action.openProjectLabel": "Open project folder",
			"projects.title": "Projects",
			"projects.subtitle": "{total} workspaces · {withSkills} with project-level skills",
			"projects.colWorkspace": "Workspaces with project-level skills",
			"projects.colSkills": "Project-level skills",
			"projects.archivedOnly": "{count} archived",
			"projects.empty": "No project has added project-level skills yet",
			"projects.viewSkills": "View skills →",
			"projects.noSkills": "No project-level skills",
			"projects.rest": "The other {count} workspaces have no project-level skills",
			"projects.restExpanded": "Showing the other {count} workspaces",
			"projects.expand": "Expand",
			"projects.collapse": "Collapse",
			"projects.missing": "Path missing",
			"projects.moreSkills": "+{count}",
			"detail.crumb": "Projects",
			"detail.skillCountSuffix": " project-level skills",
			"detail.tokensUnit": " tokens",
			"detail.callsSuffix": " calls",
			"detail.missing": "Path missing",
			"toast.archived": "Archived {name}",
			"toast.restored": "Restored {name}",
			"toast.undo": "Undo",
			"toast.openFailedCopied": "Could not open Finder — path copied instead",
			"toast.openFailed": "Could not open this folder in Finder"
		};
		// src/client/styles.ts
		/**
		* 「Skill 管理」中央面板的样式（一整段 CSS 字符串）。
		*
		* 约定：
		* - 颜色 / 圆角 / 字号 / 阴影只用 DSH token（`--dsw-alias-*`、`--dsw-radius-*`、`--dsw-font-*`），
		*   深浅主题由宿主切换，这里不写 hex、不写 `[data-theme]`。
		* - 全部选择器带 `dscx-` 前缀，避免和 DSH 本体 / 其它插件撞名。
		* - 尺寸、间距、对齐规则照定稿原型 `prototype/index.template.html` 逐条搬。
		* - 表格不裁切 tooltip：圆角落在表头和最后一行上，容器本身不设 overflow:hidden。
		*/
		const PANEL_CSS = `
/* ---------- 根容器与页面 ---------- */
.dscx-root{flex:1;min-height:0;overflow:auto;background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-primary);font:var(--dsw-font-s-14)}
.dscx-root *{box-sizing:border-box}
/* reset 用 :where() 降到零特异性，单类按钮规则才能盖住它 */
:where(.dscx-root) button{font-family:inherit;font-size:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
:where(.dscx-root) button:disabled{cursor:not-allowed}
.dscx-root svg{display:block;flex:none}
.dscx-page{max-width:1000px;margin:0 auto;display:flex;flex-direction:column;gap:22px;
  padding:calc(28px + var(--dsh-frame-top-clearance,0px)) clamp(20px,4vw,40px) 80px}

/* ---------- 页头 ---------- */
.dscx-ph{display:flex;align-items:flex-start;gap:16px}
.dscx-ph-title{display:flex;flex-direction:column;gap:5px;min-width:0}
.dscx-h1{margin:0;font:var(--dsw-font-l-20);color:var(--dsw-alias-label-primary)}
.dscx-sub{margin:0;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-tertiary)}
.dscx-ph-acts{margin-left:auto;display:flex;gap:8px;flex:none}

/* ---------- 按钮 ---------- */
.dscx-btn{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;
  border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);
  background:transparent;color:var(--dsw-alias-label-primary);font:var(--dsw-font-xs-13);white-space:nowrap}
.dscx-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dscx-btn-sm{height:28px;padding:0 10px;font:var(--dsw-font-xxs-12)}
.dscx-btn:disabled{opacity:.4;cursor:not-allowed}
.dscx-btn:disabled:hover{background:transparent}

/* ---------- 回溯进度条 ---------- */
.dscx-progress{display:flex;flex-direction:column;gap:8px;padding:12px 16px;flex:none;
  border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);
  background:var(--dsw-alias-bg-layer-1)}
.dscx-progress-row{display:flex;align-items:baseline;gap:10px}
.dscx-progress-label{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dscx-progress-count{margin-left:auto;font:var(--dsw-font-xxs-12);
  font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-caption);font-variant-numeric:tabular-nums}
.dscx-progress-track{height:6px;border-radius:999px;overflow:hidden;background:var(--dsw-alias-bg-module-platform)}
.dscx-progress-fill{display:block;height:100%;border-radius:999px;
  background:var(--dsw-alias-state-business-primary);transition:width var(--ds-transition-duration) var(--ds-ease-in-out)}

/* ---------- 预算卡：大数字 + 堆叠色带 + 四个计数 ---------- */
.dscx-budget{display:flex;flex-direction:column;gap:12px;padding:18px 20px;flex:none;
  border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);
  background:var(--dsw-alias-bg-layer-1)}
.dscx-b-top{display:flex;align-items:flex-end;gap:14px;flex-wrap:wrap}
.dscx-big{font:var(--dsw-font-xl-24);color:var(--dsw-alias-label-primary);
  font-variant-numeric:tabular-nums;letter-spacing:-.02em}
.dscx-big small{font:var(--dsw-font-xxs-12);font-weight:400;color:var(--dsw-alias-label-caption);
  margin-left:4px;letter-spacing:0}
.dscx-cap{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);padding-bottom:3px}
.dscx-saved{margin-left:auto;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-state-success-primary);
  white-space:nowrap;padding-bottom:3px}
.dscx-stack{display:flex;height:20px;border-radius:var(--dsw-radius-sm);overflow:hidden;
  background:var(--dsw-alias-bg-module-platform)}
.dscx-stack i{display:block;height:100%}
.dscx-legend{display:flex;flex-wrap:wrap;gap:5px 13px}
.dscx-legend span{display:inline-flex;align-items:center;gap:5px;
  font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-tertiary)}
.dscx-legend i{width:7px;height:7px;border-radius:2px;display:inline-block;flex:none}
.dscx-b-counts{display:flex;gap:0;border-top:1px solid var(--dsw-alias-border-l1);
  padding-top:11px;margin-top:1px}
.dscx-b-counts span{flex:1;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-caption);
  display:flex;align-items:baseline;gap:6px}
.dscx-b-counts b{font:var(--dsw-font-l-20);font-weight:600;color:var(--dsw-alias-label-primary);
  font-variant-numeric:tabular-nums}

/* 色带色板：只用 DSH 调色板 token，深浅主题各自取色 */
.dscx-band-1{background:var(--dsw-alias-state-business-primary)}
.dscx-band-2{background:var(--dsw-alias-state-success-primary)}
.dscx-band-3{background:var(--dsw-alias-state-warn-primary)}
.dscx-band-4{background:var(--dsw-static-violet-400)}
.dscx-band-5{background:var(--dsw-static-blue-500)}
.dscx-band-6{background:var(--dsw-alias-state-error-primary)}
.dscx-band-7{background:var(--dsw-static-neutral-bluish-400)}
.dscx-band-rest{background:color-mix(in srgb,var(--dsw-alias-label-primary) 13%,transparent)}

/* ---------- 分段控件（全局 / 项目）+ 状态筛选 ---------- */
.dscx-segrow{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.dscx-seg{display:inline-flex;gap:2px;padding:3px;background:var(--dsw-alias-bg-module-platform);
  border-radius:var(--dsw-radius-md);align-self:flex-start}
.dscx-seg button{border:0;background:transparent;color:var(--dsw-alias-label-tertiary);
  font:var(--dsw-font-xs-13);padding:5px 12px;border-radius:var(--dsw-radius-sm);
  display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.dscx-seg button:hover{color:var(--dsw-alias-label-primary)}
.dscx-seg button[aria-pressed="true"]{background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,var(--dsw-alias-bg-module-platform));
  color:var(--dsw-alias-label-primary);font-weight:500}

.dscx-chips{display:flex;align-items:center;gap:6px;padding-left:12px;
  border-left:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap}
/* 排序按钮贴着筛选行右端：项目详情头部已经有「打开项目目录」，放头部会挤压路径行 */
.dscx-sort{margin-left:auto}
.dscx-chip{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 12px;
  border-radius:var(--dsw-radius-sm);border:1px solid var(--dsw-alias-border-l2);
  background:transparent;color:var(--dsw-alias-label-secondary);font:var(--dsw-font-xxs-12);
  white-space:nowrap}
.dscx-chip:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dscx-chip[aria-pressed="true"]{background:var(--dsw-alias-interactive-bg-hover-solid);
  border-color:transparent;color:var(--dsw-alias-label-primary);font-weight:500}
.dscx-chip[aria-pressed="true"]:hover{background:var(--dsw-alias-interactive-bg-hover-solid)}
.dscx-chip-n{font:var(--dsw-font-xxxs-11);font-family:var(--ds-font-family-code);opacity:.8}
.dscx-chip[aria-pressed="true"] .dscx-chip-n{opacity:.6}
.dscx-fbar{display:flex;align-items:center;gap:10px;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-label-caption)}

/* ---------- 表格 ---------- */
.dscx-tbl{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);
  background:var(--dsw-alias-bg-layer-1)}
.dscx-thead,.dscx-tr{display:grid;align-items:center;gap:14px;padding:0 16px}
.dscx-thead{height:36px;font:var(--dsw-font-xxxs-11);color:var(--dsw-alias-label-caption);
  letter-spacing:.03em;border-bottom:1px solid var(--dsw-alias-border-l1);
  border-radius:var(--dsw-radius-md) var(--dsw-radius-md) 0 0}
.dscx-tr{min-height:58px;padding-top:9px;padding-bottom:9px;
  border-bottom:1px solid var(--dsw-alias-border-l1)}
.dscx-tr:last-child{border-bottom:0;border-radius:0 0 var(--dsw-radius-md) var(--dsw-radius-md)}
.dscx-tr:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dscx-tr.dscx-clickable{cursor:pointer}
.dscx-rh{display:flex;justify-content:flex-end}
.dscx-empty{padding:34px 16px;text-align:center;color:var(--dsw-alias-label-caption);
  font:var(--dsw-font-xs-13)}

/* 名称 + 描述 */
.dscx-c-name{min-width:0;display:flex;flex-direction:column;gap:2px}
.dscx-c-name .t{display:flex;align-items:center;gap:7px;min-width:0}
.dscx-c-name .t b{font:var(--dsw-font-xs-13);font-weight:500;color:var(--dsw-alias-label-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dscx-c-name .d{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

/* 数字列统一右对齐：等宽 + tabular-nums，个位数也对齐到同一右边界 */
.dscx-num-r{text-align:right;font:var(--dsw-font-xs-13);font-family:var(--ds-font-family-code);
  color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dscx-num-r.dscx-zero{color:var(--dsw-alias-label-caption)}
.dscx-ago-r{text-align:right;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption);
  white-space:nowrap;font-variant-numeric:tabular-nums}
.dscx-ago-r.dscx-zero{color:var(--dsw-alias-label-caption)}
.dscx-time-r{text-align:right;font:var(--dsw-font-xxs-12);font-family:var(--ds-font-family-code);
  color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}

/* 行尾操作 */
.dscx-ops{display:flex;gap:2px;justify-content:flex-end}
.dscx-iconbtn{width:28px;height:28px;display:inline-flex;align-items:center;justify-content:center;
  border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);padding:0}
.dscx-iconbtn:hover{background:var(--dsw-alias-interactive-bg-hover-solid);color:var(--dsw-alias-label-primary)}
.dscx-iconbtn:disabled{opacity:.28;cursor:not-allowed}
.dscx-iconbtn:disabled:hover{background:transparent;color:var(--dsw-alias-label-tertiary)}

/* ---------- 来源标签 ---------- */
.dscx-tag{display:inline-flex;align-items:center;flex:none;height:18px;padding:0 6px;
  border-radius:var(--dsw-radius-xs);font:var(--dsw-font-xxxs-11);letter-spacing:.02em;
  white-space:nowrap;background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-label-tertiary)}
.dscx-tag-blue{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 16%,transparent);
  color:var(--dsw-alias-state-business-primary)}
.dscx-tag-green{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);
  color:var(--dsw-alias-state-success-primary)}
.dscx-tag-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);
  color:var(--dsw-alias-state-warn-primary)}
.dscx-tag-dim{background:transparent;border:1px dashed var(--dsw-alias-border-l3);
  color:var(--dsw-alias-label-caption)}

/* ---------- 表头 tooltip ---------- */
.dscx-hint{position:relative;display:inline-flex;align-items:center;gap:4px;cursor:help}
.dscx-hint .q{width:13px;height:13px;border-radius:50%;border:1px solid var(--dsw-alias-border-l3);
  color:var(--dsw-alias-label-caption);font-size:9px;line-height:1;display:inline-flex;
  align-items:center;justify-content:center;flex:none}
.dscx-hint:hover .q{border-color:var(--dsw-alias-label-tertiary);color:var(--dsw-alias-label-tertiary)}
.dscx-hint:hover .lb{color:var(--dsw-alias-label-tertiary)}
.dscx-tip{position:absolute;left:50%;top:calc(100% + 9px);transform:translateX(-50%);
  width:290px;max-width:70vw;padding:10px 12px;border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);
  font:var(--dsw-font-xxs-12);text-align:left;letter-spacing:0;box-shadow:var(--dsw-shadow-lv3);
  opacity:0;pointer-events:none;transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out);
  z-index:30}
.dscx-tip::after{content:"";position:absolute;left:50%;top:-4px;transform:translateX(-50%) rotate(45deg);
  width:8px;height:8px;background:var(--dsw-alias-bg-layer-3);border-radius:2px}
.dscx-hint:hover .dscx-tip{opacity:1}
.dscx-hint[data-align="right"] .dscx-tip{left:auto;right:-8px;transform:none}
.dscx-hint[data-align="right"] .dscx-tip::after{left:auto;right:22px;transform:rotate(45deg)}

/* ---------- 项目看板 / 行 ---------- */
.dscx-ps{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.dscx-prow-actions{display:flex;justify-content:flex-end;align-items:center;gap:8px}
.dscx-ps-tokens{font:var(--dsw-font-xxs-12);font-family:var(--ds-font-family-code);
  color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dscx-prow-go{display:inline-flex;align-items:center;gap:4px;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-label-caption);white-space:nowrap}
.dscx-tr.dscx-clickable:hover .dscx-prow-go{color:var(--dsw-alias-label-secondary)}
.dscx-restline{display:flex;align-items:center;gap:10px;padding:12px 16px;width:100%;
  border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md);
  color:var(--dsw-alias-label-caption);font:var(--dsw-font-xxs-12);text-align:left;cursor:pointer}
.dscx-restline:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-tertiary)}
.dscx-restline.dscx-on{border-style:solid;border-color:var(--dsw-alias-border-l1);
  color:var(--dsw-alias-label-secondary)}
.dscx-restline .rn{margin-left:auto;font:var(--dsw-font-xxs-12)}

/* ---------- 项目详情 ---------- */
.dscx-crumb{display:flex;align-items:center;gap:7px;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-label-caption);margin-bottom:-8px}
.dscx-crumb button{border:0;background:transparent;color:var(--dsw-alias-label-secondary);
  font:var(--dsw-font-xxs-12);padding:4px 8px;border-radius:var(--dsw-radius-xs);
  display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
.dscx-crumb button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dscx-crumb .sep{opacity:.5}
.dscx-pmeta{display:flex;align-items:center;gap:10px;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-label-caption);flex-wrap:wrap}
.dscx-pmeta code{font-family:var(--ds-font-family-code);overflow:hidden;text-overflow:ellipsis;
  max-width:100%;white-space:nowrap}
.dscx-pmeta b{font:var(--dsw-font-s-14);font-weight:600;color:var(--dsw-alias-label-primary);
  font-variant-numeric:tabular-nums}
.dscx-dotsep{width:3px;height:3px;border-radius:50%;background:var(--dsw-alias-border-l3);flex:none}
/* ---------- 页脚备注（例如「另有 N 个已移除」） ---------- */
.dscx-note{display:flex;align-items:flex-start;gap:7px;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-label-caption)}

/* ---------- 加载 / 错误 / 空态 ---------- */
.dscx-state{display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:8px;padding:44px 24px;text-align:center}
.dscx-state-title{font:var(--dsw-font-xs-13);font-weight:500;color:var(--dsw-alias-label-secondary)}
.dscx-state-desc{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);max-width:340px}
.dscx-state-action{height:28px;padding:0 12px;border-radius:var(--dsw-radius-sm);
  border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);
  font:var(--dsw-font-xxs-12)}
.dscx-state-action:hover{background:var(--dsw-alias-interactive-bg-hover)}
.dscx-spinner{width:14px;height:14px;flex:none;border-radius:999px;
  border:1.5px solid var(--dsw-alias-border-l3);
  border-top-color:var(--dsw-alias-state-business-primary);animation:dscx-spin .8s linear infinite}
@keyframes dscx-spin{to{transform:rotate(360deg)}}

/* ---------- 3 秒可撤销提示条 ---------- */
.dscx-toast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);z-index:50;
  display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;
  border-radius:var(--dsw-radius-md);background:var(--dsw-alias-toast-bg);
  color:var(--dsw-alias-toast-label);font:var(--dsw-font-xs-13);box-shadow:var(--dsw-shadow-lv2);
  max-width:calc(100vw - 32px)}
.dscx-toast button{border:0;background:color-mix(in srgb,var(--dsw-alias-toast-label) 16%,transparent);
  color:var(--dsw-alias-toast-label);font:var(--dsw-font-xxs-12);padding:4px 10px;
  border-radius:var(--dsw-radius-sm);white-space:nowrap}
.dscx-toast button:hover{background:color-mix(in srgb,var(--dsw-alias-toast-label) 26%,transparent)}

@media (prefers-reduced-motion:reduce){
  .dscx-spinner{animation:none}
  .dscx-progress-fill{transition:none}
  .dscx-tip{transition:none}
}
`;
		// src/shared/catalog.ts
		/** 按调用次数降序；同次数按占用降序，再按名字升序保证稳定。 */
		function compareByCalls(a, b) {
			return b.calls - a.calls || b.approxTokens - a.approxTokens || a.name.localeCompare(b.name);
		}
		/** 按占用降序；同占用按调用次数升序（越没用越靠前）。 */
		function compareByTokens(a, b) {
			return b.approxTokens - a.approxTokens || a.calls - b.calls || a.name.localeCompare(b.name);
		}
		/** 一天的毫秒数。 */
		const DAY_MS = 864e5;
		/**
		* 「最近使用」文案：今天 / 昨天 / N 天前 / N 个月前 / N 年前。
		*
		* 按自然日算而不是按时刻差：同一天上午调用一次，不会因为差了 12 小时被算成「昨天」。
		*
		* @param lastUsedAt - `YYYY-MM-DD`；null 表示从未调用。
		* @param calls - 调用次数，为 0 时直接给「从未」。
		* @param now - 基准时刻，默认当前时间。
		* @returns 中文相对时间文案。
		*/
		function lastUsedLabel(lastUsedAt, calls, now = /* @__PURE__ */ new Date()) {
			if (calls === 0 || lastUsedAt === null) return "从未";
			const last = /* @__PURE__ */ new Date(`${lastUsedAt}T00:00:00`);
			if (Number.isNaN(last.getTime())) return "—";
			const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
			const days = Math.round((today - last.getTime()) / DAY_MS);
			if (days <= 0) return "今天";
			if (days === 1) return "昨天";
			if (days < 30) return `${String(days)} 天前`;
			const months = Math.round(days / 30);
			if (months < 12) return `${String(months)} 个月前`;
			return `${String(Math.round(months / 12))} 年前`;
		}
		/**
		* 汇总一组条目。
		* @param entries - 条目列表。
		* @returns 汇总结果。
		*/
		function totalsOf(entries) {
			let chars = 0;
			let tokens = 0;
			let calls = 0;
			for (const entry of entries) {
				chars += entry.descriptionChars;
				tokens += entry.approxTokens;
				calls += entry.calls;
			}
			return {
				count: entries.length,
				chars,
				tokens,
				calls
			};
		}
		// src/client/format.ts
		/** 千分位分组；原型用 en-US 分组（2,833），保持一致。 */
		function formatNumber(value) {
			return value.toLocaleString("en-US");
		}
		function pad2(value) {
			return value < 10 ? `0${String(value)}` : String(value);
		}
		/**
		* 归档时间：ISO 字符串 → 本地 `YYYY-MM-DD HH:mm`。
		*
		* 宿主若已给出可读文本（解析失败），原样展示，不吞掉信息。
		*/
		function formatArchivedAt(value) {
			if (value === void 0 || value === "") return "—";
			const date = new Date(value);
			if (Number.isNaN(date.getTime())) return value;
			return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
		}
		/** 请求错误码 → 文案；未知码归为「操作失败」。 */
		function errorMessage(t, code) {
			switch (code) {
				case "readonly-root": return t("error.readonlyRoot");
				case "target-exists": return t("error.targetExists");
				case "not-found": return t("error.notFound");
				case "path-escape":
				case "invalid-request":
				case "unknown-root": return t("error.invalidRequest");
				case "timeout": return t("error.timeout");
				case "network": return t("error.network");
				default: return t("error.internal");
			}
		}
		// src/client/views/SegNav.tsx
		function SegNav(props) {
			const { t, view, onSelect } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-seg",
				role: "group",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-pressed": view === "global",
					onClick: () => onSelect("global"),
					children: t("seg.global")
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					"aria-pressed": view === "projects",
					onClick: () => onSelect("projects"),
					children: t("seg.projects")
				})]
			});
		}
		// src/client/views/SkillRow.tsx
		const ACTIVE_COLUMNS = "minmax(0,1fr) 68px 54px 96px 80px 64px";
		const ARCHIVED_COLUMNS = "minmax(0,1fr) 68px 150px 80px 64px";
		/** 来源 → 标签文案 key 与配色；与原型 SRC 表一致。 */
		const SOURCE_TAG = {
			"user-agents": {
				key: "source.user-agents",
				tone: "dscx-tag-blue"
			},
			"user-dsh": {
				key: "source.user-dsh",
				tone: "dscx-tag-blue"
			},
			"project-agents": {
				key: "source.project-agents",
				tone: "dscx-tag-green"
			},
			"project-dsh": {
				key: "source.project-dsh",
				tone: "dscx-tag-green"
			},
			bundled: {
				key: "source.bundled",
				tone: "dscx-tag-dim"
			}
		};
		/** 行的稳定 key：根 + 目录名，同一目录在归档前后的身份不变。 */
		function entryKey(entry) {
			return `${entry.rootId}/${entry.dirName}`;
		}
		function SkillRow(props) {
			const { t, entry, mode, canOpen, busy, onArchive, onRestore, onOpenDir } = props;
			const source = SOURCE_TAG[entry.source];
			const tokens = entry.approxTokens > 0 ? `${String(entry.approxTokens)}t` : "—";
			const tokensClass = entry.approxTokens > 0 ? "dscx-num-r" : "dscx-num-r dscx-zero";
			const name = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-c-name",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "t",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: entry.name }), entry.isSymlink ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-tag dscx-tag-dim",
						title: t("tip.symlink"),
						children: t("row.symlink")
					}) : null]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "d",
					children: entry.description === "" ? t("table.noDescription") : entry.description
				})]
			});
			const tag = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: `dscx-tag ${source.tone}`,
				children: t(source.key)
			}) });
			if (mode === "archived") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-tr",
				style: { gridTemplateColumns: ARCHIVED_COLUMNS },
				children: [
					name,
					tag,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-time-r",
						children: formatArchivedAt(entry.archivedAt)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: tokensClass,
						children: tokens
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dscx-ops",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dscx-iconbtn",
							title: t("action.restore"),
							"aria-label": t("action.restore"),
							disabled: busy,
							onClick: () => onRestore(entry),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RestoreIcon, {})
						})
					})
				]
			});
			const archiveTitle = entry.removable ? t("action.archive") : t("action.archiveBlocked");
			const agoZero = entry.calls === 0 ? "dscx-ago-r dscx-zero" : "dscx-ago-r";
			const callsZero = entry.calls === 0 ? "dscx-num-r dscx-zero" : "dscx-num-r";
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-tr",
				style: { gridTemplateColumns: ACTIVE_COLUMNS },
				children: [
					name,
					tag,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: callsZero,
						children: entry.calls
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: agoZero,
						children: lastUsedLabel(entry.lastUsedAt, entry.calls)
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: tokensClass,
						children: tokens
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-ops",
						children: [canOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dscx-iconbtn",
							title: t("action.openDir"),
							"aria-label": t("action.openDir"),
							onClick: () => onOpenDir(entry),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FolderIcon, {})
						}) : null, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dscx-iconbtn",
							title: archiveTitle,
							"aria-label": archiveTitle,
							disabled: !entry.removable || busy,
							onClick: () => onArchive(entry),
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ArchiveIcon, {})
						})]
					})
				]
			});
		}
		// src/client/views/StateBlock.tsx
		function StateBlock(props) {
			const { t, kind, title, desc, onRetry } = props;
			if (kind === "loading") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-state",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dscx-spinner" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dscx-state-title",
					children: t("state.loading")
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-state",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-state-title",
						children: title ?? t("error.title")
					}),
					desc === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-state-desc",
						children: desc
					}),
					onRetry === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
						type: "button",
						className: "dscx-state-action",
						onClick: onRetry,
						children: t("error.retry")
					})
				]
			});
		}
		// src/client/views/SkillList.tsx
		/**
		* 列名旁的圆圈问号。
		*
		* 位置跟着对齐方向走：右对齐列把问号放列名前面、左对齐列放后面，
		* 这样列名文字和下方数据的边界才能对齐（原型量过像素的唯一摆法）。
		*/
		function HeaderHint(props) {
			const { label, tip, align } = props;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
				className: "dscx-hint",
				"data-align": align,
				children: [align === "right" ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "q",
					children: "?"
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "lb",
					children: label
				})] }) : /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "lb",
					children: label
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "q",
					children: "?"
				})] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dscx-tip",
					children: tip
				})]
			});
		}
		function TableHead(props) {
			const { t, mode, callsTip } = props;
			if (mode === "archived") return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-thead",
				style: { gridTemplateColumns: ARCHIVED_COLUMNS },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("table.archivedSkill") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeaderHint, {
						label: t("table.source"),
						tip: t("tip.source")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-rh",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeaderHint, {
							label: t("table.archivedAt"),
							tip: t("tip.archivedAt"),
							align: "right"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-rh",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeaderHint, {
							label: t("table.tokens"),
							tip: t("tip.tokens"),
							align: "right"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
				]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-thead",
				style: { gridTemplateColumns: ACTIVE_COLUMNS },
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("table.skill") }),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeaderHint, {
						label: t("table.source"),
						tip: t("tip.source")
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-rh",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeaderHint, {
							label: t("table.calls"),
							tip: callsTip,
							align: "right"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-rh",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeaderHint, {
							label: t("table.lastUsed"),
							tip: t("tip.last"),
							align: "right"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-rh",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(HeaderHint, {
							label: t("table.tokens"),
							tip: t("tip.tokens"),
							align: "right"
						})
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
				]
			});
		}
		function SkillList(props) {
			const { t, entries, mode, loading, error, canOpen, pendingKey, callsTip, emptyText } = props;
			const { onRetry, onArchive, onRestore, onOpenDir } = props;
			let body;
			if (loading && entries.length === 0) body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateBlock, {
				t,
				kind: "loading"
			});
			else if (error !== null) body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateBlock, {
				t,
				kind: "error",
				title: t("error.skillsTitle"),
				desc: errorMessage(t, error),
				onRetry
			});
			else if (entries.length === 0) body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dscx-empty",
				children: emptyText
			});
			else body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(react_jsx_runtime.Fragment, { children: entries.map((entry) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillRow, {
				t,
				entry,
				mode,
				canOpen,
				busy: pendingKey === entryKey(entry),
				onArchive,
				onRestore,
				onOpenDir
			}, entryKey(entry))) });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-tbl",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(TableHead, {
					t,
					mode,
					callsTip
				}), body]
			});
		}
		// src/client/views/ProjectDetail.tsx
		/** 未知数字的占位符。 */
		const DASH = "—";
		function ProjectDetail(props) {
			const { t, project, entries, filter, sortBy, counts, totals, loading, error, canOpen, pendingKey, view, callsTip } = props;
			const { onSelectView, onBack, onRetry, onOpenPath, onFilter, onToggleSort } = props;
			const { onArchive, onRestore, onOpenDir } = props;
			const archived = filter === "archived";
			const neverCalled = filter === "never-called";
			const emptyText = archived ? t("table.emptyArchived") : neverCalled ? t("table.emptyNever") : t("table.emptyAll");
			const fmt = (value) => value === null ? DASH : formatNumber(value);
			const chip = (state, label, count) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
				type: "button",
				className: "dscx-chip",
				"aria-pressed": filter === state,
				onClick: () => onFilter(state),
				children: [label, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
					className: "dscx-chip-n",
					children: fmt(count)
				})]
			});
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dscx-crumb",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							onClick: onBack,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(ChevronLeftIcon, {}), t("detail.crumb")]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "sep",
							children: "/"
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: project.title })
					]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dscx-ph",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-ph-title",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
								className: "dscx-h1",
								children: project.title
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dscx-pmeta",
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("code", { children: project.path }), project.exists ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
									className: "dscx-tag dscx-tag-warn",
									children: t("detail.missing")
								})]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								className: "dscx-pmeta",
								children: [
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: totals === null ? DASH : formatNumber(totals.count) }), t("detail.skillCountSuffix")] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dscx-dotsep" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: totals === null ? DASH : formatNumber(totals.tokens) }), t("detail.tokensUnit")] }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: "dscx-dotsep" }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: fmt(totals?.calls ?? null) }), t("detail.callsSuffix")] })
								]
							})
						]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dscx-ph-acts",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
							type: "button",
							className: "dscx-btn dscx-btn-sm",
							disabled: !project.exists,
							onClick: () => onOpenPath(project.path),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(FolderIcon, {}), t("action.openProjectLabel")]
						})
					})]
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dscx-segrow",
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SegNav, {
							t,
							view,
							onSelect: onSelectView
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dscx-chips",
							children: [
								chip("all", t("filter.all"), counts.active),
								chip("never-called", t("filter.never"), counts.never),
								chip("archived", t("filter.archived"), counts.archived)
							]
						}),
						archived || neverCalled ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dscx-btn dscx-btn-sm dscx-sort",
							onClick: onToggleSort,
							children: sortBy === "tokens" ? t("sort.byTokens") : t("sort.byCalls")
						})
					]
				}),
				neverCalled && counts.never !== null && counts.neverTokens !== null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dscx-fbar",
					children: t("filter.neverSummary", {
						count: formatNumber(counts.never),
						tokens: formatNumber(counts.neverTokens)
					})
				}) : null,
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillList, {
					t,
					entries,
					mode: archived ? "archived" : "active",
					loading,
					error,
					canOpen,
					pendingKey,
					callsTip,
					emptyText,
					onRetry,
					onArchive,
					onRestore,
					onOpenDir
				})
			] });
		}
		// src/client/views/ProjectsView.tsx
		/**
		* 项目看板：哪些工作区放了项目级 skill，点行进详情；没有 skill 的工作区收成一行可展开。
		*
		* 数据来自 `.projects`，行内不再单独请求；详情页的完整列表走 ProjectDetail。
		*/
		const PROJECT_COLUMNS = "minmax(0,1fr) 230px 118px";
		function previewTags(t, project) {
			const tags = project.preview.map((skill) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dscx-tag dscx-tag-green",
				children: skill.name
			}, `${skill.rootId}/${skill.dirName}`));
			const more = project.skillCount - project.preview.length;
			if (more > 0) tags.push(/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: "dscx-tag dscx-tag-dim",
				children: t("projects.moreSkills", { count: more })
			}, "__more"));
			return tags;
		}
		function ProjectRow(props) {
			const { t, project, clickable, canOpen, onOpenProject, onOpenPath } = props;
			const openFolder = (event) => {
				event.stopPropagation();
				onOpenPath(project.path);
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: clickable ? "dscx-tr dscx-clickable" : "dscx-tr",
				style: { gridTemplateColumns: PROJECT_COLUMNS },
				role: clickable ? "button" : void 0,
				tabIndex: clickable ? 0 : void 0,
				onClick: clickable ? () => onOpenProject(project) : void 0,
				onKeyDown: clickable ? (event) => {
					if (event.target !== event.currentTarget) return;
					if (event.key === "Enter" || event.key === " ") {
						event.preventDefault();
						onOpenProject(project);
					}
				} : void 0,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-c-name",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "t",
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: project.title }), project.exists ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dscx-tag dscx-tag-warn",
								children: t("projects.missing")
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "d",
							children: project.path
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-ps",
						children: [
							project.skillCount > 0 ? previewTags(t, project) : null,
							project.skillCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dscx-ps-tokens",
								children: [project.approxTokens, "t"]
							}) : null,
							project.skillCount === 0 && project.archivedCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dscx-tag dscx-tag-dim",
								children: t("projects.archivedOnly", { count: project.archivedCount })
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-prow-actions",
						children: [clickable ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dscx-prow-go",
							children: t("projects.viewSkills")
						}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
							className: "dscx-num-r dscx-zero",
							children: t("projects.noSkills")
						}), canOpen ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							className: "dscx-ops",
							children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
								type: "button",
								className: "dscx-iconbtn",
								title: t("action.openProject"),
								"aria-label": t("action.openProject"),
								disabled: !project.exists,
								onClick: openFolder,
								children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(FolderIcon, {})
							})
						}) : null]
					})
				]
			});
		}
		function ProjectsView(props) {
			const { t, payload, loading, error, canOpen, view, onSelectView, onRetry, onOpenProject, onOpenPath } = props;
			const [showAll, setShowAll] = (0, react.useState)(false);
			const projects = payload?.projects ?? [];
			const withSkills = projects.filter((project) => project.skillCount > 0 || project.archivedCount > 0);
			const rest = projects.filter((project) => project.skillCount === 0 && project.archivedCount === 0);
			const total = payload?.total ?? projects.length;
			let body;
			if (loading && payload === null) body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateBlock, {
				t,
				kind: "loading"
			});
			else if (error !== null) body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateBlock, {
				t,
				kind: "error",
				title: t("error.projectsTitle"),
				desc: errorMessage(t, error),
				onRetry
			});
			else if (withSkills.length === 0) body = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
				className: "dscx-empty",
				children: t("projects.empty")
			});
			else body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [withSkills.map((project) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectRow, {
				t,
				project,
				clickable: project.exists,
				canOpen,
				onOpenProject,
				onOpenPath
			}, project.id)), showAll ? rest.map((project) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectRow, {
				t,
				project,
				clickable: false,
				canOpen,
				onOpenProject,
				onOpenPath
			}, project.id)) : null] });
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dscx-ph",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-ph-title",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							className: "dscx-h1",
							children: t("projects.title")
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
							className: "dscx-sub",
							children: t("projects.subtitle", {
								total,
								withSkills: withSkills.length
							})
						})]
					})
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SegNav, {
					t,
					view,
					onSelect: onSelectView
				}),
				/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dscx-tbl",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-thead",
						style: { gridTemplateColumns: PROJECT_COLUMNS },
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("projects.colWorkspace") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: t("projects.colSkills") }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {})
						]
					}), body]
				}),
				rest.length > 0 && error === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
					type: "button",
					className: showAll ? "dscx-restline dscx-on" : "dscx-restline",
					onClick: () => setShowAll((value) => !value),
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: showAll ? t("projects.restExpanded", { count: rest.length }) : t("projects.rest", { count: rest.length }) }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "rn",
						children: showAll ? t("projects.collapse") : t("projects.expand")
					})]
				}) : null
			] });
		}
		// src/client/views/ProgressStrip.tsx
		function ProgressStrip(props) {
			const { t, backfill } = props;
			const total = Math.max(backfill.total, backfill.done);
			const percent = total > 0 ? Math.min(100, Math.round(backfill.done / total * 100)) : 0;
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-progress",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dscx-progress-row",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-progress-label",
						children: t("backfill.label")
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
						className: "dscx-progress-count",
						children: t("backfill.count", {
							done: backfill.done,
							total
						})
					})]
				}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dscx-progress-track",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
						className: "dscx-progress-fill",
						style: { width: `${String(percent)}%` }
					})
				})]
			});
		}
		// src/client/views/Toast.tsx
		/**
		* 归档 / 还原成功后的 3 秒可撤销提示条。
		*
		* 计时器归组件所有：`seq` 每次动作递增，同一句文案连续出现时也能重新计时。
		*/
		const TOAST_MS = 3e3;
		function Toast(props) {
			const { message, seq, actionLabel, onAction, onExpire } = props;
			const expireRef = (0, react.useRef)(onExpire);
			expireRef.current = onExpire;
			(0, react.useEffect)(() => {
				const timer = setTimeout(() => expireRef.current(), TOAST_MS);
				return () => clearTimeout(timer);
			}, [seq]);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-toast",
				role: "status",
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: message }), actionLabel === void 0 || onAction === void 0 ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					onClick: onAction,
					children: actionLabel
				})]
			});
		}
		// src/client/views/Panel.tsx
		/**
		* 「Skill 管理」中央面板的外壳：数据加载、范围/状态切换、预算卡、表格、归档动作与撤销提示。
		*
		* 面板不是会话绑定的，所以只认宿主路由，不订阅 DSH 内部事件；
		* 唯一的轮询是首次回溯进行中时每 5 秒刷新一次 overview（接住进度）。
		* 归档 / 还原后统一 `refresh` 一次，让总账与列表一起重算。
		*/
		/** 归档时间倒序；同一时间按名字稳定排。 */
		function sortArchived(entries) {
			return [...entries].sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "") || a.name.localeCompare(b.name));
		}
		/** 请求异常 → 错误码字符串；界面只按码选文案。 */
		function errorCodeOf(error) {
			return error instanceof OptimizeRequestError ? error.code : "internal";
		}
		/**
		* 极简数据加载 hook：显式传依赖，手动 `reload()`。
		*
		* 没有引入数据层依赖（面板只有几个 GET），但要保证每次切范围/筛选都换请求、
		* 旧请求被 abort，且重试与刷新走同一条路径。
		*/
		function useResource(load, deps, enabled = true) {
			const [state, setState] = (0, react.useState)({
				data: null,
				error: null,
				loading: enabled
			});
			const [nonce, setNonce] = (0, react.useState)(0);
			const loadRef = (0, react.useRef)(load);
			loadRef.current = load;
			(0, react.useEffect)(() => {
				if (!enabled) {
					setState({
						data: null,
						error: null,
						loading: false
					});
					return;
				}
				const controller = new AbortController();
				setState((previous) => ({
					data: previous.data,
					error: null,
					loading: true
				}));
				loadRef.current(controller.signal).then((data) => {
					if (!controller.signal.aborted) setState({
						data,
						error: null,
						loading: false
					});
				}, (error) => {
					if (!controller.signal.aborted) setState({
						data: null,
						error: errorCodeOf(error),
						loading: false
					});
				});
				return () => controller.abort();
			}, [
				...deps,
				enabled,
				nonce
			]);
			return {
				...state,
				reload: () => setNonce((value) => value + 1)
			};
		}
		function BudgetCard(props) {
			const { t, catalogTokens, activeCount, archivedCount, archivedTokens, calls, calls30d, top, restCount, restTokens } = props;
			const total = Math.max(1, catalogTokens);
			let accumulated = 0;
			const bands = top.map((entry, index) => {
				const width = entry.approxTokens / total * 100;
				accumulated += width;
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
					className: `dscx-band-${String(index % 7 + 1)}`,
					style: { width: `${width.toFixed(2)}%` }
				}, entryKey(entry));
			});
			const restWidth = Math.max(0, 100 - accumulated);
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-budget",
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-b-top",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
								className: "dscx-big",
								children: [formatNumber(catalogTokens), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("small", { children: t("budget.tokensUnit") })]
							}),
							/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dscx-cap",
								children: t("budget.fixedCost", { count: activeCount })
							}),
							archivedCount > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								className: "dscx-saved",
								children: t("budget.archivedSaving", {
									count: archivedCount,
									tokens: formatNumber(archivedTokens)
								})
							}) : null
						]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-stack",
						children: [bands, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", {
							className: "dscx-band-rest",
							style: { width: `${restWidth.toFixed(2)}%` }
						})]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-legend",
						children: [top.map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { className: `dscx-band-${String(index % 7 + 1)}` }), entry.name] }, entryKey(entry))), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("i", { className: "dscx-band-rest" }), t("budget.legendRest", {
							count: restCount,
							tokens: formatNumber(restTokens)
						})] })]
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-b-counts",
						children: [
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatNumber(activeCount) }), t("budget.activeSkills")] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatNumber(calls) }), t("budget.historyCalls")] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatNumber(calls30d) }), t("budget.calls30d")] }),
							/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("b", { children: formatNumber(archivedCount) }), t("budget.archivedCount")] })
						]
					})
				]
			});
		}
		function Panel(props) {
			const { t, api } = props;
			const [view, setView] = (0, react.useState)("global");
			const [filter, setFilter] = (0, react.useState)("all");
			const [sortBy, setSortBy] = (0, react.useState)("calls");
			const [project, setProject] = (0, react.useState)(null);
			const [canOpen, setCanOpen] = (0, react.useState)(false);
			const [pendingKey, setPendingKey] = (0, react.useState)(null);
			const [toast, setToast] = (0, react.useState)(null);
			const [refresh, setRefresh] = (0, react.useState)(0);
			const scrollRef = (0, react.useRef)(null);
			const toastSeq = (0, react.useRef)(0);
			const projectId = project?.id ?? null;
			const overview = useResource((signal) => api.overview(signal), [api, refresh]);
			const globalActive = useResource((signal) => api.skills({
				scope: "global",
				state: "all"
			}, signal), [api, refresh], view === "global");
			const globalArchived = useResource((signal) => api.skills({
				scope: "global",
				state: "archived"
			}, signal), [api, refresh], view === "global");
			const projects = useResource((signal) => api.projects(signal), [api, refresh], view === "projects" && project === null);
			const projectActive = useResource((signal) => api.skills({
				scope: "project",
				workspaceId: projectId ?? "",
				state: "all"
			}, signal), [
				api,
				refresh,
				projectId
			], projectId !== null);
			const projectArchived = useResource((signal) => api.skills({
				scope: "project",
				workspaceId: projectId ?? "",
				state: "archived"
			}, signal), [
				api,
				refresh,
				projectId
			], projectId !== null);
			const backfill = overview.data?.backfill;
			const backfillRunning = backfill?.state === "running";
			(0, react.useEffect)(() => {
				if (!backfillRunning) return;
				const timer = setInterval(() => overview.reload(), 5e3);
				return () => clearInterval(timer);
			}, [backfillRunning]);
			const previousBackfill = (0, react.useRef)(null);
			(0, react.useEffect)(() => {
				const state = backfill?.state ?? null;
				if (previousBackfill.current === "running" && state !== "running") setRefresh((value) => value + 1);
				previousBackfill.current = state;
			}, [backfill?.state]);
			(0, react.useEffect)(() => {
				setSortBy(filter === "never-called" ? "tokens" : "calls");
			}, [filter]);
			(0, react.useEffect)(() => {
				let alive = true;
				api.canOpenPath().then((value) => {
					if (alive) setCanOpen(value);
				});
				return () => {
					alive = false;
				};
			}, [api]);
			(0, react.useEffect)(() => {
				const node = scrollRef.current;
				if (node !== null) node.scrollTop = 0;
			}, [
				view,
				filter,
				projectId
			]);
			const activeEntries = (0, react.useMemo)(() => (globalActive.data?.entries ?? []).filter((entry) => entry.effective), [globalActive.data]);
			const archivedEntries = (0, react.useMemo)(() => sortArchived(globalArchived.data?.entries ?? []), [globalArchived.data]);
			const neverEntries = (0, react.useMemo)(() => activeEntries.filter((entry) => entry.calls === 0), [activeEntries]);
			const globalEntries = (0, react.useMemo)(() => {
				if (filter === "archived") return archivedEntries;
				return [...filter === "never-called" ? neverEntries : activeEntries].sort(sortBy === "tokens" ? compareByTokens : compareByCalls);
			}, [
				filter,
				archivedEntries,
				activeEntries,
				neverEntries,
				sortBy
			]);
			const projectActiveEntries = (0, react.useMemo)(() => (projectActive.data?.entries ?? []).filter((entry) => entry.effective), [projectActive.data]);
			const projectArchivedEntries = (0, react.useMemo)(() => sortArchived(projectArchived.data?.entries ?? []), [projectArchived.data]);
			const projectNeverEntries = (0, react.useMemo)(() => projectActiveEntries.filter((entry) => entry.calls === 0), [projectActiveEntries]);
			const projectFilteredEntries = (0, react.useMemo)(() => {
				if (filter === "archived") return projectArchivedEntries;
				return [...filter === "never-called" ? projectNeverEntries : projectActiveEntries].sort(sortBy === "tokens" ? compareByTokens : compareByCalls);
			}, [
				filter,
				projectArchivedEntries,
				projectActiveEntries,
				projectNeverEntries,
				sortBy
			]);
			const projectCounts = (0, react.useMemo)(() => ({
				active: projectActive.data === null ? null : projectActiveEntries.length,
				never: projectActive.data === null ? null : projectNeverEntries.length,
				neverTokens: projectActive.data === null ? null : projectNeverEntries.reduce((sum, entry) => sum + entry.approxTokens, 0),
				archived: projectArchived.data === null ? null : projectArchivedEntries.length
			}), [
				projectActive.data,
				projectActiveEntries,
				projectArchived.data,
				projectArchivedEntries,
				projectNeverEntries
			]);
			const projectTotals = (0, react.useMemo)(() => {
				if (projectActive.data === null) {
					if (projectActive.error !== null) return null;
					return {
						count: project?.skillCount ?? 0,
						tokens: project?.approxTokens ?? 0,
						calls: null
					};
				}
				const sum = totalsOf(projectActiveEntries);
				return {
					count: sum.count,
					tokens: sum.tokens,
					calls: sum.calls
				};
			}, [
				project,
				projectActive.data,
				projectActive.error,
				projectActiveEntries
			]);
			const totals = overview.data?.totals;
			const budget = (0, react.useMemo)(() => {
				const fallbackTokens = activeEntries.reduce((sum, entry) => sum + entry.approxTokens, 0);
				const catalogTokens = totals?.catalogTokens ?? fallbackTokens;
				const top = [...activeEntries].filter((entry) => entry.approxTokens > 0).sort(compareByTokens).slice(0, 7);
				const topTokens = top.reduce((sum, entry) => sum + entry.approxTokens, 0);
				const archivedTokens = archivedEntries.reduce((sum, entry) => sum + entry.approxTokens, 0);
				const neverCount = totals?.neverCalled ?? neverEntries.length;
				const neverTokens = totals?.neverCalledTokens ?? neverEntries.reduce((sum, entry) => sum + entry.approxTokens, 0);
				return {
					activeCount: totals?.active ?? activeEntries.length,
					removed: totals?.removed ?? 0,
					catalogTokens,
					archivedCount: totals?.archived ?? archivedEntries.length,
					archivedTokens,
					calls: totals?.calls ?? activeEntries.reduce((sum, entry) => sum + entry.calls, 0),
					calls30d: totals?.calls30d ?? activeEntries.reduce((sum, entry) => sum + entry.calls30d, 0),
					neverCount,
					neverTokens,
					top,
					topTokens,
					restCount: Math.max(0, (totals?.active ?? activeEntries.length) - top.length),
					restTokens: Math.max(0, catalogTokens - topTokens)
				};
			}, [
				activeEntries,
				archivedEntries,
				neverEntries,
				totals
			]);
			const corpus = overview.data?.corpusRange;
			const callsTip = corpus !== void 0 && corpus.sessions > 0 && corpus.from !== null && corpus.to !== null ? t("tip.calls", {
				sessions: formatNumber(corpus.sessions),
				from: corpus.from,
				to: corpus.to
			}) : t("tip.callsPlain");
			const callsTipProject = t("tip.callsProject");
			const reloadAll = () => setRefresh((value) => value + 1);
			const showToast = (message, action) => {
				toastSeq.current += 1;
				setToast({
					message,
					seq: toastSeq.current,
					actionLabel: action?.label,
					onAction: action?.run
				});
			};
			const runMove = async (kind, request, displayName) => {
				if (pendingKey !== null) return;
				setPendingKey(`${request.rootId}/${request.dirName}`);
				try {
					const payload = kind === "archive" ? await api.archive(request) : await api.restore(request);
					setRefresh((value) => value + 1);
					if (kind === "archive") {
						const undoRequest = {
							...request,
							dirName: payload.renamedTo ?? request.dirName
						};
						showToast(t("toast.archived", { name: displayName }), {
							label: t("toast.undo"),
							run: () => {
								runMove("restore", undoRequest, displayName);
							}
						});
					} else showToast(t("toast.restored", { name: displayName }));
				} catch (error) {
					showToast(errorMessage(t, errorCodeOf(error)));
				} finally {
					setPendingKey(null);
				}
			};
			const moveRequest = (entry, scope, workspaceId) => {
				const request = {
					scope,
					rootId: entry.rootId,
					dirName: entry.dirName
				};
				return workspaceId === void 0 ? request : {
					...request,
					workspaceId
				};
			};
			const handleArchive = (entry, scope, workspaceId) => {
				const request = moveRequest(entry, scope, workspaceId);
				runMove("archive", request, entry.name);
			};
			const handleRestore = (entry, scope, workspaceId) => {
				const request = moveRequest(entry, scope, workspaceId);
				runMove("restore", request, entry.name);
			};
			const handleOpenPath = (path) => {
				(async () => {
					if (await api.openPath(path)) return;
					const copied = await api.copyPath(path);
					showToast(copied ? t("toast.openFailedCopied") : t("toast.openFailed"));
				})();
			};
			const selectView = (next) => {
				if (next === view) return;
				setView(next);
				setProject(null);
			};
			const globalView = () => {
				const archived = filter === "archived";
				const failed = overview.error !== null && overview.data === null;
				const navOnly = /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dscx-segrow",
					children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(SegNav, {
						t,
						view,
						onSelect: selectView
					})
				});
				let body;
				if (failed) body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [navOnly, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateBlock, {
					t,
					kind: "error",
					title: t("error.title"),
					desc: t("error.desc"),
					onRetry: reloadAll
				})] });
				else if (overview.data === null) body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [navOnly, /* @__PURE__ */ (0, react_jsx_runtime.jsx)(StateBlock, {
					t,
					kind: "loading"
				})] });
				else body = /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [
					backfillRunning && overview.data.backfill.state === "running" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProgressStrip, {
						t,
						backfill: overview.data.backfill
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(BudgetCard, {
						t,
						...budget
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						className: "dscx-segrow",
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SegNav, {
							t,
							view,
							onSelect: selectView
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: "dscx-chips",
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dscx-chip",
									"aria-pressed": filter === "all",
									onClick: () => setFilter("all"),
									children: [t("filter.all"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dscx-chip-n",
										children: formatNumber(budget.activeCount)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dscx-chip",
									"aria-pressed": filter === "never-called",
									onClick: () => setFilter("never-called"),
									children: [t("filter.never"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dscx-chip-n",
										children: formatNumber(budget.neverCount)
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
									type: "button",
									className: "dscx-chip",
									"aria-pressed": filter === "archived",
									onClick: () => setFilter("archived"),
									children: [t("filter.archived"), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
										className: "dscx-chip-n",
										children: formatNumber(budget.archivedCount)
									})]
								})
							]
						})]
					}),
					filter === "never-called" ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dscx-fbar",
						children: t("filter.neverSummary", {
							count: formatNumber(budget.neverCount),
							tokens: formatNumber(budget.neverTokens)
						})
					}) : null,
					/* @__PURE__ */ (0, react_jsx_runtime.jsx)(SkillList, {
						t,
						entries: globalEntries,
						mode: archived ? "archived" : "active",
						loading: archived ? globalArchived.loading : globalActive.loading,
						error: archived ? globalArchived.error : globalActive.error,
						canOpen,
						pendingKey,
						callsTip,
						emptyText: archived ? t("table.emptyArchived") : filter === "never-called" ? t("table.emptyNever") : t("table.emptyAll"),
						onRetry: reloadAll,
						onArchive: (entry) => handleArchive(entry, "global"),
						onRestore: (entry) => handleRestore(entry, "global"),
						onOpenDir: (entry) => handleOpenPath(entry.dirRealPath)
					}),
					filter === "all" && budget.removed > 0 ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dscx-note",
						children: t("note.removed", { count: formatNumber(budget.removed) })
					}) : null
				] });
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: "dscx-ph",
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dscx-ph-title",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("h1", {
							className: "dscx-h1",
							children: t("panel")
						})
					}), filter !== "all" ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						className: "dscx-ph-acts",
						children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							className: "dscx-btn dscx-btn-sm",
							onClick: () => setSortBy(sortBy === "calls" ? "tokens" : "calls"),
							children: sortBy === "tokens" ? t("sort.byTokens") : t("sort.byCalls")
						})
					})]
				}), body] });
			};
			let content;
			if (project !== null) content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectDetail, {
				t,
				project,
				entries: projectFilteredEntries,
				filter,
				sortBy,
				counts: projectCounts,
				totals: projectTotals,
				loading: filter === "archived" ? projectArchived.loading : projectActive.loading,
				error: filter === "archived" ? projectArchived.error : projectActive.error,
				canOpen,
				pendingKey,
				view,
				callsTip: callsTipProject,
				onSelectView: selectView,
				onBack: () => setProject(null),
				onRetry: reloadAll,
				onOpenPath: handleOpenPath,
				onFilter: setFilter,
				onToggleSort: () => setSortBy((value) => value === "calls" ? "tokens" : "calls"),
				onArchive: (entry) => handleArchive(entry, "project", project.id),
				onRestore: (entry) => handleRestore(entry, "project", project.id),
				onOpenDir: (entry) => handleOpenPath(entry.dirRealPath)
			});
			else if (view === "projects") content = /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ProjectsView, {
				t,
				payload: projects.data,
				loading: projects.loading,
				error: projects.error,
				canOpen,
				view,
				onSelectView: selectView,
				onRetry: reloadAll,
				onOpenProject: (entry) => {
					setFilter("all");
					setProject(entry);
				},
				onOpenPath: handleOpenPath
			});
			else content = globalView();
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
				className: "dscx-root",
				ref: scrollRef,
				children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
					className: "dscx-page",
					children: content
				}), toast === null ? null : /* @__PURE__ */ (0, react_jsx_runtime.jsx)(Toast, {
					message: toast.message,
					seq: toast.seq,
					actionLabel: toast.actionLabel,
					onAction: toast.onAction,
					onExpire: () => setToast(null)
				})]
			});
		}
		// src/client/index.tsx
		/** 中央面板 id，同时是侧边栏入口 id 与 main 槽位 key，三者必须一致。 */
		const PANEL_ID = "context-optimize";
		/**
		* 必需服务：缺任何一个就不注册入口（面板依赖槽位、文案与远程打开能力）。
		*
		* 不列 `layout`：本插件不调它的 API（槽位注册由 slots 负责），把没用的服务列为硬依赖
		* 只会让组合里缺 layout 时整块入口消失。
		*/
		const inject = [
			"slots",
			"locale",
			"remote",
			"remote.session"
		];
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "dsh-context-optimize: dictionaries");
			if (typeof document !== "undefined") {
				const style = document.createElement("style");
				style.setAttribute("data-plugin", "@kulebbb/dsh-context-optimize");
				style.setAttribute("data-plugin-css", "@kulebbb/dsh-context-optimize/panel.css");
				style.textContent = PANEL_CSS;
				document.head.append(style);
				ctx.effect(() => () => style.remove(), "dsh-context-optimize: styles");
			}
			ctx.inject(inject, (scope) => {
				const t = scope.locale.bind(NS);
				const api = createContextOptimizeApi(scope);
				scope.effect(() => {
					scope.slots.inject("sidebar.panellist", () => scope.slots.register({
						name: "sidebar.panellist",
						id: PANEL_ID,
						order: 20,
						locale: NS,
						label: () => t("panel")
					}, SidebarPanelIcon));
				}, "dsh-context-optimize: sidebar entry");
				scope.effect(() => {
					scope.slots.inject("main", () => scope.slots.register({
						name: "main",
						key: PANEL_ID,
						locale: NS,
						inject: () => ({ api })
					}, Panel));
				}, "dsh-context-optimize: main panel");
			});
		}
		exports.PANEL_ID = PANEL_ID;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
