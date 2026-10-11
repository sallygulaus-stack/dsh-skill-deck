'use strict'
// 客户端半区冒烟测试。
//
// profile 的 node_modules 里没有 react（React 由宿主客户端运行时通过模块加载器的
// require 提供），所以这里用一个最小 React 替身：createElement + 单趟 hooks 渲染器。
// 目的不是像素级验证，而是抓「加载即崩」「某个分支渲染即抛错」这类问题；
// 真正的界面效果在装好之后的实机验证里看。
const assert = require('node:assert')
const vm = require('node:vm')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

// ── 最小 React 替身 ─────────────────────────────────────────────────────────
const Fragment = Symbol('Fragment')
let currentHooks = null

function createElement(type, props, ...children) {
  const merged = Object.assign({}, props)
  if (children.length === 1) merged.children = children[0]
  else if (children.length > 1) merged.children = children
  return { type, props: merged }
}

const useState = (initial) => {
  const slot = currentHooks.index++
  if (currentHooks.list[slot] === undefined) {
    currentHooks.list[slot] = [typeof initial === 'function' ? initial() : initial, () => {}]
  }
  return currentHooks.list[slot]
}
const useEffect = (fn) => { currentHooks.index++; currentHooks.effects.push(fn) }
const useRef = (initial) => {
  const slot = currentHooks.index++
  if (currentHooks.list[slot] === undefined) currentHooks.list[slot] = { current: initial }
  return currentHooks.list[slot]
}
const useMemo = (fn) => { currentHooks.index++; return fn() }
const useCallback = (fn) => { currentHooks.index++; return fn }

const ReactStub = { createElement, Fragment, useState, useEffect, useRef, useMemo, useCallback }

/** 单趟渲染成文本，用来断言某段文案出现在树里。 */
function renderText(element) {
  const previous = currentHooks
  currentHooks = { index: 0, list: [], effects: [] }
  try {
    return walk(element)
  } finally {
    currentHooks = previous
  }

  function walk(node) {
    if (node === null || node === undefined || node === false || node === true) return ''
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(walk).join(' ')
    if (node.type === Fragment) return walk(node.props.children)
    if (typeof node.type === 'function') {
      const saved = currentHooks
      currentHooks = { index: 0, list: [], effects: [] }
      let out
      try {
        out = node.type(node.props || {})
      } finally {
        currentHooks = saved
      }
      return walk(out)
    }
    // 宿主元素：把 value/placeholder/title 这类字符串 prop 也算进文本，
    // 否则输入框里的内容（分类名、别名…）在断言里看不见。
    const props = node.props || {}
    const propText = ['value', 'placeholder', 'title', 'aria-label', 'className']
      .map((key) => (typeof props[key] === 'string' ? props[key] : ''))
      .filter((text) => text !== '')
      .join(' ')
    const childrenText = walk(props.children)
    return propText === '' ? childrenText : propText + ' ' + childrenText
  }
}

// ── 装载 bundle ────────────────────────────────────────────────────────────
let loaded = null
const windowStub = { __ModuleLoader__: { load: (spec) => { loaded = spec } }, innerWidth: 1200, innerHeight: 800 }
globalThis.window = windowStub
globalThis.document = undefined

const bundlePath = join(__dirname, '..', 'client', 'bundle.js')
const bundleText = readFileSync(bundlePath, 'utf8')
vm.runInThisContext(bundleText, { filename: 'client/bundle.js' })

assert.ok(loaded !== null, 'should register itself with __ModuleLoader__')
assert.strictEqual(loaded.id, 'dsh-skill-deck')
const mod = loaded.factory((name) => {
  if (name === 'react') return ReactStub
  if (name === 'react-dom') return { createPortal: (node) => node }
  throw new Error('unexpected require: ' + name)
})
assert.strictEqual(typeof mod.apply, 'function')
assert.deepStrictEqual(mod.inject, ['slots'])
console.log('1 OK bundle 装载，apply/inject 就位')

// ── apply(ctx)：槽位注册 + 释放 ──
const registrations = []
const injections = []
let teardown = null
const ctx = {
  effect(fn) { const dispose = fn(); teardown = dispose; return () => dispose() },
  inject(services) { injections.push(services) },
  slots: {
    inject(key, callback) { injections.push(key); return callback() },
    register(spec, component) {
      registrations.push({ spec, component })
      return () => { registrations.push({ disposed: spec.id || spec.key }) }
    },
  },
}
mod.apply(ctx)

const panelRow = registrations.find((r) => r.spec && r.spec.name === 'sidebar.panellist')
const mainPage = registrations.find((r) => r.spec && r.spec.name === 'main')
const composer = registrations.find((r) => r.spec && r.spec.name === 'conversation.input.left')
assert.ok(panelRow && panelRow.spec.id === 'skill-deck' && panelRow.spec.label() === '技能牌组')
assert.ok(mainPage && mainPage.spec.key === 'skill-deck')
assert.ok(composer && composer.spec.name === 'conversation.input.left')
assert.ok(injections.some((i) => Array.isArray(i) && i.includes('sessions')), 'dynamic sessions inject requested')
console.log('2 OK apply() 注册侧边栏行 / 中栏页 / composer 按钮')

const C = mod.__components
const I = mod.__internals

// ── 图标 ──
const iconText = renderText(createElement(panelRow.component, { size: 18, active: false }))
assert.ok(iconText.includes('svg') === false && iconText.trim() === '', 'svg host element renders no text (ok)')
console.log('3 OK 侧边栏图标可渲染')

// ── 面板页（数据未到位）──
const pageText = renderText(createElement(mainPage.component, {}))
assert.ok(pageText.includes('技能牌组'))
assert.ok(pageText.includes('管理分类'))
assert.ok(pageText.includes('加载中'))
console.log('4 OK 面板页空数据渲染')

// ── 合成一份完整的 list 负载，覆盖列表 / 分组 / 分类 / 开关 / 只读 ──
const data = {
  cwd: 'D:/deepseek',
  projectRoot: 'D:/',
  projectRootDisplay: 'D:/',
  roots: [{ root: '~/.dsh/skills', source: 'user-dsh' }],
  categories: [
    { id: 'c1', name: '动效', color: '#ff8800', order: 0 },
    { id: 'c2', name: '界面', color: '', order: 1 },
  ],
  total: 3,
  groups: [
    {
      key: 'user-dsh', title: '用户技能库', hint: '~/.dsh/skills · 模型可直接调用', order: 20,
      skills: [
        { name: 'animate', description: 'Build an animation from scratch.', modelInvocable: true, userInvocable: true, source: 'user-dsh', path: 'C:/x/animate/SKILL.md', dir: 'C:/x/animate', linked: false, editable: true, deletable: true, validName: true, local: { alias: '动画制作', note: '我常用的', categoryId: 'c1', tags: ['动效'] } },
        { name: 'apple-design', description: "Apple's approach to interface design.", modelInvocable: false, userInvocable: true, source: 'user-dsh', path: 'C:/x/apple-design/SKILL.md', dir: 'C:/x/apple-design', linked: false, editable: true, deletable: true, validName: true, local: { alias: '', note: '', categoryId: '', tags: [] } },
      ],
    },
    {
      key: 'bundled', title: '系统内置', hint: '随 DSH 发行，只读', order: 60,
      skills: [
        { name: 'office-docx', description: 'Create Word documents.', modelInvocable: true, userInvocable: true, source: 'bundled', provider: 'bundled', path: undefined, dir: undefined, linked: false, editable: false, deletable: false, validName: true, readOnly: true, local: { alias: 'Word 文档', note: '', categoryId: 'c2', tags: [] } },
      ],
    },
  ],
}

const skillsTabText = renderText(createElement(C.SkillsTab, {
  data, onEdit: () => {}, onDelete: () => {}, onToggle: () => {}, busyName: '',
}))
assert.ok(skillsTabText.includes('动画制作'), '本地别名显示在列表里')
assert.ok(skillsTabText.includes('animate'), '真实技能名同时可见')
assert.ok(skillsTabText.includes('用户技能库'), '按来源分组的组标题')
assert.ok(skillsTabText.includes('系统内置'), '内置来源分组')
assert.ok(skillsTabText.includes('模型不可调用'), '禁用状态有徽章')
assert.ok(skillsTabText.includes('只读'), '只读来源有徽章')
assert.ok(skillsTabText.includes('有本地标注'), '本地标注徽章')
assert.ok(skillsTabText.includes('动效'), '分类筛选 chip')
assert.ok(skillsTabText.includes('未分类'), '未分类筛选 chip')
assert.ok(skillsTabText.includes('按分类分组'), '分组模式切换')
// 「刷新」只留页头那一个：工具栏里不许再出现重复的刷新按钮
assert.ok(!skillsTabText.includes('刷新'), '技能工具栏里不再重复出现「刷新」')
console.log('5 OK 技能列表渲染（别名 + 真名 + 分组 + 分类 + 徽章）')

const rowText = renderText(createElement(C.SkillRow, {
  row: data.groups[0].skills[0], categories: data.categories, busy: false,
  onEdit: () => {}, onDelete: () => {}, onToggle: () => {},
}))
assert.ok(rowText.includes('动画制作') && rowText.includes('animate'))
assert.ok(rowText.includes('模型可调用'))
console.log('6 OK 单行渲染')

// ── 编辑弹窗：两块语义分区必须都在 ──
const editText = renderText(createElement(C.EditDialog, {
  row: data.groups[0].skills[0], categories: data.categories, cwd: 'D:/deepseek',
  onClose: () => {}, onSaved: () => {}, onCategoryChanged: () => {},
}))
assert.ok(editText.includes('只给你自己看'), '本地标注分区标注清楚')
assert.ok(editText.includes('AI 会读到'), '技能文件分区标注清楚')
assert.ok(editText.includes('保存本地标注'))
assert.ok(editText.includes('写给模型看的'))
// 技能文件走 /read 异步加载，首帧是「读取中…」（真正的表单在加载完成后出现）
assert.ok(editText.includes('读取中'), '技能文件区块首帧显示读取中')
assert.ok(editText.includes('meta.json'))
console.log('7 OK 编辑弹窗两分区（本地标注 / 技能文件）')

// 只读技能：不该出现「写给模型看的」编辑区，也没有读取动作
const readOnlyText = renderText(createElement(C.EditDialog, {
  row: data.groups[1].skills[0], categories: data.categories, cwd: 'D:/deepseek',
  onClose: () => {}, onSaved: () => {}, onCategoryChanged: () => {},
}))
assert.ok(readOnlyText.includes('只能加本地标注'))
assert.ok(!readOnlyText.includes('读取中'))
assert.ok(!readOnlyText.includes('写给模型看的'))
console.log('8 OK 只读技能的编辑弹窗')

// ── 分类管理 / 回收站 ──
const catText = renderText(createElement(C.CategoryDialog, { categories: data.categories, onClose: () => {}, onChanged: () => {} }))
assert.ok(catText.includes('管理分类') && catText.includes('动效') && catText.includes('新建'))
console.log('9 OK 分类管理弹窗')

const trashText = renderText(createElement(C.TrashTab, {}))
assert.ok(trashText.includes('读取中'))
console.log('10 OK 回收站（初始态）')

// ── 一键导入：解析 + 界面入口 ──
const createText = renderText(createElement(C.CreateTab, {
  data, reload: () => {}, onCreated: () => {},
}))
assert.ok(createText.includes('从文件导入'), '新建页有一键导入入口')
assert.ok(createText.includes('选择 .md 文件'), '导入按钮就位')
assert.ok(createText.includes('创建技能'), '手动创建仍然在')

// ASCII 文件名 + frontmatter：name/description 直接取自文件
const parsedAscii = I.parseImportedSkill('Skill-ComfyUI-Reverse.md',
  '---\nname: comfyui-image-reverse\ndescription: 反推 ComfyUI 图片的参数\nwhenToUse: 需要看图猜工作流时\n---\n\n# 反推\n\n正文内容。\n')
assert.strictEqual(parsedAscii.name, 'comfyui-image-reverse', 'frontmatter 的合法技能名直接用')
assert.strictEqual(parsedAscii.description, '反推 ComfyUI 图片的参数')
assert.strictEqual(parsedAscii.whenToUse, '需要看图猜工作流时')
assert.ok(parsedAscii.content.startsWith('# 反推'), 'frontmatter 之外的正文原样保留')
assert.ok(!parsedAscii.content.includes('name:'), 'frontmatter 不会重复写进正文')

// 中文文件名（没有 frontmatter）：技能名退化成 slug，中文名落进本地别名
const parsedCjk = I.parseImportedSkill('Skill-ComfyUI图片反推.md',
  '# ComfyUI 图片反推\n\n从一张图反推出它的生成参数。\n')
assert.strictEqual(parsedCjk.name, 'skill-comfyui', '中文文件名生成可用的 kebab 技能名')
assert.strictEqual(parsedCjk.alias, 'Skill-ComfyUI图片反推', '文件名落进中文别名（只给用户看）')
assert.ok(parsedCjk.description.includes('从一张图反推出'), '缺 description 时用正文首段')

// 纯中文文件名 + 没有可用 slug：仍要给出合法技能名
const parsedBare = I.parseImportedSkill('图片反推.md', '正文。')
assert.ok(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(parsedBare.name), '兜底技能名仍是合法 kebab-case')
assert.strictEqual(parsedBare.alias, '图片反推', '纯中文文件名整名进别名')
assert.strictEqual(I.utf8Length('abc'), 3)
assert.strictEqual(I.utf8Length('中文'), 6)

// 摘要区里没有普通段落（只有大标题 + 引用块 + 章节）时，宁可退回大标题，
// 也不要把正文里那一大坨编号清单当成 description。
const parsedMessy = I.parseImportedSkill('Skill-ComfyUI图片反推.md',
  '# ComfyUI图片反推融合版Skill\n\n> 版本：v1.0\n> 作者：融合重制\n\n---\n\n## 【执行契约】\n\n1. **触发方式**：用户上传图片并说「反推」时执行。\n2. **默认模式**：有图无文字走模式 A。\n')
assert.strictEqual(parsedMessy.description, 'ComfyUI图片反推融合版Skill', '没有摘要段落时用大标题，而不是正文清单')
assert.strictEqual(parsedMessy.name, 'skill-comfyui')
console.log('10b OK 一键导入（frontmatter 解析 / 中文文件名 / 兜底命名）')

// ── 快捷发送浮层：候选里要有别名 + 真名 + 不透明提示 ──
const pickerText = renderText(createElement(C.SkillPicker, {
  anchor: { left: 100, top: 300 },
  rows: [
    { name: 'animate', alias: '动画制作', categoryId: 'c1', description: 'Build an animation', note: '', modelInvocable: true, source: 'user-dsh' },
    { name: 'apple-design', alias: '', categoryId: '', description: "Apple's approach", note: '', modelInvocable: true, source: 'user-dsh' },
  ],
  categories: data.categories,
  onClose: () => {}, onPick: () => {},
}))
assert.ok(pickerText.includes('动画制作'), '浮层显示中文别名')
assert.ok(pickerText.includes('animate'), '浮层同时显示真实技能名')
assert.ok(pickerText.includes('apple-design'), '没有别名的显示真名')
assert.ok(pickerText.includes('动效'), '分类筛选 chip')
assert.ok(pickerText.includes('插入的是真实技能名'), '浮层常驻说明插入的是真名')
console.log('11 OK 快捷发送浮层（别名 + 真名 + 分类 + 说明）')

// ── 纯函数 ──
assert.strictEqual(I.matchSkill({ name: 'animate', description: 'x', local: { alias: '动画', tags: ['a'] } }, '动画', ''), true)
assert.strictEqual(I.matchSkill({ name: 'animate', description: 'x', local: { alias: '动画' } }, 'zzz', ''), false)
assert.deepStrictEqual(I.rankRows([{ name: 'b', alias: '动画' }, { name: 'animate', alias: '动画制作' }], '动画').map((r) => r.name), ['animate', 'b'])
console.log('12 OK 搜索匹配与排序')

// ── 插入协议：0.1.7+（sessions.using）与 ≤0.1.6（sessions.scope）两条路径 ──
const sent = []
const modernScope = {
  inputTriggers: {},
  sessions: {
    using(sessionId, options, callback) {
      callback({ binding: { ctx: { bail: (target, event, payload) => { sent.push({ event, payload }); return true } } } })
      return Promise.resolve()
    },
  },
}
assert.strictEqual(I.insertSkillText(undefined, modernScope, 's1', { draft: 'hi', draftRev: 3 }, '/animate '), true)
assert.strictEqual(sent[0].event, 'slash/input-insert-text')
assert.strictEqual(sent[0].payload.text, '/animate ')
assert.deepStrictEqual(sent[0].payload.span, { start: 2, end: 2, draftRev: 3 })
assert.ok(!sent[0].payload.text.includes('动画'), '插入内容绝不带中文别名')

const legacySent = []
const legacyScope = {
  inputTriggers: {},
  sessions: {
    scope() { return { bail: (target, event, payload) => { legacySent.push(payload); return true } } },
  },
}
assert.strictEqual(I.insertSkillText(undefined, legacyScope, 's1', { draft: '', draftRev: 0 }, '/apple-design '), true)
assert.strictEqual(legacySent[0].text, '/apple-design ')
console.log('13 OK 快捷发送只插入真实技能名（新旧两条内核路径）')

// ── 官方 InputActions 通道优先，且必须用 captureInsertion() 的快照 ──
const actionCalls = []
const officialActions = {
  captureInsertion: () => ({ start: 7, end: 7, draftRev: 42 }),
  insertText: (text, span) => { actionCalls.push({ text, span }); return true },
}
assert.strictEqual(I.insertSkillText(officialActions, null, 's1', undefined, '/animate '), true)
assert.strictEqual(actionCalls.length, 1, '官方通道命中时不该再走兼容通道')
assert.deepStrictEqual(actionCalls[0].span, { start: 7, end: 7, draftRev: 42 }, 'span 必须原样来自 captureInsertion()')
assert.strictEqual(actionCalls[0].text, '/animate ')

// 官方通道被拒（版本已变）时回退到事件通道，而不是静默什么都不做
const fallbackSent = []
const staleActions = { captureInsertion: () => ({ start: 0, end: 0, draftRev: 0 }), insertText: () => false }
const fallbackScope = {
  inputTriggers: {},
  sessions: { using(sessionId, options, callback) { callback({ binding: { ctx: { bail: (a, b, payload) => { fallbackSent.push(payload); return true } } } }); return Promise.resolve() } },
}
assert.strictEqual(I.insertSkillText(staleActions, fallbackScope, 's1', undefined, '/animate '), true)
assert.strictEqual(fallbackSent[0].text, '/animate ')
assert.ok(!fallbackSent[0].text.includes('动画'))
console.log('14 OK 官方 captureInsertion() 通道优先 + 被拒时回退')

// ── composer 按钮在服务面缺席时安全隐藏 ──
const composerText = renderText(createElement(composer.component, {}))
assert.strictEqual(composerText, '')
console.log('15 OK composer 按钮在服务面缺席时安全隐藏')

// ── 卸载 ──
assert.strictEqual(typeof teardown, 'function')
teardown()
assert.ok(registrations.some((r) => r.disposed === 'skill-deck'))
console.log('16 OK 卸载释放')

// ── 自带确认弹窗：删技能不再依赖原生 window.confirm ──
const confirmText = renderText(createElement(C.ConfirmDialog, {
  title: '移入回收站',
  body: '把「动画制作（animate）」移入回收站？',
  confirmLabel: '移入回收站',
  tone: 'danger',
  busy: false,
  onCancel: () => {},
  onConfirm: () => {},
}))
assert.ok(confirmText.includes('移入回收站'), '确认按钮文案')
assert.ok(confirmText.includes('取消'), '取消按钮')
assert.ok(!confirmText.includes('处理中'), '非 busy 态不显示处理中')

const confirmBusyText = renderText(createElement(C.ConfirmDialog, {
  title: '移入回收站', body: 'b', confirmLabel: '移入回收站', tone: 'danger', busy: true,
  onCancel: () => {}, onConfirm: () => {},
}))
assert.ok(confirmBusyText.includes('处理中'), 'busy 态显示处理中')

// 回归护栏：DSH Desktop 的 dsh-app:// 渲染器里原生 confirm 不弹窗，
// 一旦有人再写回去，「删除」就会静默失效。
assert.ok(!/\bwindow\s*\.\s*confirm\b/.test(bundleText), 'client bundle 里不能再出现 window.confirm')
console.log('18 OK 自带确认弹窗 + 禁止 window.confirm 回归')

// 回归护栏 2：--dsw-alias-brand-primary 在本机主题下被定义成
// var(--dsw-alias-label-primary)（暗色主题的正文色 = 白色）。拿它当强调色，
// 主按钮就成了「白底白字」（文字完全看不见），开关打开态就是一颗白药丸。
// 强调色统一走 --sh-accent。
assert.ok(!/--dsw-alias-brand-primary/.test(bundleText), 'client bundle 里不能再拿 --dsw-alias-brand-primary 当强调色')
assert.ok(/--sh-accent/.test(bundleText), 'client bundle 必须定义 --sh-accent')
assert.ok(/#4d6bfe/.test(bundleText), '强调色必须有不透明兜底值，防止 token 失效时变透明/变白')
console.log('19 OK 强调色护栏（禁用品牌色 token / 必须有 --sh-accent + 兜底）')

// 回归护栏 3：浮层底色必须跟宿主菜单同一个 token（--dsw-specific-menu，退回
// --dsw-alias-bg-overlay），并且底下要垫一层不透明底色——否则半透明菜单会把
// 底下的正文透出来，浮层就没法读了。
assert.ok(/--sh-surface:var\(--dsw-specific-menu/.test(bundleText), '浮层底色必须跟随宿主菜单 token')
assert.ok(/\.sh-pick\{[^}]*background-color:var\(--dsw-alias-bg-base/.test(bundleText), '浮层必须有不透明底色托底')
assert.ok(!/background-color:#1b1b21/.test(bundleText), '不能再把浮层底色写死成固定色')
console.log('20 OK 浮层底色护栏（跟随宿主菜单 token + 不透明托底）')

console.log('\nALL PASS')
