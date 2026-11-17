# @kulebbb/dsh-context-optimize

[![npm](https://img.shields.io/npm/v/@kulebbb/dsh-context-optimize.svg)](https://www.npmjs.com/package/@kulebbb/dsh-context-optimize)
[![CI](https://github.com/kulebbb/dsh-context-optimize/actions/workflows/ci.yml/badge.svg)](https://github.com/kulebbb/dsh-context-optimize/actions/workflows/ci.yml)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**DSH（DeepSeek Harness）左侧边栏的 Skill 管理面板**：看清每个 skill 占了你多少上下文、多久没用了，没用的收起来。

![dsh-context-optimize 横幅](https://github.com/kulebbb/dsh-context-optimize/releases/download/v0.1.0/banner.png)

> **English.** A Skill manager for the DeepSeek Harness sidebar. It lists every installed skill with its call count, last-used date and estimated context cost, split into global and project scope, and archives or restores a skill by moving its directory into a reversible `skills-archived`.

## 它解决什么问题

DSH 每次开新会话，都会把「所有 skill 的名字和一句话介绍」预先塞进模型的上下文——哪怕这次一个都用不上。skill 装得越多，这份清单越贵，而你通常不知道哪些其实从来没被调用过。

这个插件把这件事摊开给你看：

- **列清楚**：全局（`~/.dsh/skills`、`~/.agents/skills`、App 内置 skill）与项目级（项目根下的 `.dsh/skills`、`.agents/skills`）分开看；
- **看得懂**：每条显示历史调用次数、最近使用时间、以及它在会话目录里占多少 tokens；
- **动得了**：一键归档（把目录移进同级的 `skills-archived`，全程不删除任何文件）与一键还原，还能直接打开 skill 所在目录。

## 截图 / Screenshots

### 全局总览

![主界面截图：全局 skill 总览与上下文预算](https://github.com/kulebbb/dsh-context-optimize/releases/download/v0.1.0/screenshot-overview.png)

顶部是上下文预算：所有生效中的 skill 加起来占多少 tokens、按占用排开的色带、历史调用与近 30 天调用。下面是明细表，可按调用次数或占用排序。

### 项目详情

![项目详情截图：同一套三态筛选与排序](https://github.com/kulebbb/dsh-context-optimize/releases/download/v0.1.0/screenshot-project.png)

点进任意工作区，看到的项目级 skill 与全局页用同一套筛选和表格：生效中 / 从未被调用 / 已归档三个状态互斥切换，各自带计数。

### 从未被调用

![从未被调用筛选截图：合计占用与列表](https://github.com/kulebbb/dsh-context-optimize/releases/download/v0.1.0/screenshot-never-called.png)

「从未被调用」会告诉你这些条目一共占了多少上下文——这一组通常就是最值得收起来的。

### 已归档

![已归档截图：行尾一键还原](https://github.com/kulebbb/dsh-context-optimize/releases/download/v0.1.0/screenshot-archived.png)

归档后条目进入同一张表的「已归档」状态，行尾一键还原，没有任何删除动作。

## 功能

- 全局 / 项目两个范围分开统计，项目范围按「项目根」聚合（见下方常见问题）；
- 每条 skill 显示调用次数、最近使用时间、估算上下文占用（名字 + 描述，再加目录行固定的 8 个字符，按 3.5 字符 ≈ 1 token 估算）；
- 状态筛选互斥三态，带计数；生效中可按调用次数或占用排序；
- 一键归档 / 还原：归档是把 skill 目录移到同级的 `skills-archived`，DSH 不会再加载它，随时可还原；
- 归档后 3 秒内可撤销；归档遇到同名会自动改名且不覆盖，还原遇到同名则拒绝且不覆盖；
- 行尾可直接打开 skill 目录，或在 Finder 中打开项目目录；
- 内置只读 skill 会被宿主拒绝归档，不依赖界面置灰；
- **洞察**：页头「洞察报告」按最近 30 天 / 90 天 / 全部，把本机人工会话压成摘要、逐会话打标签，再汇总成一份可行动的复盘（摩擦、有效习惯、建议、上下文卫生），报告存本机、面板直接看，也能导出独立 HTML。

## 安装

需要带左侧边栏面板槽位的 DSH 0.2.2 及以上（桌面端与 Web 版都可以）。

**方式一：插件页（推荐）**

侧边栏打开「插件」页 → 安装，填入 npm 包名：

```
@kulebbb/dsh-context-optimize
```

**方式二：CLI**

```bash
dsh plugin --profile desktop add @kulebbb/dsh-context-optimize
```

> GitHub 地址（`https://github.com/kulebbb/dsh-context-optimize`）也能装，但**不能应用内一键更新**——插件管理器只对「npm 同名安装」和「锁定到具体提交的 Git 安装」提供更新。想省心就用 npm。

**装完通常不用重启。** DSH 0.2.2 起支持插件热更新：安装、启用或升级后会自动重新组合，左侧边栏直接出现「Skill 管理」；没出现时先刷新页面，仍没有就重启一次 DSH。热重载会重置面板内部状态（当前筛选、滚动位置），数据不受影响。本包是 bundle（`package.json` 里 `dsh.bundle.patch` 指向自带的 `cordis.patch.yml`），由插件页负责启用/卸载，不需要手工改 profile。

## 更新

从 npm 安装的用户可以原地更新，不用卸载重装、通常也不用重启：

1. 侧边栏「插件」→「已安装」→ 右上角「刷新」，等头部出现「N 个插件可更新」；
2. 点开本插件，点顶部的「更新到 x」；或展开「版本」区，在目标版本右侧点「更新」；
3. 确认后自动「停止并移除旧版 → 安装新版」，安装失败会把旧版装回去；
4. 成功后热更新直接生效；只有界面提示「重启后生效」时才需要重启 DSH。

**0.2.0 起，面板页头还会出现「新版本 vX」胶囊**：它只负责提示和带路——点一下直接落到插件页的版本区，安装、回滚仍由 DSH 完成。没有新版、检查失败、或不是 npm 安装时，这个胶囊完全不显示。

`link:`（本地目录）与 GitHub 安装不会出现上面这两个入口——它们的依赖值不是 npm 版本号，插件管理器不支持应用内更新；这类安装请卸载后按 npm 方式重装。

## 使用

- **看总量**：打开面板先看预算卡——它是每次会话的固定目录开销，归档没用的 skill 会直接把它降下来。
- **找没用的**：点「从未被调用」，默认按占用降序，先砍最贵的。
- **归档**：行尾的归档按钮。想反悔就点提示条上的「撤销」；过了 3 秒也能在「已归档」里还原。
- **还原**：切到「已归档」，行尾还原按钮会把目录搬回原来那个根。
- **排序**：只有「生效中」状态显示排序按钮，在「按调用次数 / 按占用」之间切换。

### 调用次数是怎么来的

宿主会读本机会话日志里「模型加载某个 skill」的事件，外加你手敲 `/skill名` 直接触发的次数，按会话折叠成熟度数据。**首次启用时**要把历史会话扫一遍（本机 700+ 会话约 45 秒，面板顶部有进度条），之后靠增量累加。

缓存文件在 `~/.dsh/storages/dsh-context-optimize/`，删掉会重新跑一次全量扫描。

### 洞察报告

页头的「洞察报告」是另一种视角：不看库存，看用法。点「开始分析」后，宿主会读本机会话，先算确定性统计（轮次、工具、token、文件改动），再让模型给每个会话打标签，最后汇总成主题。

- **范围**：近 30 天 / 近 90 天 / 全部，默认只分析**人工会话**，子代理会话会被排除（否则会变成「子代理们干了什么」）；
- **模型**：默认跟随 DSH 的默认模型，也可以在下拉里换（下拉读的是 DSH 自己的模型目录）；
- **增量**：每个会话的标签缓存在 `~/.dsh/insight/facets/`，第二次分析只算新增或变过的会话；
- **产物**：`~/.dsh/insight/runs/<时间>/report.json` 与 `report.html`，索引在 `~/.dsh/insight/index.json`；关掉 DSH 也在；
- **侧边栏状态**：分析在跑时，左侧「Skill 管理」入口的文字上有一道冷色高光缓慢扫过（收起侧边栏时改为图标柔光，6 秒一轮）；跑完但还没看过的报告会让入口带一个蓝色小圆点，点开那份报告后消失；分析失败时换成琥珀色小圆点，进一次洞察面板即清掉。系统开启「减少动态效果」时不显示扫光，「未读」状态存在宿主索引里，重启和多窗口都一致。

### 归档箱在哪

| 范围 | 归档目录 |
| --- | --- |
| 全局 | `~/.dsh/skills-archived`、`~/.agents/skills-archived` |
| 项目 | `<项目根>/.dsh/skills-archived`、`<项目根>/.agents/skills-archived` |

归档目录和 `skills` 同级，DSH 不会把它当成 skill 再扫到。

> **升级提醒（0.1.0 / 0.1.1 → 0.1.2）**：归档目录名从 `skill-archive` 改成了 `skills-archived`（全局与项目一致）。插件不会自动搬旧目录，也不会删任何文件，所以旧目录里的条目**不会**出现在「已归档」里；其中有过调用记录的会被算成「已移除」，文件其实还在原处。
>
> 要接上历史归档，把存在的那几条命令跑一遍即可（`mkdir -p` 是必需的——新目录在第一次归档前不存在，直接 `mv` 会报错；`-n` 保证同名条目不覆盖）：
>
> ```bash
> mkdir -p ~/.agents/skills-archived && mv -n ~/.agents/skill-archive/* ~/.agents/skills-archived/
> mkdir -p ~/.dsh/skills-archived    && mv -n ~/.dsh/skill-archive/*    ~/.dsh/skills-archived/
> # 项目级：把 <项目根> 换成你的项目目录，.agents 与 .dsh 各跑一条
> ```
>
> 搬动会把条目的「归档时间」重置成搬动时刻（按 ctime 计），不影响还原。确认旧目录搬空后可以自行删除。

## 安全说明

- **全流程没有删除动作**：归档是移动目录，还原是搬回去；
- 客户端只传范围、根 ID、工作区 ID 和目录名，**绝对路径全部由宿主拼接**并做穿越校验；
- 内置只读 skill 不能被归档，拒绝发生在宿主端，不依赖界面；
- 「打开目录」走 DSH 官方桌面通道，不自己执行 shell 命令；
- **频次统计**只读会话日志里的工具调用事件和工作目录，不读对话正文；
- **洞察**会读会话里的用户消息与助手文本，并只在你点击「开始分析」时发送给当前模型提供商（工具输出原文不进 prompt）。报告与标签缓存只写在本机 `~/.dsh/insight/`，不上传。

## 常见问题

**洞察会不会把会话内容发到网上？**
会发给当前配置的模型提供商——这是分析本身。除此之外没有别的网络请求；报告是本地文件。不想发就别点「开始分析」，或者先把敏感会话删掉。

**洞察跑一次要多久、花多少？**
按本机 87 个人工会话粗算，首次 3–5 分钟、十来万 input tokens；之后因为标签有缓存，只算新增会话。面板里能看到本次实际用量。

**为什么有的 skill 调用次数是 0？**
统计只看会话日志里的 skill 加载事件。刚装好时先等首次回溯跑完；缓存被删后也会重新扫。

**归档之后 DSH 还会加载它吗？**
不会。目录已经移出 `skills` 根，DSH 扫描不到；还原后立刻恢复。

**「项目级 skill」的范围到底怎么算？**
DSH 会从会话工作目录往上找最近一个带 `.git` 的目录作为项目根（找不到就用工作区路径本身），项目级 skill 指项目根下的 `.dsh/skills` 与 `.agents/skills`。所以同一个项目根下的多个工作区会看到同一批项目级 skill。

**会改动我的配置或 skill 内容吗？**
不会。它只移动 skill 目录本身，不修改任何 skill 文件，也不写 DSH 配置。

**支持哪些平台？**
DSH 桌面端与 Web 版都可以，插件注册的是侧边栏入口 + 中央面板。

## 已知限制

- 英文界面里「今天 / 昨天」仍是中文（相对时间在共享代码里硬编码）；
- 历史缓存最多保留 5000 个会话，超过后「历史调用」不再是全部历史；
- 归档时间取目录的 ctime，之后如果目录元数据被改动，这个时间会刷新；
- 内置 skill 只读，不能归档；
- 同名 skill 的覆盖关系按 DSH 自己的优先级判定（项目 `.dsh` > 项目 `.agents` > 用户 `.dsh` > 用户 `.agents` > 内置）。

## 开发

```bash
pnpm install
pnpm check   # typecheck + test + build
```

- 宿主半：`src/index.ts` + `src/host/**` → `lib/index.js`（ESM）
- 浏览器半：`src/client/**` → `lib/client.js`（CJS + `window.__ModuleLoader__` 包装）
- 测试：`tests/**` 19 个 spec、279 条用例，全部落在 `os.tmpdir()`，不读真实 `~/.dsh` 或 `~/.agents`
- 本地调试用 `link:` 装进 profile，改完 `pnpm build` 后由热重载换上（通常不用重启；没生效时刷新页面或重启一次）；细节见 [`docs/development.md`](docs/development.md)

## 反馈

问题、建议、使用中的坑都欢迎开 [Issue](https://github.com/kulebbb/dsh-context-optimize/issues)。

## License

MIT
