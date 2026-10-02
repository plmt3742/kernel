// KERNEL · 数据服务 · 存储层（单写者 · 原子写 · 审计日志）
// 纪律：所有写入串行化（写队列）；写前 Zod 校验；原子写入（write-file-atomic）；
//       每次变更追加 data/activity.jsonl 审计条目。绝不删除非目标文件。
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import writeFileAtomic from 'write-file-atomic'
import { SCHEMAS } from './schemas.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = path.join(ROOT, 'data')
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.jsonl')

/* ---------------------------------------------------------------------------
 * 时间戳：本地时区 ISO 8601 带偏移（对齐 docs/04 §1.2）
 * ------------------------------------------------------------------------- */

export function nowIso() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const offsetMin = -d.getTimezoneOffset()
  const sign = offsetMin >= 0 ? '+' : '-'
  const oh = pad(Math.floor(Math.abs(offsetMin) / 60))
  const om = pad(Math.abs(offsetMin) % 60)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}${sign}${oh}:${om}`
}

/* ---------------------------------------------------------------------------
 * 读
 * ------------------------------------------------------------------------- */

const KINDS = ['tasks', 'inbox', 'projects', 'areas', 'goals', 'habits', 'events', 'notes', 'resources', 'reviews']

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8')
  return JSON.parse(raw)
}

/** 读取某目录全部记录（id 升序） */
export async function readKind(kind) {
  const dir = path.join(DATA_DIR, kind)
  let names
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const records = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    records.push(await readJson(path.join(dir, name)))
  }
  return records.sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

/** 读取单个实体（不存在返回 null） */
export async function readEntity(kind, id) {
  try {
    return await readJson(path.join(DATA_DIR, kind, `${id}.json`))
  } catch {
    return null
  }
}

/** 全量快照（前端 hydrate 用；形状与 src/types KernelSnapshot 一致） */
export async function readSnapshot() {
  const entries = await Promise.all(KINDS.map(async (kind) => [kind, await readKind(kind)]))
  const byKind = Object.fromEntries(entries)
  const config = await readJson(path.join(DATA_DIR, 'meta', 'config.json'))
  const tagRegistry = await readJson(path.join(DATA_DIR, 'meta', 'tags.json'))
  return {
    inbox: byKind.inbox,
    tasks: byKind.tasks,
    projects: byKind.projects,
    areas: byKind.areas,
    goals: byKind.goals,
    habits: byKind.habits,
    events: byKind.events,
    notes: byKind.notes,
    resources: byKind.resources,
    reviews: byKind.reviews,
    config,
    tags: tagRegistry.tags ?? [],
  }
}

/** 审计日志尾部（最近 limit 条，时间倒序） */
export async function readActivity(limit = 20) {
  let raw
  try {
    raw = await fs.readFile(ACTIVITY_FILE, 'utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter((line) => line.trim() !== '')
  return lines
    .slice(-limit)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter((entry) => entry !== null)
    .reverse()
}

/** 最近的 task.complete 记录里的 beforeStatus（供 reopen 还原） */
export async function lastCompleteStatus(taskId) {
  let raw
  try {
    raw = await fs.readFile(ACTIVITY_FILE, 'utf8')
  } catch {
    return null
  }
  let found = null
  for (const line of raw.split('\n')) {
    if (!line.includes(taskId)) continue
    try {
      const entry = JSON.parse(line)
      if (entry.action === 'task.complete' && entry.id === taskId && entry.detail?.beforeStatus) {
        found = entry.detail.beforeStatus
      }
    } catch {
      /* 跳过坏行 */
    }
  }
  return found
}

/* ---------------------------------------------------------------------------
 * 写（单写者：模块级 promise 链串行化 + 原子写 + 审计）
 * ------------------------------------------------------------------------- */

let writeChain = Promise.resolve()

/** 串行执行写入任务 */
function serialize(task) {
  const run = writeChain.then(task, task)
  // 防止一次失败中断后续队列
  writeChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

/** 校验 + 原子写 + 审计（唯一写入入口） */
export function commit(kind, record, audit) {
  return serialize(async () => {
    const schema = SCHEMAS[kind]
    if (!schema) throw new Error(`未知实体类型：${kind}`)
    const parsed = schema.parse(record)
    const file = path.join(DATA_DIR, kind, `${parsed.id}.json`)
    await writeFileAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8' })
    if (audit) await appendActivity(audit)
    return parsed
  })
}

/** 删除实体文件 + 审计（仅用于撤销澄清产生的实体） */
export function remove(kind, id, audit) {
  return serialize(async () => {
    const schema = SCHEMAS[kind]
    if (!schema) throw new Error(`未知实体类型：${kind}`)
    const file = path.join(DATA_DIR, kind, `${id}.json`)
    await fs.unlink(file)
    if (audit) await appendActivity(audit)
  })
}

async function appendActivity(entry) {
  const line = `${JSON.stringify({ ts: nowIso(), ...entry })}\n`
  await fs.appendFile(ACTIVITY_FILE, line, 'utf8')
}

/** 下一个顺序 id：t-0001 → t-0002（扫描目录取最大值 +1） */
export async function nextId(kind) {
  const prefix = { tasks: 't', inbox: 'i', notes: 'n', resources: 'r', projects: 'p' }[kind]
  if (!prefix) throw new Error(`未知实体类型：${kind}`)
  const list = await readKind(kind)
  let max = 0
  for (const record of list) {
    const match = /-(\d+)$/.exec(String(record.id))
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}-${String(max + 1).padStart(4, '0')}`
}
