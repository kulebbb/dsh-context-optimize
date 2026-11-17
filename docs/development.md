# 开发与安装

## 本地开发

```bash
pnpm install
pnpm check        # typecheck + test + build
```

- 宿主半 `src/index.ts` + `src/host/**` → 打成 `lib/index.js`（ESM）
- 浏览器半 `src/client/**` → 打成 `lib/client.js`（CJS，外加 `window.__ModuleLoader__.load(...)` 外壳）
- 测试 `tests/**`：19 个 spec、287 条用例；全部落在 `os.tmpdir()`，不读真实 `~/.dsh` 或 `~/.agents`

`pnpm build` 会重写 `lib/`，CI 里有一步 `git diff --exit-code lib` 保证提交的产物和源码一致——改完源码记得一起提交产物。

## 装进 profile

DSH 的插件是以「profile 里的一条 bundle」形式加载的，和 `@kulebbb/dsh-output` 同一套做法。

桌面端（`desktop` profile）由应用独占管理，**命令行改不了它**——`dsh plugin --profile desktop add ...` 会报
`profile "desktop" is managed exclusively by the Electron application`。本地开发装进去用插件页：

```bash
# 1) 插件页「安装」时把目标填成本地仓库的绝对路径（等价于 link: 安装），
#    或者让 agent 的插件管理器执行 install_bundle；不要用 dsh plugin 改 desktop。
```

非桌面 profile（例如 Web 版用的）仍然可以用 CLI：

```bash
dsh plugin --profile <你的 profile 名> add "link:/path/to/dsh-context-optimize"
```

```jsonc
// 2) 编辑 ~/.dsh/profiles/desktop/package.json，把包名加进 bundles
{
  "dsh": {
    "profile": {
      "bundles": [
        // ...
        "@kulebbb/dsh-context-optimize"
      ]
    }
  }
}
```

3. **通常不用重启。** DSH 0.2.2 起 `dsh-hmr` 会监听 profile 与 patch，安装/启用后自动重组合；`dsh-client-hmr` 会把变化同步到已打开的页面。入口没出现时先刷新页面，仍没有就重启一次 DSH 排查。

### 回滚

在插件页卸载（或让插件管理器 `remove_bundle`），profile 里的依赖与 bundles 条目会一起清掉；
非桌面 profile 也可以用 CLI：`dsh plugin --profile <你的 profile 名> remove @kulebbb/dsh-context-optimize`。

> 卸载时如果 pnpm 走的是 `registry.npmjs.org` 而网络不通，会卡在依赖校验上（本项目实际遇到过，
> 报 `ERR_PNPM_META_FETCH_FAIL`）。可以给该 profile 的 `.npmrc` 临时指一个可用镜像源。

插件不改任何全局配置，回滚只是删两处引用。

## 排错

| 现象 | 先看哪里 |
| --- | --- |
| 侧边栏没有入口 | 客户端半要求 `slots` / `locale` / `remote` / `remote.session` 都在；缺任何一个它会静默跳过，不留死按钮。看 DSH 日志里有没有 `dsh-context-optimize`。 |
| 入口在但面板空白 | 宿主路由没注册成功（`connection` 服务缺失），面板会显示「服务未就绪」并可重试。 |
| 频次全是 0 | 首次回溯还没跑完（面板顶部有进度条）；或 `sessionQuery` 服务缺失，此时 `backfill.state` 会是 `partial`。 |
| 项目页空白 | `workspaceRegistry` 服务缺失。它属于 web 层 bundle，命令行跑 `dsh` 时可能没有。 |
| 调用次数对不上 | 口径是「模型加载该 skill 的次数 + 你手敲 `/skill名` 的次数」，按会话日志折叠，跳过已被处理过的 `seq`。缓存文件在 `~/.dsh/storages/dsh-context-optimize/frequency.v2.json`，删掉会重跑一次全量回溯（本机约 45 秒）。 |
| 洞察按钮点了没反应 | 宿主缺 `llm` 或 `sessionQuery` 时会明确报错；`agentDefaultModel` 缺失时下拉只剩兜底列表。看 DSH 日志里 `dsh-context-optimize` 的 warn。 |
| 洞察一直卡在「读取会话」 | 会话日志很多时读取会慢；单会话有 20 秒超时，超过上限（默认 300 个会话）的部分会被舍弃。 |
| 洞察报告想重跑一遍 | 标签缓存在 `~/.dsh/insight/facets/`，删掉对应会话的 json 就会重算；整份报告与索引在 `~/.dsh/insight/`，面板里也能删。 |

## 发布

1. 改版本号 → `pnpm check` → 提交（`lib/` 一起提交，CI 会校验两者一致）。
2. 打 tag 并推送：`git tag vX.Y.Z && git push origin vX.Y.Z`（`X.Y.Z` 与 `package.json` 的 `version` 相同。已发布的是 v0.1.0、v0.1.1、v0.1.2，没有 v0.2.0）。
3. GitHub Actions 的 `publish` workflow 在 tag 推送时发布到 npm。它需要仓库 secret `NPM_TOKEN`（npm automation token）；没有配置时该步骤会跳过并打一条提示，不会让 workflow 变红。

也可以本地手动发布：`npm publish --access public`。

## 磁盘上的位置

| 内容 | 路径 |
| --- | --- |
| 频次缓存 | `~/.dsh/storages/dsh-context-optimize/frequency.v2.json` |
| 全局归档箱 | `~/.agents/skills-archived`、`~/.dsh/skills-archived` |
| 项目归档箱 | `<项目根>/.agents/skills-archived`、`<项目根>/.dsh/skills-archived` |

归档目录与 `skills` **同级**，不会被 DSH 当成 skill 再扫到；全流程没有删除动作，还原就是把目录搬回原位。

归档目录名在 0.1.2 从 `skill-archive` 改为 `skills-archived`（与维护者本机既有目录对齐）。0.1.0 与 0.1.1 仍是 `skill-archive`。升级时不会自动搬运旧目录：旧条目不再显示，有过调用记录的会计入「另有 N 个已移除」，文件仍原样保留。手动迁移命令见 README「归档箱在哪」。
