// KERNEL · 开发启动器（数据服务 + Vite 一体启动）
// 用法：node scripts/dev.mjs [--preview] [-- <传给 vite 的额外参数>]
// - 数据服务固定监听 127.0.0.1:4097（永不暴露局域网）
// - Vite 代理 /api 到数据服务；Ctrl+C 一并退出
import { spawn } from 'node:child_process'
import net from 'node:net'
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

/* ---------------------------------------------------------------------------
 * opencode serve（AI 能力，v0.5）：默认 127.0.0.1:4096
 * - 已在运行 → 静默跳过（不重复拉起用户自己的实例）
 * - 未运行 → 以托管子进程启动，dev 退出时一并关闭
 * - 未安装 CLI → 警告后继续（不影响数据服务与前端）
 * ------------------------------------------------------------------------- */

/** 端口是否已有监听（约 500ms 超时；连上即视为有服务） */
function isPortListening(port, host = '127.0.0.1', timeout = 500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeout)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function ensureOpencode() {
  const port = 4096
  if (await isPortListening(port)) {
    console.log('[dev] opencode serve 已在运行（4096）')
    return
  }
  console.log('[dev] 启动 opencode serve（4096）')
  const child = spawn('opencode', ['serve', '--port', String(port)], {
    stdio: 'inherit',
    cwd: root,
    shell: process.platform === 'win32',
  })
  // CLI 缺失（ENOENT）时仅告警，不拖垮 dev 启动
  child.on('error', (err) => {
    console.warn(`[dev] 未找到 opencode CLI，AI 功能不可用（${err?.code ?? err?.message ?? '未知错误'}）`)
  })
  children.push(child)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

console.log(`[dev] 数据服务 + Vite${isPreview ? '（preview）' : ''} 启动中…`)
launch([serverEntry])
launch([viteEntry, ...(isPreview ? ['preview'] : []), ...passthrough])
// 并行走 opencode 就绪检查（失败不影响主栈）
ensureOpencode().catch((err) => {
  console.warn(`[dev] opencode 就绪检查失败：${err?.message ?? err}`)
})
