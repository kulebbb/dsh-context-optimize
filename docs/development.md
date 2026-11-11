# 开发与安装

## 本地开发

```bash
pnpm install
pnpm check        # typecheck + test + build
```

- 宿主半 `src/index.ts` + `src/host/**` → 打成 `lib/index.js`（ESM）
- 浏览器半 `src/client/**` → 打成 `lib/client.js`（CJS，外加 `window.__ModuleLoader__.load(...)` 外壳）
- 测试 `tests/**`：8 个 spec、153 条用例；全部落在 `os.tmpdir()`，不读真实 `~/.dsh` 或 `~/.agents`

`pnpm build` 会重写 `lib/`，CI 里有一步 `git diff --exit-code lib` 保证提交的产物和源码一致——改完源码记得一起提交产物。

## 装进 profile

DSH 的插件是以「profile 里的一条 bundle」形式加载的，和 `@kulebbb/dsh-output` 同一套做法。

```bash
# 1) 以 link 方式加进 profile（把路径换成你的工程目录）
dsh plugin --profile desktop add "link:/path/to/dsh-context-optimize"
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

3. **重启 DSH App**。新增 bundle 只在启动时装配，热重载覆盖不到。

### 回滚

```bash
dsh plugin --profile desktop remove @kulebbb/dsh-context-optimize
# 再从 package.json 的 bundles 里删掉那一行，重启
```

插件不改任何全局配置，回滚只是删两处引用。

## 排错

| 现象 | 先看哪里 |
| --- | --- |
| 侧边栏没有入口 | 客户端半要求 `slots` / `locale` / `remote` / `remote.session` 都在；缺任何一个它会静默跳过，不留死按钮。看 DSH 日志里有没有 `dsh-context-optimize`。 |
| 入口在但面板空白 | 宿主路由没注册成功（`connection` 服务缺失），面板会显示「服务未就绪」并可重试。 |
| 频次全是 0 | 首次回溯还没跑完（面板顶部有进度条）；或 `sessionQuery` 服务缺失，此时 `backfill.state` 会是 `partial`。 |
| 项目页空白 | `workspaceRegistry` 服务缺失。它属于 web 层 bundle，命令行跑 `dsh` 时可能没有。 |
| 调用次数对不上 | 口径是「模型加载该 skill 的次数 + 你手敲 `/skill名` 的次数」，按会话日志折叠，跳过已被处理过的 `seq`。缓存文件在 `~/.dsh/storages/dsh-context-optimize/frequency.v1.json`，删掉会重跑一次全量回溯（本机约 45 秒）。 |

## 磁盘上的位置

| 内容 | 路径 |
| --- | --- |
| 频次缓存 | `~/.dsh/storages/dsh-context-optimize/frequency.v1.json` |
| 全局归档箱 | `~/.agents/skill-archive`、`~/.dsh/skill-archive` |
| 项目归档箱 | `<项目根>/.agents/skill-archive`、`<项目根>/.dsh/skill-archive` |

归档目录与 `skills` **同级**，不会被 DSH 当成 skill 再扫到；全流程没有删除动作，还原就是把目录搬回原位。
