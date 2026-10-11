
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
