
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
