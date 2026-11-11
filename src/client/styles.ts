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
export const PANEL_CSS = `
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
`
