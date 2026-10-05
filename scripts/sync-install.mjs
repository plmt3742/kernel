#!/usr/bin/env node
// KERNEL · 安装版实时同步
// 把工作区源码白名单镜像到安装目录（D:\KERNEL），供其自带 Vite dev 热更新即时生效。
//
// 用法：
//   node scripts/sync-install.mjs [destRoot]      # 默认 D:/KERNEL（可用 KERNEL_SYNC_DEST 覆盖）
//   node scripts/sync-install.mjs --once          # 只同步一次后退出
//
// 纪律：只同步「代码 / 配置」白名单；绝不触碰 data / logs / runtime / node_modules /
//       opencode.json / 启动器与卸载器 —— 安装目录里的用户数据与本地配置不受影响。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const ONCE = args.includes('--once')
const DEST = path.resolve(
  args.find((a) => !a.startsWith('--')) ?? process.env.KERNEL_SYNC_DEST ?? 'D:/KERNEL',
)

/** 白名单：整目录同步 */
const DIRS = ['src', 'server', 'public', 'scripts']
/** 白名单：根级文件同步 */
const FILES = [
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'package.json',
]

let copied = 0
let upToDate = 0

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`)
}

function copyFile(rel) {
  const from = path.join(SRC, rel)
  const to = path.join(DEST, rel)
  let s
  try {
    s = fs.statSync(from)
  } catch {
    return
  }
  if (!s.isFile()) return
  try {
    const d = fs.statSync(to)
    // 目标已存在且大小 / 修改时间一致 → 跳过（避免无谓写盘与 HMR 抖动）
    if (d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 1000) {
      upToDate++
      return
    }
  } catch {
    /* 目标缺失 → 复制 */
  }
  fs.mkdirSync(path.dirname(to), { recursive: true })
  fs.copyFileSync(from, to)
  copied++
  log(`sync ${rel}`)
}

function walk(relDir) {
  let entries
  try {
    entries = fs.readdirSync(path.join(SRC, relDir), { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const rel = `${relDir}/${entry.name}`
    if (entry.isDirectory()) walk(rel)
    else if (entry.isFile()) copyFile(rel)
  }
}

function syncAll(reason) {
  copied = 0
  upToDate = 0
  for (const dir of DIRS) walk(dir)
  for (const file of FILES) copyFile(file)
  if (copied > 0 || reason === 'start') {
    log(`sync ${reason} · copied=${copied} up-to-date=${upToDate}`)
  }
}

if (!fs.existsSync(DEST)) {
  log(`目标不存在，退出：${DEST}`)
  process.exit(1)
}

log(`watch ${SRC} → ${DEST}`)
syncAll('start')

if (ONCE) process.exit(0)

let timer = null
function schedule() {
  if (timer !== null) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    syncAll('change')
  }, 300)
}

for (const dir of DIRS) {
  const abs = path.join(SRC, dir)
  if (fs.existsSync(abs)) {
    try {
      fs.watch(abs, { recursive: true }, () => schedule())
    } catch (err) {
      log(`watch 失败 ${dir}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

// 根级白名单文件：非递归监听仓库根，仅对白名单文件名反应
try {
  fs.watch(SRC, (_event, filename) => {
    if (filename !== null && FILES.includes(filename.toString())) schedule()
  })
} catch (err) {
  log(`watch 根目录失败: ${err instanceof Error ? err.message : String(err)}`)
}

process.on('SIGINT', () => {
  log('stop')
  process.exit(0)
})
