// 把 client-src/ 的分片按文件名顺序拼成 client/bundle.js。
//
// 客户端半区的加载格式是宿主的 `window.__ModuleLoader__.load({ id, factory })`：
// 工厂返回一个带 apply/inject 的模块对象。分片共享同一个工厂作用域，所以能直接
// 互相引用，不需要模块系统。
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const srcDir = join(root, 'client-src')
const outFile = join(root, 'client', 'bundle.js')

const { readdir } = await import('node:fs/promises')
const names = (await readdir(srcDir)).filter((name) => name.endsWith('.js')).sort()
if (names.length === 0) throw new Error('client-src 里没有分片')

const parts = []
for (const name of names) {
  const text = await readFile(join(srcDir, name), 'utf8')
  parts.push(text.replace(/\s*$/, ''))
}

const bundle = parts.join('\n') + '\n'
await mkdir(dirname(outFile), { recursive: true })
await writeFile(outFile, bundle, 'utf8')

// 产物自检：必须是可解析的脚本，且工厂尾部闭合。
new Function(bundle) // eslint-disable-line no-new-func
console.log(`built ${outFile} (${bundle.length} bytes, ${names.length} chunks: ${names.join(', ')})`)
