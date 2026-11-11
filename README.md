# dsh-context-optimize

DSH（DeepSeek Harness）左侧边栏的 **Skill 管理** 面板：把本机所有 skill 摊开，看清楚谁在占用你的上下文。

## 它解决什么问题

会话每次开始，模型都会被预先塞进一份「所有 skill 的名字和一句话介绍」的清单——哪怕这次一个都用不上。skill 装得越多，这份清单纯占的上下文就越大，而**你并不知道哪些从来没用过**。

这个面板做三件事：

1. **列清楚**：全局（`~/.dsh/skills`、`~/.agents/skills`、App 内置 office skill）与项目级（项目根下的 `.dsh/skills` 与 `.agents/skills`）分开看；
2. **看得懂**：每条显示调用次数、最近使用时间、以及在会话目录里占多少 tokens；
3. **动得了**：一键归档（把 skill 目录移到同级的 `skill-archive`，可逆软删除）与一键还原，还能直接在 Finder 中打开 skill 目录。

## 界面

侧边栏新增一项，位置与「插件」「自动化任务」同级。点开是中央面板：

- 顶部**上下文预算卡**：总 token 数、按占用拆开的色带、四个计数；
- 状态筛选：**生效中 / 从未被调用 / 已归档**（互斥，带计数）；
- 表格六列：SKILL / 来源 / 调用 / 最近使用 / 占用 / 操作；
- 项目页：工作区列表 → 点进去看该项目自己的 skill，用的是同一套三态筛选与排序（归档也收进状态里，不再是单独一块版面）。

## 安装

```bash
dsh plugin --profile desktop add "link:/path/to/dsh-context-optimize"
```

然后在 profile 的 `package.json` 里把 `@kulebbb/dsh-context-optimize` 加进 `dsh.profile.bundles`，重启 DSH。

## 安全性

- 归档是**移动目录**，全流程没有任何删除动作；
- 归档目录与 `skills` 同级（`<root>/skill-archive`），不会被 DSH 当成 skill 再加载；
- 客户端只传根 ID、工作区 ID 和目录名，**绝对路径全部由宿主拼**，并做穿越校验；
- 内置只读 skill 不能归档（宿主端拒绝，不依赖界面置灰）；
- 「打开目录」走 DSH 官方桌面通道，不自己执行 shell 命令。

## 开发

```bash
pnpm install
pnpm check   # typecheck + test + build
```

产物：`lib/index.js`（宿主，ESM）、`lib/client.js`（浏览器，CJS + `window.__ModuleLoader__` 包装）。

## License

MIT
