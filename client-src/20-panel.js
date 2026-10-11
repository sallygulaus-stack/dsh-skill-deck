
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
