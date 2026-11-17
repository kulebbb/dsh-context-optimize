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

/* ---------- 新版本入口：胶囊 + 悬停提示 ---------- */
.dscx-update{position:relative;display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:999px;background:transparent;
  color:var(--dsw-alias-label-primary);font:var(--dsw-font-xxs-12);white-space:nowrap}
.dscx-update:hover{background:var(--dsw-alias-interactive-bg-hover);border-color:var(--dsw-alias-border-l3)}
.dscx-update:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
.dscx-update-v{font-family:var(--ds-font-family-code);color:var(--dsw-alias-state-business-primary)}
.dscx-update-tip{position:absolute;top:calc(100% + 8px);right:0;z-index:5;width:max-content;max-width:280px;
  padding:7px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);
  font:var(--dsw-font-xxs-12);line-height:1.5;text-align:left;white-space:normal;
  box-shadow:var(--dsw-shadow-lv3);opacity:0;transform:translateY(-2px);pointer-events:none;
  transition:opacity var(--ds-transition-duration-fast) var(--ds-ease-in-out),transform var(--ds-transition-duration-fast) var(--ds-ease-in-out)}
.dscx-update:hover .dscx-update-tip,.dscx-update:focus-visible .dscx-update-tip{opacity:1;transform:none}

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


/* ═══════════ 洞察 ═══════════ */
/* ---------- 入口与页头 ---------- */
.dscx-i-head{display:flex;align-items:flex-start;gap:16px}
.dscx-i-head .dscx-ph-title{display:flex;flex-direction:column;gap:5px;min-width:0}
.dscx-i-back{display:inline-flex;align-items:center;gap:5px;height:28px;padding:0 10px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);white-space:nowrap}
.dscx-i-back:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}

/* ---------- 卡片与表单 ---------- */
.dscx-i-card{display:flex;flex-direction:column;gap:14px;padding:18px 20px;
  border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md);
  background:var(--dsw-alias-bg-layer-1)}
.dscx-i-card-h{display:flex;align-items:baseline;gap:10px;font:var(--dsw-font-s-14);font-weight:600}
.dscx-i-card-h .right{margin-left:auto;font:var(--dsw-font-xxs-12);font-weight:400;
  color:var(--dsw-alias-label-caption)}
.dscx-i-lead{font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-secondary);max-width:62ch;margin:0}
.dscx-i-flow{display:flex;flex-wrap:wrap;align-items:center;gap:7px;
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption)}
.dscx-i-flow span{display:inline-flex;align-items:center;height:22px;padding:0 9px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);
  color:var(--dsw-alias-label-secondary)}
.dscx-i-form{display:flex;flex-direction:column;gap:12px;border-top:1px solid var(--dsw-alias-border-l1);
  padding-top:14px}
.dscx-i-field{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.dscx-i-field>label{width:56px;flex:none;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption)}
.dscx-i-field .v{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dscx-i-field .v b{color:var(--dsw-alias-label-primary);font-weight:600}
.dscx-i-select{height:30px;max-width:420px;min-width:180px;padding:0 10px;
  border:1px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm);
  background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);
  font:var(--dsw-font-xxs-12)}
.dscx-i-select:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:1px}
.dscx-i-primary{display:inline-flex;align-items:center;gap:6px;height:32px;padding:0 14px;
  border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-state-business-primary);
  color:#fff;font:var(--dsw-font-xs-13);font-weight:500}
.dscx-i-primary:hover{filter:brightness(1.06)}
.dscx-i-primary:disabled{opacity:.45;filter:none}
.dscx-i-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.dscx-i-privacy{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);max-width:46ch}

/* ---------- 运行中 ---------- */
.dscx-i-run{display:flex;flex-direction:column;gap:14px}
.dscx-i-run-top{display:flex;align-items:center;gap:10px}
.dscx-i-badge{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;
  border-radius:999px;font:var(--dsw-font-xxs-12);font-weight:500;
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 14%,transparent);
  color:var(--dsw-alias-state-business-primary)}
.dscx-i-badge::before{content:"";width:6px;height:6px;border-radius:50%;
  background:var(--dsw-alias-state-business-primary);animation:dscx-pulse 1.4s ease-in-out infinite}
.dscx-i-badge.done{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);
  color:var(--dsw-alias-state-success-primary)}
.dscx-i-badge.done::before{background:var(--dsw-alias-state-success-primary);animation:none}
.dscx-i-badge.fail{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);
  color:var(--dsw-alias-state-error-primary)}
.dscx-i-badge.fail::before{background:var(--dsw-alias-state-error-primary);animation:none}
@keyframes dscx-pulse{50%{opacity:.35}}
.dscx-i-run-top .elapsed{margin-left:auto;font-family:var(--ds-font-family-code);font-size:12px;
  color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dscx-i-bar{height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.dscx-i-bar i{display:block;height:100%;border-radius:999px;
  background:var(--dsw-alias-state-business-primary);transition:width .3s ease}
.dscx-i-phases{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
@media (max-width:640px){.dscx-i-phases{grid-template-columns:repeat(2,minmax(0,1fr))}}
.dscx-i-phase{padding:9px 11px;border:1px solid var(--dsw-alias-border-l1);
  border-radius:var(--dsw-radius-sm);display:flex;flex-direction:column;gap:2px;min-width:0}
.dscx-i-phase b{font:var(--dsw-font-xxs-12);font-weight:500;color:var(--dsw-alias-label-secondary)}
.dscx-i-phase span{font-family:var(--ds-font-family-code);font-size:11px;
  color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums}
.dscx-i-phase.done{border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,var(--dsw-alias-border-l1));
  background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}
.dscx-i-phase.done b{color:var(--dsw-alias-state-success-primary)}
.dscx-i-phase.now{border-color:var(--dsw-alias-state-business-primary);
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dscx-i-phase.now b{color:var(--dsw-alias-state-business-primary)}
.dscx-i-current{display:flex;align-items:center;gap:9px;padding:9px 12px;
  border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);min-width:0}
.dscx-i-current .t{font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-primary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dscx-i-err{padding:9px 12px;border-radius:var(--dsw-radius-sm);font:var(--dsw-font-xxs-12);
  background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);
  color:var(--dsw-alias-state-error-primary)}
.dscx-i-note{padding:9px 12px;border-radius:var(--dsw-radius-sm);font:var(--dsw-font-xxs-12);
  background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 10%,transparent);
  color:var(--dsw-alias-state-warn-primary)}

/* ---------- 历史列表 ---------- */
.dscx-i-list{display:flex;flex-direction:column}
.dscx-i-row{display:flex;align-items:center;gap:12px;padding:10px 0;
  border-top:1px solid var(--dsw-alias-border-l1);min-width:0}
.dscx-i-row:first-child{border-top:0;padding-top:2px}
.dscx-i-row .when{width:118px;flex:none;font-family:var(--ds-font-family-code);font-size:12px;
  color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.dscx-i-row .meta{display:flex;gap:7px;flex-wrap:wrap;font:var(--dsw-font-xxs-12);
  color:var(--dsw-alias-label-tertiary);min-width:0}
.dscx-i-row .meta b{color:var(--dsw-alias-label-secondary);font-weight:500;
  font-family:var(--ds-font-family-code)}
.dscx-i-row .acts{margin-left:auto;display:flex;gap:6px;flex:none}
.dscx-i-empty{padding:22px 0;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-tertiary);text-align:center}

/* ---------- 报告 ---------- */
.dscx-i-report{display:flex;flex-direction:column;gap:18px}
.dscx-i-crumb{display:flex;align-items:center;gap:8px;flex-wrap:wrap;
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-caption)}
.dscx-i-crumb .code{font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-secondary)}
.dscx-i-tag{display:inline-flex;align-items:center;height:21px;padding:0 8px;border-radius:4px;
  background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);
  font-size:11px;font-family:var(--ds-font-family-code)}
.dscx-i-tag.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 12%,transparent);
  color:var(--dsw-alias-state-success-primary)}
.dscx-i-g3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}
@media (max-width:720px){.dscx-i-g3{grid-template-columns:1fr}}
.dscx-i-g{padding:12px 14px;border-radius:var(--dsw-radius-sm);display:flex;flex-direction:column;gap:5px}
.dscx-i-g .k{font-size:10px;font-family:var(--ds-font-family-code);letter-spacing:.12em;text-transform:uppercase}
.dscx-i-g .v{font:var(--dsw-font-xxs-12);line-height:1.65;color:var(--dsw-alias-label-secondary)}
.dscx-i-g.good{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent)}
.dscx-i-g.good .k{color:var(--dsw-alias-state-success-primary)}
.dscx-i-g.bad{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}
.dscx-i-g.bad .k{color:var(--dsw-alias-state-error-primary)}
.dscx-i-g.next{background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 10%,transparent)}
.dscx-i-g.next .k{color:var(--dsw-alias-state-business-primary)}
.dscx-i-stats{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:1px;
  background:var(--dsw-alias-border-l1);border:1px solid var(--dsw-alias-border-l1);
  border-radius:var(--dsw-radius-md);overflow:hidden}
@media (max-width:760px){.dscx-i-stats{grid-template-columns:repeat(3,minmax(0,1fr))}}
.dscx-i-stat{background:var(--dsw-alias-bg-layer-1);padding:12px 14px;display:flex;
  flex-direction:column;gap:1px;min-width:0}
.dscx-i-stat b{font-family:var(--ds-font-family-code);font-size:19px;font-weight:600;
  font-variant-numeric:tabular-nums;letter-spacing:-.02em;line-height:1.35}
.dscx-i-stat span{font-size:11px;color:var(--dsw-alias-label-tertiary);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dscx-i-bars{display:flex;flex-direction:column;gap:8px}
.dscx-i-brow{display:grid;grid-template-columns:130px minmax(0,1fr) 82px;gap:10px;align-items:center;
  font:var(--dsw-font-xxs-12)}
.dscx-i-brow .lab{color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;
  white-space:nowrap}
.dscx-i-brow .track{height:7px;border-radius:999px;background:var(--dsw-alias-bg-layer-3);overflow:hidden}
.dscx-i-brow .track i{display:block;height:100%;border-radius:999px;
  background:var(--dsw-alias-state-business-primary);opacity:.85}
.dscx-i-brow .n{text-align:right;font-family:var(--ds-font-family-code);font-size:11.5px;
  color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;white-space:nowrap}
.dscx-i-hours{display:flex;align-items:flex-end;gap:3px;height:72px;margin-top:4px}
.dscx-i-hours i{flex:1;min-height:2px;border-radius:2px 2px 0 0;
  background:var(--dsw-alias-state-business-primary);opacity:.55}
.dscx-i-hours i.hot{opacity:.95}
.dscx-i-hours-x{display:flex;gap:3px;margin-top:5px;
  font-size:10px;font-family:var(--ds-font-family-code);color:var(--dsw-alias-label-tertiary)}
.dscx-i-hours-x span{flex:1;text-align:center}
.dscx-i-fric{border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);
  padding:11px 13px;background:var(--dsw-alias-bg-base)}
.dscx-i-fric+.dscx-i-fric{margin-top:8px}
.dscx-i-fric summary{display:flex;align-items:center;gap:10px;cursor:pointer;list-style:none;
  font:var(--dsw-font-xs-13)}
.dscx-i-fric summary::-webkit-details-marker{display:none}
.dscx-i-fric summary .n{font-family:var(--ds-font-family-code);font-size:11px;
  color:var(--dsw-alias-label-tertiary)}
.dscx-i-fric summary .cnt{margin-left:auto;font-family:var(--ds-font-family-code);font-size:11.5px;
  color:var(--dsw-alias-state-error-primary);font-variant-numeric:tabular-nums}
.dscx-i-fric .d{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);margin-top:6px}
.dscx-i-fric[open] summary{padding-bottom:8px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.dscx-i-ex{margin-top:8px;padding-left:10px;border-left:2px solid var(--dsw-alias-border-l2);
  font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dscx-i-ex .src{margin-top:2px;font-family:var(--ds-font-family-code);font-size:11px;
  color:var(--dsw-alias-label-tertiary)}
.dscx-i-ol{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:9px}
.dscx-i-ol li{display:flex;gap:10px;font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary)}
.dscx-i-ol li .n{flex:none;font-family:var(--ds-font-family-code);
  color:var(--dsw-alias-state-success-primary)}
.dscx-i-ol li b{color:var(--dsw-alias-label-primary);font-weight:600}
.dscx-i-sugg{display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:10px;align-items:start;
  padding:11px 13px;border:1px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm)}
.dscx-i-sugg+.dscx-i-sugg{margin-top:8px}
.dscx-i-where{font-size:10px;font-family:var(--ds-font-family-code);letter-spacing:.08em;text-transform:uppercase;
  padding:2px 6px;border-radius:4px;white-space:nowrap;
  background:color-mix(in srgb,var(--dsw-alias-state-business-primary) 12%,transparent);
  color:var(--dsw-alias-state-business-primary)}
.dscx-i-sugg .what{font:var(--dsw-font-xxs-12);color:var(--dsw-alias-label-secondary);min-width:0}
.dscx-i-sugg .what b{display:block;font:var(--dsw-font-xs-13);color:var(--dsw-alias-label-primary);
  font-weight:600;margin-bottom:2px}
.dscx-i-sugg .what code{display:block;margin-top:6px;padding:6px 8px;border-radius:4px;
  background:var(--dsw-alias-bg-base);font:11.5px/1.6 var(--ds-font-family-code);
  color:var(--dsw-alias-label-secondary);white-space:pre-wrap;word-break:break-word}
.dscx-i-hyg{display:flex;align-items:center;gap:22px;row-gap:12px;flex-wrap:wrap}
.dscx-i-hyg .big{font-family:var(--ds-font-family-code);font-size:23px;font-weight:600;
  font-variant-numeric:tabular-nums;line-height:1.25}
.dscx-i-hyg .big small{font-size:11.5px;color:var(--dsw-alias-label-tertiary);
  font-weight:400;margin-left:3px}
.dscx-i-hyg .cap{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dscx-i-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap;
  font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.dscx-i-foot .right{margin-left:auto;display:flex;gap:6px}

@media (prefers-reduced-motion:reduce){
  .dscx-spinner{animation:none}
  .dscx-progress-fill{transition:none}
  .dscx-tip{transition:none}
}

/* ===== 侧边栏入口：运行中扫光 / 未读点 / 收起态柔光 =====
   侧边栏那行是 DSH 自己渲染的，我们只有一个图标节点在里面。
   所以用「结构选择器 + :has()」从图标反选到整行，再选中它渲染的文字节点，
   不依赖 DSH 的哈希类名，升级后也不容易失效。 */
.dscx-nav{position:relative;display:inline-flex;align-items:center;justify-content:center}

/* 92% / 8% 是「高光带完全出画」的位置：停在两端时文字看不出残留的蓝边。 */
@keyframes dscx-nav-sweep{
  0%{background-position:92% 0}
  35%{background-position:8% 0}
  100%{background-position:8% 0}
}
@keyframes dscx-nav-breathe{
  0%,100%{opacity:.1;transform:scale(.84)}
  35%{opacity:.72;transform:scale(1.06)}
  64%{opacity:.16;transform:scale(.92)}
}

/* 展开时：文字被一道冷色高光缓慢扫过。
   注意：这里给文字节点设了 animation，会覆盖 DSH 自己在展开时用的 0.2s 入场动画
   （panelTitle.wide）。代价是展开瞬间少了那一下淡入，换的是稳定的扫光，值得。
   高光带从文字左外侧走到右外侧：background-size 300% 时，
   高光中心在图像 50% 处，对应 background-position-x 从 82% 到 18%。 */
button:has(> span > .dscx-nav[data-dco-nav="running"]) > span + span:last-child{
  /* 文字本色不动，只让扫过的那一段变成浅冷蓝（品牌色在深色主题下就是 #7aaaff） */
  --dscx-sweep-base:var(--dsw-alias-label-primary);
  --dscx-sweep-band:var(--dsw-alias-state-business-primary,#7aaaff);
  background-image:linear-gradient(100deg,
    var(--dscx-sweep-base) 0%,var(--dscx-sweep-base) 40%,
    var(--dscx-sweep-band) 50%,
    var(--dscx-sweep-base) 60%,var(--dscx-sweep-base) 100%);
  background-size:300% 100%;
  background-repeat:no-repeat;
  -webkit-background-clip:text;
  background-clip:text;
  color:transparent;
  -webkit-text-fill-color:transparent;
  animation:dscx-nav-sweep 6s cubic-bezier(.45,0,.55,1) infinite;
}

/* 收起时没有文字可扫：图标自己缓慢呼吸 */
button:has(> span:only-child > .dscx-nav[data-dco-nav="running"]) .dscx-nav::before{
  content:"";position:absolute;inset:-7px;border-radius:50%;
  background:radial-gradient(circle,
    color-mix(in oklab,var(--dsw-alias-state-business-primary,#6f9dff) 40%,transparent) 0%,
    transparent 70%);
  animation:dscx-nav-breathe 6s cubic-bezier(.45,0,.55,1) infinite;
  pointer-events:none;
}

.dscx-nav-dot{
  position:absolute;top:-2px;right:-2px;width:6px;height:6px;border-radius:50%;
  background:var(--dsw-alias-state-business-primary,#6f9dff);
  box-shadow:0 0 0 2px var(--dsw-specific-sidebar-fill,var(--dsw-alias-bg-base,#1b1b1c));
}
.dscx-nav-dot[data-kind="failed"]{background:var(--dsw-alias-state-warn-primary,#c79a5b)}

@media (prefers-reduced-motion:reduce){
  /* 不做扫光，也不在文字上留蓝色；运行中改由图标的一圈静态柔光表示。 */
  button:has(> span > .dscx-nav[data-dco-nav="running"]) > span + span:last-child{
    animation:none;background-image:none;color:inherit;-webkit-text-fill-color:currentColor;
  }
  button:has(svg) .dscx-nav[data-dco-nav="running"]::before{
    content:"";position:absolute;inset:-7px;border-radius:50%;
    background:radial-gradient(circle,
      color-mix(in oklab,var(--dsw-alias-state-business-primary,#7aaaff) 40%,transparent) 0%,
      transparent 70%);
    opacity:.3;pointer-events:none;
  }
}
`
