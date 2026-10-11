'use strict'
// 宿主半区内部函数的离线冒烟测试：只跑纯函数，不碰 cordis 上下文。
const assert = require('node:assert')
const plugin = require('../src/index.js')
const {
  splitFrontmatter,
  parseFrontmatterLines,
  setFrontmatterKeys,
  joinSkillFile,
  yamlScalarLines,
  sanitizeStore,
  normalizeSkillMeta,
  invocationPolicy,
  findProjectRoot,
} = plugin.__internals

// ── 1. 解析带注释的真实 SKILL.md frontmatter ──
const raw = [
  '---',
  '# 只给用户看的注释',
  'name: animate',
  'description: Build an animation from scratch, making the decisions in order.',
  'whenToUse: 当用户要求加动画时',
  '---',
  '',
  '# Building Animations',
  '',
  'body line',
].join('\n')
const split = splitFrontmatter(raw)
assert.ok(split.hasBlock, 'should detect frontmatter block')
const meta = parseFrontmatterLines(split.head)
assert.strictEqual(meta.name, 'animate')
assert.ok(meta.description.startsWith('Build an animation'))
assert.strictEqual(meta.whenToUse, '当用户要求加动画时')
assert.deepStrictEqual(invocationPolicy(meta), { modelInvocable: true, userInvocable: true })
console.log('1 OK 解析 frontmatter')

// ── 2. 打开 disable-model-invocation，注释与其它键原位保留 ──
let head = setFrontmatterKeys(split.head, { 'disable-model-invocation': ['true'] })
let text = joinSkillFile(head, split.bodyLines, split.eol)
assert.ok(text.includes('name: animate'))
assert.ok(text.includes('# 只给用户看的注释'), 'comment preserved')
assert.ok(text.includes('disable-model-invocation: true'))
assert.strictEqual(parseFrontmatterLines(splitFrontmatter(text).head)['disable-model-invocation'], true)
assert.deepStrictEqual(invocationPolicy(parseFrontmatterLines(splitFrontmatter(text).head)), { modelInvocable: false, userInvocable: true })
console.log('2 OK 禁用模型调用')

// ── 3. 再打开一次：键被删掉，不留空行垃圾 ──
head = setFrontmatterKeys(splitFrontmatter(text).head, { 'disable-model-invocation': null })
text = joinSkillFile(head, splitFrontmatter(text).bodyLines, '\n')
assert.ok(!text.includes('disable-model-invocation'))
assert.ok(text.includes('name: animate'))
assert.ok(text.includes('# 只给用户看的注释'))
console.log('3 OK 恢复模型调用')

// ── 4. 替换 description（含逗号的长句）与 whenToUse ──
const newDesc = 'A brand new description, with commas (and parens).'
head = setFrontmatterKeys(splitFrontmatter(text).head, {
  description: yamlScalarLines(newDesc),
  whenToUse: yamlScalarLines('新的触发说明'),
})
text = joinSkillFile(head, splitFrontmatter(text).bodyLines, '\n')
const reparsed = parseFrontmatterLines(splitFrontmatter(text).head)
assert.strictEqual(reparsed.description, newDesc)
assert.strictEqual(reparsed.whenToUse, '新的触发说明')
assert.strictEqual(reparsed.name, 'animate')
// 值行不能出现两次
assert.strictEqual(text.split('description:').length - 1, 1, 'description key must appear once')
console.log('4 OK 替换 description / whenToUse')

// ── 5. 多行描述 → 块标量 ──
const multi = 'first line\nsecond line'
const blockLines = yamlScalarLines(multi)
assert.strictEqual(blockLines[0], '>-')
head = setFrontmatterKeys(splitFrontmatter(text).head, { description: blockLines })
text = joinSkillFile(head, splitFrontmatter(text).bodyLines, '\n')
assert.strictEqual(parseFrontmatterLines(splitFrontmatter(text).head).description, 'first line second line')
console.log('5 OK 多行描述折叠块标量')

// ── 6. 无 frontmatter 的文件不被动 ──
const plain = '# just markdown\n\nno frontmatter here\n'
assert.strictEqual(splitFrontmatter(plain).hasBlock, false)
console.log('6 OK 无 frontmatter')

// ── 7. 仓库清洗 ──
const store = sanitizeStore({
  skills: {
    animate: { alias: '  动画  ', note: '本地备注', categoryId: 'cat-1', tags: ['a', 'a', ''] },
    bad: 'nonsense',
    empty: {},
  },
  categories: [
    { id: 'cat-1', name: '前端', color: '#ff0000', order: 0 },
    { id: 'cat-1', name: '重复', order: 1 },
    { name: '', order: 2 },
  ],
})
assert.strictEqual(store.skills.animate.alias, '动画')
assert.deepStrictEqual(store.skills.animate.tags, ['a'])
assert.ok(store.skills.bad === undefined)
assert.strictEqual(store.categories.length, 1)
assert.deepStrictEqual(normalizeSkillMeta({ alias: '', note: '  ', tags: [] }), {})
console.log('7 OK 仓库清洗')

// ── 8. 项目根发现 ──
assert.strictEqual(typeof findProjectRoot(process.cwd()), 'string')
console.log('8 OK 项目根发现 ->', findProjectRoot(process.cwd()))

console.log('\nALL PASS')
