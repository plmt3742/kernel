#!/usr/bin/env node
// KERNEL · Windows 安装包构建器（v0.5.0）
//
// 用法：
//   node scripts/build-installer.mjs
//   npm run installer
//
// 它做什么：
//   1) 按白名单组装一份干净的安装载荷（payload）；
//   2) 调用内置 Inno Setup 编译器（node_modules\innosetup-compiler\bin\ISCC.exe）
//      编译 installer\KERNEL.iss；
//   3) 打印生成的 Setup.exe 绝对路径。
//
// 纪律：
//   - 白名单拷贝：owner 数据（种子 / 审计 / 附件 / 凭据）绝不进包；
//   - 输出与暂存均位于仓库之外（保护仓库）；重复运行幂等；
//   - 不依赖系统级 Inno Setup 安装，全部走仓库内置编译器。
//
// 可用环境变量覆盖本机默认路径：
//   KERNEL_RELEASE_DIR / KERNEL_NODE_SRC / KERNEL_OPENCODE_SRC

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')

const APP_VERSION = '0.5.0'
const SETUP_BASENAME = `KERNEL-Setup-${APP_VERSION}`
const ISS_NAME = 'KERNEL.iss'

// 诊断护栏：任何未捕获异常都留下可见痕迹（正常路径不触发）。
process.on('uncaughtException', (err) => {
  console.error('UNCAUGHT:', err && err.stack ? err.stack : err)
  process.exit(2)
})
process.on('unhandledRejection', (err) => {
  console.error('UNHANDLED:', err && err.stack ? err.stack : err)
  process.exit(3)
})

// ---- 本机默认路径（可用环境变量覆盖）----
const RELEASE_PARENT = process.env.KERNEL_RELEASE_DIR
  ? path.resolve(process.env.KERNEL_RELEASE_DIR)
  : path.join('G:' + path.sep, '<workspace>', 'opencode', 'release')
const OUT_DIR = path.join(RELEASE_PARENT, 'installer')
const NODE_SRC = process.env.KERNEL_NODE_SRC
  ? path.resolve(process.env.KERNEL_NODE_SRC)
  : path.join('C:' + path.sep, 'nodejs', 'node.exe')
const OPENCODE_SRC = process.env.KERNEL_OPENCODE_SRC
  ? path.resolve(process.env.KERNEL_OPENCODE_SRC)
  : path.join('G:' + path.sep, '<workspace>', 'opencode', 'opencode.exe')

const ISCC = path.join(ROOT, 'node_modules', 'innosetup-compiler', 'bin', 'ISCC.exe')
const ISS_PATH = path.join(ROOT, 'installer', ISS_NAME)
const WELCOME_SRC = path.join(ROOT, 'installer', 'welcome.html')
const ICON_SRC = path.join(ROOT, 'kernel.ico')

// 暂存目录（均位于仓库之外，构建结束后清理）。
const STAGE = path.join(OUT_DIR, '.payload')
const STAGE_DATA = path.join(OUT_DIR, '.payload-data')
const ISSBUILD = path.join(OUT_DIR, '.issbuild')

const ENTITY_DIRS = [
  'tasks',
  'projects',
  'notes',
  'resources',
  'events',
  'areas',
  'goals',
  'habits',
  'reviews',
  'inbox',
  'courses',
]
const DATA_DIRS = [...ENTITY_DIRS, 'trash', 'files', 'meta']

const SCRIPTS_EXCLUDE = new Set(['seed.mjs', 'package.mjs', 'build-installer.mjs', 'make-icon.ps1'])
const ROOT_FILES = ['index.html', 'vite.config.ts', 'README.md', '启动.cmd', '启动器.ps1', '启动器.vbs', 'kernel.ico']

const RED = '\x1b[31m'
const GREEN = '\x1b[32m'
const RESET = '\x1b[0m'

const log = (m = '') => console.log(m)
const ok = (m) => console.log(`${GREEN}PASS${RESET} ${m}`)
function fatal(msg) {
  console.error(`${RED}FAIL${RESET} ${msg}`)
  process.exit(1)
}

// ---- 文件助手（使用旧式 API，规避 cpSync 在部分路径下的原生崩溃）----
function mustExist(p, label) {
  if (!fs.existsSync(p)) fatal(`缺少必需来源：${label}（${p}）`)
}

function copyDir(srcDir, destDir, filter) {
  fs.mkdirSync(destDir, { recursive: true })
  for (const e of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, e.name)
    if (typeof filter === 'function' && !filter(s, path.join(destDir, e.name))) continue
    const d = path.join(destDir, e.name)
    if (e.isDirectory()) {
      copyDir(s, d, filter)
    } else if (e.isSymbolicLink()) {
      try {
        fs.copyFileSync(fs.realpathSync(s), d)
      } catch {
        log(`[installer] 跳过无法复制的链接：${path.relative(ROOT, s)}`)
      }
    } else {
      fs.copyFileSync(s, d)
    }
  }
}

function copyFile(srcFile, destFile) {
  fs.mkdirSync(path.dirname(destFile), { recursive: true })
  fs.copyFileSync(srcFile, destFile)
}

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
}

// ===========================================================================
// 主流程
// ===========================================================================
log(`[installer] KERNEL 安装包构建 · v${APP_VERSION}`)

// 安全：输出必须在仓库之外
const relToRoot = path.relative(ROOT, OUT_DIR)
if (relToRoot === '' || (!relToRoot.startsWith('..') && !path.isAbsolute(relToRoot))) {
  fatal('输出目录位于仓库内（会污染仓库）。请用 KERNEL_RELEASE_DIR 指定仓库之外的目录。')
}

// ---- 来源校验 ----
mustExist(NODE_SRC, '本机 node 可执行文件（可用 KERNEL_NODE_SRC 覆盖）')
mustExist(OPENCODE_SRC, '本机 opencode 可执行文件（可用 KERNEL_OPENCODE_SRC 覆盖）')
mustExist(ISS_PATH, '安装脚本 installer/KERNEL.iss')
mustExist(WELCOME_SRC, '启动页 installer/welcome.html')
mustExist(ICON_SRC, '图标 kernel.ico')
mustExist(path.join(ROOT, 'package.json'), '仓库 package.json')
mustExist(ISCC, '内置 Inno Setup 编译器（请先 npm install）')

fs.mkdirSync(OUT_DIR, { recursive: true })

// ---- 幂等：清空暂存目录 ----
rmrf(STAGE)
rmrf(STAGE_DATA)
rmrf(ISSBUILD)
fs.mkdirSync(STAGE, { recursive: true })
fs.mkdirSync(STAGE_DATA, { recursive: true })

log('[installer] 组装安装载荷（白名单拷贝）…')
copyDir(path.join(ROOT, 'src'), path.join(STAGE, 'src'))
copyDir(path.join(ROOT, 'server'), path.join(STAGE, 'server'))
copyDir(path.join(ROOT, 'public'), path.join(STAGE, 'public'), (src) => {
  const base = path.basename(src)
  return base !== 'showcase.html' // 本地展示页含真实数据截图，绝不进安装包
})
copyDir(path.join(ROOT, 'scripts'), path.join(STAGE, 'scripts'), (src) => {
  const base = path.basename(src)
  return base !== 'assets' && !SCRIPTS_EXCLUDE.has(base)
})
copyDir(path.join(ROOT, 'node_modules'), path.join(STAGE, 'node_modules'), (src) => {
  const base = path.basename(src)
  if (base === '.cache' || base === '.vite') return false
  if (base === 'innosetup-compiler') return false // 构建期工具，运行不需要
  if (base.endsWith('.tsbuildinfo')) return false
  return true
})

log('[installer] 拷贝根文件…')
for (const f of ROOT_FILES) {
  const abs = path.join(ROOT, f)
  if (!fs.existsSync(abs)) fatal(`缺少必需根文件：${f}`)
  copyFile(abs, path.join(STAGE, f))
}
for (const f of fs.readdirSync(ROOT).filter((n) => /^tsconfig.*\.json$/.test(n))) {
  copyFile(path.join(ROOT, f), path.join(STAGE, f))
}

// 启动页固定置于载荷根目录（启动器读取 <root>\welcome.html）。
copyFile(WELCOME_SRC, path.join(STAGE, 'welcome.html'))
log('[installer] 启动页 → welcome.html')

log('[installer] 内置运行时…')
copyFile(NODE_SRC, path.join(STAGE, 'runtime', 'node.exe'))
copyFile(OPENCODE_SRC, path.join(STAGE, 'runtime', 'opencode', 'opencode.exe'))

// ---- 净化版 package.json（去掉 seed 脚本）----
log('[installer] 生成 package.json…')
const meta = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
if (meta.scripts && typeof meta.scripts === 'object') delete meta.scripts.seed
fs.writeFileSync(path.join(STAGE, 'package.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8')

// ---- opencode.json（无密钥，读环境变量）----
log('[installer] 生成 opencode.json…')
const opencodeConfig = {
  $schema: 'https://opencode.ai/config.json',
  model: 'deepseek/deepseek-flash',
  provider: {
    deepseek: {
      options: { apiKey: '{env:DEEPSEEK_API_KEY}' },
      models: {
        'deepseek-flash': {
          name: 'DeepSeek V4.1 Flash',
          modalities: { input: ['text', 'image'], output: ['text'] },
        },
      },
    },
  },
}
fs.writeFileSync(path.join(STAGE, 'opencode.json'), JSON.stringify(opencodeConfig, null, 2) + '\n', 'utf8')

// ---- 空白数据骨架（绝不拷贝 owner 数据）----
log('[installer] 生成空白数据骨架…')
for (const d of DATA_DIRS) fs.mkdirSync(path.join(STAGE_DATA, 'data', d), { recursive: true })
const config = {
  name: 'KERNEL',
  owner: '',
  version: '0.1.0',
  locale: 'zh-CN',
  weekStart: 'monday',
  aiAutomation: 'confirm',
}
fs.writeFileSync(path.join(STAGE_DATA, 'data', 'meta', 'config.json'), JSON.stringify(config, null, 2) + '\n', 'utf8')
fs.writeFileSync(path.join(STAGE_DATA, 'data', 'meta', 'tags.json'), JSON.stringify({ tags: [] }, null, 2) + '\n', 'utf8')

// ---- 结构校验（防回归）----
for (const bad of ['.git', '.qa', '.omo', 'docs', 'design-drafts', 'data', 'data/meta/secrets.json', 'data/activity.jsonl', 'scripts/seed.mjs', 'scripts/assets', 'public/showcase.html', '使用说明.md']) {
  if (fs.existsSync(path.join(STAGE, bad))) fatal(`禁用路径出现在载荷内：${bad}`)
}
if (fs.existsSync(path.join(STAGE, 'AGENTS.md'))) fatal('AGENTS.md 不应进载荷')
ok('载荷结构校验通过')

// ---- 准备 ISCC 脚本目录（.iss 与 kernel.ico 同目录，保证 SetupIconFile=kernel.ico 可解析）----
fs.mkdirSync(ISSBUILD, { recursive: true })
copyFile(ISS_PATH, path.join(ISSBUILD, ISS_NAME))
copyFile(ICON_SRC, path.join(ISSBUILD, 'kernel.ico'))

// ---- 编译 ----
log('[installer] 调用内置 Inno Setup 编译器…')
const isccArgs = [
  path.join(ISSBUILD, ISS_NAME),
  `/DStageDir=${STAGE}`,
  `/DDataDir=${STAGE_DATA}`,
  `/DOutputDir=${OUT_DIR}`,
]
const r = spawnSync(ISCC, isccArgs, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const stdout = String(r.stdout || '')
const stderr = String(r.stderr || '')
if (stdout.trim()) log(stdout.trim())

const setupPath = path.join(OUT_DIR, `${SETUP_BASENAME}.exe`)
if (r.error || r.status !== 0 || !fs.existsSync(setupPath)) {
  if (stderr.trim()) console.error(stderr.trim())
  fatal(`编译失败（ISCC 退出码 ${r.status ?? '未知'}）。未产出 Setup.exe。`)
}
ok('编译通过')

// ---- 清理暂存（仓库与发布区都不留临时目录）----
rmrf(STAGE)
rmrf(STAGE_DATA)
rmrf(ISSBUILD)

// ---- 结果 ----
const sizeMb = (fs.statSync(setupPath).size / 1024 / 1024).toFixed(1)
log('')
log(`${GREEN}[installer] 完成。${RESET}`)
log(`[installer] Setup.exe → ${setupPath}  (${sizeMb} MB)`)
