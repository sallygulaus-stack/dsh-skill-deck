
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
