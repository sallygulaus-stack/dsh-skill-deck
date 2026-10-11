'use strict'
// 宿主半区端到端冒烟测试：真文件系统 + 假 cordis 上下文 + 假 req/res。
//
// 关键安全措施：先把 DSH_HOME / DSH_AGENTS_HOME 指到临时目录，再 require 插件，
// 因此所有写操作（启用切换 / 编辑 / 删除 / 回收站）都落在临时目录里，
// 绝不碰用户真实的 ~/.dsh/skills。
const assert = require('node:assert')
const vm = require('node:vm')
const { Readable } = require('node:stream')
const fs = require('node:fs')
const fsp = require('node:fs/promises')
const os = require('node:os')
const { join } = require('node:path')

const TMP = fs.mkdtempSync(join(os.tmpdir(), 'skill-deck-test-'))
process.env.DSH_HOME = join(TMP, 'dsh-home')
process.env.DSH_AGENTS_HOME = join(TMP, 'agents-home')

const plugin = require('../src/index.js')

// ── 假 req / res ────────────────────────────────────────────────────────────
function makeReq(method, url, body, headers) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body), 'utf8')])
  req.method = method
  req.url = url
  req.headers = Object.assign({ host: '127.0.0.1:19387' }, headers || {})
  req.socket = { remoteAddress: '127.0.0.1' }
  return req
}
function makeRes() {
  return {
    status: 0,
    headers: null,
    body: '',
    writableEnded: false,
    writeHead(status, headers) { this.status = status; this.headers = headers },
    end(chunk) { if (chunk !== undefined) this.body += chunk; this.writableEnded = true },
    json() { return this.body === '' ? null : JSON.parse(this.body) },
  }
}

/** 收集插件挂载出来的东西。 */
const state = { route: null, provider: null, providerName: null, rejection: undefined, logs: [] }
const logger = { info: (m) => state.logs.push(['info', m]), warn: (m) => state.logs.push(['warn', m]), error: (m) => state.logs.push(['error', m]) }
const fakeSkills = []
const ctx = {
  logger,
  effect(fn) { const dispose = fn(); return () => dispose() },
  get(name) {
    if (name !== 'connection') return undefined
    return { requestRejection: () => state.rejection }
  },
  webServer: { register(route) { state.route = route; return () => { state.route = null } } },
  skills: {
    registerProvider(factory) {
      const provider = factory({ signal: new AbortController().signal, invalidate: () => {} })
      state.provider = provider
      state.providerName = provider.name
      return () => { state.provider = null }
    },
    async list() { return fakeSkills },
  },
}

const skillsDir = join(TMP, 'dsh-home', 'skills')
fs.mkdirSync(join(skillsDir, 'existing-skill'), { recursive: true })
fs.writeFileSync(join(skillsDir, 'existing-skill', 'SKILL.md'), [
  '---',
  '# 顶部注释（必须原样保留）',
  'name: existing-skill',
  'description: An existing skill used by the host smoke test.',
  'whenToUse: 冒烟测试用',
  '---',
  '',
  '# Existing Skill',
  '',
  '原始正文第一行。',
].join('\n'), 'utf8')

plugin.apply(ctx, { dataDir: join(TMP, 'data'), trashRetentionDays: 30 })

assert.ok(state.route !== null, 'http route registered')
assert.strictEqual(state.route.kind, 'prefix')
assert.strictEqual(state.route.path, '/api/dsh-skill-deck')
assert.strictEqual(state.providerName, 'skill-deck-filesystem')

const CALL = async (method, path, body, headers) => {
  const res = makeRes()
  await state.route.handler(makeReq(method, path, body, headers), res)
  return res
}

;(async () => {
  const cwd = TMP

  // 1. 健康检查
  let res = await CALL('GET', '/api/dsh-skill-deck/health')
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.json().provider, 'skill-deck-filesystem')
  console.log('1 OK health')

  // 2. 信任栅栏：connection 拒绝时必须 403 且不落任何写
  state.rejection = { status: 403, headers: { 'content-type': 'text/plain' } }
  res = await CALL('GET', '/api/dsh-skill-deck/list')
  assert.strictEqual(res.status, 403)
  res = await CALL('POST', '/api/dsh-skill-deck/meta', { name: 'existing-skill', alias: 'x' })
  assert.strictEqual(res.status, 403, '写路由同样被拦')
  state.rejection = undefined
  console.log('2 OK 信任栅栏')

  // 3. 列表：能扫到 existing-skill
  res = await CALL('GET', '/api/dsh-skill-deck/list?cwd=' + encodeURIComponent(cwd))
  assert.strictEqual(res.status, 200)
  let payload = res.json()
  const row = payload.groups.flatMap((g) => g.skills).find((s) => s.name === 'existing-skill')
  assert.ok(row, '扫描到 existing-skill')
  assert.strictEqual(row.description, 'An existing skill used by the host smoke test.')
  assert.strictEqual(row.whenToUse, '冒烟测试用')
  assert.strictEqual(row.modelInvocable, true)
  assert.deepStrictEqual(row.local, { alias: '', note: '', categoryId: '', tags: [] })
  console.log('3 OK list 扫描')

  // 4. 本地标注：写别名/备注/标签，绝不碰 SKILL.md
  const beforeRaw = fs.readFileSync(join(skillsDir, 'existing-skill', 'SKILL.md'), 'utf8')
  res = await CALL('POST', '/api/dsh-skill-deck/meta', {
    name: 'existing-skill', alias: '现有技能', note: '给用户自己看的备注', tags: ['测试', '测试', '  '],
  })
  assert.strictEqual(res.status, 200)
  assert.strictEqual(res.json().local.alias, '现有技能')
  assert.strictEqual(fs.readFileSync(join(skillsDir, 'existing-skill', 'SKILL.md'), 'utf8'), beforeRaw, 'SKILL.md 必须一字未动')
  const metaRaw = fs.readFileSync(join(TMP, 'data', 'meta.json'), 'utf8')
  assert.ok(metaRaw.includes('现有技能'))
  console.log('4 OK 本地标注只写 meta.json，技能文件一字未动')

  // 5. 别名出现在列表 / picker，但 picker 仍带真实技能名
  res = await CALL('GET', '/api/dsh-skill-deck/list?cwd=' + encodeURIComponent(cwd))
  payload = res.json()
  const rowAliased = payload.groups.flatMap((g) => g.skills).find((s) => s.name === 'existing-skill')
  assert.strictEqual(rowAliased.local.alias, '现有技能')
  assert.ok(rowAliased.local.tags.includes('测试'))

  res = await CALL('GET', '/api/dsh-skill-deck/picker?cwd=' + encodeURIComponent(cwd))
  const pick = res.json().skills.find((s) => s.name === 'existing-skill')
  assert.strictEqual(pick.alias, '现有技能')
  assert.strictEqual(pick.name, 'existing-skill')
  console.log('5 OK 别名出现在列表与 picker，真名不变')

  // 6. 分类
  res = await CALL('POST', '/api/dsh-skill-deck/categories', { op: 'create', name: '测试分类', color: '#ff8800' })
  assert.strictEqual(res.status, 200)
  const categoryId = res.json().result.id
  assert.strictEqual(res.json().categories.length, 1)
  res = await CALL('POST', '/api/dsh-skill-deck/categories', { op: 'create', name: '测试分类' })
  assert.strictEqual(res.status, 400, '同名分类要拒绝')
  res = await CALL('POST', '/api/dsh-skill-deck/meta', { name: 'existing-skill', alias: '现有技能', categoryId })
  assert.strictEqual(res.status, 200)
  res = await CALL('GET', '/api/dsh-skill-deck/list?cwd=' + encodeURIComponent(cwd))
  assert.strictEqual(res.json().groups.flatMap((g) => g.skills).find((s) => s.name === 'existing-skill').local.categoryId, categoryId)
  console.log('6 OK 分类增删改')

  // 7. 启用 / 禁用：改写 frontmatter，注释与其它键原位保留
  res = await CALL('POST', '/api/dsh-skill-deck/set-enabled', { name: 'existing-skill', path: row.path, enabled: false, cwd })
  assert.strictEqual(res.status, 200)
  let raw = fs.readFileSync(join(skillsDir, 'existing-skill', 'SKILL.md'), 'utf8')
  assert.ok(raw.includes('disable-model-invocation: true'))
  assert.ok(raw.includes('# 顶部注释（必须原样保留）'), '注释保留')
  assert.ok(raw.includes('description: An existing skill'), '描述未动')
  assert.ok(raw.includes('原始正文第一行。'), '正文未动')

  res = await CALL('GET', '/api/dsh-skill-deck/list?cwd=' + encodeURIComponent(cwd))
  assert.strictEqual(res.json().groups.flatMap((g) => g.skills).find((s) => s.name === 'existing-skill').modelInvocable, false)

  res = await CALL('POST', '/api/dsh-skill-deck/set-enabled', { name: 'existing-skill', path: row.path, enabled: true, cwd })
  assert.strictEqual(res.status, 200)
  raw = fs.readFileSync(join(skillsDir, 'existing-skill', 'SKILL.md'), 'utf8')
  assert.ok(!raw.includes('disable-model-invocation'))
  assert.ok(raw.includes('# 顶部注释（必须原样保留）'))
  console.log('7 OK 启用/禁用外科式改写')

  // 8. 读 + 编辑
  res = await CALL('GET', '/api/dsh-skill-deck/read?name=existing-skill&path=' + encodeURIComponent(row.path))
  assert.strictEqual(res.status, 200)
  assert.ok(res.json().content.includes('原始正文第一行。'))

  res = await CALL('POST', '/api/dsh-skill-deck/update', {
    name: 'existing-skill', path: row.path, cwd,
    description: '改写后的描述, 带逗号和括号 (ok)。',
    whenToUse: '改写后的场景',
    content: '# 新正文\n\n第二行。',
  })
  assert.strictEqual(res.status, 200)
  raw = fs.readFileSync(join(skillsDir, 'existing-skill', 'SKILL.md'), 'utf8')
  assert.ok(raw.includes('description: 改写后的描述, 带逗号和括号 (ok)。'), '描述已替换')
  assert.ok(!raw.includes('An existing skill used'), '旧描述不再出现')
  assert.strictEqual(raw.split('description:').length - 1, 1, 'description 只出现一次')
  assert.ok(raw.includes('whenToUse: 改写后的场景'))
  assert.ok(raw.includes('# 新正文'))
  assert.ok(raw.includes('# 顶部注释（必须原样保留）'), '注释仍然保留')

  // 陈旧路径必须被拒
  res = await CALL('POST', '/api/dsh-skill-deck/update', {
    name: 'existing-skill', path: '/nope/SKILL.md', cwd, description: 'x', content: 'y',
  })
  assert.strictEqual(res.status, 409)
  console.log('8 OK 读取 / 编辑 / 陈旧路径拒绝')

  // 9. 创建
  res = await CALL('POST', '/api/dsh-skill-deck/create', {
    root: 'user', cwd, name: 'demo-skill',
    description: 'A demo skill created by the smoke test.',
    whenToUse: '演示用',
    content: '# Demo\n\n正文',
    alias: '演示技能', categoryId,
  })
  assert.strictEqual(res.status, 200, res.body)
  const createdRaw = fs.readFileSync(join(skillsDir, 'demo-skill', 'SKILL.md'), 'utf8')
  assert.ok(createdRaw.startsWith('---\nname: demo-skill'))
  assert.ok(createdRaw.includes('description: A demo skill created by the smoke test.'))
  assert.ok(createdRaw.includes('whenToUse: 演示用'))
  assert.ok(createdRaw.includes('# Demo'))
  res = await CALL('GET', '/api/dsh-skill-deck/list?cwd=' + encodeURIComponent(cwd))
  const demo = res.json().groups.flatMap((g) => g.skills).find((s) => s.name === 'demo-skill')
  assert.strictEqual(demo.local.alias, '演示技能')
  assert.strictEqual(demo.local.categoryId, categoryId)
  // 非法名
  res = await CALL('POST', '/api/dsh-skill-deck/create', { root: 'user', cwd, name: 'Bad Name', description: 'x' })
  assert.strictEqual(res.status, 400)
  console.log('9 OK 创建技能')

  // 10. 删除 → 回收站 → 还原
  res = await CALL('POST', '/api/dsh-skill-deck/delete', { name: 'demo-skill', path: demo.path, cwd })
  assert.strictEqual(res.status, 200)
  const trashId = res.json().trashId
  assert.ok(!fs.existsSync(join(skillsDir, 'demo-skill')), '原目录已移走')
  res = await CALL('GET', '/api/dsh-skill-deck/trash')
  assert.strictEqual(res.status, 200)
  const trashEntry = res.json().entries.find((e) => e.id === trashId)
  assert.ok(trashEntry && trashEntry.name === 'demo-skill')
  assert.ok(trashEntry.originalPath.includes('demo-skill'))

  res = await CALL('POST', '/api/dsh-skill-deck/trash/restore', { id: trashId })
  assert.strictEqual(res.status, 200)
  assert.ok(fs.existsSync(join(skillsDir, 'demo-skill', 'SKILL.md')), '已还原到原位')
  res = await CALL('GET', '/api/dsh-skill-deck/trash')
  assert.strictEqual(res.json().entries.length, 0)
  console.log('10 OK 删除 / 回收站 / 还原')

  // 11. 删除 → 彻底删除
  res = await CALL('GET', '/api/dsh-skill-deck/list?cwd=' + encodeURIComponent(cwd))
  const demo2 = res.json().groups.flatMap((g) => g.skills).find((s) => s.name === 'demo-skill')
  res = await CALL('POST', '/api/dsh-skill-deck/delete', { name: 'demo-skill', path: demo2.path, cwd })
  const trashId2 = res.json().trashId
  res = await CALL('POST', '/api/dsh-skill-deck/trash/purge', { id: trashId2 })
  assert.strictEqual(res.status, 200)
  res = await CALL('GET', '/api/dsh-skill-deck/trash')
  assert.strictEqual(res.json().entries.length, 0)
  console.log('11 OK 回收站彻底删除')

  // 12. provider 契约：候选合法、get 拿得到正文；空描述/非法名被滤掉
  fs.mkdirSync(join(skillsDir, 'bad name'), { recursive: true })
  fs.writeFileSync(join(skillsDir, 'bad name', 'SKILL.md'), '---\nname: bad name\ndescription: x\n---\n\nbody\n', 'utf8')
  fs.mkdirSync(join(skillsDir, 'no-desc'), { recursive: true })
  fs.writeFileSync(join(skillsDir, 'no-desc', 'SKILL.md'), '---\nname: no-desc\ndescription: ""\n---\n\nbody\n', 'utf8')

  const candidates = await state.provider.list({ cwd })
  const names = candidates.map((c) => c.name)
  assert.ok(names.includes('existing-skill'))
  assert.ok(!names.includes('bad name'), '非法名被滤掉')
  assert.ok(!names.includes('no-desc'), '空描述被滤掉')
  const candidate = candidates.find((c) => c.name === 'existing-skill')
  assert.strictEqual(candidate.source, 'user-dsh')
  assert.strictEqual(candidate.provider, 'skill-deck-filesystem')
  assert.strictEqual(candidate.invocation.modelInvocable, true)
  assert.ok(candidate.path.endsWith('SKILL.md'))
  const definition = await state.provider.get(candidate)
  assert.strictEqual(definition.name, 'existing-skill')
  assert.ok(definition.content.includes('# 新正文'))
  assert.strictEqual(definition.resourceBase.kind, 'directory')
  console.log('12 OK provider 契约（list 过滤 + get 全文）')

  // 13. 目录下的别名不进 provider —— 模型的技能目录里绝不能出现中文别名
  const aliasLeak = JSON.stringify(candidates)
  assert.ok(!aliasLeak.includes('现有技能'), 'provider 候选里不能出现本地别名')
  console.log('13 OK 本地别名不进模型可见的候选')

  // 14. 404
  res = await CALL('GET', '/api/dsh-skill-deck/nope')
  assert.strictEqual(res.status, 404)
  console.log('14 OK 未知路由 404')

  // 15. 本地标注的数据安全（真实踩过的坑）
  //     (a) 清空字段 + 保存 = 清掉标注（用户把字段清空的自然预期），
  //         但它只写一条空记录，绝不删除条目本身
  //     (b) 删除技能时不能顺手删标注——回收站是可还原的，标注必须跟着回来；
  //         只有「彻底删除」才丢弃标注
  const listRow = async () => {
    const payload = (await CALL('GET', '/api/dsh-skill-deck/list?cwd=' + encodeURIComponent(cwd))).json()
    return payload.groups.flatMap((g) => g.skills).find((s) => s.name === 'existing-skill')
  }
  res = await CALL('POST', '/api/dsh-skill-deck/meta', { name: 'existing-skill', alias: '别名保命测试', note: 'x' })
  assert.strictEqual(res.status, 200)
  assert.strictEqual((await listRow()).local.alias, '别名保命测试')
  res = await CALL('POST', '/api/dsh-skill-deck/meta', { name: 'existing-skill', alias: '', note: '', categoryId: '', tags: [] })
  assert.strictEqual(res.status, 200)
  assert.strictEqual((await listRow()).local.alias, '', '(a) 清空字段保存后标注为空')
  res = await CALL('POST', '/api/dsh-skill-deck/meta', { name: 'existing-skill', alias: '别名保命测试', note: 'x' })
  assert.strictEqual((await listRow()).local.alias, '别名保命测试')

  const delPath = (await listRow()).path
  res = await CALL('POST', '/api/dsh-skill-deck/delete', { name: 'existing-skill', path: delPath, cwd })
  assert.strictEqual(res.status, 200)
  const tid = res.json().trashId
  const trashRow = (await CALL('GET', '/api/dsh-skill-deck/trash')).json().entries.find((e) => e.id === tid)
  assert.ok(trashRow, '回收站里能看到刚删的技能')
  assert.strictEqual(trashRow.alias, '别名保命测试', '回收站列表带别名，便于辨认')
  res = await CALL('POST', '/api/dsh-skill-deck/trash/restore', { id: tid })
  assert.strictEqual(res.status, 200)
  assert.strictEqual((await listRow()).local.alias, '别名保命测试', '(b) 还原后别名必须还在')

  res = await CALL('POST', '/api/dsh-skill-deck/delete', { name: 'existing-skill', path: (await listRow()).path, cwd })
  const tid2 = res.json().trashId
  res = await CALL('POST', '/api/dsh-skill-deck/trash/purge', { id: tid2 })
  assert.strictEqual(res.status, 200)
  const storeOnDisk = JSON.parse(fs.readFileSync(join(TMP, 'data', 'meta.json'), 'utf8'))
  assert.ok(storeOnDisk.skills['existing-skill'] === undefined, '彻底删除才丢弃标注')
  // 备份文件应当存在（每次写入前留上一代）
  assert.ok(fs.existsSync(join(TMP, 'data', 'meta.json.bak')), '写入前留有 meta.json.bak')
  console.log('15 OK 清空字段=清标注 / 标注扛住删除→还原 / 彻底删除才丢弃 / 有备份')

  // 清理
  fs.rmSync(TMP, { recursive: true, force: true })
  console.log('\nALL PASS')
})().catch((error) => {
  console.error('\nFAILED:', error && error.stack ? error.stack : error)
  try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {}
  process.exit(1)
})
