/* dsh-skill-deck — 客户端半区（构建产物由 scripts/build-client.mjs 拼接生成，勿直接改 client/bundle.js）
 *
 * 本构建产物包含派生自 @weibaohui/skills-management（MIT，Copyright (c) weibaohui）的代码；
 * 该项目的版权声明与许可全文见本仓库根目录的 NOTICE 文件。 */
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

    // ── 数据面 ──────────────────────────────────────────────────────────────
    //
    // 路由基址先探一次：文档相对优先（子路径部署），探不到再退回根绝对。

    let apiBase = API_REL
    let probePromise = null

    async function probeBase() {
      if (probePromise !== null) return probePromise
      probePromise = (async () => {
        try {
          const response = await fetch(API_REL + '/health')
          if (response.ok) { apiBase = API_REL; return apiBase }
        } catch { /* 继续试绝对路径 */ }
        try {
          const response = await fetch(API_ABS + '/health')
          if (response.ok) { apiBase = API_ABS; return apiBase }
        } catch { /* 两条都不通：保持相对，让错误消息透出去 */ }
        apiBase = API_REL
        return apiBase
      })()
      return probePromise
    }

    /** 带中文错误面的 request。 */
    async function request(path, options) {
      const base = await probeBase()
      let response
      try {
        response = await fetch(base + path, options)
      } catch (error) {
        throw new Error('无法连接宿主插件路由：' + (error && error.message ? error.message : String(error)))
      }
      let payload = null
      try { payload = await response.json() } catch { payload = null }
      if (!response.ok) {
        const message = payload !== null && typeof payload.error === 'string' ? payload.error : 'HTTP ' + response.status
        throw new Error(message)
      }
      return payload
    }

    const getJson = (path) => request(path)
    const postJson = (path, body) => request(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body === undefined ? {} : body),
    })

    /** 当前工作目录：能让宿主知道该把哪个项目根算进来。 */
    function currentCwd() {
      try {
        const fromGlobal = globalThis.__DSH_WORKSPACE_PATH__
        if (typeof fromGlobal === 'string' && fromGlobal !== '') return fromGlobal
      } catch { /* 没有就算了，宿主会退回 process.cwd() */ }
      return ''
    }

    const withCwd = (path) => {
      const cwd = currentCwd()
      if (cwd === '') return path
      return path + (path.includes('?') ? '&' : '?') + 'cwd=' + encodeURIComponent(cwd)
    }

    // ── 小工具 ──────────────────────────────────────────────────────────────

    /** 相对时间（回收站用）。 */
    function relativeTime(iso) {
      if (typeof iso !== 'string' || iso === '') return '-'
      const at = Date.parse(iso)
      if (!Number.isFinite(at)) return '-'
      const diff = Date.now() - at
      const minutes = Math.floor(diff / 60000)
      if (minutes < 1) return '刚刚'
      if (minutes < 60) return minutes + ' 分钟前'
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return hours + ' 小时前'
      const days = Math.floor(hours / 24)
      if (days < 30) return days + ' 天前'
      return new Date(at).toLocaleDateString('zh-CN')
    }

    /** 搜索匹配：别名 / 真名 / 描述 / 本地备注 / 标签 / 分类名 全参与。 */
    function matchSkill(row, needle, categoryName) {
      if (needle === '') return true
      const haystack = [
        row.name,
        row.local !== undefined && row.local !== null ? row.local.alias : '',
        row.description,
        row.local !== undefined && row.local !== null ? row.local.note : '',
        Array.isArray(row.local !== undefined && row.local !== null ? row.local.tags : null) ? row.local.tags.join(' ') : '',
        categoryName !== undefined ? categoryName : '',
      ]
      for (const part of haystack) {
        if (typeof part === 'string' && part.toLowerCase().includes(needle)) return true
      }
      return false
    }

    // ── 基础组件 ────────────────────────────────────────────────────────────

    const Btn = (props) => h('button', {
      type: 'button',
      className: 'sh-btn' + (props.variant ? ' sh-btn-' + props.variant : '') + (props.small ? ' sh-btn-sm' : ''),
      disabled: props.disabled === true,
      title: props.title,
      onClick: props.onClick,
    }, props.children)

    const Input = (props) => h('input', {
      className: 'sh-input ' + (props.className || ''),
      value: props.value,
      placeholder: props.placeholder,
      disabled: props.disabled === true,
      spellCheck: false,
      onChange: (event) => props.onChange(event.target.value),
      onKeyDown: props.onKeyDown,
      onBlur: props.onBlur,
      ref: props.inputRef,
    })

    const Area = (props) => h('textarea', {
      className: 'sh-area ' + (props.className || ''),
      value: props.value,
      placeholder: props.placeholder,
      disabled: props.disabled === true,
      spellCheck: false,
      rows: props.rows,
      onChange: (event) => props.onChange(event.target.value),
    })

    const Select = (props) => h('select', {
      className: 'sh-select ' + (props.className || ''),
      value: props.value,
      onChange: (event) => props.onChange(event.target.value),
    }, props.children)

    /** 开关（模型可调用）。 */
    const Switch = (props) => h('span', {
      className: 'sh-switch',
      title: props.title,
      onClick: props.disabled === true ? undefined : props.onToggle,
    },
      h('span', { className: 'sh-switch-track', 'data-on': props.on === true ? 'true' : 'false' },
        h('span', { className: 'sh-switch-thumb' })),
      props.label)

    const Badge = (props) => h('span', { className: 'sh-badge' + (props.tone ? ' sh-badge-' + props.tone : '') }, props.children)

    const Banner = (props) => props.text === undefined || props.text === null || props.text === ''
      ? null
      : h('div', { className: 'sh-banner sh-banner-' + (props.tone || 'error') }, props.text)

    // ── 侧边栏图标 ──────────────────────────────────────────────────────────
    //
    // 外壳只把「方框尺寸 + 是否选中」交给这个组件，按钮本体、标签、高亮、
    // 折叠轨几何都归外壳所有——和其它面板行完全一样。

    function SkillHubIcon(props) {
      const size = props !== undefined && Number.isFinite(props.size) ? props.size : 18
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': 'true', 'data-dsh-panel-entry': 'skill-deck',
      },
        h('path', { d: 'M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z' }),
        h('path', { d: 'M4 20.5A2.5 2.5 0 0 1 6.5 18H19v3H6.5A2.5 2.5 0 0 1 4 20.5z' }),
        h('path', { d: 'M9 7.5h6' }))
    }

    // ── 通用确认弹窗 ────────────────────────────────────────────────────────
    //
    // 刻意**不用**原生 `confirm()`：DSH Desktop 的 GUI 走 `dsh-app://` 自定义协议，
    // 实测原生确认框不弹窗（系统窗口列表里查不到任何对话框），于是「删除」会静默
    // 什么都不做。自带弹窗既能在任何渲染器里工作，样式也和面板一致。
    // （回归护栏见 scripts/smoke-client.js：bundle 里出现原生确认调用即测试失败。）

    function ConfirmDialog({ title, body, confirmLabel, tone, busy, onCancel, onConfirm }) {
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape' && event.isComposing !== true && busy !== true) onCancel() }
        try { document.addEventListener('keydown', onKey) } catch {}
        return () => { try { document.removeEventListener('keydown', onKey) } catch {} }
      }, [busy])
      return h('div', { className: 'sh-mask', onMouseDown: (e) => { if (e.target === e.currentTarget && busy !== true) onCancel() } },
        h('div', { className: 'sh-dialog', style: { width: 'min(460px,94vw)' } },
          h('h3', null, title),
          h('div', { className: 'sh-desc' }, body),
          h('div', { className: 'sh-dialog-foot' },
            h(Btn, { disabled: busy === true, onClick: onCancel }, '取消'),
            h(Btn, {
              variant: tone === 'danger' ? 'danger' : 'primary',
              disabled: busy === true,
              onClick: onConfirm,
            }, busy === true ? '处理中…' : confirmLabel))))
    }

    // ── 分类管理弹窗 ────────────────────────────────────────────────────────

    function CategoryDialog({ categories, onClose, onChanged }) {
      const [draft, setDraft] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      const call = async (payload) => {
        setBusy(true)
        setError('')
        try {
          await postJson('/categories', payload)
          onChanged()
        } catch (e) {
          setError(e.message)
        } finally {
          setBusy(false)
        }
      }

      return h('div', { className: 'sh-mask', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { className: 'sh-dialog', style: { width: 'min(460px,94vw)' } },
          h('h3', null, '管理分类'),
          h('div', { className: 'sh-hint' }, '分类是本地元数据（存在 meta.json），不会写进技能文件，也不影响模型看到的内容。'),
          h(Banner, { text: error }),
          h('div', { className: 'sh-row' },
            h(Input, { value: draft, placeholder: '新分类名，例如「前端动效」', onChange: setDraft, className: 'sh-grow' }),
            h(Btn, {
              variant: 'primary', disabled: busy || draft.trim() === '',
              onClick: async () => { await call({ op: 'create', name: draft.trim() }); setDraft('') },
            }, '新建')),
          categories.length === 0
            ? h('div', { className: 'sh-empty' }, '还没有分类')
            : h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6 } },
                categories.map((category) => h('div', { key: category.id, className: 'sh-row' },
                  h('span', { style: { width: 12, height: 12, borderRadius: 3, background: category.color || 'var(--sh-accent)', flex: 'none' } }),
                  h(RenameField, {
                    name: category.name,
                    disabled: busy,
                    onRename: (name) => call({ op: 'update', id: category.id, name }),
                  }),
                  h(Btn, {
                    small: true, variant: 'danger', disabled: busy,
                    onClick: () => call({ op: 'delete', id: category.id }),
                  }, '删除')))),
          h('div', { className: 'sh-dialog-foot' }, h(Btn, { onClick: onClose }, '关闭'))))
    }

    /** 就地改名的输入框（失焦/回车提交）。 */
    function RenameField({ name, disabled, onRename }) {
      const [value, setValue] = useState(name)
      useEffect(() => { setValue(name) }, [name])
      const commit = () => {
        const next = value.trim()
        if (next !== '' && next !== name) onRename(next)
        else setValue(name)
      }
      return h(Input, {
        value,
        disabled,
        className: 'sh-grow',
        onChange: setValue,
        onKeyDown: (event) => { if (event.key === 'Enter') { event.preventDefault(); commit() } },
        onBlur: commit,
      })
    }

    // ── 标签输入（逗号分隔）────────────────────────────────────────────────

    function TagsField({ value, onChange }) {
      return h(Input, {
        value,
        placeholder: '用逗号分隔，例如：动效, 交互',
        onChange,
      })
    }

    // ── 编辑弹窗：本地标注 / 技能文件 两块，语义清楚分开 ────────────────────

    function EditDialog({ row, categories, cwd, onClose, onSaved, onCategoryChanged }) {
      const local = row.local !== undefined && row.local !== null ? row.local : { alias: '', note: '', categoryId: '', tags: [] }
      const [alias, setAlias] = useState(local.alias || '')
      const [note, setNote] = useState(local.note || '')
      const [categoryId, setCategoryId] = useState(local.categoryId || '')
      const [tags, setTags] = useState(Array.isArray(local.tags) ? local.tags.join(', ') : '')
      const [description, setDescription] = useState(row.description || '')
      const [whenToUse, setWhenToUse] = useState(row.whenToUse || '')
      const [content, setContent] = useState('')
      const [loading, setLoading] = useState(row.readOnly !== true)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [ok, setOk] = useState('')
      const [showNewCategory, setShowNewCategory] = useState(false)
      const [newCategory, setNewCategory] = useState('')

      useEffect(() => {
        let alive = true
        if (row.readOnly === true || row.path === undefined) {
          setLoading(false)
          return () => { alive = false }
        }
        getJson(withCwd('/read?name=' + encodeURIComponent(row.name) + '&path=' + encodeURIComponent(row.path)))
          .then((payload) => {
            if (!alive) return
            setDescription(payload.description || '')
            setWhenToUse(payload.whenToUse || '')
            setContent(payload.content || '')
          })
          .catch((e) => { if (alive) setError('读取技能文件失败：' + e.message) })
          .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
      }, [row.name, row.path])

      const tagList = tags.split(/[,，]/).map((t) => t.trim()).filter((t) => t !== '')

      const saveLocal = async () => {
        setBusy(true); setError(''); setOk('')
        try {
          await postJson('/meta', { name: row.name, alias, note, categoryId, tags: tagList })
          setOk('本地标注已保存（只在本机 meta.json，模型读不到）')
          onSaved()
        } catch (e) { setError(e.message) } finally { setBusy(false) }
      }

      const saveFile = async () => {
        setBusy(true); setError(''); setOk('')
        try {
          await postJson('/update', {
            name: row.name, path: row.path, cwd,
            description, whenToUse, content,
          })
          setOk('技能文件已更新（模型下次读到的就是这个）')
          onSaved()
        } catch (e) { setError(e.message) } finally { setBusy(false) }
      }

      const createCategory = async () => {
        const name = newCategory.trim()
        if (name === '') return
        try {
          const payload = await postJson('/categories', { op: 'create', name })
          setCategoryId(payload.result.id)
          setNewCategory('')
          setShowNewCategory(false)
          onCategoryChanged()
        } catch (e) { setError(e.message) }
      }

      return h('div', { className: 'sh-mask', onMouseDown: (e) => { if (e.target === e.currentTarget) onClose() } },
        h('div', { className: 'sh-dialog' },
          h('h3', null, '编辑「' + (alias.trim() !== '' ? alias.trim() : row.name) + '」'),
          h(Banner, { text: error }),
          h(Banner, { text: ok, tone: 'ok' }),

          // ── 本地标注 ──
          h('div', { className: 'sh-section' },
            h('div', { className: 'sh-section-title' }, '本地标注',
              h(Badge, { tone: 'local' }, '只给你自己看')),
            h('div', { className: 'sh-hint' }, '中文别名、备注、分类、标签都存在本机 meta.json 里：不写进 SKILL.md，不改技能真名，模型读不到。'),
            h('div', { className: 'sh-field' },
              h('span', { className: 'sh-label' }, '中文别名'),
              h(Input, { value: alias, placeholder: '例如：动画制作（留空则显示技能真名）', onChange: setAlias })),
            h('div', { className: 'sh-field' },
              h('span', { className: 'sh-label' }, '本地备注'),
              h(Area, { value: note, placeholder: '写给自己的说明，随便写', onChange: setNote, rows: 3, className: '' })),
            h('div', { className: 'sh-field' },
              h('span', { className: 'sh-label' }, '分类'),
              h('div', { className: 'sh-row' },
                h(Select, {
                  value: categoryId, className: 'sh-grow',
                  onChange: setCategoryId,
                },
                  h('option', { value: '' }, '（未分类）'),
                  categories.map((category) => h('option', { key: category.id, value: category.id }, category.name))),
                h(Btn, { small: true, onClick: () => setShowNewCategory(!showNewCategory) }, '＋ 新分类')),
              showNewCategory === true
                ? h('div', { className: 'sh-row', style: { marginTop: 6 } },
                    h(Input, { value: newCategory, placeholder: '新分类名', onChange: setNewCategory, className: 'sh-grow' }),
                    h(Btn, { small: true, variant: 'primary', onClick: createCategory }, '创建'))
                : null),
            h('div', { className: 'sh-field' },
              h('span', { className: 'sh-label' }, '标签'),
              h(TagsField, { value: tags, onChange: setTags })),
            h('div', { className: 'sh-row' },
              h(Btn, { variant: 'primary', disabled: busy, onClick: saveLocal }, '保存本地标注'))),

          // ── 技能文件 ──
          row.readOnly === true
            ? h('div', { className: 'sh-section' },
                h('div', { className: 'sh-section-title' }, '技能文件'),
                h('div', { className: 'sh-hint' }, '这个技能来自 ' + (row.provider || row.source) + '（' + row.source + '），没有可写的 SKILL.md，只能加本地标注。'))
            : h('div', { className: 'sh-section' },
                h('div', { className: 'sh-section-title' }, '写给模型看的（会改 SKILL.md）',
                  h(Badge, { tone: 'warn' }, 'AI 会读到')),
                h('div', { className: 'sh-hint' }, '改的是真实技能文件：' + (row.path || '')),
                loading === true
                  ? h('div', { className: 'sh-empty' }, '读取中…')
                  : h(React.Fragment, null,
                      h('div', { className: 'sh-field' },
                        h('span', { className: 'sh-label' }, 'description 简介（模型据此判断何时加载）'),
                        h(Area, { value: description, onChange: setDescription, rows: 3 })),
                      h('div', { className: 'sh-field' },
                        h('span', { className: 'sh-label' }, 'whenToUse 适用场景（可选）'),
                        h(Input, { value: whenToUse, onChange: setWhenToUse })),
                      h('div', { className: 'sh-field' },
                        h('span', { className: 'sh-label' }, '正文（SKILL.md 的 Markdown 主体）'),
                        h(Area, { value: content, onChange: setContent, rows: 14 })),
                      h('div', { className: 'sh-row' },
                        h(Btn, { variant: 'primary', disabled: busy || loading, onClick: saveFile }, '保存到技能文件')))),

          h('div', { className: 'sh-dialog-foot' }, h(Btn, { onClick: onClose }, '关闭'))))
    }

    // ── 技能行 ──────────────────────────────────────────────────────────────

    function SkillRow({ row, categories, onEdit, onDelete, onToggle, busy }) {
      const local = row.local !== undefined && row.local !== null ? row.local : { alias: '', note: '', categoryId: '', tags: [] }
      const alias = typeof local.alias === 'string' ? local.alias : ''
      const note = typeof local.note === 'string' ? local.note : ''
      const category = categories.find((c) => c.id === local.categoryId)
      const tags = Array.isArray(local.tags) ? local.tags : []
      const hasLocal = alias !== '' || note !== '' || category !== undefined || tags.length > 0

      return h('div', { className: 'sh-card' },
        h('div', { className: 'sh-card-main' },
          alias !== ''
            ? h(React.Fragment, null,
                h('span', { className: 'sh-alias' }, alias),
                h('span', { className: 'sh-real' }, row.name))
            : h('span', { className: 'sh-alias' }, row.name),
          category !== undefined ? h('span', { className: 'sh-inline-tag' }, '📂 ' + category.name) : null,
          tags.map((tag) => h('span', { key: tag, className: 'sh-inline-tag' }, '#' + tag)),
          hasLocal === true ? h(Badge, { tone: 'local' }, '有本地标注') : null,
          row.modelInvocable === false ? h(Badge, { tone: 'off' }, '模型不可调用') : null,
          row.readOnly === true ? h(Badge, null, '只读') : null,
          row.validName === false ? h(Badge, { tone: 'warn' }, '技能名不合规') : null),
        note !== ''
          ? h('div', { className: 'sh-note' }, note)
          : null,
        row.description !== '' ? h('div', { className: 'sh-desc' }, row.description) : null,
        row.whenToUse !== undefined && row.whenToUse !== '' ? h('div', { className: 'sh-desc' }, '适用场景：' + row.whenToUse) : null,
        h('div', { className: 'sh-actions' },
          h(Switch, {
            on: row.modelInvocable !== false,
            disabled: busy === true || row.readOnly === true || row.path === undefined,
            label: row.modelInvocable !== false ? '模型可调用' : '模型不可调用',
            title: row.readOnly === true ? '该来源为只读，无法改写' : '切换 SKILL.md 里的 disable-model-invocation（模型能否主动调用）',
            onToggle: () => onToggle(row, row.modelInvocable === false),
          }),
          h('span', { className: 'sh-grow' }),
          h(Btn, { small: true, disabled: busy === true, onClick: () => onEdit(row) }, '编辑'),
          h(Btn, {
            small: true, variant: 'danger',
            disabled: busy === true || row.deletable === false,
            title: row.deletable === false ? '链接技能或只读来源不可删除' : '移入回收站（可恢复）',
            onClick: () => onDelete(row),
          }, '删除')),
        row.path !== undefined && row.path !== '' ? h('div', { className: 'sh-path', title: row.path }, row.path) : null)
    }

    // ── 技能 tab ────────────────────────────────────────────────────────────

    function SkillsTab({ data, onEdit, onDelete, onToggle, busyName }) {
      const [query, setQuery] = useState('')
      const [groupMode, setGroupMode] = useState('source')
      const [categoryFilter, setCategoryFilter] = useState('')
      const [collapsed, setCollapsed] = useState({})

      const categories = data.categories || []
      const needle = query.trim().toLowerCase()

      const groups = useMemo(() => {
        const all = []
        for (const group of data.groups || []) {
          for (const row of group.skills) {
            const category = categories.find((c) => c.id === (row.local !== undefined && row.local !== null ? row.local.categoryId : ''))
            all.push({ row, sourceGroup: group, categoryName: category !== undefined ? category.name : '' })
          }
        }
        const filtered = all.filter((entry) => {
          if (categoryFilter !== '') {
            const id = entry.row.local !== undefined && entry.row.local !== null && typeof entry.row.local.categoryId === 'string'
              ? entry.row.local.categoryId
              : ''
            if (categoryFilter === '__none__') {
              if (id !== '') return false
            } else if (id !== categoryFilter) {
              return false
            }
          }
          return matchSkill(entry.row, needle, entry.categoryName)
        })
        if (groupMode === 'source') {
          const buckets = new Map()
          for (const entry of filtered) {
            const key = entry.sourceGroup.key
            if (!buckets.has(key)) buckets.set(key, { key, title: entry.sourceGroup.title, hint: entry.sourceGroup.hint, order: entry.sourceGroup.order, rows: [] })
            buckets.get(key).rows.push(entry.row)
          }
          return [...buckets.values()].sort((a, b) => a.order - b.order)
        }
        const buckets = new Map()
        const ensure = (key, title, order) => {
          if (!buckets.has(key)) buckets.set(key, { key, title, hint: '自定义分类', order, rows: [] })
          return buckets.get(key)
        }
        for (const category of categories) ensure(category.id, category.name, 100 + category.order)
        ensure('__none__', '未分类', 9999)
        for (const entry of filtered) {
          const id = entry.row.local !== undefined && entry.row.local !== null && entry.row.local.categoryId !== ''
            ? entry.row.local.categoryId
            : '__none__'
          const bucket = buckets.get(id) !== undefined ? buckets.get(id) : ensure('__none__', '未分类', 9999)
          bucket.rows.push(entry.row)
        }
        return [...buckets.values()].filter((bucket) => bucket.rows.length > 0).sort((a, b) => a.order - b.order)
      }, [data, needle, groupMode, categoryFilter, categories])

      const visibleCount = groups.reduce((sum, group) => sum + group.rows.length, 0)

      return h(React.Fragment, null,
        h('div', { className: 'sh-toolbar' },
          h('input', {
            className: 'sh-search',
            value: query,
            placeholder: '搜索中文别名、技能名、描述或标签',
            onChange: (event) => setQuery(event.target.value),
            onKeyDown: (event) => { if (event.key === 'Escape') setQuery('') },
          }),
          h('div', { className: 'sh-grow' }),
          h('button', {
            type: 'button', className: 'sh-chip',
            'data-on': groupMode === 'source' ? 'true' : 'false',
            onClick: () => setGroupMode('source'),
          }, '按来源分组'),
          h('button', {
            type: 'button', className: 'sh-chip',
            'data-on': groupMode === 'category' ? 'true' : 'false',
            onClick: () => setGroupMode('category'),
          }, '按分类分组')),
        h('div', { className: 'sh-toolbar' },
          h('button', {
            type: 'button', className: 'sh-chip',
            'data-on': categoryFilter === '' ? 'true' : 'false',
            onClick: () => setCategoryFilter(''),
          }, '全部 ' + (data.total || 0)),
          categories.map((category) => h('button', {
            key: category.id, type: 'button', className: 'sh-chip',
            'data-on': categoryFilter === category.id ? 'true' : 'false',
            onClick: () => setCategoryFilter(categoryFilter === category.id ? '' : category.id),
          }, category.name)),
          h('button', {
            type: 'button', className: 'sh-chip',
            'data-on': categoryFilter === '__none__' ? 'true' : 'false',
            onClick: () => setCategoryFilter(categoryFilter === '__none__' ? '' : '__none__'),
          }, '未分类')),
        visibleCount === 0
          ? h('div', { className: 'sh-empty' }, (data.total || 0) === 0 ? '还没有扫描到技能' : '没有匹配的技能')
          : groups.map((group) => {
              const isCollapsed = collapsed[group.key] === true
              return h('div', { key: group.key, className: 'sh-group' },
                h('div', {
                  className: 'sh-grouphead',
                  onClick: () => setCollapsed({ ...collapsed, [group.key]: !isCollapsed }),
                },
                  h('span', null, isCollapsed === true ? '▸' : '▾'),
                  h('span', { className: 'sh-grouptitle' }, group.title),
                  h('span', { className: 'sh-count' }, String(group.rows.length)),
                  h('span', { className: 'sh-grouphint' }, group.hint || '')),
                isCollapsed === true
                  ? null
                  : group.rows.map((row) => h(SkillRow, {
                      key: row.source + ':' + row.name,
                      row,
                      categories,
                      busy: busyName === row.name,
                      onEdit,
                      onDelete,
                      onToggle,
                    })))
            }))
    }

    // ── 新建 / 导入 tab ─────────────────────────────────────────────────────

    /** 任意文本 → kebab-case 片段（纯中文会得到空串，改由「中文别名」承载）。 */
    function slugFromText(input) {
      return String(input === undefined || input === null ? '' : input)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 48)
        .replace(/-+$/g, '')
    }

    /** 文件名 → 技能名（ASCII 文件名直接可用；中文文件名返回空串）。 */
    const KEBAB_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
    const HAS_CJK_RE = /[\u3400-\u9fff]/

    /**
     * 从 .md 文本里拆出 frontmatter 与正文。
     * 只认顶层 `key: value`（多行/块标量的续行忽略），够覆盖 SKILL.md 的常规写法，
     * 也避免为了导入一个文件去引 YAML 依赖。
     */
    function splitImportedMarkdown(text) {
      const raw = String(text === undefined || text === null ? '' : text).replace(/^\uFEFF/, '')
      const lines = raw.split(/\r?\n/)
      if (lines.length === 0 || lines[0].trim() !== '---') return { meta: {}, body: raw }
      let end = -1
      for (let index = 1; index < lines.length; index++) {
        if (lines[index].trim() === '---') { end = index; break }
      }
      if (end === -1) return { meta: {}, body: raw }
      const meta = {}
      for (let index = 1; index < end; index++) {
        const line = lines[index]
        if (line.trim() === '' || /^\s/.test(line)) continue
        const colon = line.indexOf(':')
        if (colon <= 0) continue
        const key = line.slice(0, colon).trim()
        const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, '')
        if (value === '' || value === '>' || value === '|') continue
        meta[key] = value
      }
      return { meta, body: lines.slice(end + 1).join('\n').replace(/^\n+/, '') }
    }

    /** 把一个 .md 文件解析成 /create 要的字段；缺什么就按文件名/正文补什么。 */
    function parseImportedSkill(fileName, text) {
      const stem = String(fileName === undefined || fileName === null ? '' : fileName).replace(/\.[^.]+$/, '').trim()
      const { meta, body } = splitImportedMarkdown(text)
      const heading = (body.match(/^#\s+(.+)$/m) || [])[1] || ''
      const alias = HAS_CJK_RE.test(stem) ? stem : (HAS_CJK_RE.test(heading) ? heading.trim() : '')
      const declared = typeof meta.name === 'string' ? meta.name.trim() : ''
      let name = KEBAB_RE.test(declared) ? declared : slugFromText(declared !== '' ? declared : stem)
      if (name === '') name = 'imported-' + Date.now().toString(36)
      let description = typeof meta.description === 'string' ? meta.description.trim() : ''
      if (description === '') {
        // 候选段落按「大标题 / 引用块 / 列表 / 普通段落」分类。描述优先取**首个二级
        // 标题之前**的普通段落——那是文件的摘要区；没有就退回大标题本身，再退回引用块。
        // 这样既不会把正文里的清单当成简介，也不会让「## 执行契约」那类章节标题串进来。
        const parts = body.split(/\n{2,}/).map((part) => {
          const trimmed = part.trim()
          const text = trimmed.replace(/^>\s?/gm, '').replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim()
          return {
            level: (trimmed.match(/^#+/) || [''])[0].length,
            quote: trimmed.startsWith('>'),
            list: /^(?:[-*+]\s|\d+[.)]\s)/.test(trimmed),
            text,
          }
        }).filter((part) => part.text !== '' && !part.text.startsWith('---'))
        const firstSection = parts.findIndex((part) => part.level >= 2)
        const preamble = firstSection === -1 ? parts : parts.slice(0, firstSection)
        const plain = preamble.find((part) => part.level === 0 && part.quote !== true && part.list !== true && part.text.length >= 12)
        const title = parts.find((part) => part.level === 1)
        const quote = parts.find((part) => part.quote === true)
        const pick = plain || title || quote || parts[0]
        description = pick === undefined ? '' : pick.text.slice(0, 200)
      }
      if (description === '') description = alias !== '' ? alias : name
      const whenToUse = typeof meta.whenToUse === 'string'
        ? meta.whenToUse.trim()
        : (typeof meta.when_to_use === 'string' ? meta.when_to_use.trim() : '')
      const content = body.replace(/\s+$/, '')
      return {
        name,
        description,
        whenToUse,
        content: content === '' ? '# ' + (alias !== '' ? alias : name) : content,
        alias,
        disabled: meta['disable-model-invocation'] === 'true',
      }
    }

    /** 文本的 UTF-8 字节数（渲染器里没有 Buffer，用 TextEncoder 或手算）。 */
    function utf8Length(text) {
      try {
        if (typeof TextEncoder === 'function') return new TextEncoder().encode(text).length
      } catch { /* 退回手算 */ }
      let bytes = 0
      for (let index = 0; index < text.length; index++) {
        const code = text.charCodeAt(index)
        if (code < 0x80) bytes += 1
        else if (code < 0x800) bytes += 2
        else if (code >= 0xd800 && code <= 0xdbff) { bytes += 4; index++ }
        else bytes += 3
      }
      return bytes
    }

    /** 把本地文件读成文本（Electron 渲染器里 file.text() 可直接用）。 */
    async function readDroppedFile(file) {
      if (file === undefined || file === null) throw new Error('没有拿到文件')
      if (typeof file.text === 'function') return await file.text()
      return await new Promise((resolveText, rejectText) => {
        const reader = new FileReader()
        reader.onload = () => resolveText(String(reader.result))
        reader.onerror = () => rejectText(new Error('读取文件失败'))
        reader.readAsText(file, 'utf-8')
      })
    }

    function CreateTab({ data, reload, onCreated }) {
      const [root, setRoot] = useState('user')
      const [name, setName] = useState('')
      const [description, setDescription] = useState('')
      const [whenToUse, setWhenToUse] = useState('')
      const [content, setContent] = useState('')
      const [alias, setAlias] = useState('')
      const [categoryId, setCategoryId] = useState('')
      const [disabled, setDisabled] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [ok, setOk] = useState('')
      const [importing, setImporting] = useState(false)
      const [dragOver, setDragOver] = useState(false)
      const fileRef = useRef(null)

      const submit = async () => {
        setBusy(true); setError(''); setOk('')
        try {
          const payload = await postJson('/create', {
            root, name: name.trim(), description, whenToUse, content,
            alias, categoryId, cwd: currentCwd(), disabled,
          })
          setOk('已创建：' + payload.path)
          setName(''); setDescription(''); setWhenToUse(''); setContent(''); setAlias(''); setCategoryId(''); setDisabled(false)
          onCreated()
        } catch (e) { setError(e.message) } finally { setBusy(false) }
      }

      /**
       * 一键导入：读文件 → 解析 frontmatter → 直接建到当前选定的技能库。
       * 失败（重名、超大、格式不合）时不吞错：把解析结果回填到下面的表单，
       * 让人改完手动创建——文件内容不会白读一次。
       */
      const importFile = async (file) => {
        if (file === undefined || file === null) return
        setImporting(true); setError(''); setOk('')
        let parsed = null
        try {
          const text = await readDroppedFile(file)
          if (utf8Length(text) > 64 * 1024) throw new Error('文件超过 64 KB 上限')
          parsed = parseImportedSkill(file.name, text)
          const payload = await postJson('/create', {
            root, name: parsed.name, description: parsed.description,
            whenToUse: parsed.whenToUse, content: parsed.content,
            alias: parsed.alias, categoryId: '', cwd: currentCwd(), disabled: parsed.disabled,
          })
          setOk('已导入「' + file.name + '」→ ' + payload.path
            + (parsed.alias !== '' ? '（中文别名：' + parsed.alias + '）' : ''))
          reload()
        } catch (e) {
          if (parsed !== null) {
            setName(parsed.name); setDescription(parsed.description); setWhenToUse(parsed.whenToUse)
            setContent(parsed.content); setAlias(parsed.alias); setDisabled(parsed.disabled)
          }
          setError('导入失败：' + e.message + (parsed !== null ? '。内容已填进下面的表单，改好后点「创建技能」。' : ''))
        } finally { setImporting(false) }
      }

      const onDrop = (event) => {
        event.preventDefault()
        setDragOver(false)
        const files = event.dataTransfer !== undefined && event.dataTransfer !== null ? event.dataTransfer.files : null
        importFile(files !== null && files.length > 0 ? files[0] : null)
      }

      return h('div', {
        style: { display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 780 },
        onDragOver: (event) => { event.preventDefault(); setDragOver(true) },
        onDragLeave: () => setDragOver(false),
        onDrop,
      },
        h(Banner, { text: error }),
        h(Banner, { text: ok, tone: 'ok' }),
        h('div', { className: 'sh-drop', 'data-over': dragOver === true ? 'true' : 'false' },
          h('div', { className: 'sh-drop-text' },
            h('span', { className: 'sh-drop-title' }, '从文件导入'),
            h('span', { className: 'sh-hint' }, '选择或拖入一个 .md（例如桌面上的 SKILL.md）：会自动读取 frontmatter 里的 name / description，中文文件名会存成中文别名。')),
          h(Btn, {
            variant: 'primary', disabled: importing,
            onClick: () => { if (fileRef.current !== null) fileRef.current.click() },
          }, importing === true ? '导入中…' : '选择 .md 文件'),
          h('input', {
            ref: fileRef, type: 'file', accept: '.md,.markdown,.txt,text/markdown',
            className: 'sh-visually-hidden',
            onChange: (event) => {
              const files = event.target.files
              const picked = files !== null && files !== undefined && files.length > 0 ? files[0] : null
              event.target.value = ''
              importFile(picked)
            },
          })),
        h('div', { className: 'sh-row' },
          h('div', { className: 'sh-field', style: { flex: '0 0 240px' } },
            h('span', { className: 'sh-label' }, '保存位置'),
            h(Select, { value: root, onChange: setRoot },
              h('option', { value: 'user' }, '用户技能库 · ~/.dsh/skills'),
              h('option', { value: 'project' }, '当前项目 · <项目根>/.dsh/skills'))),
          h('div', { className: 'sh-field', style: { flex: 1 } },
            h('span', { className: 'sh-label' }, '技能名（kebab-case，模型按它调用）'),
            h(Input, { value: name, placeholder: 'my-skill', onChange: setName }))),
        h('div', { className: 'sh-field' },
          h('span', { className: 'sh-label' }, 'description 简介（必填，模型据此判断何时加载）'),
          h(Area, { value: description, onChange: setDescription, rows: 3 })),
        h('div', { className: 'sh-field' },
          h('span', { className: 'sh-label' }, 'whenToUse 适用场景（可选）'),
          h(Input, { value: whenToUse, onChange: setWhenToUse })),
        h('div', { className: 'sh-field' },
          h('span', { className: 'sh-label' }, '正文（Markdown）'),
          h(Area, { value: content, onChange: setContent, rows: 14, placeholder: '# 技能标题\n\n正文…' })),
        h('div', { className: 'sh-section' },
          h('div', { className: 'sh-section-title' }, '本地标注', h(Badge, { tone: 'local' }, '只给你自己看')),
          h('div', { className: 'sh-row' },
            h('div', { className: 'sh-field', style: { flex: 1 } },
              h('span', { className: 'sh-label' }, '中文别名'),
              h(Input, { value: alias, onChange: setAlias, placeholder: '例如：我的常用技能' })),
            h('div', { className: 'sh-field', style: { flex: '0 0 220px' } },
              h('span', { className: 'sh-label' }, '分类'),
              h(Select, { value: categoryId, onChange: setCategoryId },
                h('option', { value: '' }, '（未分类）'),
                (data.categories || []).map((category) => h('option', { key: category.id, value: category.id }, category.name))))),
          h(Switch, {
            on: !disabled,
            label: disabled === true ? '模型不可调用' : '模型可调用',
            onToggle: () => setDisabled(!disabled),
          })),
        h('div', { className: 'sh-row' },
          h(Btn, { variant: 'primary', disabled: busy || name.trim() === '' || description.trim() === '', onClick: submit }, '创建技能')))
    }

    // ── 回收站 tab ──────────────────────────────────────────────────────────

    function TrashTab({ reloadToken }) {
      const [entries, setEntries] = useState(null)
      const [root, setRoot] = useState('')
      const [error, setError] = useState('')
      const [busy, setBusy] = useState(false)

      const load = useCallback(async () => {
        setError('')
        try {
          const payload = await getJson('/trash')
          setEntries(payload.entries || [])
          setRoot(payload.root || '')
        } catch (e) { setError(e.message); setEntries([]) }
      }, [])

      useEffect(() => { load() }, [load, reloadToken])

      const act = async (path, body) => {
        setBusy(true); setError('')
        try {
          await postJson(path, body)
          await load()
        } catch (e) { setError(e.message) } finally { setBusy(false) }
      }

      if (entries === null) return h('div', { className: 'sh-empty' }, '读取中…')

      return h(React.Fragment, null,
        h('div', { className: 'sh-toolbar' },
          h('span', { className: 'sh-hint' }, '回收站：' + root + '（保留 30 天，期间可随时还原）'),
          h('div', { className: 'sh-grow' }),
          h(Btn, { small: true, disabled: busy || entries.length === 0, onClick: () => act('/trash/purge', { all: true }) }, '清空回收站')),
        h(Banner, { text: error }),
        entries.length === 0
          ? h('div', { className: 'sh-empty' }, '回收站是空的')
          : entries.map((entry) => h('div', { key: entry.id, className: 'sh-card' },
              h('div', { className: 'sh-card-main' },
                (typeof entry.alias === 'string' && entry.alias !== '')
                  ? h(React.Fragment, null,
                      h('span', { className: 'sh-alias' }, entry.alias),
                      h('span', { className: 'sh-real' }, entry.name),
                      h(Badge, { tone: 'local' }, '标注会一起还原'))
                  : h('span', { className: 'sh-alias' }, entry.name),
                h(Badge, null, relativeTime(entry.deletedAt))),
              h('div', { className: 'sh-path', title: entry.originalPath }, entry.originalPath),
              h('div', { className: 'sh-actions' },
                h(Btn, { small: true, variant: 'primary', disabled: busy, onClick: () => act('/trash/restore', { id: entry.id }) }, '还原到原位'),
                h(Btn, { small: true, variant: 'danger', disabled: busy, onClick: () => act('/trash/purge', { id: entry.id }) }, '彻底删除')))))
    }

    // ── 中栏页面 ────────────────────────────────────────────────────────────

    function SkillHubPage() {
      useEffect(ensureStyles, [])
      const [tab, setTab] = useState('skills')
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [busyName, setBusyName] = useState('')
      const [editing, setEditing] = useState(null)
      const [pendingDelete, setPendingDelete] = useState(null)
      const [showCategories, setShowCategories] = useState(false)
      const [reloadToken, setReloadToken] = useState(0)

      const reload = useCallback(() => setReloadToken((n) => n + 1), [])

      useEffect(() => {
        let alive = true
        setError('')
        getJson(withCwd('/list'))
          .then((payload) => { if (alive) setData(payload) })
          .catch((e) => { if (alive) setError('加载技能列表失败：' + e.message) })
        return () => { alive = false }
      }, [reloadToken])

      const findRow = (name) => {
        if (data === null) return null
        for (const group of data.groups || []) {
          for (const row of group.skills) if (row.name === name) return row
        }
        return null
      }

      const toggle = async (row, enabled) => {
        setBusyName(row.name); setError('')
        try {
          await postJson('/set-enabled', { name: row.name, path: row.path, enabled, cwd: currentCwd() })
          reload()
        } catch (e) { setError('切换失败：' + e.message) } finally { setBusyName('') }
      }

      /** 真正执行删除（已经在自带确认弹窗里点过确认）。 */
      const performDelete = async (row) => {
        setBusyName(row.name); setError('')
        try {
          await postJson('/delete', { name: row.name, path: row.path, cwd: currentCwd() })
          setPendingDelete(null)
          reload()
        } catch (e) { setError('删除失败：' + e.message) } finally { setBusyName('') }
      }

      const categories = data !== null && Array.isArray(data.categories) ? data.categories : []

      return h('div', { className: 'sh-view', 'data-dsh-plugin': 'skill-deck' },
        h('div', { className: 'sh-panel', 'data-dsh-skill-deck-view': '' },
          h('div', { className: 'sh-header' },
            h('h2', { className: 'sh-title' }, '技能牌组'),
            data !== null ? h('span', { className: 'sh-sub' }, (data.total || 0) + ' 个技能 · ' + categories.length + ' 个分类') : null,
            h(Btn, { small: true, onClick: returnToConversation }, '返回会话'),
            h(Btn, { small: true, onClick: () => setShowCategories(true) }, '管理分类'),
            h(Btn, { small: true, onClick: reload }, '刷新')),
          h('div', { className: 'sh-tabbar' },
            [['skills', '技能'], ['create', '新建'], ['trash', '回收站']].map(([key, label]) =>
              h('button', {
                key, type: 'button', className: 'sh-tab',
                'data-active': tab === key ? 'true' : 'false',
                onClick: () => setTab(key),
              }, label))),
          h('div', { className: 'sh-body' },
            h(Banner, { text: error }),
            tab === 'skills'
              ? (data === null
                  ? h('div', { className: 'sh-empty' }, '加载中…')
                  : h(React.Fragment, null,
                      h('div', { className: 'sh-hint' },
                        '技能名与 description 写在 SKILL.md 里，模型能看到；中文别名、本地备注、分类、标签只保存在本机 meta.json，模型读不到。'),
                      h(SkillsTab, {
                        data,
                        onEdit: (row) => setEditing(row),
                        onDelete: (row) => setPendingDelete(row),
                        onToggle: toggle,
                        busyName,
                      })))
              : null,
            tab === 'create' && data !== null
              ? h(CreateTab, { data, reload, onCreated: () => { reload(); setTab('skills') } })
              : null,
            tab === 'trash' ? h(TrashTab, { reloadToken }) : null)),
        editing !== null
          ? h(EditDialog, {
              row: editing,
              categories,
              cwd: currentCwd(),
              onClose: () => setEditing(null),
              onSaved: () => reload(),
              onCategoryChanged: () => reload(),
            })
          : null,
        showCategories === true
          ? h(CategoryDialog, { categories, onClose: () => setShowCategories(false), onChanged: () => reload() })
          : null,
        pendingDelete !== null
          ? h(ConfirmDialog, {
              title: '移入回收站',
              body: '把「'
                + ((pendingDelete.local !== undefined && pendingDelete.local !== null && pendingDelete.local.alias !== '')
                  ? pendingDelete.local.alias + '（' + pendingDelete.name + '）'
                  : pendingDelete.name)
                + '」移入回收站？\n\n技能目录会移动到插件的回收站里，可以随时在「回收站」标签页还原到原位，不会影响其它技能。',
              confirmLabel: '移入回收站',
              tone: 'danger',
              busy: busyName === pendingDelete.name,
              onCancel: () => setPendingDelete(null),
              onConfirm: () => performDelete(pendingDelete),
            })
          : null)
    }

    // ── 输入栏「技能」快捷插入 ──────────────────────────────────────────────
    //
    // 插入走**官方 InputActions**（会话作用域槽位的标准 prop）：
    //   `captureInsertion()` 取 pick 时刻的 `{start,end,draftRev}` 快照，
    //   `insertText(text, span)` 在 `span.draftRev === 当前 rev` 时落笔。
    // 同时保留旧的 `slash/input-insert-text` 事件通道作为兼容回退。
    // 插入的永远是 `/<真实技能名> `——中文别名只在这个浮层里显示，不会离开浏览器。

    /** composer 侧的服务面（inputTriggers + sessions），动态注入后才可用。 */
    let composerScope = null
    /** 客户端根 ctx，供「返回会话」惰性取 layout 服务。 */
    let clientCtx = null
    /**
     * 把中栏交还给会话。
     *
     * 外壳只负责「选中这个面板」，点同一行**不会**切回去，所以面板自己得留一个
     * 出口（skill-explorer 同样带了「返回会话」控件）。layout 在槽位回调期间不一定
     * 已就绪，所以每次点击时惰性取一次，取不到就静默无操作。
     */
    function returnToConversation() {
      try {
        const layout = clientCtx !== null && typeof clientCtx.get === 'function' ? clientCtx.get('layout') : undefined
        if (layout !== undefined && layout !== null && typeof layout.selectPanel === 'function') layout.selectPanel(null)
      } catch { /* 没有 layout 服务就什么也不做 */ }
    }

    // ── 插入通道 ──────────────────────────────────────────────────────────────
    //
    // 把「/技能名 」送进草稿有三条路，从上往下试，命中一条就不再试下一条
    // （两条都成功会把同一个技能插两遍）：
    //
    //   ① inputActions —— 会话作用域槽位的标准 prop，当前宿主走这条；
    //   ② slash/input-insert-text 事件 + sessions.scope(id) —— 0.1.6 及更早；
    //   ③ 同一个事件 + sessions.using(id, …) —— 0.1.7 起 scope() 没了，
    //      会话 ctx 只能在 using 的回调里取。
    //
    // 三条都不通就返回 false，由浮层明说「请手动输入」，不假装写进去了。
    //
    // ① 的 span 为什么必须现取：captureInsertion() 给的是带 revision 的快照，拿槽位
    // prop 里那份旧快照会被编辑器按 CAS 判为过期、静默丢掉——草稿里什么都不出现，
    // 也不报错。②③ 的 span 自己拼，draftRev 同样参与这次 CAS。

    /** 贴着草稿末尾的折叠选区：起点终点都落在末尾。 */
    function draftEndSpan(draft, rev) {
      const end = typeof draft === 'string' ? draft.length : 0
      return { start: end, end: end, draftRev: typeof rev === 'number' ? rev : 0 }
    }

    /**
     * 老宿主取会话 ctx 的路子：sessions.scope(id)。
     * @returns undefined = 这个宿主没有该方法；null = 有，但没拿到能用的 ctx。
     */
    function sessionCtxViaScope(sessions, sessionId) {
      if (sessions === null || sessions === undefined) return null
      if (typeof sessions.scope !== 'function') return undefined
      try {
        const ctx = sessions.scope(sessionId)
        if (ctx === null || ctx === undefined) return null
        return typeof ctx.bail === 'function' ? ctx : null
      } catch { return null }
    }

    /** ① 官方 InputActions：现取 span，现插一次。 */
    function viaInputActions(actions, text) {
      const usable = actions !== null && actions !== undefined
        && typeof actions.captureInsertion === 'function'
        && typeof actions.insertText === 'function'
      if (usable !== true) return false
      let span
      try {
        span = actions.captureInsertion()
      } catch { return false }
      if (span === null || span === undefined) return false
      try {
        return actions.insertText(text, span) === true
      } catch { return false }
    }

    /** ②③ 事件通道；using 那条是 fire-and-forget，投递出去就算成功。 */
    function viaEventChannel(sessions, sessionId, text, draft, rev) {
      if (sessions === null || sessions === undefined) return false
      const payload = { text, span: draftEndSpan(draft, rev) }
      const ctx = sessionCtxViaScope(sessions, sessionId)

      if (ctx !== undefined) {
        if (ctx === null) return false
        try {
          return ctx.bail(ctx, 'slash/input-insert-text', payload) === true
        } catch { return false }
      }

      // ctx === undefined：宿主已经拿掉 scope()，退到 using。
      if (typeof sessions.using !== 'function') return false
      try {
        const settled = sessions.using(sessionId, { source: 'skill-deck-pick' }, (ref) => {
          const inner = ref !== null && ref !== undefined && ref.binding !== undefined ? ref.binding.ctx : undefined
          if (inner === null || inner === undefined) return
          if (typeof inner.bail !== 'function') return
          try {
            inner.bail(inner, 'slash/input-insert-text', payload)
          } catch { /* 会话已经关了，这次 pick 作废 */ }
        })
        if (settled !== null && settled !== undefined && typeof settled.catch === 'function') settled.catch(() => {})
        return true
      } catch { return false }
    }

    /**
     * 送进草稿：官方通道优先，其次事件通道。
     * @returns 是否已投递（using 那条只是排上队，也算投递）。
     */
    function insertSkillText(actions, scope, sessionId, input, text) {
      if (viaInputActions(actions, text) === true) return true
      const draft = input !== null && input !== undefined ? input.draft : undefined
      const rev = input !== null && input !== undefined ? input.draftRev : undefined
      const sessions = scope !== null && scope !== undefined ? scope.sessions : undefined
      return viaEventChannel(sessions, sessionId, text, draft, rev) === true
    }

    /**
     * 候选拉不到时的兜底：掀开宿主自己的 `/` 菜单。
     * 按钮不会消失，只是没有搜索框——这时插入的是宿主菜单里的命令，不是技能。
     */
    function openHostSlashMenu(scope, sessionId, input, sourceName) {
      const triggers = scope !== null && scope !== undefined ? scope.inputTriggers : undefined
      const sessions = scope !== null && scope !== undefined ? scope.sessions : undefined
      if (triggers === null || triggers === undefined) return false
      const ctx = sessionCtxViaScope(sessions, sessionId)
      if (ctx === null || ctx === undefined) return false
      let controller
      try {
        controller = triggers.sessionOf(ctx)
      } catch { return false }
      if (controller === null || controller === undefined) return false
      if (typeof controller.toggleSource !== 'function') return false
      const draft = input !== null && input !== undefined && typeof input.draft === 'string' ? input.draft : ''
      const span = draftEndSpan(draft, input !== null && input !== undefined ? input.draftRev : undefined)
      try {
        controller.toggleSource(sourceName, {
          trigger: '/',
          query: '',
          quoted: false,
          position: draft.trim() === '' ? 'leading' : 'inline',
          span,
        })
      } catch { return false }
      return true
    }

    /** 浮层关掉之后把光标还给输入框；面板已经切走就没什么可还原的。 */
    function handFocusBackToComposer() {
      try {
        const area = document.querySelector('[data-composer-card] textarea')
        if (area !== null && typeof area.focus === 'function') area.focus()
      } catch { /* 找不到就算了 */ }
    }

    /** 浮层候选缓存（TTL 内复用，避免每次点开都打宿主）。 */
    let catalogCache = { at: 0, rows: null, categories: [] }
    const CATALOG_TTL = 30000
    /** 候选上限：再多的靠搜索框收敛。 */
    const PICKER_CAP = 300

    /** 拉取候选（带 TTL 缓存）。 */
    async function fetchCatalog(force) {
      const now = Date.now()
      if (force !== true && catalogCache.rows !== null && now - catalogCache.at < CATALOG_TTL) return catalogCache
      const payload = await getJson(withCwd('/picker'))
      catalogCache = {
        at: now,
        rows: Array.isArray(payload.skills) ? payload.skills : [],
        categories: Array.isArray(payload.categories) ? payload.categories : [],
      }
      return catalogCache
    }

    /** 候选排序：中文别名命中的排前面，其余按名称。 */
    function rankRows(rows, needle) {
      if (needle === '') return rows
      const scored = []
      for (const row of rows) {
        const alias = (row.alias || '').toLowerCase()
        const name = (row.name || '').toLowerCase()
        const description = (row.description || '').toLowerCase()
        const note = (row.note || '').toLowerCase()
        let score = -1
        if (alias.startsWith(needle)) score = 0
        else if (name.startsWith(needle)) score = 1
        else if (alias.includes(needle)) score = 2
        else if (name.includes(needle)) score = 3
        else if (note.includes(needle)) score = 4
        else if (description.includes(needle)) score = 5
        if (score >= 0) scored.push({ row, score })
      }
      scored.sort((a, b) => (a.score - b.score) || a.row.name.localeCompare(b.row.name))
      return scored.map((entry) => entry.row)
    }

    /**
     * 快捷插入浮层。
     *
     * 底色跟随宿主的菜单 token（见 CSS 里的 --sh-surface），中文别名做主标题、
     * 真实技能名做副标题，底部一行常驻提示「插入的是真名」。
     */
    function SkillPicker(props) {
      const [query, setQuery] = useState('')
      const [active, setActive] = useState(0)
      const [categoryFilter, setCategoryFilter] = useState('')
      const inputRef = useRef(null)
      const listRef = useRef(null)

      useEffect(() => { try { if (inputRef.current) inputRef.current.focus() } catch {} }, [])
      useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape' && event.isComposing !== true) props.onClose() }
        try { document.addEventListener('keydown', onKey) } catch {}
        return () => { try { document.removeEventListener('keydown', onKey) } catch {} }
      }, [])

      const needle = query.trim().toLowerCase()
      const all = props.rows || []
      const categories = props.categories || []

      // 只列出「真的有用到的」分类，避免一排空分类占位置。
      const usedCategories = useMemo(() => {
        const counts = new Map()
        for (const row of all) {
          if (typeof row.categoryId === 'string' && row.categoryId !== '') {
            counts.set(row.categoryId, (counts.get(row.categoryId) || 0) + 1)
          }
        }
        return categories.filter((category) => counts.has(category.id))
      }, [all, categories])

      const filtered = useMemo(() => {
        let rows = all
        if (categoryFilter !== '') rows = rows.filter((row) => row.categoryId === categoryFilter)
        if (needle !== '') {
          rows = rows.filter((row) => {
            const alias = (row.alias || '').toLowerCase()
            const name = (row.name || '').toLowerCase()
            return alias.includes(needle) || name.includes(needle)
              || (row.description || '').toLowerCase().includes(needle)
              || (row.note || '').toLowerCase().includes(needle)
          })
        }
        return rankRows(rows, needle).slice(0, PICKER_CAP)
      }, [all, needle, categoryFilter])

      useEffect(() => { setActive(0) }, [needle, categoryFilter, props.rows])
      useEffect(() => {
        const list = listRef.current
        const element = list && list.children[active]
        if (element && typeof element.scrollIntoView === 'function') {
          try { element.scrollIntoView({ block: 'nearest' }) } catch {}
        }
      }, [active])

      const onKeyDown = (event) => {
        if (event.nativeEvent && event.nativeEvent.isComposing === true) return
        if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(i + 1, filtered.length - 1)) }
        else if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(i - 1, 0)) }
        else if (event.key === 'Enter') { event.preventDefault(); const row = filtered[active]; if (row) props.onPick(row) }
      }

      const width = 460
      const winW = typeof window !== 'undefined' ? window.innerWidth : 900
      const winH = typeof window !== 'undefined' ? window.innerHeight : 700
      const anchor = props.anchor || { left: 16, top: 200 }
      const left = Math.max(8, Math.min(anchor.left, winW - width - 8))
      const bottom = Math.max(8, winH - anchor.top + 8)

      return h('div', {
        className: 'sh-pick-backdrop',
        onMouseDown: (event) => { if (event.target === event.currentTarget) props.onClose() },
      },
        h('div', {
          className: 'sh-pick', style: { left, bottom, width },
          role: 'dialog', 'aria-label': '选择技能', 'data-dsh-plugin': 'skill-deck',
        },
          h('div', { className: 'sh-pick-head' },
            h('input', {
              ref: inputRef, className: 'sh-input sh-pick-search',
              value: query, placeholder: '搜索中文别名或技能名…',
              onChange: (event) => setQuery(event.target.value), onKeyDown,
            })),
          usedCategories.length > 0
            ? h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
                h('button', {
                  type: 'button', className: 'sh-chip',
                  'data-on': categoryFilter === '' ? 'true' : 'false',
                  onMouseDown: (event) => { event.preventDefault(); setCategoryFilter('') },
                }, '全部'),
                usedCategories.map((category) => h('button', {
                  key: category.id, type: 'button', className: 'sh-chip',
                  'data-on': categoryFilter === category.id ? 'true' : 'false',
                  onMouseDown: (event) => {
                    event.preventDefault()
                    setCategoryFilter(categoryFilter === category.id ? '' : category.id)
                  },
                }, category.name)))
            : null,
          h('div', { className: 'sh-pick-list', ref: listRef, role: 'listbox' },
            props.rows === null
              ? h('div', { className: 'sh-pick-empty' }, '加载中…')
              : filtered.length === 0
                ? h('div', { className: 'sh-pick-empty' }, all.length === 0 ? '没有可用技能' : '没有匹配的技能')
                : filtered.map((row, index) => h('button', {
                    key: row.name, type: 'button', role: 'option',
                    'aria-selected': index === active,
                    className: 'sh-pick-row',
                    'data-active': index === active ? 'true' : 'false',
                    onMouseEnter: () => setActive(index),
                    onMouseDown: (event) => { event.preventDefault(); props.onPick(row) },
                  },
                    h('span', { className: 'sh-pick-line1' },
                      h('span', { className: 'sh-pick-alias' }, (row.alias || '') !== '' ? row.alias : row.name),
                      (row.alias || '') !== '' ? h('span', { className: 'sh-pick-name' }, row.name) : null,
                      row.modelInvocable === false ? h('span', { className: 'sh-badge sh-badge-off' }, '模型不可调用') : null),
                    h('span', { className: 'sh-pick-desc' },
                      (row.note || '') !== '' ? row.note : row.description)))),
          h('div', { className: 'sh-pick-foot' },
            h('span', null, '↑↓ 选择 · Enter 确认 · Esc 关闭'),
            h('span', { className: 'sh-grow' }),
            props.notice !== undefined && props.notice !== ''
              ? h('span', { style: { color: 'var(--dsw-alias-state-warn-primary)' } }, props.notice)
              : h('span', null, '插入的是真实技能名 /技能名，中文别名只在这里显示'))))
    }

    /** composer 工具行里的按钮 + 浮层宿主。 */
    function ComposerButtonSlot(props) {
      useEffect(ensureStyles, [])
      const [anchor, setAnchor] = useState(null)
      const [rows, setRows] = useState(null)
      const [categories, setCategories] = useState([])
      const [notice, setNotice] = useState('')
      const btnRef = useRef(null)
      const liveInput = useRef(props.input)
      liveInput.current = props.input

      // 官方 InputActions（会话作用域槽位的标准 prop）是首选插入通道；
      // 它缺位时退回动态注入的 inputTriggers/sessions 兼容路径。
      const hasActions = props.inputActions !== undefined && props.inputActions !== null
        && typeof props.inputActions.captureInsertion === 'function'
        && typeof props.inputActions.insertText === 'function'
      const ready = props.sessionId !== undefined && props.sessionId !== null
        && (hasActions || (composerScope !== null
          && composerScope.inputTriggers !== undefined && composerScope.sessions !== undefined))
      if (ready !== true) return null

      const close = () => { setAnchor(null); setNotice('') }

      const open = async () => {
        const rect = btnRef.current !== null && typeof btnRef.current.getBoundingClientRect === 'function'
          ? btnRef.current.getBoundingClientRect()
          : { left: 16, top: 200 }
        setAnchor({ left: rect.left, top: rect.top })
        setRows(null)
        setNotice('')
        try {
          const catalog = await fetchCatalog(false)
          setRows(catalog.rows)
          setCategories(catalog.categories)
        } catch {
          // 宿主目录拉不到 → 退回宿主斜杠菜单，按钮不消失。
          setAnchor(null)
          openHostSlashMenu(composerScope, props.sessionId, liveInput.current, 'skill')
        }
      }

      const pick = (row) => {
        const text = '/' + row.name + ' '
        const written = insertSkillText(props.inputActions, composerScope, props.sessionId, liveInput.current, text)
        if (written === true) {
          close()
          handFocusBackToComposer()
          return
        }
        // 插入被拒（草稿版本已变/编辑器不可编辑）：不静默吞掉，明确告诉用户怎么办。
        setNotice('没能写进输入框，请手动输入 /' + row.name)
      }

      const popover = anchor !== null && ReactDOM !== null && typeof ReactDOM.createPortal === 'function'
        ? ReactDOM.createPortal(
            h(SkillPicker, { anchor, rows, categories, notice, onClose: close, onPick: pick }),
            document.body)
        : null

      return h('button', {
        type: 'button',
        className: 'sh-chipbtn',
        ref: btnRef,
        title: '插入技能指令（/技能名）',
        'aria-haspopup': 'dialog',
        'aria-expanded': anchor !== null ? 'true' : 'false',
        'data-open': anchor !== null ? 'true' : 'false',
        'data-dsh-plugin': 'skill-deck',
        onClick: open,
      }, '技能', popover)
    }

    // ── 插件契约 ────────────────────────────────────────────────────────────

    /** 槽位注册的释放器（挂载时压栈，卸载时统一释放）。 */
    const SLOT_DISPOSERS = []

    /**
     * 挂载三块界面：
     *  1. 侧边栏「技能牌组」行（`sidebar.panellist`）——按钮本体、标签、高亮、
     *     折叠轨几何都归外壳，这里只画字形。
     *  2. 中栏页面（`main`，keyed by PANEL_ID）——外壳只在该面板被选中时挂载它。
     *  3. composer 工具行的「技能」按钮（`conversation.input.left`）。
     *
     * 三处都走 `ctx.slots.inject`：占据该座位的 shell 插件还没声明时回调不执行，
     * 加载顺序因此无关紧要，没有 shell 的组合也只是少几块 UI 而不会挂掉启动。
     */
    function apply(ctx) {
      ensureStyles()
      clientCtx = ctx

      // inputTriggers / sessions 是 composer 插入文本所必需的服务面。
      // 静态 inject 会拖住激活，所以走动态注入；缺失时只是按钮不出现。
      try {
        if (typeof ctx.inject === 'function') {
          ctx.inject(['inputTriggers', 'sessions'], (scope) => { composerScope = scope })
        }
      } catch (error) {
        console.warn('[skill-deck] composer 服务注入失败：', error)
      }

      ctx.effect(() => {
        const slots = ctx.slots
        try {
          SLOT_DISPOSERS.push(slots.inject('sidebar.panellist', () => slots.register({
            name: 'sidebar.panellist',
            id: PANEL_ID,
            order: 35,
            label: () => '技能牌组',
          }, SkillHubIcon)))

          SLOT_DISPOSERS.push(slots.inject('main', () => slots.register({
            name: 'main',
            key: PANEL_ID,
          }, SkillHubPage)))

          SLOT_DISPOSERS.push(slots.inject('conversation.input.left', () => slots.register({
            name: 'conversation.input.left',
            id: PANEL_ID,
            order: 60,
            label: () => '技能',
          }, function SkillHubComposerSlot(apiProps) {
            const share = apiProps === undefined || apiProps === null ? {} : apiProps
            return h(ComposerButtonSlot, {
              // 会话作用域槽位的标准 prop：inputActions + sessionId（官方插入通道）。
              inputActions: share.inputActions,
              sessionId: share.sessionId,
              // 兼容位：旧内核没有 inputActions 时退回事件通道，只能拿到这份快照。
              input: share.input,
            })
          })))
        } catch (error) {
          console.warn('[skill-deck] 槽位注册失败：', error)
        }
        return () => {
          for (const dispose of SLOT_DISPOSERS.splice(0)) {
            try { dispose() } catch { /* 卸载失败不该阻断其它释放 */ }
          }
        }
      }, 'skill-deck: ui mounts')
    }

    exports.apply = apply
    exports.inject = ['slots']
    exports.__internals = {
      PANEL_ID,
      matchSkill,
      rankRows,
      relativeTime,
      insertSkillText,
      viaInputActions,
      viaEventChannel,
      draftEndSpan,
      openHostSlashMenu,
      fetchCatalog,
      utf8Length,
      slugFromText,
      splitImportedMarkdown,
      parseImportedSkill,
    }
    /** 组件面（离线冒烟测试用：测试通过它拿到本作用域里的内部函数）。 */
    exports.__components = {
      SkillHubIcon,
      SkillHubPage,
      SkillsTab,
      SkillRow,
      CreateTab,
      EditDialog,
      CategoryDialog,
      ConfirmDialog,
      TrashTab,
      SkillPicker,
    }

    return module.exports
  },
})
