/**
 * 面板文案（locale 命名空间 `dshContextOptimize`）。
 *
 * `index.tsx` 在 apply 里 `ctx.locale.register(NS, { zh, en })`；
 * 槽位的 `locale: NS` 让宿主把 `t` 注入组件 props。
 * key 是扁平字符串，`{name}` 由 t 的第二个参数插值。
 */

/** locale 命名空间，与 `ctx.locale.register(NS, ...)`、槽位 `locale` 保持一致。 */
export const NS = 'dshContextOptimize'

/** 简体中文字典；也是 key 集合的单一真相源。 */
export const zh = {
  panel: 'Skill 管理',

  'state.loading': '正在读取…',
  'error.title': '服务未就绪',
  'error.desc': '没有读到数据。可能是宿主半尚未启动，或路由未注册。',
  'error.retry': '重试',
  'error.skillsTitle': '读取 skill 列表失败',
  'error.projectsTitle': '读取工作区失败',
  'error.readonlyRoot': '内置 skill 只读，不能归档',
  'error.targetExists': '目标位置已有同名条目',
  'error.notFound': '目录不存在，可能已经被移动',
  'error.invalidRequest': '请求参数不合法',
  'error.timeout': '请求超时，宿主没有响应',
  'error.network': '连不上宿主，请稍后重试',
  'error.internal': '操作失败，请重试',

  'backfill.label': '正在回溯历史调用',
  'backfill.count': '{done} / {total}',

  'sort.byCalls': '排序：按调用次数',
  'sort.byTokens': '排序：按占用',

  'seg.global': '全局',
  'seg.projects': '项目',

  'filter.all': '生效中',
  'filter.never': '从未被调用',
  'filter.archived': '已归档',
  'filter.neverSummary': '{count} 个从未被调用 · 合计 {tokens}t',

  'budget.tokensUnit': 'tokens',
  'budget.fixedCost': '每次会话固定开销 · {count} 个 skill',
  'budget.archivedSaving': '已归档 {count} · 省 {tokens}t',
  'budget.legendRest': '其余 {count} 个 · {tokens}t',
  'budget.activeSkills': '生效中 skill',
  'budget.historyCalls': '历史调用',
  'budget.calls30d': '近 30 天调用',
  'budget.archivedCount': '已归档',

  'table.skill': 'SKILL',
  'table.archivedSkill': '已归档的 SKILL',
  'table.source': '来源',
  'table.calls': '调用',
  'table.lastUsed': '最近使用',
  'table.tokens': '占用',
  'table.archivedAt': '归档时间',
  'table.emptyAll': '还没有扫到生效中的 skill',
  'table.emptyNever': '没有从未被调用过的 skill',
  'table.emptyArchived': '还没有归档过 skill',
  'table.noDescription': '—',

  'tip.source':
    '从哪个目录读到的。同名 skill 的优先级：项目 .dsh > 项目 .agents > 用户 .dsh > 用户 .agents > 内置只读。',
  'tip.calls':
    '统计范围：本机全部 {sessions} 个会话（{from} → {to}）。计的是模型加载该 skill 的次数，你在对话里用 /skill名 直接触发的也计入。',
  'tip.callsPlain':
    '统计范围：本机全部会话。计的是模型加载该 skill 的次数，你在对话里用 /skill名 直接触发的也计入。',
  'tip.callsProject':
    '统计范围：本项目目录下发生过的会话（全部历史）。计的是模型加载该 skill 的次数，你在对话里用 /skill名 直接触发的也计入。',
  'tip.last':
    '这条 skill 最后一次被加载的时间。按自然日显示：今天 / 昨天 / N 天前 / N 个月前。从未调用过的一律显示「从未」。',
  'tip.tokens': '该 skill 在会话目录里占的文本量：名字 + 描述，按 3.5 个字符约等于 1 token 估算。',
  'tip.archivedAt': '这条 skill 被移出 skills 目录、进入 skill-archive 的时间。点行尾的还原按钮可以放回原位置。',
  'tip.symlink': '这是指向别处的软链，归档只移动链接本身，不会影响目标文件。',
  'row.symlink': '软链',
  'note.removed': '另有 {count} 个已移除，仅保留历史调用记录',

  'source.user-agents': '用户',
  'source.user-dsh': '用户·dsh',
  'source.project-agents': '项目',
  'source.project-dsh': '项目·dsh',
  'source.bundled': '内置',

  'action.openDir': '在 Finder 中打开该 skill 目录',
  'action.archive': '归档（移到 skill-archive）',
  'action.archiveBlocked': '内置 skill 只读，不能归档',
  'action.restore': '还原到 skills 目录',
  'action.openProject': '在 Finder 中打开项目目录',
  'action.openProjectLabel': '打开项目目录',

  'projects.title': '项目',
  'projects.subtitle': '{total} 个工作区 · {withSkills} 个有项目级 skill',
  'projects.colWorkspace': '有项目级 skill 的工作区',
  'projects.colSkills': '项目级 skill',
  'projects.archivedOnly': '已归档 {count} 个',
  'projects.empty': '还没有项目放置了项目级 skill',
  'projects.viewSkills': '查看 skill →',
  'projects.noSkills': '无项目级 skill',
  'projects.rest': '其余 {count} 个工作区无项目级 skill',
  'projects.restExpanded': '已展开其余 {count} 个工作区',
  'projects.expand': '展开',
  'projects.collapse': '收起',
  'projects.missing': '路径失效',
  'projects.moreSkills': '+{count}',

  'detail.crumb': '项目',
  'detail.skillCountSuffix': ' 个项目级 skill',
  'detail.tokensUnit': ' tokens',
  'detail.callsSuffix': ' 次调用',
  'detail.missing': '路径失效',

  'toast.archived': '已归档 {name}',
  'toast.restored': '已还原 {name}',
  'toast.undo': '撤销',
  'toast.openFailedCopied': '无法在 Finder 中打开，路径已复制',
  'toast.openFailed': '无法在 Finder 中打开这个目录',
} as const

/** key 集合类型；`en` 必须与它完全一致（少一个 key 就编译不过）。 */
export type ContextOptimizeLocaleKey = keyof typeof zh

/** English dictionary, checked against the Chinese key set. */
export const en: Record<ContextOptimizeLocaleKey, string> = {
  panel: 'Skill manager',

  'state.loading': 'Loading…',
  'error.title': 'Service not ready',
  'error.desc': 'No data was returned. The host half may not be running, or its routes are not registered.',
  'error.retry': 'Retry',
  'error.skillsTitle': 'Could not read the skill list',
  'error.projectsTitle': 'Could not read workspaces',
  'error.readonlyRoot': 'Bundled skills are read-only and cannot be archived',
  'error.targetExists': 'An entry with this name already exists at the target',
  'error.notFound': 'The directory no longer exists — it may have been moved',
  'error.invalidRequest': 'Invalid request',
  'error.timeout': 'The host did not respond in time',
  'error.network': 'Cannot reach the host — try again later',
  'error.internal': 'The operation failed — try again',

  'backfill.label': 'Backfilling call history',
  'backfill.count': '{done} / {total}',

  'sort.byCalls': 'Sort: by calls',
  'sort.byTokens': 'Sort: by tokens',

  'seg.global': 'Global',
  'seg.projects': 'Projects',

  'filter.all': 'Active',
  'filter.never': 'Never called',
  'filter.archived': 'Archived',
  'filter.neverSummary': '{count} never called · {tokens}t in total',

  'budget.tokensUnit': 'tokens',
  'budget.fixedCost': 'Fixed cost per session · {count} skills',
  'budget.archivedSaving': 'Archived {count} · saved {tokens}t',
  'budget.legendRest': 'Other {count} · {tokens}t',
  'budget.activeSkills': 'active skills',
  'budget.historyCalls': 'calls all time',
  'budget.calls30d': 'calls in 30 days',
  'budget.archivedCount': 'archived',

  'table.skill': 'SKILL',
  'table.archivedSkill': 'ARCHIVED SKILL',
  'table.source': 'Source',
  'table.calls': 'Calls',
  'table.lastUsed': 'Last used',
  'table.tokens': 'Size',
  'table.archivedAt': 'Archived at',
  'table.emptyAll': 'No active skills found yet',
  'table.emptyNever': 'No skill was never called',
  'table.emptyArchived': 'Nothing archived yet',
  'table.noDescription': '—',

  'tip.source':
    'The directory this skill came from. Precedence for duplicate names: project .dsh > project .agents > user .dsh > user .agents > bundled read-only.',
  'tip.calls':
    'Scope: all {sessions} sessions on this machine ({from} → {to}). Counts how often the model loaded this skill, including direct /skill-name invocations in the conversation.',
  'tip.callsProject':
    'Scope: sessions that ran under this project’s directory (all history). Counts how often the model loaded this skill, including direct /skill-name invocations.',
  'tip.callsPlain':
    'Scope: all sessions on this machine. Counts how often the model loaded this skill, including direct /skill-name invocations in the conversation.',
  'tip.last':
    'When this skill was last loaded. Shown by calendar day: today / yesterday / N days / N months ago. Skills never called always show “never”.',
  'tip.tokens':
    'Text this skill occupies in the session catalog: name + description, estimated at 3.5 characters per token.',
  'tip.archivedAt':
    'When this skill was moved out of skills into skill-archive. Use the restore button at the end of the row to put it back.',
  'tip.symlink':
    'This is a symlink to another location. Archiving moves only the link itself and leaves the target file untouched.',
  'row.symlink': 'Symlink',
  'note.removed': 'Another {count} were removed — only their call history is kept',

  'source.user-agents': 'User',
  'source.user-dsh': 'User·dsh',
  'source.project-agents': 'Project',
  'source.project-dsh': 'Project·dsh',
  'source.bundled': 'Bundled',

  'action.openDir': 'Open this skill folder in Finder',
  'action.archive': 'Archive (move to skill-archive)',
  'action.archiveBlocked': 'Bundled skill is read-only and cannot be archived',
  'action.restore': 'Restore to the skills directory',
  'action.openProject': 'Open the project folder in Finder',
  'action.openProjectLabel': 'Open project folder',

  'projects.title': 'Projects',
  'projects.subtitle': '{total} workspaces · {withSkills} with project-level skills',
  'projects.colWorkspace': 'Workspaces with project-level skills',
  'projects.colSkills': 'Project-level skills',
  'projects.archivedOnly': '{count} archived',
  'projects.empty': 'No project has added project-level skills yet',
  'projects.viewSkills': 'View skills →',
  'projects.noSkills': 'No project-level skills',
  'projects.rest': 'The other {count} workspaces have no project-level skills',
  'projects.restExpanded': 'Showing the other {count} workspaces',
  'projects.expand': 'Expand',
  'projects.collapse': 'Collapse',
  'projects.missing': 'Path missing',
  'projects.moreSkills': '+{count}',

  'detail.crumb': 'Projects',
  'detail.skillCountSuffix': ' project-level skills',
  'detail.tokensUnit': ' tokens',
  'detail.callsSuffix': ' calls',
  'detail.missing': 'Path missing',

  'toast.archived': 'Archived {name}',
  'toast.restored': 'Restored {name}',
  'toast.undo': 'Undo',
  'toast.openFailedCopied': 'Could not open Finder — path copied instead',
  'toast.openFailed': 'Could not open this folder in Finder',
}
