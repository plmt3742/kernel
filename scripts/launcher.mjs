// KERNEL · 双击启动器（Windows 优先，兼容 macOS / Linux）
// 用法：双击仓库根目录的「启动.cmd」，或在此目录执行：node scripts/launcher.mjs
//   1) 检查 Node.js 版本（建议 18+，低版本仅警告）
//   2) 缺少 node_modules 时自动 npm install
//   3) 检测 opencode CLI（缺失仅提示，绝不阻断）
//   4) 启动 node scripts/dev.mjs（数据服务 4097 + Vite 5173 + opencode 4096）
//   5) 等待 http://127.0.0.1:5173 就绪后自动打开浏览器
//
// 自测 / 调试环境变量（正常使用无需关心）：
//   KERNEL_LAUNCHER_HELP=1      仅打印用法后退出，不启动任何服务
//   KERNEL_LAUNCHER_SKIP_DEV=1  跳过真实 dev 启动，仅做前置检查后退出
import { spawn, spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import readline from 'node:readline'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HOST = '127.0.0.1'
const PORT = 5173
const APP_URL = `http://localhost:${PORT}`
// 分发包：包根 welcome.html（启动页）与内置 opencode 可执行文件
const WELCOME_PATH = path.join(root, 'welcome.html')
const BUILTIN_OPENCODE = path.join(root, 'runtime', 'opencode', 'opencode.exe')
const NODE_MIN = 18
const POLL_INTERVAL_MS = 700
const POLL_TIMEOUT_MS = 90_000
const TAG = '[启动器]'

const isWindows = process.platform === 'win32'

function log(msg = '') {
  console.log(msg)
}

function warn(msg) {
  console.warn(msg)
}

function printHelp() {
  log('KERNEL 双击启动器')
  log('')
  log('用法：')
  log('  node scripts/launcher.mjs')
  log('  或直接双击仓库根目录的「启动.cmd」')
  log('')
  log('它会：')
  log('  1) 检查 Node.js 版本（建议 18+）')
  log('  2) 缺少 node_modules 时自动 npm install')
  log('  3) 优先使用包内内置 opencode，否则探测系统 CLI（缺失仅提示，不阻断）')
  log('  4) 启动 node scripts/dev.mjs')
  log(`  5) 打开启动页 welcome.html（存在时），${APP_URL} 就绪后自动进入`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** `node -v` 自检：>=18 通过；无法解析时放行（不误伤） */
function nodeVersionOk() {
  try {
    const r = spawnSync(process.execPath, ['-v'], { encoding: 'utf8' })
    const raw = String(r.stdout || '').trim().replace(/^v/, '')
    const major = Number.parseInt(raw, 10)
    if (!Number.isFinite(major)) return true
    return major >= NODE_MIN
  } catch {
    return true
  }
}

/** node_modules 缺失时安装依赖；失败则致命退出 */
function ensureDependencies() {
  if (existsSync(path.join(root, 'node_modules'))) return
  log(`${TAG} 首次运行，正在安装依赖（需要联网，可能要几分钟）…`)
  const r = spawnSync('npm', ['install'], {
    stdio: 'inherit',
    cwd: root,
    shell: isWindows, // Windows 上经 shell 解析 npm.cmd
  })
  if (r.error) {
    fatal(
      `${TAG} 未找到 npm（Node 可能未正确安装）。若你用的是分发包，包内已自带依赖、不应走到这一步；` +
        `否则请安装 Node.js 18+ 后重试。`,
    )
  }
  if (r.status !== 0 || !existsSync(path.join(root, 'node_modules'))) {
    fatal(`${TAG} 依赖安装失败。请检查网络后重试，或在项目目录手动运行：npm install`)
  }
}

/** opencode 是否在 PATH（where / which） */
function hasOpencode() {
  const probe = isWindows ? 'where' : 'which'
  try {
    const r = spawnSync(probe, ['opencode'], { stdio: 'ignore' })
    return r.status === 0
  } catch {
    return false
  }
}

function startDev(env) {
  return spawn(process.execPath, [path.join(root, 'scripts', 'dev.mjs')], {
    stdio: 'inherit',
    cwd: root,
    env,
  })
}

/** 子进程退出 → 本进程同码退出；Ctrl+C → 透传终止子进程 */
function bindChild(child) {
  child.on('exit', (code, signal) => {
    process.exit(signal ? 0 : code ?? 0)
  })
  const stop = () => {
    if (!child.killed) {
      try {
        child.kill()
      } catch {
        /* 忽略：进程可能已退出 */
      }
    }
  }
  process.on('SIGINT', () => {
    stop()
    setTimeout(() => process.exit(0), 300)
  })
  process.on('SIGTERM', () => {
    stop()
    setTimeout(() => process.exit(0), 300)
  })
}

/** 轮询应用端口，约 700ms 一次，最长约 90s */
async function waitForApp() {
  const deadline = Date.now() + POLL_TIMEOUT_MS
  while (Date.now() < deadline) {
    try {
      await fetch(`http://${HOST}:${PORT}`, { method: 'GET' })
      return true
    } catch {
      // 尚未就绪，继续等待
    }
    await sleep(POLL_INTERVAL_MS)
  }
  return false
}

/** 用系统默认程序打开一个 URL 或本地文件（仅 Windows；其它平台返回 false） */
function openPath(target) {
  if (!isWindows) return false
  try {
    const child = spawn('cmd', ['/c', 'start', '', target], {
      stdio: 'ignore',
      detached: true,
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

/** 打开应用 URL（浏览器） */
function openBrowser() {
  return openPath(APP_URL)
}

/** 致命错误：打印可读中文并等待回车，避免双击窗口一闪而过 */
function fatal(msg) {
  log('')
  warn(msg)
  log('')
  if (!process.stdin.isTTY) {
    process.exit(1)
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.question('按回车退出…', () => {
    rl.close()
    process.exit(1)
  })
}

async function main() {
  if (process.env.KERNEL_LAUNCHER_HELP === '1' || process.argv.includes('--help')) {
    printHelp()
    return
  }

  if (!nodeVersionOk()) {
    warn(`${TAG} 检测到 Node ${process.versions.node}，建议升级到 Node ${NODE_MIN}+（本次仍会尝试运行）。`)
  }

  ensureDependencies()

  // 内置 opencode（分发包）：存在则经 KERNEL_OPENCODE_BIN 传给 dev 子进程；否则探测系统 PATH。
  const builtinOpencode = isWindows && existsSync(BUILTIN_OPENCODE) ? BUILTIN_OPENCODE : ''
  if (builtinOpencode) {
    log(`${TAG} 使用内置 opencode`)
  } else if (!hasOpencode()) {
    log('')
    log(`${TAG} 未检测到 opencode：AI 功能不可用（其余功能不受影响）。`)
    log(`${TAG} 如需 AI，请安装 opencode CLI：https://opencode.ai/docs`)
    log('')
  }

  if (process.env.KERNEL_LAUNCHER_SKIP_DEV === '1') {
    log(`${TAG} 自测模式：已跳过 dev 启动。`)
    return
  }

  const childEnv = builtinOpencode
    ? { ...process.env, KERNEL_OPENCODE_BIN: builtinOpencode }
    : process.env
  const child = startDev(childEnv)
  bindChild(child)

  // 启动页优先：welcome.html 存在时先开它（它会自行轮询并跳转）；随后就绪时不再开第二个标签。
  const hasWelcome = existsSync(WELCOME_PATH)
  if (hasWelcome) {
    log(`${TAG} 正在打开启动页…`)
    if (!openPath(WELCOME_PATH)) {
      log(`${TAG} 启动页打开失败，可手动双击目录里的 welcome.html`)
    }
  }

  const ready = await waitForApp()
  if (ready) {
    log(`${TAG} 已就绪：${APP_URL}`)
    if (!hasWelcome && !openBrowser()) {
      log(`${TAG} 请手动打开 ${APP_URL}`)
    }
  } else {
    log(`${TAG} 等待超时：请手动打开 ${APP_URL}`)
  }
}

main().catch((err) => {
  fatal(`${TAG} 启动失败：${err?.message ?? err}`)
})
