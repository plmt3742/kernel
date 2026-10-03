// KERNEL 数据清零脚本（v0.5 · 运维工具）：把 data/ 清到「从零开始」状态。
//
// 用法：
//   node scripts/reset.mjs         预演（只打印将执行的动作，不改任何文件）
//   node scripts/reset.mjs --yes   执行（先整目录备份到 .qa/backups/，再清空）
//
// 保留：data/meta/config.json（应用设置）。
// 清空：全部实体 JSON（tasks/projects/notes/resources/events/areas/goals/habits/
//       reviews/inbox/courses）、回收站内容、附件目录内容、activity.jsonl（截断为 0）。
// 重置：data/meta/tags.json → { "tags": [] }；删除 data/meta/term.json（学期未设置）。
//
// 纪律：本脚本属维护工具（与 scripts/seed.mjs 同族，绕过服务直写文件，AGENTS.md §4 例外条款）；
//       执行后建议重启数据服务；备份在 .qa/backups/ 下，可整目录拷回恢复。
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DATA = path.join(ROOT, 'data')
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

const execute = process.argv.includes('--yes')

function stamp() {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

function countFilesRec(dir) {
  if (!fs.existsSync(dir)) return 0
  let n = 0
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    n += entry.isDirectory() ? countFilesRec(path.join(dir, entry.name)) : 1
  }
  return n
}

if (!fs.existsSync(DATA)) {
  console.error('[reset] data/ 不存在，终止')
  process.exit(1)
}

// ---- 预演清单 ----
const jsonFiles = []
for (const dir of ENTITY_DIRS) {
  const abs = path.join(DATA, dir)
  if (!fs.existsSync(abs)) continue
  for (const f of fs.readdirSync(abs)) {
    if (f.endsWith('.json')) jsonFiles.push(path.join(abs, f))
  }
}
const trashDir = path.join(DATA, 'trash')
const filesDir = path.join(DATA, 'files')
const activityPath = path.join(DATA, 'activity.jsonl')
const tagsPath = path.join(DATA, 'meta', 'tags.json')
const termPath = path.join(DATA, 'meta', 'term.json')

const planTrash = countFilesRec(trashDir)
const planFiles = countFilesRec(filesDir)
const planActivity = fs.existsSync(activityPath)
  ? fs.readFileSync(activityPath, 'utf8').split('\n').filter((l) => l.trim() !== '').length
  : 0

console.log('[reset] 将清空：')
console.log(`  实体 JSON：${jsonFiles.length} 个`)
console.log(`  回收站文件：${planTrash} 个`)
console.log(`  附件：${planFiles} 个`)
console.log(`  审计日志：${planActivity} 行（截断为 0）`)
console.log('  标签注册表：重置为空；学期 term.json：删除；config.json：保留')

if (!execute) {
  console.log('[reset] 预演模式——未改动任何文件。加 --yes 执行。')
  process.exit(0)
}

// ---- 备份 ----
const backupDir = path.join(ROOT, '.qa', 'backups', `data-${stamp()}`)
fs.mkdirSync(path.dirname(backupDir), { recursive: true })
fs.cpSync(DATA, backupDir, { recursive: true })
console.log(`[reset] 备份完成：${backupDir}`)

// ---- 清空 ----
let removedJson = 0
for (const abs of jsonFiles) {
  fs.rmSync(abs)
  removedJson += 1
}
if (fs.existsSync(trashDir)) fs.rmSync(trashDir, { recursive: true, force: true })
fs.mkdirSync(trashDir, { recursive: true })
if (fs.existsSync(filesDir)) fs.rmSync(filesDir, { recursive: true, force: true })
fs.mkdirSync(filesDir, { recursive: true })
fs.mkdirSync(path.dirname(tagsPath), { recursive: true })
fs.writeFileSync(tagsPath, `${JSON.stringify({ tags: [] }, null, 2)}\n`, 'utf8')
if (fs.existsSync(termPath)) fs.rmSync(termPath)
fs.writeFileSync(activityPath, '', 'utf8')

console.log(
  `[reset] 已清空：实体 ${removedJson} · 回收站 ${planTrash} · 附件 ${planFiles} · 审计 ${planActivity} 行`,
)
console.log('[reset] 完成。建议重启数据服务后开始使用。')
