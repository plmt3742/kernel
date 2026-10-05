// KERNEL · 数据服务 · 存储层（单写者 · 原子写 · 审计日志）
// 纪律：所有写入串行化（写队列）；写前 Zod 校验；原子写入（write-file-atomic）；
//       每次变更追加 data/activity.jsonl 审计条目。绝不删除非目标文件。
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import writeFileAtomic from 'write-file-atomic'
import { SCHEMAS, tagRegistrySchema } from './schemas.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = path.join(ROOT, 'data')
const ACTIVITY_FILE = path.join(DATA_DIR, 'activity.jsonl')
/** 回收站目录：data/trash/<kind>/<id>.json（记录 + trashedAt；见 ADR-0009） */
export const TRASH_DIR = path.join(DATA_DIR, 'trash')
/** 标签注册表（v0.5 · Slice T）：data/meta/tags.json */
const TAGS_FILE = path.join(DATA_DIR, 'meta', 'tags.json')
/** 应用配置（v0.5 · Slice R2）：data/meta/config.json（含 aiAutomation 档位） */
const CONFIG_FILE = path.join(DATA_DIR, 'meta', 'config.json')
/** 学期信息（v0.5 · Slice H0）：data/meta/term.json（缺失 = 未设置学期） */
const TERM_FILE = path.join(DATA_DIR, 'meta', 'term.json')
/** 带 tags 数组、参与标签级联 / 计数 / 登记的实体目录（events 只读但同样级联，见 ADR-0014） */
const TAG_ENTITY_KINDS = ['tasks', 'projects', 'notes', 'resources', 'events', 'traces']
/** 可回收实体类型（与 index.mjs 路由白名单一致；Slice X 增 areas / goals / habits；Slice H0 增 courses；「踪迹」增 traces） */
const TRASH_KINDS = ['tasks', 'projects', 'notes', 'resources', 'events', 'traces', 'areas', 'goals', 'habits', 'courses']

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

const KINDS = ['tasks', 'inbox', 'projects', 'areas', 'goals', 'habits', 'events', 'traces', 'notes', 'resources', 'reviews', 'courses']

async function readJson(file) {
  const raw = await fs.readFile(file, 'utf8')
  return JSON.parse(raw)
}

/** 读取指定目录全部记录（目录不存在返回 []；不做排序） */
async function readDirRecords(dir) {
  let names
  try {
    names = await fs.readdir(dir)
  } catch {
    return []
  }
  const records = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      records.push(await readJson(path.join(dir, name)))
    } catch {
      /* 文件在 readdir 与 readFile 之间被删除 / 损坏：跳过（并发读竞态防护） */
    }
  }
  return records
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
    try {
      records.push(await readJson(path.join(dir, name)))
    } catch {
      /* 文件在 readdir 与 readFile 之间被删除 / 损坏：跳过（并发读竞态防护） */
    }
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
  // 配置 / 标签注册表缺失或损坏：静默降级（与 readTerm 同口径），避免快照整体 500
  let config
  try {
    config = await readJson(CONFIG_FILE)
  } catch {
    config = { name: 'KERNEL', owner: '', version: '', locale: 'zh-CN', weekStart: 'monday', createdAt: '' }
  }
  let tagRegistry = { tags: [] }
  try {
    const parsed = await readJson(path.join(DATA_DIR, 'meta', 'tags.json'))
    if (Array.isArray(parsed?.tags)) tagRegistry = parsed
  } catch {
    /* 视作空注册表 */
  }
  return {
    inbox: byKind.inbox,
    tasks: byKind.tasks,
    projects: byKind.projects,
    areas: byKind.areas,
    goals: byKind.goals,
    habits: byKind.habits,
    events: byKind.events,
    traces: byKind.traces,
    notes: byKind.notes,
    resources: byKind.resources,
    reviews: byKind.reviews,
    courses: byKind.courses,
    term: await readTerm(),
    config,
    tags: tagRegistry.tags ?? [],
  }
}

/**
 * 读取应用配置（meta/config.json；缺失 / 损坏返回 null）。
 * 含 v0.5 · Slice R2 的 aiAutomation 档位（缺省由前端视作 'confirm'）。
 */
export async function readConfig() {
  try {
    return await readJson(CONFIG_FILE)
  } catch {
    return null
  }
}

/**
 * 更新应用配置（v0.5 · Slice R2，见 ADR-0016）：白名单仅 aiAutomation；
 * 合并保留既有字段，原子写 + 审计 config.update（detail.fields 记录实际改动键）。
 * 值非法（非 confirm / auto）→ 400。返回新配置。
 */
export function updateConfig(patch) {
  return serialize(async () => {
    let current
    try {
      current = await readJson(CONFIG_FILE)
    } catch {
      throw Object.assign(new Error('配置文件不存在'), { status: 500 })
    }
    const next = { ...current }
    const fields = []
    const value = patch?.aiAutomation
    if (value !== 'confirm' && value !== 'auto') {
      throw Object.assign(new Error('aiAutomation 必须为 confirm 或 auto'), { status: 400 })
    }
    if (next.aiAutomation !== value) {
      next.aiAutomation = value
      fields.push('aiAutomation')
    }
    await writeFileAtomic(CONFIG_FILE, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8' })
    await appendActivity({
      action: 'config.update',
      entity: 'config',
      id: '-',
      detail: { fields },
    })
    return next
  })
}

/**
 * 读取学期信息（v0.5 · Slice H0，见 docs/04）：data/meta/term.json；
 * 文件缺失 / 损坏 → null（前端视作「学期未设置」）。
 */
export async function readTerm() {
  try {
    return await readJson(TERM_FILE)
  } catch {
    return null
  }
}

/**
 * 更新学期信息（v0.5 · Slice H0）：只合并 startDate / totalWeeks（白名单外忽略）；
 * 文件缺失从 {} 起（首次设置）；startDate 格式非法或 totalWeeks 越界 → 400 中文可读。
 * 原子写 + 审计 term.update（detail.fields 记录实际改动键；两者皆缺省 = 空审计）。返回新对象。
 */
export function updateTerm(patch) {
  return serialize(async () => {
    let current = {}
    try {
      current = await readJson(TERM_FILE)
    } catch {
      current = {}
    }
    const next = { ...current }
    const fields = []
    if (patch?.startDate !== undefined) {
      const startDate = typeof patch.startDate === 'string' ? patch.startDate.trim() : ''
      if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
        throw Object.assign(new Error('学期开始日期须为 YYYY-MM-DD 格式'), { status: 400 })
      }
      if (next.startDate !== startDate) {
        next.startDate = startDate
        fields.push('startDate')
      }
    }
    if (patch?.totalWeeks !== undefined) {
      const totalWeeks = patch.totalWeeks
      if (!Number.isInteger(totalWeeks) || totalWeeks < 1 || totalWeeks > 30) {
        throw Object.assign(new Error('学期周数须为 1–30 的整数'), { status: 400 })
      }
      if (next.totalWeeks !== totalWeeks) {
        next.totalWeeks = totalWeeks
        fields.push('totalWeeks')
      }
    }
    next.updatedAt = nowIso()
    await writeFileAtomic(TERM_FILE, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8' })
    await appendActivity({
      action: 'term.update',
      entity: 'term',
      id: '-',
      detail: { fields },
    })
    return next
  })
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
    // 父目录可能不存在（新实体首写等）——先建目录再原子写（Slice H0 QA 修复）
    await fs.mkdir(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8' })
    // 审计自描述（Slice S）：并入记录标题，供回顾页渲染人类可读时间线；不覆盖既有 detail 键
    if (audit) {
      const detail = { ...(audit.detail ?? {}) }
      if (typeof parsed.title === 'string' && parsed.title !== '') detail.title = parsed.title
      await appendActivity({ ...audit, detail })
    }
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

/* ---------------------------------------------------------------------------
 * 标签生命周期（v0.5 · Slice T，见 ADR-0014）
 * 口径：标签名规格化（裸名 → topic: 前缀；@ → context；role:/topic:/context: 保留）；
 *       ensureTags 在任意携带 tags 的写入后把未注册名登记进 data/meta/tags.json；
 *       backfillTags 扫描存量补齐；rename / merge / remove 为管理操作（级联重写实体 tags）。
 * 纪律：全部走 serialize 串行队列；登记沿用原子写 + 审计（tag.create / tag.backfill /
 *       tag.rename / tag.merge / tag.remove）；级联只改 tags 数组，**不 bump updatedAt**，
 *       以免污染停滞项目 / 回顾指标的「最近活动」口径。绝不静默丢弃实体上的标签。
 * ------------------------------------------------------------------------- */

const TAG_NAMESPACES = new Set(['role', 'context', 'topic'])

/** 标签名规格化：trim + 折叠空白 → 统一命名空间形式；空 / 非法返回 null */
export function normalizeTagName(raw) {
  if (typeof raw !== 'string') return null
  const name = raw.trim().replace(/\s+/g, ' ')
  if (name === '') return null
  if (name.startsWith('@')) {
    const rest = name.slice(1).trim()
    return rest === '' ? null : `@${rest}`
  }
  const colon = name.indexOf(':')
  if (colon > 0) {
    const ns = name.slice(0, colon).toLowerCase()
    const rest = name.slice(colon + 1).trim()
    if (rest === '') return null
    if (TAG_NAMESPACES.has(ns)) return `${ns}:${rest}`
    return `topic:${name}`
  }
  return `topic:${name}`
}

/** 由标签名推断命名空间（@ → context；合法前缀 → 该 ns；其余 → topic） */
export function tagNamespaceOf(name) {
  if (name.startsWith('@')) return 'context'
  const colon = name.indexOf(':')
  if (colon > 0) {
    const ns = name.slice(0, colon)
    if (TAG_NAMESPACES.has(ns)) return ns
  }
  return 'topic'
}

/** 标签展示名（去命名空间前缀；@ 保留原文） */
export function tagLabelOf(name) {
  if (name.startsWith('@')) return name
  const colon = name.indexOf(':')
  return colon >= 0 ? name.slice(colon + 1) : name
}

/** 数组规格化：逐项 normalize + 去重 + 上限长度；非数组返回 [] */
export function normalizeTagList(rawList) {
  if (!Array.isArray(rawList)) return []
  const seen = new Set()
  const out = []
  for (const raw of rawList) {
    const name = normalizeTagName(raw)
    if (name === null || name.length > 64 || seen.has(name)) continue
    seen.add(name)
    out.push(name)
  }
  return out
}

/** 读标签注册表（缺失 / 损坏 → { tags: [] }） */
async function readTagRegistryFile() {
  try {
    const parsed = await readJson(TAGS_FILE)
    return Array.isArray(parsed?.tags) ? parsed : { tags: [] }
  } catch {
    return { tags: [] }
  }
}

/** 注册表 id 生成器：扫描最大值 +1（tag-001 → tag-002） */
function tagIdFactory(tags) {
  let max = 0
  for (const item of tags) {
    const match = /^tag-(\d+)$/.exec(String(item.id))
    if (match) max = Math.max(max, Number(match[1]))
  }
  return () => {
    max += 1
    return `tag-${String(max).padStart(3, '0')}`
  }
}

/**
 * 登记缺失标签（不串行、不审计——供 ensureTags / backfillTags 在各自队列任务内复用）。
 * @param {string[]} rawNames 原始标签名数组
 * @param {{ origin?: 'seed'|'manual'|'ai', firstUsedIn?: string, firstUsedInMap?: Record<string,string> }} opts
 * @returns {Promise<Array>} 新建的注册项
 */
async function ensureTagsInner(rawNames, { origin = 'manual', firstUsedIn, firstUsedInMap } = {}) {
  const wanted = normalizeTagList(rawNames)
  if (wanted.length === 0) return []
  const reg = await readTagRegistryFile()
  const tags = [...(reg.tags ?? [])]
  const existing = new Set(tags.map((item) => item.name))
  const nextTagId = tagIdFactory(tags)
  const createdAt = nowIso()
  const created = []
  for (const name of wanted) {
    if (existing.has(name)) continue
    const item = {
      id: nextTagId(),
      name,
      namespace: tagNamespaceOf(name),
      label: tagLabelOf(name),
      origin,
      createdAt,
    }
    const used = (firstUsedInMap !== undefined ? firstUsedInMap[name] : undefined) ?? firstUsedIn
    if (typeof used === 'string' && used !== '') item.firstUsedIn = used
    tags.push(item)
    existing.add(name)
    created.push(item)
  }
  if (created.length === 0) return []
  const parsed = tagRegistrySchema.parse({ tags })
  await writeFileAtomic(TAGS_FILE, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8' })
  return created
}

/**
 * 「录入即生成」：任意写入携带 tags 后调用——把未注册名登记进注册表并审计 tag.create。
 * @param {string[]} names 标签名数组
 * @param {{ origin?: 'seed'|'manual'|'ai', firstUsedIn?: string }} [opts]
 */
export function ensureTags(names, opts) {
  return serialize(async () => {
    const created = await ensureTagsInner(names, opts)
    for (const item of created) {
      await appendActivity({
        action: 'tag.create',
        entity: 'tag',
        id: item.id,
        detail: { name: item.name, origin: item.origin },
      })
    }
    return created
  })
}

/** 扫描全部实体上出现但未注册的标签名并登记（origin 'manual'，firstUsedIn 取首个使用实体） */
export function backfillTags() {
  return serialize(async () => {
    const firstUsed = new Map()
    for (const kind of TAG_ENTITY_KINDS) {
      const records = await readKind(kind)
      for (const record of records) {
        const list = Array.isArray(record.tags) ? record.tags : []
        for (const raw of list) {
          const name = normalizeTagName(raw)
          if (name !== null && !firstUsed.has(name)) firstUsed.set(name, record.id)
        }
      }
    }
    const reg = await readTagRegistryFile()
    const existing = new Set((reg.tags ?? []).map((item) => item.name))
    const missing = [...firstUsed.keys()].filter((name) => !existing.has(name))
    if (missing.length === 0) return { created: [], scanned: firstUsed.size }
    const created = await ensureTagsInner(missing, {
      origin: 'manual',
      firstUsedInMap: Object.fromEntries(firstUsed),
    })
    for (const item of created) {
      await appendActivity({
        action: 'tag.create',
        entity: 'tag',
        id: item.id,
        detail: { name: item.name, origin: item.origin, backfill: true },
      })
    }
    await appendActivity({
      action: 'tag.backfill',
      entity: 'tag',
      id: '-',
      detail: { created: created.length, scanned: firstUsed.size },
    })
    return { created, scanned: firstUsed.size }
  })
}

/** 级联重写实体 tags 数组（oldName → newName，去重；不 bump updatedAt）；返回受影响记录数 */
async function rewriteTagsAcrossEntities(oldName, newName) {
  let affected = 0
  for (const kind of TAG_ENTITY_KINDS) {
    const dir = path.join(DATA_DIR, kind)
    let names
    try {
      names = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const file of names) {
      if (!file.endsWith('.json')) continue
      const filePath = path.join(dir, file)
      let record
      try {
        record = JSON.parse(await fs.readFile(filePath, 'utf8'))
      } catch {
        continue
      }
      if (!Array.isArray(record.tags) || !record.tags.includes(oldName)) continue
      const seen = new Set()
      record.tags = record.tags
        .map((tag) => (tag === oldName ? newName : tag))
        .filter((tag) => {
          if (seen.has(tag)) return false
          seen.add(tag)
          return true
        })
      await writeFileAtomic(filePath, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8' })
      affected += 1
    }
  }
  return affected
}

/** 统计某标签名在实体 tags 中出现的记录数（一个实体计一次） */
async function countTagUsage(name) {
  let count = 0
  for (const kind of TAG_ENTITY_KINDS) {
    const records = await readKind(kind)
    for (const record of records) {
      if (Array.isArray(record.tags) && record.tags.includes(name)) count += 1
    }
  }
  return count
}

/**
 * 重命名标签：更新注册表 name / label / namespace，并级联重写全部实体 tags。
 * 目标名与其它标签冲突 → 409（提示改用合并）。
 */
export function renameTag(id, { name, label } = {}) {
  return serialize(async () => {
    const reg = await readTagRegistryFile()
    const tags = [...(reg.tags ?? [])]
    const tag = tags.find((item) => item.id === id)
    if (tag === undefined) throw Object.assign(new Error('标签不存在'), { status: 404 })
    const newName = name === undefined ? tag.name : normalizeTagName(name)
    if (newName === null) throw Object.assign(new Error('标签名不能为空'), { status: 400 })
    if (tags.some((item) => item.name === newName && item.id !== id)) {
      throw Object.assign(new Error('已存在同名标签，请改用「合并」'), { status: 409 })
    }
    const oldName = tag.name
    const nextLabel =
      typeof label === 'string' && label.trim() !== '' ? label.trim() : tagLabelOf(newName)
    const changed = newName !== oldName
    tag.name = newName
    tag.label = nextLabel
    tag.namespace = tagNamespaceOf(newName)
    const affected = changed ? await rewriteTagsAcrossEntities(oldName, newName) : 0
    const parsed = tagRegistrySchema.parse({ tags })
    await writeFileAtomic(TAGS_FILE, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8' })
    await appendActivity({
      action: 'tag.rename',
      entity: 'tag',
      id,
      detail: { from: oldName, to: newName, affected },
    })
    return { tag, affected }
  })
}

/** 合并标签：source 名在全部实体上替换为 target 名（去重），source 从注册表移除 */
export function mergeTags(sourceId, targetId) {
  return serialize(async () => {
    const reg = await readTagRegistryFile()
    const tags = [...(reg.tags ?? [])]
    const source = tags.find((item) => item.id === sourceId)
    const target = tags.find((item) => item.id === targetId)
    if (source === undefined || target === undefined) {
      throw Object.assign(new Error('标签不存在'), { status: 404 })
    }
    if (source.id === target.id) throw Object.assign(new Error('不能合并到自身'), { status: 400 })
    const affected = await rewriteTagsAcrossEntities(source.name, target.name)
    const nextTags = tags.filter((item) => item.id !== sourceId)
    const parsed = tagRegistrySchema.parse({ tags: nextTags })
    await writeFileAtomic(TAGS_FILE, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8' })
    await appendActivity({
      action: 'tag.merge',
      entity: 'tag',
      id: sourceId,
      detail: { from: source.name, to: target.name, targetId, affected },
    })
    return { tag: target, affected }
  })
}

/** 删除标签：使用中（usage>0）→ 409 阻止（不静默剥离实体标签）；未使用则从注册表移除 */
export function removeTag(id) {
  return serialize(async () => {
    const reg = await readTagRegistryFile()
    const tags = [...(reg.tags ?? [])]
    const tag = tags.find((item) => item.id === id)
    if (tag === undefined) throw Object.assign(new Error('标签不存在'), { status: 404 })
    const usage = await countTagUsage(tag.name)
    if (usage > 0) {
      throw Object.assign(
        new Error(`该标签正被 ${usage} 条记录使用，不能删除；请先合并到其他标签，或移除实体上的该标签`),
        { status: 409 },
      )
    }
    const nextTags = tags.filter((item) => item.id !== id)
    const parsed = tagRegistrySchema.parse({ tags: nextTags })
    await writeFileAtomic(TAGS_FILE, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8' })
    await appendActivity({
      action: 'tag.remove',
      entity: 'tag',
      id,
      detail: { name: tag.name },
    })
    return { removed: { id } }
  })
}

/**
 * 撤销一揽子应用时清理「本次新建的标签」（Slice R1）：仅删除传入 id 且当前 0 使用者的标签。
 * 已被其它记录使用 → 保留（不破坏数据）；级联审计 tag.remove（detail.via 标记来源）。
 * @param {string[]} ids 应用时新登记的标签 id
 * @param {{ via?: string }} [options] 审计 detail.via（缺省 'inbox.unapply'，保持旧行为）
 * @returns {Promise<Array>} 实际移除的注册项
 */
export function pruneTags(ids, { via } = {}) {
  const viaTag = typeof via === 'string' && via !== '' ? via : 'inbox.unapply'
  return serialize(async () => {
    const wanted = new Set((Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string'))
    if (wanted.size === 0) return []
    const reg = await readTagRegistryFile()
    const tags = [...(reg.tags ?? [])]
    const removed = []
    for (const id of wanted) {
      const index = tags.findIndex((item) => item.id === id)
      if (index === -1) continue
      const tag = tags[index]
      const usage = await countTagUsage(tag.name)
      if (usage > 0) continue
      tags.splice(index, 1)
      removed.push(tag)
      await appendActivity({
        action: 'tag.remove',
        entity: 'tag',
        id,
        detail: { name: tag.name, via: viaTag },
      })
    }
    if (removed.length === 0) return []
    const parsed = tagRegistrySchema.parse({ tags })
    await writeFileAtomic(TAGS_FILE, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8' })
    return removed
  })
}

/* ---------------------------------------------------------------------------
 * 回收站（v0.5 · Slice E2）：data/trash/<kind>/<id>.json（原记录 + trashedAt）
 * 纪律：先写副本再删原件；恢复先写回再删副本；全部走 serialize 串行队列。
 * ------------------------------------------------------------------------- */

/** 移入回收站：写副本（含 trashedAt）→ 删原文件；原记录不存在抛 404 */
export function moveToTrash(kind, id, audit) {
  return serialize(async () => {
    if (!SCHEMAS[kind]) throw new Error(`未知实体类型：${kind}`)
    const source = path.join(DATA_DIR, kind, `${id}.json`)
    let record
    try {
      record = await readJson(source)
    } catch {
      throw Object.assign(new Error('记录不存在'), { status: 404 })
    }
    const trashed = { ...record, trashedAt: nowIso() }
    const trashFile = path.join(TRASH_DIR, kind, `${id}.json`)
    await fs.mkdir(path.dirname(trashFile), { recursive: true })
    await writeFileAtomic(trashFile, `${JSON.stringify(trashed, null, 2)}\n`, { encoding: 'utf8' })
    await fs.unlink(source)
    // 审计自描述（Slice S）：并入记录标题（record 已读）；不覆盖既有 detail 键
    if (audit) {
      const detail = { ...(audit.detail ?? {}) }
      if (typeof record.title === 'string' && record.title !== '') detail.title = record.title
      await appendActivity({ ...audit, detail })
    }
    return trashed
  })
}

/** 从回收站恢复：写回原目录（去除 trashedAt，经 schema 校验）→ 删副本；副本不存在抛 404 */
export function restoreFromTrash(kind, id, audit) {
  return serialize(async () => {
    const schema = SCHEMAS[kind]
    if (!schema) throw new Error(`未知实体类型：${kind}`)
    const trashFile = path.join(TRASH_DIR, kind, `${id}.json`)
    let trashed
    try {
      trashed = await readJson(trashFile)
    } catch {
      throw Object.assign(new Error('回收站中不存在该记录'), { status: 404 })
    }
    const record = { ...trashed }
    delete record.trashedAt
    const parsed = schema.parse(record)
    const file = path.join(DATA_DIR, kind, `${parsed.id}.json`)
    // 父目录可能不存在（目录被清 / 新实体）——先建目录再写回（Slice H0 QA 修复）
    await fs.mkdir(path.dirname(file), { recursive: true })
    await writeFileAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`, { encoding: 'utf8' })
    await fs.unlink(trashFile)
    // 审计自描述（Slice S）：并入记录标题（parsed 已校验）；不覆盖既有 detail 键
    if (audit) {
      const detail = { ...(audit.detail ?? {}) }
      if (typeof parsed.title === 'string' && parsed.title !== '') detail.title = parsed.title
      await appendActivity({ ...audit, detail })
    }
    return parsed
  })
}

/** 彻底删除回收站记录；副本不存在抛 404 */
export function purgeTrash(kind, id, audit) {
  return serialize(async () => {
    if (!SCHEMAS[kind]) throw new Error(`未知实体类型：${kind}`)
    const trashFile = path.join(TRASH_DIR, kind, `${id}.json`)
    try {
      await fs.unlink(trashFile)
    } catch {
      throw Object.assign(new Error('回收站中不存在该记录'), { status: 404 })
    }
    if (audit) await appendActivity(audit)
  })
}

/** 回收站列表：全部 { kind, record }，按 trashedAt 倒序 */
export async function readTrash() {
  const groups = await Promise.all(
    TRASH_KINDS.map(async (kind) => {
      const records = await readDirRecords(path.join(TRASH_DIR, kind))
      return records.map((record) => ({ kind, record }))
    }),
  )
  return groups
    .flat()
    .sort((a, b) =>
      String(b.record.trashedAt ?? '').localeCompare(String(a.record.trashedAt ?? '')),
    )
}

async function appendActivity(entry) {
  const line = `${JSON.stringify({ ts: nowIso(), ...entry })}\n`
  await fs.appendFile(ACTIVITY_FILE, line, 'utf8')
}

/**
 * 已分配但可能尚未落盘的 id 水位（防并发分配撞号）。
 * 背景：nextId 与随后的 commit 是两次独立调用；两个并发创建可能在各自落盘前拿到同一 id，
 * 后者覆盖前者。此处让 nextId 在返回前同步抬高水位（读-改-写之间无 await，单线程下原子），
 * 与文件扫描取最大值，保证连续分配不重复。
 */
const reservedMax = new Map()

/** 下一个顺序 id：t-0001 → t-0002（扫描目录 + 回收站取最大值 +1，防回收后 id 复用；含在途水位） */
export async function nextId(kind) {
  const prefix = {
    tasks: 't',
    inbox: 'i',
    notes: 'n',
    resources: 'r',
    projects: 'p',
    areas: 'a',
    goals: 'g',
    habits: 'h',
    reviews: 'rev',
    events: 'e',
    traces: 'tr',
    courses: 'c',
  }[kind]
  if (!prefix) throw new Error(`未知实体类型：${kind}`)
  const list = await readKind(kind)
  const trashed = await readDirRecords(path.join(TRASH_DIR, kind))
  let max = reservedMax.get(kind) ?? 0
  for (const record of [...list, ...trashed]) {
    const match = /-(\d+)$/.exec(String(record.id))
    if (match) max = Math.max(max, Number(match[1]))
  }
  const next = max + 1
  reservedMax.set(kind, next)
  return `${prefix}-${String(next).padStart(4, '0')}`
}
