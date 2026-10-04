#!/usr/bin/env node
// KERNEL · 后台启动器（Windows 安全模式）
// 为什么：直接用 `start "" /min cmd /c "..."` 或未重定向的 spawn 启动长驻服务时，
//         子进程会持有代理层调用的输出管道句柄，导致调用**永久挂起**
//         （2026-10-02 三次事故记录，见 AGENTS.md「Windows 操作纪律」）。
// 原理：detached spawn + stdio 全部重定向到日志文件 + unref —— 工具调用约 1 秒内返回，
//       服务进程独立存活；日志持续追加，启动后另用 netstat / HTTP 探活断言就绪。
// 用法：
//   node scripts/spawn-bg.mjs <日志文件> <命令...>
// 例：
//   node scripts/spawn-bg.mjs .qa/logs/dev.log npm run dev
//   node scripts/spawn-bg.mjs .qa/logs/data-service.log node server/index.mjs
import { spawn } from 'node:child_process'
import { mkdirSync, openSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const [logArg, ...cmdParts] = process.argv.slice(2)
if (logArg === undefined || cmdParts.length === 0) {
  console.error('用法: node scripts/spawn-bg.mjs <日志文件> <命令...>')
  console.error('例:   node scripts/spawn-bg.mjs .qa/logs/dev.log npm run dev')
  process.exit(1)
}

const logPath = resolve(root, logArg)
mkdirSync(dirname(logPath), { recursive: true })
const fd = openSync(logPath, 'a')

const command = cmdParts.join(' ')
const child = spawn(command, {
  cwd: root,
  shell: true,
  detached: true,
  stdio: ['ignore', fd, fd],
  windowsHide: true,
})
child.unref()

console.log(`[spawn-bg] 已启动 pid=${child.pid}`)
console.log(`[spawn-bg] 命令: ${command}`)
console.log(`[spawn-bg] 日志: ${logPath}`)
process.exit(0)
