// KERNEL · 开发启动器（数据服务 + Vite 一体启动）
// 用法：node scripts/dev.mjs [--preview] [-- <传给 vite 的额外参数>]
// - 数据服务固定监听 127.0.0.1:4097（永不暴露局域网）
// - Vite 代理 /api 到数据服务；Ctrl+C 一并退出
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isPreview = process.argv.includes('--preview')
const passthrough = process.argv.slice(2).filter((arg) => arg !== '--preview')

const serverEntry = path.join(root, 'server', 'index.mjs')
const viteEntry = path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')

const children = []
let shuttingDown = false

function launch(args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', cwd: root })
  children.push(child)
  child.on('exit', (code) => {
    if (!shuttingDown) shutdown(code ?? 0)
  })
  return child
}

function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    if (!child.killed) child.kill()
  }
  // 给子进程一点时间释放端口，然后退出
  setTimeout(() => process.exit(code), 300)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log(`[dev] 数据服务 + Vite${isPreview ? '（preview）' : ''} 启动中…`)
launch([serverEntry])
launch([viteEntry, ...(isPreview ? ['preview'] : []), ...passthrough])
