'use strict'
/**
 * dsh-skill-deck — 宿主半区。
 *
 * 三件事，彼此独立：
 *
 * 1. **技能 provider**：在 `ctx.skills` 上注册一个按官方 dsh-skill-filesystem 根约定
 *    扫描文件系统的 provider，让模型侧的技能目录继续可用（本 profile 里官方
 *    filesystem provider 与 @weibaohui/skills-management 都被禁用，这个 provider
 *    就是它们的替代者）。
 *
 * 2. **本地元数据仓库**：`<DSH_HOME>/skill-deck/meta.json` 保存「中文别名 / 自定义描述 /
 *    分类 / 标签」。这份数据**只被本插件的 UI 读取**——不写进 SKILL.md，不注册进
 *    skills 注册表，因此模型永远看不到它。技能的英文真名与真实 description 不受影响。
 *
 * 3. **HTTP 路由族** `/api/dsh-skill-deck/*`：面板与快捷发送浮层的数据面。
 *    与其他 host 路由一样走 `ctx.connection.requestRejection` 的信任栅栏。
 *
 * 零运行时依赖：frontmatter 用自带的轻量解析 + 外科式改写（只动自己那几个键，
 * 其余字节原样保留），避免引入 yaml 依赖导致的安装失败。
 */

const { homedir } = require('node:os')
const { basename, dirname, join, relative, resolve, sep } = require('node:path')
const { existsSync } = require('node:fs')
const fsp = require('node:fs/promises')

/** 稳定 cordis 插件名。 */
const PLUGIN_NAME = 'dsh-skill-deck'
/** 注册进 ctx.skills 的 provider 名。 */
const PROVIDER_NAME = 'skill-deck-filesystem'
/** 路由族前缀。 */
const API_PREFIX = '/api/dsh-skill-deck'
/** 技能名（kebab-case）——与官方 tools/skills 校验一致。 */
const KEBAB_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
/** 扫描时跳过的目录名。 */
const SCAN_SKIP = new Set(['.git', 'node_modules', '.trash', '.hub-trash'])
/** 单个 SKILL.md 的写入上限（与旧「技能中心」插件相同）。 */
const MAX_CONTENT_BYTES = 64 * 1024

// ── 小工具 ────────────────────────────────────────────────────────────────

/** `~` / `~/x` 展开为家目录。 */
function expandTilde(input) {
  const text = String(input === undefined || input === null ? '' : input)
  if (text === '~') return homedir()
  if (text.startsWith('~/') || text.startsWith('~\\')) return join(homedir(), text.slice(2))
  return text
}

/** DSH 配置根：$DSH_HOME 优先，否则 ~/.dsh。 */
function dshHomeDir() {
  const env = process.env.DSH_HOME
  if (typeof env === 'string' && env.trim() !== '') return resolve(expandTilde(env))
  return join(homedir(), '.dsh')
}

/** agents 共享池根：$DSH_AGENTS_HOME 优先，否则 ~/.agents。 */
function agentsHomeDir() {
  const env = process.env.DSH_AGENTS_HOME
  if (typeof env === 'string' && env.trim() !== '') return resolve(expandTilde(env))
  return join(homedir(), '.agents')
}

/** 把 $HOME 前缀折成 `~`，避免界面泄露用户名。 */
function displayPath(p) {
  const home = homedir()
  const text = String(p)
  if (text === home) return '~'
  if (text.startsWith(home + sep)) return '~' + text.slice(home.length)
  return text
}

/** 从 cwd 向上找最近的含 .git 的祖先（项目根约定）；找不到就返回 cwd 本身。 */
function findProjectRoot(cwd) {
  let current
  try {
    current = resolve(cwd)
  } catch {
    return undefined
  }
  let guard = 0
  for (;;) {
    if (guard++ > 64) return current
    if (existsSync(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return current
    current = parent
  }
}

/** JSON 响应。 */
function sendJson(res, status, payload) {
  if (res.writableEnded) return
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  })
  res.end(body)
}

/** 读请求体并解析 JSON（失败/超限一律给空对象，调用方自己校验字段）。 */
function readJsonBody(req) {
  return new Promise((resolveBody) => {
    let data = ''
    let done = false
    const finish = (value) => {
      if (done) return
      done = true
      resolveBody(value)
    }
    req.on('data', (chunk) => {
      data += chunk
      if (data.length > 1024 * 1024) {
        try { req.destroy() } catch {}
        finish({})
      }
    })
    req.on('end', () => {
      if (data === '') return finish({})
      try {
        const parsed = JSON.parse(data)
        finish(parsed !== null && typeof parsed === 'object' ? parsed : {})
      } catch {
        finish({})
      }
    })
    req.on('error', () => finish({}))
  })
}

/** 原子写文本：先写临时文件再 rename。 */
async function writeFileAtomic(target, content) {
  await fsp.mkdir(dirname(target), { recursive: true })
  const tmp = target + '.hub-' + process.pid + '-' + Date.now() + '.tmp'
  await fsp.writeFile(tmp, content, 'utf8')
  await fsp.rename(tmp, target)
}

// ── frontmatter：轻量解析 + 外科式改写 ─────────────────────────────────────

/**
 * 拆出 frontmatter 块与正文。
 * `head` 为 null 表示没有 frontmatter（此时 headLines 为空、body 为全文）。
 */
function splitFrontmatter(raw) {
  const text = String(raw).replace(/^\uFEFF/, '')
  const lines = text.split(/\r?\n/)
  if (lines.length === 0 || lines[0].trim() !== '---') {
    return { hasBlock: false, head: [], bodyLines: lines, eol: /\r\n/.test(text) ? '\r\n' : '\n' }
  }
  let close = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i].trim() === '---') { close = i; break }
  }
  if (close < 0) {
    return { hasBlock: false, head: [], bodyLines: lines, eol: /\r\n/.test(text) ? '\r\n' : '\n' }
  }
  return {
    hasBlock: true,
    head: lines.slice(1, close),
    bodyLines: lines.slice(close + 1),
    eol: /\r\n/.test(text) ? '\r\n' : '\n',
  }
}

/** 去掉 YAML 引号并识别布尔。 */
function scalarValue(rawValue) {
  const text = String(rawValue).trim()
  if (text.length >= 2) {
    const first = text[0]
    if (first === '"' && text.endsWith('"')) {
      try { return JSON.parse(text) } catch { return text.slice(1, -1) }
    }
    if (first === "'" && text.endsWith("'")) return text.slice(1, -1).replace(/''/g, "'")
  }
  const lower = text.toLowerCase()
  if (lower === 'true' || lower === 'yes' || lower === 'on') return true
  if (lower === 'false' || lower === 'no' || lower === 'off') return false
  return text
}

/**
 * 解析 frontmatter 行 → 扁平键值表。
 * 支持：普通标量、单双引号、块标量（`|` / `>` 及其 `-` 修饰）、以及被忽略的嵌套块
 * （如 `input:`）——嵌套块只标记存在，不展开。
 */
function parseFrontmatterLines(headLines) {
  const meta = {}
  let i = 0
  while (i < headLines.length) {
    const line = headLines[i]
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line)
    if (!match) { i += 1; continue }
    const key = match[1]
    const rest = match[2]
    const block = /^([|>])([+-]?)\s*$/.exec(rest.trim())
    if (block) {
      const folded = block[1] === '>'
      const chunk = []
      i += 1
      let indent = null
      while (i < headLines.length) {
        const inner = headLines[i]
        if (inner.trim() === '') { chunk.push(''); i += 1; continue }
        const lead = inner.length - inner.trimStart().length
        if (lead === 0) break
        if (indent === null) indent = lead
        chunk.push(inner.slice(Math.min(indent, lead)))
        i += 1
      }
      while (chunk.length > 0 && chunk[chunk.length - 1] === '') chunk.pop()
      meta[key] = folded ? chunk.join(' ').trim() : chunk.join('\n').trim()
      continue
    }
    if (rest.trim() === '') {
      // 嵌套块或空值：吞掉后续缩进行，仅标记存在。
      let nested = false
      i += 1
      while (i < headLines.length && (/^\s/.test(headLines[i]) || headLines[i].trim() === '')) {
        if (headLines[i].trim() !== '') nested = true
        i += 1
      }
      meta[key] = nested ? true : ''
      continue
    }
    meta[key] = scalarValue(rest)
    i += 1
  }
  return meta
}

/** 定位某个顶层键在 headLines 中占据的行区间（含块标量/嵌套块的续行）。 */
function findKeyExtent(lines, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp('^' + escaped + '\\s*:')
  for (let i = 0; i < lines.length; i += 1) {
    if (!re.test(lines[i])) continue
    const rest = lines[i].slice(lines[i].indexOf(':') + 1)
    const isBlock = /^[|>][+-]?\s*$/.test(rest.trim())
    const isNested = rest.trim() === ''
    let end = i + 1
    if (isBlock || isNested) {
      while (end < lines.length) {
        const line = lines[end]
        if (line.trim() === '') { end += 1; continue }
        if (/^\s/.test(line)) { end += 1; continue }
        break
      }
      while (end - 1 > i && lines[end - 1].trim() === '') end -= 1
    }
    return { start: i, end }
  }
  return null
}

/**
 * 把一个字符串渲染成 YAML **值行**（不含 `key:` 前缀）。
 * 多行 → 折叠块标量 `>-` + 缩进行；单行 → 裸标量，只有明文不安全时才退到双引号。
 * 裸标量的禁项：以指示符开头、含 `: ` / ` #` / 控制字符、看起来像布尔或数字。
 */
function yamlScalarLines(text) {
  const value = String(text)
  if (value.includes('\n')) {
    const body = value.replace(/\r\n/g, '\n').split('\n').map((line) => '  ' + line)
    return ['>-', ...body]
  }
  const startsWithIndicator = /^[-?:,[\]{}#&*!|>'"%@`]/.test(value)
  const unsafe =
    value.trim() !== value ||
    startsWithIndicator ||
    /:\s/.test(value) ||
    /:$/.test(value) ||
    /\s#/.test(value) ||
    /[\u0000-\u001f\u007f]/.test(value) ||
    /^(true|false|yes|no|on|off|null|~)$/i.test(value) ||
    /^[-+]?\d+(\.\d+)?$/.test(value)
  if (!unsafe) return [value]
  return [JSON.stringify(value)]
}

/**
 * 外科式改写 frontmatter 的若干顶层键，其余行（含注释、`input:` 嵌套块）原样保留。
 *
 * `updates[key]` 传的是**值行**，不是整行：
 *   - `undefined` → 不动；
 *   - `null` → 删除该键；
 *   - 数组 → 用 `${key}: <首行>` + 其余行替换它原来的整个区间（块标量的续行一起换掉）。
 * 键不存在时插到 `name:` 之后，没有 `name:` 就追加到末尾。
 */
function setFrontmatterKeys(headLines, updates) {
  const lines = headLines.slice()
  for (const key of Object.keys(updates)) {
    const value = updates[key]
    if (value === undefined) continue
    const replacement = value === null
      ? []
      : value.length === 0
        ? [`${key}:`]
        : [`${key}: ${value[0]}`, ...value.slice(1)]
    const extent = findKeyExtent(lines, key)
    if (extent !== null) {
      lines.splice(extent.start, extent.end - extent.start, ...replacement)
      continue
    }
    if (value === null) continue
    const nameExtent = findKeyExtent(lines, 'name')
    const at = nameExtent !== null ? nameExtent.end : lines.length
    lines.splice(at, 0, ...replacement)
  }
  return lines
}

/** 把 headLines + bodyLines 拼回完整文件文本。 */
function joinSkillFile(headLines, bodyLines, eol) {
  const lines = ['---', ...headLines, '---', ...bodyLines]
  return lines.join(eol || '\n')
}

/** 从 frontmatter 推导调用策略（与官方语义一致）。 */
function invocationPolicy(meta) {
  return {
    modelInvocable: meta['disable-model-invocation'] !== true,
    userInvocable: meta['user-invocable'] !== false,
  }
}

/** 从 frontmatter 取 whenToUse（兼容两种写法）。 */
function whenToUseOf(meta) {
  const value = meta.whenToUse !== undefined ? meta.whenToUse : meta.when_to_use
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

// ── 目录扫描 ──────────────────────────────────────────────────────────────

/** 递归找含 SKILL.md 的技能目录；跟随符号链接，`visited` 防环。 */
async function scanSkillDirs(root, current, out, visited) {
  let entries
  try {
    entries = await fsp.readdir(current, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SCAN_SKIP.has(entry.name)) continue
    const dir = join(current, entry.name)
    let lst
    try { lst = await fsp.lstat(dir) } catch { continue }
    const linked = lst.isSymbolicLink()
    let dirStat = lst
    if (linked) {
      try { dirStat = await fsp.stat(dir) } catch { continue }
    }
    if (!dirStat.isDirectory()) continue
    let real
    try { real = await fsp.realpath(dir) } catch { continue }
    if (visited.has(real)) continue
    visited.add(real)
    let skillStat
    let hasSkillMd = false
    try {
      skillStat = await fsp.stat(join(dir, 'SKILL.md'))
      hasSkillMd = skillStat.isFile()
    } catch { hasSkillMd = false }
    if (hasSkillMd) {
      out.push({ root, dir, real, relPath: relative(root, dir).split(sep).join('/'), linked, stat: skillStat })
    } else {
      await scanSkillDirs(root, dir, out, visited)
    }
  }
}

/** 扫一个技能根目录，返回条目数组（根不存在 → 空数组）。 */
async function scanRoot(root) {
  const out = []
  if (typeof root !== 'string' || root.trim() === '') return out
  try { await fsp.access(root) } catch { return out }
  let real
  try { real = await fsp.realpath(root) } catch { return out }
  await scanSkillDirs(root, root, out, new Set([real]))
  return out
}

/** 读一个技能目录的 SKILL.md，产出展示/编辑所需的完整行。 */
async function readSkillEntry(entry) {
  const skillPath = join(entry.dir, 'SKILL.md')
  const raw = await fsp.readFile(skillPath, 'utf8')
  const { hasBlock, head, bodyLines, eol } = splitFrontmatter(raw)
  const meta = hasBlock ? parseFrontmatterLines(head) : {}
  const invocation = invocationPolicy(meta)
  const description = typeof meta.description === 'string' ? meta.description.trim() : ''
  const name = typeof meta.name === 'string' && meta.name.trim() !== '' ? meta.name.trim() : basename(entry.dir)
  return {
    name,
    description,
    whenToUse: whenToUseOf(meta),
    invocation,
    path: skillPath,
    dir: entry.dir,
    root: entry.root,
    relPath: entry.relPath,
    linked: entry.linked === true,
    hasFrontmatter: hasBlock,
    raw,
    body: bodyLines.join('\n').replace(/^\r?\n/, ''),
    meta,
  }
}

// ── 本地元数据仓库（别名 / 描述 / 分类 / 标签）─────────────────────────────
//
// 这一份数据是插件的私有状态：只被 UI 读，不参与任何模型可见的输出。
// 技能的英文真名与真实 description 完全不受影响。

/** 空仓库的初始形状。 */
function emptyStore() {
  return { version: 1, skills: {}, categories: [] }
}

/** 规范化单个技能的本地元数据条目。 */
function normalizeSkillMeta(input) {
  const alias = typeof input.alias === 'string' ? input.alias.trim() : ''
  const note = typeof input.note === 'string' ? input.note : ''
  const categoryId = typeof input.categoryId === 'string' && input.categoryId !== '' ? input.categoryId : ''
  const tags = Array.isArray(input.tags)
    ? [...new Set(input.tags.map((t) => String(t).trim()).filter((t) => t !== ''))].slice(0, 24)
    : []
  const out = {}
  if (alias !== '') out.alias = alias
  if (note.trim() !== '') out.note = note
  if (categoryId !== '') out.categoryId = categoryId
  if (tags.length > 0) out.tags = tags
  return out
}

/** 规范化一条分类。 */
function normalizeCategory(input, fallbackOrder) {
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name === '') return null
  return {
    id: typeof input.id === 'string' && input.id !== '' ? input.id : 'cat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7),
    name: name.slice(0, 40),
    color: typeof input.color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(input.color) ? input.color : '',
    order: Number.isFinite(input.order) ? Number(input.order) : fallbackOrder,
  }
}

/** 把任意读到的 JSON 收敛成合法仓库形状（容忍手改坏文件）。 */
function sanitizeStore(value) {
  const store = emptyStore()
  if (value === null || typeof value !== 'object') return store
  if (value.skills !== null && typeof value.skills === 'object') {
    for (const [name, entry] of Object.entries(value.skills)) {
      if (entry === null || typeof entry !== 'object') continue
      const normalized = normalizeSkillMeta(entry)
      if (Object.keys(normalized).length > 0) store.skills[name] = normalized
    }
  }
  if (Array.isArray(value.categories)) {
    const seen = new Set()
    let order = 0
    for (const raw of value.categories) {
      const category = normalizeCategory(raw, order)
      if (category === null || seen.has(category.id)) continue
      seen.add(category.id)
      store.categories.push(category)
      order += 1
    }
  }
  return store
}

/**
 * 仓库句柄：一个缓存 + 串行化的原子写，避免并发写互相覆盖。
 *
 * 数据安全上有两条硬约束（都是被真实踩过之后加的）：
 *  1. 「文件在、但读不出来」绝不能当成「空仓库」然后就写回去——那会把用户所有
 *     别名/分类静默清空。这种情况下 `mutate` 直接拒绝写入并报错，同时把原始内容
 *     另存一份 `.corrupt-<时间>` 供人工抢救。
 *  2. 每次写入前把上一代内容备份到 `meta.json.bak`，误操作还有一次回滚机会。
 */
function createStore(dataDir) {
  const metaFile = join(dataDir, 'meta.json')
  const backupFile = metaFile + '.bak'
  let cache = null
  let unreadable = null
  let chain = Promise.resolve()
  const load = async () => {
    if (cache !== null) return cache
    let raw
    try {
      raw = await fsp.readFile(metaFile, 'utf8')
    } catch (error) {
      // 只有「文件不存在」才是正常的首次运行（空仓库）。
      const code = error !== null && typeof error === 'object' ? error.code : undefined
      if (code !== 'ENOENT') unreadable = error
      cache = emptyStore()
      return cache
    }
    try {
      cache = sanitizeStore(JSON.parse(raw))
    } catch (error) {
      unreadable = error
      try { await fsp.writeFile(metaFile + '.corrupt-' + Date.now(), raw, 'utf8') } catch { /* 抢救副本失败也继续 */ }
      cache = emptyStore()
    }
    return cache
  }
  const read = () => load()
  const mutate = (fn) => {
    const task = chain.then(async () => {
      const store = await load()
      if (unreadable !== null) {
        throw new Error(
          '本地元数据读不出来，已拒绝写入以免覆盖你的标注（' + displayPath(metaFile) + '）：'
          + (unreadable && unreadable.message ? unreadable.message : String(unreadable)),
        )
      }
      const value = fn(store)
      try { await fsp.copyFile(metaFile, backupFile) } catch { /* 首次运行没有上一代 */ }
      await writeFileAtomic(metaFile, JSON.stringify(store, null, 2) + '\n')
      return value
    })
    chain = task.then(() => undefined, () => undefined)
    return task
  }
  return { read, mutate, file: metaFile, backup: backupFile }
}

// ── 回收站 ────────────────────────────────────────────────────────────────

/** 递归复制目录（跨卷 rename 失败时的回退路径）。 */
async function copyDir(src, dest) {
  await fsp.mkdir(dest, { recursive: true })
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const entry of entries) {
    const from = join(src, entry.name)
    const to = join(dest, entry.name)
    if (entry.isDirectory()) {
      await copyDir(from, to)
    } else if (entry.isSymbolicLink()) {
      const target = await fsp.readlink(from)
      try { await fsp.symlink(target, to) } catch { /* 链接复制失败不致命 */ }
    } else {
      await fsp.copyFile(from, to)
    }
  }
}

/** rename，失败则复制 + 删源。 */
async function movePath(src, dest) {
  await fsp.mkdir(dirname(dest), { recursive: true })
  try {
    await fsp.rename(src, dest)
    return
  } catch (error) {
    if (error === null || typeof error !== 'object' || error.code !== 'EXDEV') throw error
  }
  await copyDir(src, dest)
  await fsp.rm(src, { recursive: true, force: true })
}

/** 回收站句柄。 */
function createTrash(trashRoot, retentionDays) {
  /** 按 id 读一条回收站条目（无 manifest 时从目录名还原）。 */
  const readEntry = async (id) => {
    if (typeof id !== 'string' || id === '' || id.includes('/') || id.includes('\\') || id.includes('..')) return null
    const dir = join(trashRoot, id)
    let manifest = null
    try {
      manifest = JSON.parse(await fsp.readFile(join(dir, 'manifest.json'), 'utf8'))
    } catch { manifest = null }
    let payloadStat = null
    try { payloadStat = await fsp.stat(join(dir, 'skill')) } catch { payloadStat = null }
    if (manifest === null && payloadStat === null) return null
    const fallbackName = id.includes('__') ? id.slice(id.indexOf('__') + 2) : id
    return {
      id,
      name: manifest !== null && typeof manifest.name === 'string' ? manifest.name : fallbackName,
      originalPath: manifest !== null && typeof manifest.originalPath === 'string' ? manifest.originalPath : '',
      deletedAt: manifest !== null && typeof manifest.deletedAt === 'string' ? manifest.deletedAt : '',
      linked: manifest !== null && manifest.linked === true,
      bytes: manifest !== null && Number.isFinite(manifest.bytes) ? manifest.bytes : 0,
    }
  }
  const list = async () => {
    let entries = []
    try {
      entries = await fsp.readdir(trashRoot, { withFileTypes: true })
    } catch {
      return []
    }
    const out = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const row = await readEntry(entry.name)
      if (row !== null) out.push(row)
    }
    out.sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)))
    return out
  }
  const moveIn = async (target, name, linked) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    let id = stamp + '__' + name
    let suffix = 0
    while (existsSync(join(trashRoot, id))) { suffix += 1; id = stamp + '-' + suffix + '__' + name }
    const dir = join(trashRoot, id)
    await fsp.mkdir(dir, { recursive: true })
    await movePath(target, join(dir, 'skill'))
    await writeFileAtomic(
      join(dir, 'manifest.json'),
      JSON.stringify({ id, name, originalPath: target, deletedAt: new Date().toISOString(), linked: linked === true }, null, 2) + '\n',
    )
    return id
  }
  const restore = async (id) => {
    const row = await readEntry(id)
    if (row === null) throw new Error('回收站条目不存在：' + id)
    if (row.originalPath === '') throw new Error('回收站条目缺少原始路径，无法还原')
    if (existsSync(row.originalPath)) throw new Error('原位置已被占用：' + displayPath(row.originalPath))
    await movePath(join(trashRoot, id, 'skill'), row.originalPath)
    await fsp.rm(join(trashRoot, id), { recursive: true, force: true })
    return row.originalPath
  }
  const purgeOne = async (id) => {
    const dir = join(trashRoot, id)
    if (!existsSync(dir)) throw new Error('回收站条目不存在：' + id)
    await fsp.rm(dir, { recursive: true, force: true })
    return true
  }
  /** 清理超过保留期的条目；retentionDays <= 0 视为关闭（不清）。 */
  const purgeExpired = async () => {
    if (!Number.isFinite(retentionDays) || retentionDays <= 0) return []
    const cutoff = Date.now() - retentionDays * 86400000
    const removed = []
    for (const row of await list()) {
      const at = row.deletedAt !== '' ? Date.parse(row.deletedAt) : NaN
      if (!Number.isFinite(at) || at >= cutoff) continue
      try {
        await purgeOne(row.id)
        removed.push(row.id)
      } catch { /* 清不掉的留着，下次再说 */ }
    }
    return removed
  }
  return { list, moveIn, restore, purgeOne, purgeExpired, root: trashRoot }
}

// ── 技能收集（文件系统扫描 ⊕ 注册表）─────────────────────────────────────

/** 各来源在界面上的标题与说明。 */
const SOURCE_META = {
  'user-dsh': { title: '用户技能库', hint: '~/.dsh/skills · 模型可直接调用', order: 20 },
  'user-agents': { title: '共享池', hint: '~/.agents/skills · 跨工具共享', order: 30 },
  'project-dsh': { title: '项目技能 .dsh', hint: '当前工作区的 .dsh/skills', order: 10 },
  'project-agents': { title: '项目技能 .agents', hint: '当前工作区的 .agents/skills', order: 11 },
  custom: { title: '自定义目录', hint: '插件配置 customSkillDirs 指定的技能根', order: 40 },
  bundled: { title: '系统内置', hint: '随 DSH 发行，只读', order: 60 },
  runtime: { title: '运行时注册', hint: '由插件在运行时注册，只读', order: 70 },
}

/** 来源分组元信息（未知来源给一个兜底行）。 */
function sourceMetaOf(source) {
  const key = typeof source === 'string' && source !== '' ? source : 'runtime'
  if (SOURCE_META[key] !== undefined) return { key, ...SOURCE_META[key] }
  return { key, title: key, hint: '来源：' + key, order: 90 }
}

/** 按当前 cwd 与配置算出要扫的技能根（去重、保序）。 */
function rootSpecs(cwd, customSkillDirs) {
  const specs = [
    { root: join(dshHomeDir(), 'skills'), source: 'user-dsh' },
    { root: join(agentsHomeDir(), 'skills'), source: 'user-agents' },
  ]
  const projectRoot = typeof cwd === 'string' && cwd.trim() !== '' ? findProjectRoot(cwd) : undefined
  if (projectRoot !== undefined) {
    specs.push({ root: join(projectRoot, '.dsh', 'skills'), source: 'project-dsh' })
    specs.push({ root: join(projectRoot, '.agents', 'skills'), source: 'project-agents' })
  }
  for (const dir of customSkillDirs) specs.push({ root: dir, source: 'custom' })
  const seen = new Set()
  const out = []
  for (const spec of specs) {
    const key = spec.root.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(spec)
  }
  return { specs: out, projectRoot }
}

/**
 * 扫描本机技能（文件系统一侧）。返回 `{ skills, projectRoot, roots }`。
 * 单个技能读失败不影响整体（跳过）。
 */
async function scanSkills(options, logger) {
  const { cwd, customSkillDirs } = options
  const { specs, projectRoot } = rootSpecs(cwd, customSkillDirs)
  const skills = []
  const seenNames = new Set()
  const seenDirs = new Set()
  for (const spec of specs) {
    const entries = await scanRoot(spec.root)
    for (const entry of entries) {
      let key
      try { key = await fsp.realpath(entry.dir) } catch { key = entry.dir }
      const dedupe = spec.source + '|' + key
      if (seenDirs.has(dedupe)) continue
      seenDirs.add(dedupe)
      let row
      try {
        row = await readSkillEntry(entry)
      } catch (error) {
        if (logger !== undefined) logger.warn(`skill-deck: 读取 ${entry.dir} 失败：${error && error.message}`)
        continue
      }
      const validName = KEBAB_NAME_RE.test(row.name)
      if (seenNames.has(row.name)) continue
      seenNames.add(row.name)
      skills.push({
        name: row.name,
        description: row.description,
        whenToUse: row.whenToUse,
        modelInvocable: row.invocation.modelInvocable,
        userInvocable: row.invocation.userInvocable,
        source: spec.source,
        provider: 'filesystem',
        path: row.path,
        dir: row.dir,
        rootDisplay: displayPath(spec.root),
        linked: row.linked,
        editable: !row.linked,
        deletable: !row.linked,
        validName,
        hasFrontmatter: row.hasFrontmatter,
      })
    }
  }
  return { skills, projectRoot, roots: specs }
}

/** 把注册表里那些文件系统扫描看不到的条目补进来（bundled / runtime 等，只读）。 */
async function mergeRegistry(ctx, filesystemSkills, cwd) {
  const rows = filesystemSkills.slice()
  const seen = new Set(rows.map((row) => row.name))
  let registryRows = []
  try {
    registryRows = await ctx.skills.list({ cwd })
  } catch (error) {
    if (ctx.logger !== undefined) ctx.logger.warn(`skill-deck: skills.list 失败：${error && error.message}`)
    return rows
  }
  for (const summary of registryRows) {
    if (summary === null || typeof summary !== 'object') continue
    const name = summary.name
    if (typeof name !== 'string' || name === '' || seen.has(name)) continue
    seen.add(name)
    rows.push({
      name,
      description: typeof summary.description === 'string' ? summary.description : '',
      whenToUse: typeof summary.whenToUse === 'string' ? summary.whenToUse : undefined,
      modelInvocable: summary.invocation === undefined || summary.invocation === null ? true : summary.invocation.modelInvocable !== false,
      userInvocable: summary.invocation === undefined || summary.invocation === null ? true : summary.invocation.userInvocable !== false,
      source: typeof summary.source === 'string' && summary.source !== '' ? summary.source : 'runtime',
      provider: typeof summary.provider === 'string' ? summary.provider : '',
      path: typeof summary.path === 'string' ? summary.path : undefined,
      dir: summary.resourceBase !== undefined && summary.resourceBase !== null && summary.resourceBase.kind === 'directory' ? summary.resourceBase.path : undefined,
      rootDisplay: '',
      linked: false,
      editable: false,
      deletable: false,
      validName: KEBAB_NAME_RE.test(name),
      hasFrontmatter: true,
      readOnly: true,
    })
  }
  return rows
}

// ── 路由 ──────────────────────────────────────────────────────────────────

/** 从仓库里取某技能的本地元数据（没有则给空对象）。 */
function localMetaOf(store, name) {
  const entry = store.skills[name]
  if (entry === undefined || entry === null) return { alias: '', note: '', categoryId: '', tags: [] }
  return {
    alias: typeof entry.alias === 'string' ? entry.alias : '',
    note: typeof entry.note === 'string' ? entry.note : '',
    categoryId: typeof entry.categoryId === 'string' ? entry.categoryId : '',
    tags: Array.isArray(entry.tags) ? entry.tags : [],
  }
}

/** 面板列表负载：分组 + 分类 + 本地元数据。 */
function buildListPayload({ skills, store, cwd, projectRoot, roots }) {
  const groups = new Map()
  for (const row of skills) {
    const meta = sourceMetaOf(row.source)
    if (!groups.has(meta.key)) groups.set(meta.key, { key: meta.key, title: meta.title, hint: meta.hint, order: meta.order, skills: [] })
    const group = groups.get(meta.key)
    group.skills.push({ ...row, local: localMetaOf(store, row.name) })
  }
  const groupList = [...groups.values()].sort((a, b) => a.order - b.order)
  for (const group of groupList) group.skills.sort((a, b) => a.name.localeCompare(b.name))
  return {
    cwd: cwd !== undefined ? cwd : '',
    projectRoot: projectRoot !== undefined ? projectRoot : '',
    projectRootDisplay: projectRoot !== undefined ? displayPath(projectRoot) : '',
    roots: roots.map((spec) => ({ root: displayPath(spec.root), source: spec.source })),
    categories: store.categories,
    groups: groupList,
    total: skills.length,
  }
}

/** 面板与浮层共用的紧凑投影（浮层只需要几个字段，省流量）。 */
function toPickerRow(row, local) {
  return {
    name: row.name,
    alias: local.alias,
    categoryId: local.categoryId,
    description: row.description,
    note: local.note,
    modelInvocable: row.modelInvocable,
    source: row.source,
  }
}

/**
 * 构建整个 /api/dsh-skill-deck 路由族。
 * 信任栅栏在每个请求进入分派前统一执行。
 */
function makeRoutes(ctx, deps) {
  const { store, trash, customSkillDirs, logger } = deps

  /** 信任栅栏 + URL 解析。 */
  const enter = (req, res) => {
    const connection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined
    if (connection !== undefined && connection !== null && typeof connection.requestRejection === 'function') {
      const rejection = connection.requestRejection(req)
      if (rejection !== undefined && rejection !== null) {
        res.writeHead(rejection.status, rejection.headers)
        res.end()
        return null
      }
    }
    try {
      return new URL(req.url || '/', 'http://dsh.local')
    } catch {
      sendJson(res, 400, { error: 'bad request url' })
      return null
    }
  }

  /** 当前工作目录：显式 ?cwd= 优先，否则 process.cwd()。 */
  const cwdOf = (url) => {
    const value = url.searchParams.get('cwd')
    return typeof value === 'string' && value.trim() !== '' ? value : process.cwd()
  }

  /** 收集一次技能（文件系统 ⊕ 注册表）。 */
  const collect = async (cwd) => {
    const { skills, projectRoot, roots } = await scanSkills({ cwd, customSkillDirs }, logger)
    const merged = await mergeRegistry(ctx, skills, cwd)
    return { skills: merged, projectRoot, roots }
  }

  /**
   * 从一次全新扫描里解析出写操作的目标技能。
   * 只有「同名 + 同路径」都命中的条目才被接受：面板打开的旧路径不允许被拿去改
   * 同名的另一个技能。
   */
  const resolveWritable = async (cwd, name, expectedPath, res) => {
    const { skills } = await collect(cwd)
    const row = skills.find((candidate) => candidate.name === name)
    if (row === undefined) {
      sendJson(res, 404, { error: `技能 ${name} 不存在` })
      return null
    }
    if (row.path === undefined) {
      sendJson(res, 404, { error: `技能 ${name} 没有可写的 SKILL.md（来源：${row.source}）` })
      return null
    }
    if (row.readOnly === true || row.editable === false) {
      sendJson(res, 400, { error: `技能 ${name} 不可编辑（来源：${row.source}）` })
      return null
    }
    if (typeof expectedPath === 'string' && expectedPath !== '' && row.path !== expectedPath) {
      sendJson(res, 409, { error: `技能 ${name} 已变更，请刷新面板后重试` })
      return null
    }
    return row
  }

  return async (req, res) => {
    const url = enter(req, res)
    if (url === null) return
    const path = url.pathname.replace(/\/+$/, '')
    const method = req.method || 'GET'
    try {
      // ── 列表 ──
      if (method === 'GET' && path === API_PREFIX + '/list') {
        const cwd = cwdOf(url)
        const { skills, projectRoot, roots } = await collect(cwd)
        const storeValue = await store.read()
        sendJson(res, 200, buildListPayload({ skills, store: storeValue, cwd, projectRoot, roots }))
        return
      }

      // ── 快捷发送浮层的候选（与面板同源，只是投影更小）──
      if (method === 'GET' && path === API_PREFIX + '/picker') {
        const cwd = cwdOf(url)
        const { skills } = await collect(cwd)
        const storeValue = await store.read()
        sendJson(res, 200, {
          skills: skills.map((row) => toPickerRow(row, localMetaOf(storeValue, row.name))),
          categories: storeValue.categories,
        })
        return
      }

      // ── 读单个技能全文 ──
      if (method === 'GET' && path === API_PREFIX + '/read') {
        const cwd = cwdOf(url)
        const name = url.searchParams.get('name')
        const expectedPath = url.searchParams.get('path')
        if (name === null || name === '') {
          sendJson(res, 400, { error: '缺少 ?name=' })
          return
        }
        const { skills } = await collect(cwd)
        const row = skills.find((candidate) => candidate.name === name)
        if (row === undefined || row.path === undefined) {
          sendJson(res, 404, { error: `技能 ${name} 没有可读的 SKILL.md` })
          return
        }
        if (typeof expectedPath === 'string' && expectedPath !== '' && row.path !== expectedPath) {
          sendJson(res, 409, { error: `技能 ${name} 已变更，请刷新面板后重试` })
          return
        }
        const entry = await readSkillEntry({
          dir: row.dir, root: row.root, relPath: '', linked: row.linked, stat: undefined,
        })
        const storeValue = await store.read()
        sendJson(res, 200, {
          name: row.name,
          path: row.path,
          description: entry.description,
          whenToUse: entry.whenToUse !== undefined ? entry.whenToUse : '',
          content: entry.body,
          modelInvocable: row.modelInvocable,
          linked: row.linked === true,
          local: localMetaOf(storeValue, row.name),
        })
        return
      }

      // ── 保存本地元数据（别名 / 描述 / 分类 / 标签）──
      // 这是本插件的核心新增能力：数据只落在 meta.json，任何 SKILL.md 与
      // 模型可见目录都不受影响。
      //
      // 语义：**只 upsert，绝不删除**。清空所有字段 = 存一条空记录（界面上就是
      // 「没有标注」），下次进程启动时 sanitizeStore 会把它丢掉。早先这里是
      // 「空载荷 = 删除条目」，那是个数据丢失陷阱：一次误点/空表单就会把用户的
      // 别名悄悄抹掉。
      if (method === 'POST' && path === API_PREFIX + '/meta') {
        const body = await readJsonBody(req)
        const name = body.name
        if (typeof name !== 'string' || !KEBAB_NAME_RE.test(name)) {
          sendJson(res, 400, { error: 'name 必须是 kebab-case 技能名' })
          return
        }
        const next = normalizeSkillMeta({
          alias: body.alias,
          note: body.note,
          categoryId: body.categoryId,
          tags: body.tags,
        })
        await store.mutate((current) => {
          current.skills[name] = next
        })
        sendJson(res, 200, { ok: true, name, local: next })
        return
      }

      // ── 分类增删改 ──
      if (method === 'POST' && path === API_PREFIX + '/categories') {
        const body = await readJsonBody(req)
        const op = typeof body.op === 'string' ? body.op : 'create'
        const result = await store.mutate((current) => {
          if (op === 'create') {
            const category = normalizeCategory({ name: body.name, color: body.color }, current.categories.length)
            if (category === null) throw new Error('分类名不能为空')
            if (current.categories.some((c) => c.name === category.name)) throw new Error('同名分类已存在')
            current.categories.push(category)
            return category
          }
          if (op === 'update') {
            const category = current.categories.find((c) => c.id === body.id)
            if (category === undefined) throw new Error('分类不存在')
            if (typeof body.name === 'string' && body.name.trim() !== '') category.name = body.name.trim().slice(0, 40)
            if (typeof body.color === 'string') category.color = /^#[0-9a-fA-F]{3,8}$/.test(body.color) ? body.color : ''
            return category
          }
          if (op === 'delete') {
            const index = current.categories.findIndex((c) => c.id === body.id)
            if (index < 0) throw new Error('分类不存在')
            const [removed] = current.categories.splice(index, 1)
            for (const entry of Object.values(current.skills)) {
              if (entry.categoryId === removed.id) delete entry.categoryId
            }
            return removed
          }
          throw new Error('未知的 op：' + op)
        }).catch((error) => ({ __error: error && error.message ? error.message : String(error) }))
        if (result !== null && typeof result === 'object' && '__error' in result) {
          sendJson(res, 400, { error: result.__error })
          return
        }
        sendJson(res, 200, { ok: true, result, categories: (await store.read()).categories })
        return
      }

      // ── 启用 / 禁用模型调用（改写 SKILL.md 的 disable-model-invocation）──
      if (method === 'POST' && path === API_PREFIX + '/set-enabled') {
        const body = await readJsonBody(req)
        const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
        const row = await resolveWritable(cwd, body.name, body.path, res)
        if (row === null) return
        const raw = await fsp.readFile(row.path, 'utf8')
        const { hasBlock, head, bodyLines, eol } = splitFrontmatter(raw)
        if (!hasBlock) {
          sendJson(res, 400, { error: 'SKILL.md 没有 frontmatter，无法切换模型可见性' })
          return
        }
        const enabled = body.enabled !== false
        const nextHead = setFrontmatterKeys(head, {
          'disable-model-invocation': enabled ? null : ['true'],
        })
        await writeFileAtomic(row.path, joinSkillFile(nextHead, bodyLines, eol))
        sendJson(res, 200, { ok: true, name: row.name, path: row.path, modelInvocable: enabled })
        return
      }

      // ── 创建 ──
      if (method === 'POST' && path === API_PREFIX + '/create') {
        const body = await readJsonBody(req)
        const name = typeof body.name === 'string' ? body.name.trim() : ''
        if (!KEBAB_NAME_RE.test(name)) {
          sendJson(res, 400, { error: '技能名必须是 kebab-case（小写字母/数字/连字符）' })
          return
        }
        const description = typeof body.description === 'string' ? body.description.trim() : ''
        if (description === '') {
          sendJson(res, 400, { error: '描述不能为空（模型靠它决定何时加载技能）' })
          return
        }
        const content = typeof body.content === 'string' ? body.content : ''
        if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
          sendJson(res, 400, { error: '正文超过 64KB 上限' })
          return
        }
        const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
        const root = body.root === 'project' ? join(findProjectRoot(cwd), '.dsh', 'skills') : join(dshHomeDir(), 'skills')
        const dir = join(root, name)
        if (existsSync(dir)) {
          sendJson(res, 409, { error: `已存在同名技能：${displayPath(dir)}` })
          return
        }
        const whenToUse = typeof body.whenToUse === 'string' ? body.whenToUse.trim() : ''
        let head = ['name: ' + name, ...yamlScalarLines(description).map((line, index) => index === 0 ? 'description: ' + line : line)]
        if (whenToUse !== '') {
          head = [...head, ...yamlScalarLines(whenToUse).map((line, index) => index === 0 ? 'whenToUse: ' + line : line)]
        }
        if (body.disabled === true) head.push('disable-model-invocation: true')
        const file = join(dir, 'SKILL.md')
        await writeFileAtomic(file, joinSkillFile(head, ['', ...content.split(/\r?\n/)], '\n'))
        if (typeof body.alias === 'string' && body.alias.trim() !== '' || typeof body.categoryId === 'string' && body.categoryId !== '') {
          const local = normalizeSkillMeta({ alias: body.alias, note: body.note, categoryId: body.categoryId, tags: body.tags })
          await store.mutate((current) => {
            if (Object.keys(local).length > 0) current.skills[name] = local
          })
        }
        sendJson(res, 200, { ok: true, name, path: displayPath(file), dir: displayPath(dir) })
        return
      }

      // ── 编辑已有技能（真实文件字段）──
      if (method === 'POST' && path === API_PREFIX + '/update') {
        const body = await readJsonBody(req)
        const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
        const row = await resolveWritable(cwd, body.name, body.path, res)
        if (row === null) return
        const content = typeof body.content === 'string' ? body.content : ''
        if (Buffer.byteLength(content, 'utf8') > MAX_CONTENT_BYTES) {
          sendJson(res, 400, { error: '正文超过 64KB 上限' })
          return
        }
        const raw = await fsp.readFile(row.path, 'utf8')
        const { hasBlock, head, bodyLines, eol } = splitFrontmatter(raw)
        if (!hasBlock) {
          sendJson(res, 400, { error: 'SKILL.md 没有 frontmatter，无法就地编辑' })
          return
        }
        const description = typeof body.description === 'string' ? body.description.trim() : ''
        if (description === '') {
          sendJson(res, 400, { error: '描述不能为空' })
          return
        }
        const whenToUse = typeof body.whenToUse === 'string' ? body.whenToUse.trim() : ''
        const nextHead = setFrontmatterKeys(head, {
          description: yamlScalarLines(description),
          whenToUse: whenToUse === '' ? null : yamlScalarLines(whenToUse),
        })
        await writeFileAtomic(row.path, joinSkillFile(nextHead, ['', ...content.split(/\r?\n/)], eol))
        sendJson(res, 200, { ok: true, name: row.name, path: row.path })
        return
      }

      // ── 删除（移入回收站）──
      if (method === 'POST' && path === API_PREFIX + '/delete') {
        const body = await readJsonBody(req)
        const cwd = typeof body.cwd === 'string' && body.cwd !== '' ? body.cwd : process.cwd()
        const row = await resolveWritable(cwd, body.name, body.path, res)
        if (row === null) return
        if (row.deletable === false || row.linked === true) {
          sendJson(res, 400, { error: '链接技能不可删除（删掉会越出当前技能根）' })
          return
        }
        const id = await trash.moveIn(row.dir, row.name, row.linked === true)
        // 刻意**不动**本地标注：回收站是「可还原」的，标注必须跟着技能一起回来。
        // （早先这里顺手 delete 了 skills[name]，导致「删除 → 还原」之后别名凭空
        // 消失。真正该清掉标注的时机是「彻底删除」。）
        sendJson(res, 200, { ok: true, name: row.name, trashId: id })
        return
      }

      // ── 回收站 ──
      if (method === 'GET' && path === API_PREFIX + '/trash') {
        await trash.purgeExpired()
        const storeValue = await store.read()
        const entries = (await trash.list()).map((entry) => ({
          ...entry,
          alias: localMetaOf(storeValue, entry.name).alias,
        }))
        sendJson(res, 200, { entries, root: displayPath(trash.root) })
        return
      }
      if (method === 'POST' && path === API_PREFIX + '/trash/restore') {
        const body = await readJsonBody(req)
        const restored = await trash.restore(String(body.id === undefined || body.id === null ? '' : body.id))
        sendJson(res, 200, { ok: true, path: displayPath(restored) })
        return
      }
      if (method === 'POST' && path === API_PREFIX + '/trash/purge') {
        const body = await readJsonBody(req)
        // 彻底删除才是丢弃标注的时机。
        if (body.all === true) {
          const entries = await trash.list()
          for (const entry of entries) await trash.purgeOne(entry.id)
          await store.mutate((current) => {
            for (const entry of entries) delete current.skills[entry.name]
          })
          sendJson(res, 200, { ok: true, purged: entries.length })
          return
        }
        const id = String(body.id === undefined || body.id === null ? '' : body.id)
        const target = (await trash.list()).find((entry) => entry.id === id)
        await trash.purgeOne(id)
        if (target !== undefined) {
          await store.mutate((current) => { delete current.skills[target.name] })
        }
        sendJson(res, 200, { ok: true })
        return
      }

      // ── 健康检查 ──
      if (method === 'GET' && path === API_PREFIX + '/health') {
        sendJson(res, 200, {
          ok: true,
          plugin: PLUGIN_NAME,
          provider: PROVIDER_NAME,
          metaFile: displayPath(store.file),
          trashRoot: displayPath(trash.root),
          dshHome: displayPath(dshHomeDir()),
          agentsHome: displayPath(agentsHomeDir()),
          customSkillDirs: customSkillDirs.map(displayPath),
        })
        return
      }

      // ── 诊断：当前客户端模块图（排查「停用了插件但界面还在」用）──
      if (method === 'GET' && path === API_PREFIX + '/client-graph') {
        let graph = null
        try {
          const clientModules = typeof ctx.get === 'function' ? ctx.get('clientModules') : undefined
          graph = clientModules !== undefined && clientModules !== null && typeof clientModules.graph === 'function'
            ? clientModules.graph()
            : null
        } catch (error) {
          graph = { error: error && error.message ? error.message : String(error) }
        }
        sendJson(res, 200, graph !== null && typeof graph === 'object' ? graph : { graph })
        return
      }

      sendJson(res, 404, { error: 'not found: ' + method + ' ' + path })
    } catch (error) {
      if (logger !== undefined) logger.warn(`skill-deck: ${method} ${path} 失败：${error && error.stack ? error.stack : error}`)
      sendJson(res, 500, { error: error && error.message ? error.message : String(error) })
    }
  }
}

// ── 插件契约 ──────────────────────────────────────────────────────────────

module.exports = {
  name: PLUGIN_NAME,
  // 只静态声明真正必需的宿主服务；clientModules 之类只用于诊断的服务走
  // `ctx.get()` 可选读取，避免 inject 列表被非必需项拖住激活。
  inject: ['skills', 'webServer'],
  __internals: {
    splitFrontmatter,
    parseFrontmatterLines,
    setFrontmatterKeys,
    joinSkillFile,
    yamlScalarLines,
    invocationPolicy,
    sanitizeStore,
    normalizeSkillMeta,
    scanSkills,
    rootSpecs,
    findProjectRoot,
  },
  /**
   * @param ctx - 宿主上下文（skills / webServer 已在 inject 里等待就绪）。
   * @param config - 插件配置。
   */
  apply(ctx, config = {}) {
    const resolvedConfig = config !== null && typeof config === 'object' ? config : {}
    const logger = ctx.logger !== undefined && ctx.logger !== null ? ctx.logger : console
    const customSkillDirs = (Array.isArray(resolvedConfig.customSkillDirs) ? resolvedConfig.customSkillDirs : [])
      .map((dir) => resolve(expandTilde(String(dir))))
    const dataDir = resolve(expandTilde(
      typeof resolvedConfig.dataDir === 'string' && resolvedConfig.dataDir !== ''
        ? resolvedConfig.dataDir
        : join(dshHomeDir(), 'skill-deck'),
    ))
    const retentionDays = Number.isFinite(Number(resolvedConfig.trashRetentionDays))
      ? Number(resolvedConfig.trashRetentionDays)
      : 30
    const providerName = typeof resolvedConfig.providerName === 'string' && resolvedConfig.providerName !== ''
      ? resolvedConfig.providerName
      : PROVIDER_NAME

    const store = createStore(dataDir)
    const trash = createTrash(join(dataDir, 'trash'), retentionDays)

    // 诊断产物：把当前客户端模块图落盘（配置文件里的 dumpClientGraph 可关）。
    // 用途：排查「宿主行已停用但界面还在」这类客户端半区归属问题。
    if (resolvedConfig.dumpClientGraph !== false) {
      fsp.mkdir(dataDir, { recursive: true }).then(async () => {
        let graph = null
        try {
          const clientModules = typeof ctx.get === 'function' ? ctx.get('clientModules') : undefined
          graph = clientModules !== undefined && clientModules !== null && typeof clientModules.graph === 'function'
            ? clientModules.graph()
            : { unavailable: true }
        } catch (error) {
          graph = { error: error && error.message ? error.message : String(error) }
        }
        await fsp.writeFile(join(dataDir, 'client-graph.json'), JSON.stringify(graph, null, 2) + '\n', 'utf8')
      }).catch(() => {})
    }

    // 启动清一次过期回收项（读列表时也会惰性清理）。
    ctx.effect(() => {
      trash.purgeExpired().catch((error) => logger.warn(`skill-deck: 回收站清理失败：${error && error.message}`))
      return () => {}
    }, 'skill-deck: trash purge')

    // ── 技能 provider：顶替被禁用的官方 filesystem provider ──
    ctx.skills.registerProvider((control) => {
      let controlRef = control
      control.signal.addEventListener('abort', () => {
        if (controlRef === control) controlRef = undefined
      }, { once: true })
      return {
        name: providerName,
        async list(options = {}) {
          const cwd = typeof options.cwd === 'string' && options.cwd !== '' ? options.cwd : process.cwd()
          const { skills } = await scanSkills({ cwd, customSkillDirs }, logger)
          const candidates = []
          for (const row of skills) {
            // 注册表对非法候选是抛错而不是跳过——它会连带打死发起方的整个 turn。
            // 所以坏 frontmatter 的技能在这里就滤掉。
            if (row.validName !== true) {
              logger.warn(`skill-deck: 跳过技能 '${row.name}'（${row.path}）：名字不是 kebab-case`)
              continue
            }
            if (typeof row.description !== 'string' || row.description.trim() === '') {
              logger.warn(`skill-deck: 跳过技能 '${row.name}'（${row.path}）：描述为空`)
              continue
            }
            candidates.push({
              name: row.name,
              description: row.description,
              whenToUse: row.whenToUse,
              invocation: { modelInvocable: row.modelInvocable, userInvocable: row.userInvocable },
              source: row.source,
              provider: providerName,
              rank: row.source.startsWith('project') ? 10 : row.source === 'user-dsh' ? 100 : 150,
              path: row.path,
              locator: { dir: row.dir, source: row.source, linked: row.linked },
              resourceBase: { kind: 'directory', path: row.dir },
            })
          }
          return candidates
        },
        async get(candidate) {
          const locator = candidate === null || typeof candidate !== 'object' ? undefined : candidate.locator
          const dir = locator !== undefined && locator !== null && typeof locator.dir === 'string'
            ? locator.dir
            : candidate !== null && typeof candidate === 'object' && typeof candidate.path === 'string'
              ? dirname(candidate.path)
              : undefined
          if (dir === undefined) return undefined
          try {
            const entry = await readSkillEntry({
              dir,
              root: locator !== undefined && locator !== null && typeof locator.source === 'string' ? locator.source : '',
              relPath: '',
              linked: locator !== undefined && locator !== null && locator.linked === true,
              stat: undefined,
            })
            return {
              name: entry.name,
              description: entry.description,
              whenToUse: entry.whenToUse,
              invocation: entry.invocation,
              source: candidate.source,
              provider: providerName,
              content: entry.body,
              path: entry.path,
              resourceBase: { kind: 'directory', path: entry.dir },
              metadata: entry.meta,
            }
          } catch {
            return undefined
          }
        },
      }
    })

    // ── HTTP 路由族 ──
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: API_PREFIX,
      handler: makeRoutes(ctx, { store, trash, customSkillDirs, logger }),
    }), 'skill-deck: http routes')

    logger.info(`skill-deck: 已挂载（元数据：${displayPath(store.file)}，回收站：${displayPath(trash.root)}）`)
  },
}

