#!/usr/bin/env node
// KERNEL · 后台启动器（Windows 安全模式）
// 为什么：直接用 `start "" /min cmd /c "..."` 或未重定向的 spawn 启动长驻服务时，
//         子进程会持有代理层调用的输出管道句柄，导致调用**永久挂起**
//         （2026-10-02 三次事故记录，见 AGENTS.md「Windows 操作纪律」）。
// 原理：detached spawn + 日志重定向 + unref —— 工具调用约 1 秒内返回，服务独立存活，日志持续追加。
// 用法：
//   node scripts/spawn-bg.mjs <日志文件> <命令...>
// 例：
//   node scripts/spawn-bg.mjs .qa/logs/dev.log npm run dev
//   node scripts/spawn-bg.mjs .qa/logs/data-service.log node server/index.mjs
//
// 2026-10-04 修订（QA v75）：实测本环境下「shell:true 直接以 fd 重定向 stdout/stderr」时，
// 句柄经 cmd.exe 中转后失效——进程照跑、日志全空（.qa/logs/data-service.log 早已留下 0 字节症状）。
// 改为**自中继模式**：以 shell:false + fd 重定向启动自身 `--relay` 子进程（该链路实测稳定），
// relay 再以**管道**持有目标命令（shell:true；管道经 cmd.exe 无此缺陷）并实时转发输出。
import { spawn } from 'node:child_process'
import { mkdirSync, openSync, writeSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SELF = fileURLToPath(import.meta.url)
const root = resolve(dirname(SELF), '..')

const argv = process.argv.slice(2)

if (argv[0] === '--relay') {
  // relay 模式：stdout/stderr 已由父层重定向到日志文件；以管道持有目标命令并逐段转发。
  const command = argv.slice(1).join(' ')
  if (!command) {
    process.stderr.write('[spawn-bg] relay: 缺少命令\n')
    process.exit(1)
  }
  const child = spawn(command, { cwd: root, shell: true, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  child.stdout.on('data', (d) => process.stdout.write(d))
  child.stderr.on('data', (d) => process.stderr.write(d))
  child.on('error', (err) => {
    process.stderr.write('[spawn-bg] relay spawn 失败：' + (err && err.message ? err.message : String(err)) + '\n')
    process.exit(1)
  })
  child.on('exit', (code) => process.exit(code ?? 0))
} else {
  const [logArg, ...cmdParts] = argv
  if (logArg === undefined || cmdParts.length === 0) {
    console.error('用法: node scripts/spawn-bg.mjs <日志文件> <命令...>')
    console.error('例:   node scripts/spawn-bg.mjs .qa/logs/dev.log npm run dev')
    process.exit(1)
  }

  const logPath = resolve(root, logArg)
  mkdirSync(dirname(logPath), { recursive: true })
  const fd = openSync(logPath, 'a')

  const child = spawn(process.execPath, [SELF, '--relay', ...cmdParts], {
    cwd: root,
    shell: false,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
  })
  child.on('error', (err) => {
    try {
      writeSync(fd, '[spawn-bg] 启动 relay 失败：' + (err && err.message ? err.message : String(err)) + '\n')
    } catch {
      /* 忽略：日志句柄不可写时只能放弃 */
    }
  })
  child.unref()

  console.log(`[spawn-bg] 已启动 pid=${child.pid}`)
  console.log(`[spawn-bg] 命令: ${cmdParts.join(' ')}`)
  console.log(`[spawn-bg] 日志: ${logPath}`)
  process.exit(0)
}
