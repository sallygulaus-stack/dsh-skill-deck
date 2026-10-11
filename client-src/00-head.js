/* dsh-skill-deck — 客户端半区（构建产物由 scripts/build-client.mjs 拼接生成，勿直接改 client/bundle.js） */
window.__ModuleLoader__.load({
  id: 'dsh-skill-deck',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    let React = null
    try { React = require('react') } catch { React = null }
    let ReactDOM = null
    try { ReactDOM = require('react-dom') } catch { ReactDOM = null }

    // 没有 React 就没有界面；宿主半区（技能 provider + 路由）不受影响。
    if (React === null) {
      exports.inject = []
      exports.apply = function () {}
      return module.exports
    }

    const h = React.createElement
    const useState = React.useState
    const useEffect = React.useEffect
    const useRef = React.useRef
    const useMemo = React.useMemo
    const useCallback = React.useCallback

    /** 侧边栏面板行 id / 中栏页面 key，两者必须一致。 */
    const PANEL_ID = 'skill-deck'
    /** 路由族基址。文档相对（无前导斜杠）：宿主用 <base href="./"> 提供 GUI，
     *  子路径部署下根绝对的 /api/... 会逃出前缀打不到路由。 */
    const API_REL = 'api/dsh-skill-deck'
    const API_ABS = '/api/dsh-skill-deck'

    // ── 样式 ────────────────────────────────────────────────────────────────
    // 浮层（快捷发送 + 弹窗）的底色跟宿主自己的菜单/popover 对齐：先用
    // --dsw-specific-menu 铺一层，再垫一层**不透明**的 --dsw-alias-bg-base 托底。
    // 这样既和「仅可查看 / 完全权限」那类宿主菜单是同一个颜色（主题换了也跟着换），
    // 又不会像纯半透明菜单那样把底下的正文透出来。

    const CSS = `
/* ── 强调色（本插件唯一的「蓝色」来源）─────────────────────────────────────
   不要用「品牌色」那个 token（brand-primary）：本机主题把它定义成
   var(--dsw-alias-label-primary)，也就是暗色主题的正文色——白色。用了它的地方
   全都会「煞白」：主按钮变成白底白字（文字完全看不见），开关打开态变成一颗白药丸。
   「业务主色」那个 token（state-business-primary）才是正解：它指向
   --dsw-static-deepseek-*，就是侧边栏工作区文件夹图标那个 DeepSeek 蓝。
   再垫一层 #4d6bfe 兜底，保证任何主题/皮肤下这个蓝色都真实可见。 */
.sh-view,.sh-panel,.sh-mask,.sh-dialog,.sh-pick,.sh-pick-backdrop{--sh-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--sh-surface:var(--dsw-specific-menu,var(--dsw-alias-bg-overlay,#26262c))}
.sh-view{height:100%;min-height:0;overflow:hidden}
.sh-panel{background:var(--dsw-alias-bg-base);height:100%;min-height:0;color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);display:flex;flex-direction:column;gap:10px;padding:14px 16px 16px}
.sh-header{flex:none;display:flex;align-items:center;gap:10px}
.sh-title{flex:1;margin:0;font-size:16px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sh-sub{flex:none;color:var(--dsw-alias-label-tertiary);font-size:12px}
.sh-tabbar{flex:none;display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l1)}
.sh-tab{color:var(--dsw-alias-label-secondary);cursor:pointer;white-space:nowrap;background:0 0;border:none;border-bottom:2px solid transparent;border-radius:6px 6px 0 0;padding:7px 14px;font-size:13px;font-family:var(--dsw-font-family)}
.sh-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.sh-tab[data-active="true"]{color:var(--dsw-alias-label-primary);border-bottom-color:var(--sh-accent,#4d6bfe);font-weight:600}
.sh-body{flex:1;min-height:0;display:flex;flex-direction:column;gap:10px;overflow-y:auto;overscroll-behavior:contain;padding-bottom:56px}
.sh-toolbar{flex:none;display:flex;flex-wrap:wrap;align-items:center;gap:8px}
.sh-grow{flex:1;min-width:8px}
.sh-search{flex:0 1 260px;min-width:140px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;padding:6px 10px;font-size:13px;font-family:var(--dsw-font-family)}
.sh-search::placeholder{color:var(--dsw-alias-label-tertiary)}
.sh-input,.sh-select,.sh-area{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:8px;outline:none;padding:6px 10px;font-size:13px;font-family:var(--dsw-font-family);box-sizing:border-box;width:100%}
.sh-input:focus,.sh-select:focus,.sh-area:focus{border-color:var(--sh-accent,#4d6bfe)}
.sh-area{resize:vertical;min-height:160px;line-height:1.55;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sh-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:30px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:13px;font-family:var(--dsw-font-family);cursor:pointer;white-space:nowrap}
.sh-btn:hover{border-color:var(--dsw-alias-border-l1);background:var(--dsw-alias-interactive-bg-hover)}
.sh-btn:disabled{opacity:.5;cursor:not-allowed}
.sh-btn-primary{background-color:#4d6bfe;background-color:var(--sh-accent,#4d6bfe);border-color:transparent;color:#fff;font-weight:500}
.sh-btn-primary:hover{background-color:#4d6bfe;background-color:var(--sh-accent,#4d6bfe);filter:brightness(1.08)}
.sh-btn-danger{color:var(--dsw-alias-state-error-primary);border-color:var(--dsw-alias-state-error-primary)}
.sh-btn-sm{min-height:26px;padding:3px 9px;font-size:12px}
.sh-chip{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;font-family:var(--dsw-font-family);cursor:pointer;white-space:nowrap}
.sh-chip:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
.sh-chip[data-on="true"]{color:var(--dsw-alias-label-primary);border-color:var(--sh-accent,#4d6bfe);background:color-mix(in srgb,var(--sh-accent,#4d6bfe) 20%,transparent)}
.sh-badge{display:inline-flex;align-items:center;height:20px;padding:0 7px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);font-size:11px;white-space:nowrap}
.sh-badge-local{background:color-mix(in srgb,var(--sh-accent,#4d6bfe) 26%,transparent);color:var(--dsw-alias-label-primary)}
.sh-badge-warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 22%,transparent);color:var(--dsw-alias-label-primary)}
.sh-badge-off{background:color-mix(in srgb,var(--dsw-alias-state-idle-primary) 30%,transparent);color:var(--dsw-alias-label-secondary)}
.sh-group{flex:none;display:flex;flex-direction:column;gap:6px}
.sh-grouphead{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;padding:2px 0;min-width:0;overflow:hidden}
.sh-grouptitle{font-size:13px;font-weight:600;flex:none}
.sh-grouphint{color:var(--dsw-alias-label-tertiary);font-size:12px;flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh-count{color:var(--dsw-alias-label-dimmed,var(--dsw-alias-label-tertiary));font-size:12px;flex:none}
.sh-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:6px}
.sh-card-main{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.sh-alias{font-size:14px;font-weight:600}
.sh-real{color:var(--dsw-alias-label-secondary);font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.sh-desc{color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.sh-note{color:var(--dsw-alias-label-primary);font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
.sh-path{color:var(--dsw-alias-label-tertiary);font-size:11.5px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh-actions{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.sh-switch{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);user-select:none}
.sh-switch-track{width:34px;height:18px;border-radius:999px;background:var(--dsw-alias-state-idle-primary);position:relative;transition:background .15s;flex:none}
.sh-switch-track[data-on="true"]{background:color-mix(in srgb,var(--sh-accent,#4d6bfe) 34%,transparent)}
.sh-switch-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:left .15s,background .15s}
.sh-switch-track[data-on="true"] .sh-switch-thumb{left:18px;background-color:#4d6bfe;background-color:var(--sh-accent,#4d6bfe)}
.sh-banner{border-radius:8px;padding:8px 10px;font-size:12.5px;line-height:1.5;white-space:pre-wrap}
.sh-banner-error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-state-error-primary)}
.sh-banner-ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 18%,transparent);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-state-success-primary)}
.sh-empty{color:var(--dsw-alias-label-tertiary);font-size:13px;padding:24px 0;text-align:center}
.sh-mask{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:24px}
.sh-dialog{width:min(760px,94vw);max-height:88vh;overflow:auto;border-radius:14px;padding:18px;background-color:var(--dsw-alias-bg-base,#16161a);background-image:linear-gradient(var(--sh-surface,#26262c),var(--sh-surface,#26262c));border:1px solid var(--dsw-alias-border-l2);box-shadow:0 18px 48px rgba(0,0,0,.5);color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:12px}
.sh-dialog h3{margin:0;font-size:15px}
.sh-field{display:flex;flex-direction:column;gap:5px}
.sh-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.sh-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.5}
.sh-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.sh-section{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--dsw-alias-bg-layer-1)}
.sh-section-title{font-size:13px;font-weight:600;display:flex;align-items:center;gap:8px}
.sh-dialog-foot{display:flex;gap:8px;justify-content:flex-end;position:sticky;bottom:0;background-color:var(--dsw-alias-bg-base,#16161a);background-image:linear-gradient(var(--sh-surface,#26262c),var(--sh-surface,#26262c));padding-top:10px}
.sh-inline-tag{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:6px;font-size:11.5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.sh-x{cursor:pointer;opacity:.7}
.sh-x:hover{opacity:1}
/* ── 输入栏「技能」快捷插入 ── */
.sh-chipbtn{display:inline-flex;align-items:center;gap:4px;height:26px;padding:0 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-family:var(--dsw-font-family);font-size:12px;cursor:pointer;white-space:nowrap}
.sh-chipbtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1)}
.sh-chipbtn[data-open="true"]{color:var(--dsw-alias-label-primary);border-color:var(--sh-accent,#4d6bfe)}
.sh-pick-backdrop{position:fixed;inset:0;z-index:2147483200;background:transparent}
/* 完全不透明：菜单色铺面 + 不透明底色托底，任何主题都不会透出页面内容。 */
.sh-pick{position:fixed;z-index:2147483201;display:flex;flex-direction:column;gap:6px;padding:8px;border-radius:12px;
  background-color:var(--dsw-alias-bg-base,#16161a);
  background-image:linear-gradient(var(--sh-surface,#26262c),var(--sh-surface,#26262c));
  border:1px solid var(--dsw-alias-border-l2);
  box-shadow:0 16px 44px rgba(0,0,0,.55);
  backdrop-filter:none;filter:none;opacity:1}
.sh-pick-head{display:flex;align-items:center;gap:8px}
.sh-pick-search{flex:1;min-width:0}
.sh-pick-list{display:flex;flex-direction:column;min-height:44px;max-height:340px;overflow-y:auto;overflow-x:hidden}
.sh-pick-row{display:flex;flex-direction:column;align-items:stretch;gap:2px;width:100%;padding:7px 10px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;font-family:var(--dsw-font-family)}
.sh-pick-row[data-active="true"]{background:var(--dsw-alias-interactive-bg-hover)}
.sh-pick-line1{display:flex;align-items:center;gap:8px;min-width:0}
.sh-pick-alias{font-size:13px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none;max-width:52%}
.sh-pick-name{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.sh-pick-desc{font-size:11.5px;color:var(--dsw-alias-label-tertiary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sh-pick-empty{padding:14px 10px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px}
.sh-pick-foot{display:flex;align-items:center;gap:8px;padding:2px 4px 0;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-tertiary);font-size:11px}
/* ── 导入 .md ── */
.sh-drop{display:flex;align-items:center;gap:10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);transition:border-color .12s,background-color .12s}
.sh-drop[data-over="true"]{border-color:var(--sh-accent,#4d6bfe);background:color-mix(in srgb,var(--sh-accent,#4d6bfe) 12%,transparent)}
.sh-drop-text{display:flex;flex-direction:column;gap:3px;min-width:0;flex:1}
.sh-drop-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary)}
.sh-visually-hidden{position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`

    /** 只在文档里插一次样式表。 */
    function ensureStyles() {
      try {
        if (typeof document === 'undefined') return
        if (document.querySelector('style[data-plugin-css="dsh-skill-deck"]') !== null) return
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-skill-deck'
        tag.dataset.pluginCss = 'dsh-skill-deck'
        tag.textContent = CSS
        document.head.appendChild(tag)
      } catch { /* 样式失败不该拖垮逻辑 */ }
    }
