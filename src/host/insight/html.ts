/**
 * 把一份报告导出成自包含 HTML。
 *
 * 约束：不引用任何外部资源（字体、脚本、图片），双击就能看；深浅色跟随系统。
 * 动态文本一律转义——报告里有用户消息的原话，不能直接拼进标签。
 */
import type { InsightReport } from '../../shared/insight.ts'

/** HTML 转义。 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function pad2(value: number): string {
  return value < 10 ? `0${String(value)}` : String(value)
}

/** ISO → 本地 `YYYY-MM-DD HH:mm`。 */
function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${String(date.getFullYear())}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 千分位。 */
function num(value: number): string {
  return value.toLocaleString('en-US')
}

/** 分钟数。 */
function minutes(ms: number): string {
  return `${String(Math.max(1, Math.round(ms / 60000)))} 分钟`
}

/** token 的简短写法。 */
function tokens(value: number): string {
  if (value >= 10_000) return `${(value / 10_000).toFixed(1)} 万`
  return num(value)
}

const WHERE_LABEL: Record<string, string> = {
  agents: 'AGENTS.md',
  skill: 'skill',
  workflow: 'workflow',
  config: '配置',
  other: '其他',
}

/** 样式：与 DSH 面板的深色气质一致，但不依赖宿主的 token。 */
const CSS = `
:root{color-scheme:light dark;--paper:#fbfaf9;--surface:#fff;--ink:#15171c;--ink2:#4a505e;--ink3:#838b9c;
--line:#e4e2de;--line2:#efeef0;--blue:#2e63d8;--green:#1b8656;--green-bg:#e8f5ee;--red:#b03a2e;--red-bg:#fbeae7;
--amber:#a8690c;--amber-bg:#fbf1e0;--violet:#7343c9;--violet-bg:#f2ecfc;--code:#f4f3f0}
@media (prefers-color-scheme:dark){:root{--paper:#101216;--surface:#171a20;--ink:#eceae6;--ink2:#a8aebc;--ink3:#6e7688;
--line:#282c35;--line2:#21252c;--blue:#7ba3f5;--green:#4cc08a;--green-bg:#10281e;--red:#e58579;--red-bg:#33201c;
--amber:#dfa64a;--amber-bg:#2a2013;--violet:#b48cf0;--violet-bg:#221836;--code:#1c2027}}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.75 -apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif}
.wrap{max-width:860px;margin:0 auto;padding:56px 24px 90px;display:flex;flex-direction:column;gap:34px}
h1{font-size:28px;line-height:1.35;margin:0 0 10px;letter-spacing:-.01em}
h2{font-size:18px;margin:0 0 14px;padding-bottom:9px;border-bottom:1.5px solid var(--ink)}
h3{font-size:15px;margin:0}
p{margin:0}
.eyebrow{font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3)}
.lede{margin-top:12px;color:var(--ink2);max-width:64ch}
.meta{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}
.tag{font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--code);border:1px solid var(--line2);
color:var(--ink2);border-radius:4px;padding:3px 9px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
@media (max-width:720px){.grid3{grid-template-columns:1fr}}
.card{border-radius:10px;padding:14px 16px;display:flex;flex-direction:column;gap:6px}
.card .k{font:10.5px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.12em;text-transform:uppercase}
.card.good{background:var(--green-bg)} .card.good .k{color:var(--green)}
.card.bad{background:var(--red-bg)} .card.bad .k{color:var(--red)}
.card.next{background:var(--violet-bg)} .card.next .k{color:var(--violet)}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:1px;background:var(--line);border:1px solid var(--line);
border-radius:8px;overflow:hidden}
@media (max-width:760px){.stats{grid-template-columns:repeat(3,1fr)}}
.stat{background:var(--surface);padding:13px 15px;display:flex;flex-direction:column;gap:2px}
.stat b{font:600 20px/1.3 ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.stat span{font-size:11.5px;color:var(--ink3)}
.panel{border:1px solid var(--line);border-radius:8px;padding:18px 20px;background:var(--surface)}
.bars{display:flex;flex-direction:column;gap:8px}
.brow{display:grid;grid-template-columns:150px 1fr 78px;gap:10px;align-items:center;font-size:12.5px}
.brow .lab{color:var(--ink2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brow .track{height:8px;border-radius:99px;background:var(--code);overflow:hidden}
.brow .track i{display:block;height:100%;background:var(--blue);border-radius:99px}
.brow .n{text-align:right;font-family:ui-monospace,Menlo,monospace;color:var(--ink3);font-size:12px;white-space:nowrap}
.hours{display:flex;align-items:flex-end;gap:3px;height:84px;margin-top:8px}
.hours i{flex:1;min-height:2px;background:var(--blue);opacity:.55;border-radius:2px 2px 0 0}
.hours i.hot{background:var(--violet);opacity:.9}
.hours-x{display:flex;gap:3px;margin-top:5px;font:10px ui-monospace,Menlo,monospace;color:var(--ink3)}
.hours-x span{flex:1;text-align:center}
.fric{border:1px solid var(--line2);border-radius:8px;padding:12px 14px;margin-bottom:10px;background:var(--code)}
.fric .t{display:flex;gap:10px;align-items:baseline}
.fric .t b{font-size:13.5px}
.fric .t .n{margin-left:auto;font:12px ui-monospace,Menlo,monospace;color:var(--red)}
.fric .d{font-size:12.5px;color:var(--ink2);margin-top:4px}
.ex{margin-top:8px;padding-left:10px;border-left:2px solid var(--line);font-size:12.5px;color:var(--ink2)}
.ex .src{font:11px ui-monospace,Menlo,monospace;color:var(--ink3);margin-top:2px}
ol.clean{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px}
ol.clean li{display:flex;gap:10px;font-size:13px;color:var(--ink2)}
ol.clean li .n{font:12px ui-monospace,Menlo,monospace;color:var(--green);flex:none}
ol.clean li b{color:var(--ink)}
.sugg{border:1px solid var(--line2);border-radius:8px;padding:11px 13px;margin-bottom:9px;display:grid;
grid-template-columns:auto 1fr;gap:10px;align-items:start}
.where{font:10px/1.6 ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.08em;
background:var(--violet-bg);color:var(--violet);border-radius:4px;padding:2px 6px;white-space:nowrap}
.sugg .what b{display:block;font-size:13px;color:var(--ink)}
.sugg .what span{font-size:12.5px;color:var(--ink2)}
.sugg code{display:block;margin-top:6px;font:12px/1.6 ui-monospace,Menlo,monospace;background:var(--code);
border-radius:4px;padding:6px 8px;color:var(--ink2);white-space:pre-wrap;word-break:break-word}
.hyg{display:flex;gap:18px;flex-wrap:wrap;align-items:center}
.hyg .big{font:600 24px/1.2 ui-monospace,Menlo,monospace;font-variant-numeric:tabular-nums}
.hyg .big small{font:12px/1.4 inherit;color:var(--ink3);margin-left:3px;font-weight:400}
.hyg .cap{font-size:12px;color:var(--ink3)}
.foot{border-top:1px solid var(--line);padding-top:16px;font:12px/1.7 ui-monospace,Menlo,monospace;color:var(--ink3)}
`

/** 生成完整 HTML。 */
export function renderReportHtml(report: InsightReport): string {
  const { meta, glance, stats, projects, tools, hours } = report
  const maxProject = Math.max(1, ...projects.map((item) => item.sessions))
  const maxTool = Math.max(1, ...tools.map((item) => item.calls))
  const maxHour = Math.max(1, ...hours.map((item) => item.sessions))
  const windowLabel = meta.days === null ? '全部历史' : `近 ${String(meta.days)} 天`

  const projectRows = projects
    .slice(0, 8)
    .map(
      (item) =>
        `<div class="brow"><span class="lab">${escapeHtml(item.name)}</span><span class="track"><i style="width:${String(
          Math.round((item.sessions / maxProject) * 100),
        )}%"></i></span><span class="n">${num(item.sessions)}</span></div>`,
    )
    .join('')

  const toolRows = tools
    .slice(0, 8)
    .map(
      (item) =>
        `<div class="brow"><span class="lab">${escapeHtml(item.name)}</span><span class="track"><i style="width:${String(
          Math.round((item.calls / maxTool) * 100),
        )}%"></i></span><span class="n">${num(item.calls)}${item.failures > 0 ? ` · ${String(item.failures)} 败` : ''}</span></div>`,
    )
    .join('')

  const hourBars = hours
    .map(
      (item) =>
        `<i class="${item.hour >= 21 || item.hour === 0 ? 'hot' : ''}" style="height:${String(
          Math.max(2, Math.round((item.sessions / maxHour) * 100)),
        )}%"></i>`,
    )
    .join('')
  const hourAxis = [0, 3, 6, 9, 12, 15, 18, 21, 24].map((hour) => `<span>${String(hour)}</span>`).join('')

  const frictionHtml = report.frictions
    .map(
      (friction) => `<div class="fric">
  <div class="t"><b>${escapeHtml(friction.title)}</b><span class="n">${String(friction.count)} 次</span></div>
  <div class="d">${escapeHtml(friction.detail)}</div>
  ${friction.examples
    .map(
      (example) => `<div class="ex">「${escapeHtml(example.quote)}」
    <div class="src">${escapeHtml(example.project)} · ${escapeHtml(example.date)} · 会话 ${escapeHtml(example.sessionId)}</div>
  </div>`,
    )
    .join('\n  ')}
</div>`,
    )
    .join('\n')

  const winsHtml = report.wins
    .map(
      (win, index) =>
        `<li><span class="n">${pad2(index + 1)}</span><span><b>${escapeHtml(win.title)}</b> ${escapeHtml(win.detail)}</span></li>`,
    )
    .join('')

  const suggestionsHtml = report.suggestions
    .map(
      (item) => `<div class="sugg"><span class="where">${escapeHtml(WHERE_LABEL[item.where] ?? '其他')}</span>
  <span class="what"><b>${escapeHtml(item.title)}</b><span>${escapeHtml(item.detail)}</span>${
    item.snippet === '' ? '' : `<code>${escapeHtml(item.snippet)}</code>`
  }</span></div>`,
    )
    .join('')

  const hygieneHtml =
    report.hygiene === null
      ? ''
      : `<section class="panel"><h2>上下文卫生</h2>
  <div class="hyg">
    <div><div class="big">${String(report.hygiene.active)}<small>个常驻 skill</small></div><div class="cap">每次会话固定开销</div></div>
    <div><div class="big" style="color:var(--amber)">${String(report.hygiene.unused30d)}<small>个近 30 天未用</small></div><div class="cap">占 ${num(report.hygiene.unusedTokens)} tokens</div></div>
    ${report.hygiene.examples.length > 0 ? `<div class="cap">例如 ${escapeHtml(report.hygiene.examples.join('、'))}，可以在面板里归档。</div>` : ''}
    ${report.hygiene.complete ? '' : '<div class="cap" style="color:var(--amber)">频次统计还没回填完成，这里的数字可能偏高。</div>'}
  </div></section>`

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>洞察报告 · ${escapeHtml(formatTime(meta.startedAt))}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="eyebrow">DSH 洞察 · ${escapeHtml(formatTime(meta.startedAt))}</div>
    <h1>这段时间你是怎么用 DSH 的</h1>
    <p class="lede">读本机会话得到的复盘：先看哪些习惯有效、哪些摩擦反复出现，再挑一件事改。数字来自会话日志，文字判断来自模型。</p>
    <div class="meta">
      <span class="tag">${escapeHtml(windowLabel)}</span>
      <span class="tag">${String(stats.sessions)} 个会话</span>
      <span class="tag">${escapeHtml(meta.provider)}/${escapeHtml(meta.model)}</span>
      <span class="tag">用时 ${minutes(meta.durationMs)}</span>
      <span class="tag">${tokens(meta.tokens)} tokens</span>
    </div>
  </header>

  <section>
    <h2>先看这三条</h2>
    <div class="grid3">
      <div class="card good"><span class="k">在起作用的</span><span>${escapeHtml(glance.working)}</span></div>
      <div class="card bad"><span class="k">最拖后腿的</span><span>${escapeHtml(glance.friction)}</span></div>
      <div class="card next"><span class="k">先改一件事</span><span>${escapeHtml(glance.next)}</span></div>
    </div>
  </section>

  <div class="stats">
    <div class="stat"><b>${num(stats.sessions)}</b><span>分析的会话</span></div>
    <div class="stat"><b>${num(stats.messages)}</b><span>你的消息</span></div>
    <div class="stat"><b>${num(stats.toolCalls)}</b><span>工具调用</span></div>
    <div class="stat"><b>${num(stats.activeDays)}</b><span>活跃天数</span></div>
    <div class="stat"><b>${num(stats.toolFailures)}</b><span>失败的工具调用</span></div>
  </div>

  <section class="panel">
    <h2>你在哪些项目上花时间</h2>
    <div class="bars">${projectRows}</div>
  </section>

  <section class="panel">
    <h2>最常用的工具</h2>
    <div class="bars">${toolRows}</div>
  </section>

  <section class="panel">
    <h2>一天里的节奏</h2>
    <div class="hours">${hourBars}</div>
    <div class="hours-x">${hourAxis}</div>
  </section>

  <section>
    <h2>反复卡住的 ${String(report.frictions.length)} 类事</h2>
    ${frictionHtml}
  </section>

  <section class="panel">
    <h2>有效的习惯</h2>
    <ol class="clean">${winsHtml}</ol>
  </section>

  <section class="panel">
    <h2>建议：只挑一条改</h2>
    ${suggestionsHtml}
  </section>

  ${hygieneHtml}

  <section class="panel">
    <h2>顺手记下的一幕</h2>
    <p style="color:var(--ink2);font-size:13px">${escapeHtml(report.fun)}</p>
  </section>

  <div class="foot">
    分析于 ${escapeHtml(formatTime(meta.startedAt))} · 用时 ${minutes(meta.durationMs)} · ${tokens(meta.tokens)} tokens<br>
    覆盖 ${num(stats.sessions)} 个会话（已排除 ${num(stats.excludedSubagent)} 个非人工会话、${num(stats.excludedOld)} 个超出时间窗口${stats.excludedCapped > 0 ? `、${num(stats.excludedCapped)} 个超出单次上限` : ''}）· 其中 ${num(stats.failedSessions)} 个打标签失败
  </div>
</div>
</body>
</html>`
}
