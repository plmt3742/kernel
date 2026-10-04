// KERNEL · 数据服务 · HTTP 入口（唯一写入路径）
// 只监听 127.0.0.1:4097（永不暴露局域网；浏览器经 Vite 代理访问）。
// 路由：health / snapshot / activity / tasks(create·complete·reopen) / inbox(capture·clarify·revert)
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import {
  backfillTags,
  commit,
  DATA_DIR,
  ensureTags,
  lastCompleteStatus,
  mergeTags,
  moveToTrash,
  nextId,
  normalizeTagList,
  nowIso,
  pruneTags,
  purgeTrash,
  readActivity,
  readEntity,
  readSnapshot,
  readTerm,
  readTrash,
  remove,
  removeTag,
  renameTag,
  restoreFromTrash,
  updateConfig,
  updateTerm,
} from './store.mjs'
import {
  areaCreateSchema,
  chatNoteRequestSchema,
  clarifyDetailsSchema,
  clusterApplySchema,
  clusterUnapplySchema,
  configUpdateSchema,
  courseCreateSchema,
  coursesImportSchema,
  goalCreateSchema,
  habitCheckinSchema,
  habitCreateSchema,
  ID_PATTERNS,
  inboxApplySchema,
  normalizeCourseSessions,
  noteDistillRequestSchema,
  organizeApplySchema,
  organizeDraftSchema,
  organizeUnapplySchema,
  resourceCreateSchema,
  taskCreateFieldsSchema,
  tagMergeSchema,
  tagUpdateSchema,
  termUpdateSchema,
} from './schemas.mjs'
import {
  CHAT_MAX_CHARS,
  CHAT_MAX_MESSAGES,
  CHAT_TOTAL_CHARS,
  chatWithKernel,
  computeMonthMetrics,
  computeWeekMetrics,
  draftChatNote,
  draftClusters,
  draftNoteDistill,
  draftOrganize,
  draftProject,
  draftTask,
  draftTimetable,
  draftTimetableStream,
  generateReviewDraft,
  getAiHealth,
  isImageFile,
  isoWeekKey,
  monthKey,
  OPEN_TASK_STATUS,
  ORGANIZE_PROJECT_STATUS,
  parseInboxItem,
  parseInboxItemStream,
  PROJECT_DRAFT_MAX_TITLE_CHARS,
  staleProjects,
  TASK_DRAFT_MAX_TITLE_CHARS,
} from './ai.mjs'
// 本机凭据（v0.5 · Slice N5）：只读 / 写 data/meta/secrets.json（gitignore，绝不入库）
import { getDeepseekKey, setDeepseekKey } from './secrets.mjs'

const HOST = '127.0.0.1'
const PORT = 4097
const BODY_LIMIT = 256 * 1024
const SERVICE_VERSION = '0.4.0'
/** 文件投递单文件上限（RAW body；超出即 413 并中断请求） */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
/** 长截图 AI 分片上限（RAW body；每片为前端切好的 JPEG） */
const MAX_PREVIEW_BYTES = 4 * 1024 * 1024
/** 附件二进制目录（不进 git；见 ADR-0008） */
const FILES_DIR = path.join(DATA_DIR, 'files')

/** 澄清目标 → 实体 kind */
const CLARIFY_KINDS = { task: 'tasks', project: 'projects', note: 'notes', resource: 'resources' }

/** 可编辑 / 可回收的实体 kind 白名单（通用 /update · /trash 路由；areas/goals/habits 走专属路由；Slice H0 增 courses） */
const EDITABLE_KINDS = ['tasks', 'projects', 'notes', 'resources', 'events', 'courses']
/** 可回收实体 kind（Slice X：areas / goals / habits 亦可恢复 / 彻底删除；回收站路由组） */
const TRASHABLE_KINDS = [...EDITABLE_KINDS, 'areas', 'goals', 'habits']
/** kind → 审计用单数名 */
const SINGULAR = {
  tasks: 'task',
  projects: 'project',
  notes: 'note',
  resources: 'resource',
  events: 'event',
  areas: 'area',
  goals: 'goal',
  habits: 'habit',
  courses: 'course',
}
/** 无 createdAt / updatedAt 的实体（对齐既有形状；编辑时不 bump updatedAt） */
const NO_TIMESTAMP_KINDS = new Set(['events', 'areas', 'goals', 'habits'])
/** 任务创建可携带的可选字段顺序（Slice O；用于审计 detail.fields） */
const CREATE_FIELD_KEYS = [
  'contexts', 'energy', 'importance', 'estimateMin', 'dueAt', 'projectId', 'areaId', 'parentTaskId', 'tags',
]
/** 各 kind 允许编辑的字段白名单（其余一律忽略，见 ADR-0009） */
const EDITABLE_FIELDS = {
  tasks: [
    'title', 'status', 'contexts', 'energy', 'importance', 'estimateMin',
    'dueAt', 'deferUntil', 'projectId', 'areaId', 'parentTaskId', 'tags', 'notes',
  ],
  projects: ['title', 'outcome', 'status', 'areaId', 'goalId', 'nextActionId', 'dueAt', 'tags'],
  notes: ['title', 'type', 'body', 'areaId', 'projectId', 'tags', 'distillLevel'],
  resources: ['title', 'kind', 'status', 'url', 'path', 'areaId', 'tags', 'note'],
  // 日程（Slice W）：repeatRule 仅展示保留，不开放编辑（见 ADR-0018）
  events: ['title', 'startAt', 'endAt', 'allDay', 'location', 'status', 'projectId', 'areaId', 'tags', 'notes'],
  // 区域 / 目标 / 习惯（Slice X，见 ADR-0019）：字段白名单；keyResults 不开放编辑（写入延后）
  areas: ['title', 'standard', 'cadence', 'status'],
  goals: ['title', 'horizon', 'areaId', 'status', 'targetDate'],
  habits: ['title', 'cadence', 'metric', 'target', 'trigger', 'areaId'],
  // 课程（Slice H0）：sessions 走 normalizeCourseSessions 交叉校验（≥1 且 end ≥ start）
  courses: ['title', 'teacher', 'location', 'sessions', 'notes'],
}

/** AI Key 保存入参（Slice N5）：非空 = 保存，trim 后为空 = 清除；上限 300 字符 */
const aiKeyUpdateSchema = z.object({ apiKey: z.string().max(300) })

function send(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(body)
}

function fail(res, status, message) {
  send(res, status, { error: message })
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > BODY_LIMIT) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (raw.trim() === '') return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON'))
      }
    })
    req.on('error', reject)
  })
}

/**
 * 追加审计条目（Slice N5）：secrets 模块刻意无副作用，故由服务端在本机凭据写入后
 * 追加一条 ai.key.update —— detail 只记 hasKey，**绝不落 key 明文**。
 */
async function recordAudit(entry) {
  const line = `${JSON.stringify({ ts: nowIso(), ...entry })}\n`
  await fs.appendFile(path.join(DATA_DIR, 'activity.jsonl'), line, 'utf8')
}

/** id 形状校验（防目录穿越；不匹配即 400） */
function validId(kind, id) {
  const pattern = ID_PATTERNS[kind]
  return pattern !== undefined && pattern.test(id)
}

/* ---------------------------------------------------------------------------
 * AI 对话 · 修改建议（只读）：把模型给出的 edit 请求校验为前端可确认的 edits 数组。
 * 服务端**不写入、不审计**——仅在用户于前端确认后走既有 /update 路径落盘。
 * ------------------------------------------------------------------------- */

/** 修改建议单数 kind → 复数集合键 */
const CHAT_EDIT_PLURAL = {
  task: 'tasks',
  event: 'events',
  note: 'notes',
  resource: 'resources',
  project: 'projects',
  area: 'areas',
  goal: 'goals',
  habit: 'habits',
  course: 'courses',
}

/** 允许随建议下发的字段值类型：字符串 / 数字 / 布尔 / null / 字符串数组 */
function isEditableFieldValue(value) {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return true
  if (value === null) return true
  if (Array.isArray(value)) return value.every((v) => typeof v === 'string')
  return false
}

/**
 * 校验并转换 AI 修改建议：kind/id 真实存在 + fields 过 EDITABLE_FIELDS 白名单 + 值类型合法。
 * 任一步不合法返回 []（调用方据此回退文案）。始终返回数组（0 或 1 项）。
 */
async function buildChatEdits(editRequest) {
  const plural = CHAT_EDIT_PLURAL[editRequest?.kind]
  if (plural === undefined) return []
  const allowed = EDITABLE_FIELDS[plural]
  if (!Array.isArray(allowed)) return []
  const id = editRequest.id
  if (typeof id !== 'string' || !validId(plural, id)) return []
  const record = await readEntity(plural, id)
  if (record === null) return []
  const fields = {}
  for (const [key, value] of Object.entries(editRequest.fields ?? {})) {
    if (!allowed.includes(key)) continue
    if (!isEditableFieldValue(value)) continue
    fields[key] = value
  }
  if (Object.keys(fields).length === 0) return []
  const before = {}
  for (const key of Object.keys(fields)) {
    before[key] = record[key] === undefined ? null : record[key]
  }
  const label = typeof editRequest.label === 'string' ? editRequest.label : ''
  return [{ kind: plural, id, title: record.title ?? '', fields, before, label }]
}

/* ---------------------------------------------------------------------------
 * 文件投递（v0.5 · Slice D）：RAW body 流式落盘 + 附件读取（见 ADR-0008）
 * ------------------------------------------------------------------------- */

/** 文件名清洗：basename → 非法字符替换 → trim → 截断（保留扩展名）→ 兜底 'file' */
function sanitizeFilename(raw) {
  const base = path.basename(typeof raw === 'string' ? raw : '')
  const cleaned = base.replace(/[\\/:*?"<>|]/g, '_').trim()
  if (cleaned === '') return 'file'
  return capFilename(cleaned, 120)
}

/** 截断文件名至 max 字符（尽量保留扩展名；扩展名过长则整体截断） */
function capFilename(name, max) {
  if (name.length <= max) return name
  const dot = name.lastIndexOf('.')
  const hasExt = dot > 0 && name.length - dot <= 20
  const ext = hasExt ? name.slice(dot) : ''
  const stem = hasExt ? name.slice(0, dot) : name
  const stemMax = max - ext.length
  if (stemMax < 1) return name.slice(0, max)
  return `${stem.slice(0, stemMax)}${ext}`
}

/**
 * 流式写上传体到 dest；超过 maxBytes 立即暂停读取、拒绝 413 并销毁写流。
 * 返回写入字节数。上层负责删除残留文件。
 */
function saveUpload(req, dest, maxBytes) {
  return new Promise((resolve, reject) => {
    const ws = createWriteStream(dest)
    let size = 0
    let settled = false
    const settle = (fn, arg) => {
      if (settled) return
      settled = true
      req.removeAllListeners('data')
      req.removeAllListeners('end')
      fn(arg)
    }
    const onData = (chunk) => {
      size += chunk.length
      if (size > maxBytes) {
        req.pause()
        settle(reject, Object.assign(new Error('文件过大（上限 25MB）'), { status: 413 }))
        ws.destroy()
        return
      }
      if (!ws.write(chunk)) {
        req.pause()
        ws.once('drain', () => req.resume())
      }
    }
    const onError = (err) => {
      settle(reject, err)
      ws.destroy()
    }
    req.on('data', onData)
    req.on('end', () => ws.end())
    req.on('error', onError)
    ws.on('error', onError)
    ws.on('finish', () => settle(resolve, size))
  })
}

/** 文件投递：RAW body → data/files/<id>-<safeName> → 收件箱条目（source:'file'） */
async function uploadInbox(req, url) {
  const rawName = (url.searchParams.get('name') ?? '').trim()
  const type = (url.searchParams.get('type') ?? '').trim() || undefined
  const caption = (url.searchParams.get('caption') ?? '').trim()
  const safeName = sanitizeFilename(rawName)
  const id = await nextId('inbox')
  await fs.mkdir(FILES_DIR, { recursive: true })
  const dest = path.join(FILES_DIR, `${id}-${safeName}`)
  let size
  try {
    size = await saveUpload(req, dest, MAX_UPLOAD_BYTES)
  } catch (err) {
    // 写入失败 / 超限：清理半成品，错误交由全局处理器（413 / 500）
    await fs.unlink(dest).catch(() => {})
    throw err
  }
  const file = { name: safeName, size }
  if (type !== undefined) file.mime = type
  const item = {
    id,
    content: caption !== '' ? caption : rawName !== '' ? rawName : safeName,
    source: 'file',
    capturedAt: nowIso(),
    status: 'unprocessed',
    file,
  }
  const detail = { name: safeName, size }
  if (type !== undefined) detail.mime = type
  const saved = await commit('inbox', item, {
    action: 'inbox.upload',
    entity: 'inboxItem',
    id,
    detail,
  })
  return { inbox: saved }
}

/** 删除收件箱条目（含附件清理）；已澄清条目需先撤销澄清（防误删已联动实体） */
async function removeInbox(id) {
  const item = await readEntity('inbox', id)
  if (item === null) throw Object.assign(new Error('条目不存在'), { status: 404 })
  if (item.status === 'clarified') {
    throw Object.assign(new Error('已澄清条目请先撤销澄清'), { status: 409 })
  }
  // 清理该条目在 data/files 下的全部文件（原附件 + AI 长截图分片 <id>-ai-<n>.jpg），忽略错误
  const entries = await fs.readdir(FILES_DIR).catch(() => [])
  for (const name of entries) {
    if (name.startsWith(`${id}-`)) {
      await fs.unlink(path.join(FILES_DIR, name)).catch(() => {})
    }
  }
  await remove('inbox', id, { action: 'inbox.remove', entity: 'inboxItem', id })
  return { removed: { kind: 'inbox', id } }
}

/** 读取附件：流式 inline 返回（文件名为 RFC 5987 编码，兼容非 ASCII） */
async function serveFile(res, id) {
  const item = await readEntity('inbox', id)
  if (item === null || item.file === undefined || item.file === null) {
    return fail(res, 404, '文件不存在')
  }
  const filePath = path.join(FILES_DIR, `${id}-${item.file.name}`)
  let stat
  try {
    stat = await fs.stat(filePath)
  } catch {
    return fail(res, 404, '文件不存在')
  }
  res.writeHead(200, {
    'Content-Type': item.file.mime ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.file.name)}`,
  })
  createReadStream(filePath).pipe(res)
}


/* ---------------------------------------------------------------------------
 * 动作
 * ------------------------------------------------------------------------- */

/**
 * 校验父任务引用（v0.5 · Slice R3）：父任务必须真实存在，且不得引用自身 / 构成环。
 * 环检测沿 parentTaskId 祖先链上溯（守卫上限 = 任务数 + 1，防既有脏数据死循环）。
 * callerId 为当前任务 id；新建任务时传 null（尚不存在，自引用不可能）。
 * 校验失败抛 400（可读中文），由路由层统一转错误响应。
 */
async function assertValidParentTask(callerId, parentId) {
  if (typeof parentId !== 'string' || parentId.trim() === '') {
    throw Object.assign(new Error('父任务不存在'), { status: 400 })
  }
  if (callerId !== null && parentId === callerId) {
    throw Object.assign(new Error('任务不能作为自己的父任务'), { status: 400 })
  }
  const snapshot = await readSnapshot()
  const byId = new Map((snapshot.tasks ?? []).map((task) => [task.id, task]))
  if (!byId.has(parentId)) {
    throw Object.assign(new Error('父任务不存在'), { status: 400 })
  }
  let cursor = parentId
  let guard = 0
  while (cursor !== undefined && cursor !== null) {
    if (callerId !== null && cursor === callerId) {
      throw Object.assign(new Error('父任务会形成循环引用'), { status: 400 })
    }
    guard += 1
    if (guard > byId.size + 1) break
    const node = byId.get(cursor)
    cursor = node !== undefined ? node.parentTaskId : undefined
  }
}

/**
 * 创建任务（v0.5 · Slice O）：title 必填；可一次性携带「预览确认（含编辑）」后的字段。
 * 可选字段与澄清覆盖同口径（taskCreateFieldsSchema），关联 id 只接受真实存在的项目 / 区域；
 * 缺省字段维持既有默认（contexts ['@computer'] / energy 'low' / importance 2 / tags []）。
 * 仅传标题的旧调用行为不变（审计 detail.fields 为空数组）。
 */
async function createTask(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title === '') throw Object.assign(new Error('标题不能为空'), { status: 400 })
  const fields = taskCreateFieldsSchema.parse(body)
  // 标签规格化（裸名 → topic: 前缀等），保证实体与注册表 / 筛选条同名匹配（Slice T）
  const tags = normalizeTagList(fields.tags ?? [])
  const origin = fields.ai === true ? 'ai' : 'manual'
  const now = nowIso()
  const task = {
    id: await nextId('tasks'),
    title,
    status: 'next',
    contexts: fields.contexts ?? ['@computer'],
    energy: fields.energy ?? 'low',
    importance: fields.importance ?? 2,
    tags,
    createdAt: now,
    updatedAt: now,
  }
  if (fields.estimateMin !== undefined) task.estimateMin = fields.estimateMin
  if (fields.dueAt !== undefined) task.dueAt = fields.dueAt
  if (fields.projectId !== undefined) {
    if (!validId('projects', fields.projectId) || (await readEntity('projects', fields.projectId)) === null) {
      throw Object.assign(new Error('项目不存在'), { status: 400 })
    }
    task.projectId = fields.projectId
  }
  if (fields.areaId !== undefined) {
    if (!validId('areas', fields.areaId) || (await readEntity('areas', fields.areaId)) === null) {
      throw Object.assign(new Error('区域不存在'), { status: 400 })
    }
    task.areaId = fields.areaId
  }
  if (fields.parentTaskId !== undefined) {
    // Slice R3：新建任务的父任务必须存在（新建 id 尚不存在，故不可能成环 / 自引用）
    await assertValidParentTask(null, fields.parentTaskId)
    task.parentTaskId = fields.parentTaskId
  }
  const applied = CREATE_FIELD_KEYS.filter((key) => fields[key] !== undefined)
  const saved = await commit('tasks', task, {
    action: 'task.create',
    entity: 'task',
    id: task.id,
    detail: { title, fields: applied },
  })
  // 录入即生成：登记新标签（origin 'ai' 表示来自 AI 草稿确认）
  if (tags.length > 0) await ensureTags(tags, { origin, firstUsedIn: saved.id })
  return { task: saved }
}

/**
 * 新建项目：title 非空（400）；默认 active + 区域 a-0001 + 完成定义待整理（Slice E2.5）。
 * Slice R1：可携带草稿确认后的可选字段 outcome / areaId / tags（关联 id 须真实存在；
 * areaId 缺省仍为 a-0001；仅传 title 的旧调用行为不变）；origin 'ai' 表示 AI 草稿确认。
 */
async function createProject(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title === '') throw Object.assign(new Error('标题不能为空'), { status: 400 })
  const rawArea = typeof body.areaId === 'string' ? body.areaId.trim() : ''
  if (rawArea !== '' && (!validId('areas', rawArea) || (await readEntity('areas', rawArea)) === null)) {
    throw Object.assign(new Error('区域不存在'), { status: 400 })
  }
  const rawOutcome = typeof body.outcome === 'string' ? body.outcome.trim() : ''
  const tags = normalizeTagList(body.tags)
  const origin = body.ai === true ? 'ai' : 'manual'
  const now = nowIso()
  const project = {
    id: await nextId('projects'),
    title,
    outcome: rawOutcome !== '' ? rawOutcome.slice(0, 200) : '完成定义待整理',
    status: 'active',
    areaId: rawArea !== '' ? rawArea : 'a-0001',
    tags,
    createdAt: now,
    updatedAt: now,
  }
  const fields = []
  if (rawOutcome !== '') fields.push('outcome')
  if (rawArea !== '') fields.push('areaId')
  if (tags.length > 0) fields.push('tags')
  const saved = await commit('projects', project, {
    action: 'project.create',
    entity: 'project',
    id: project.id,
    detail: { title, fields, ...(origin === 'ai' ? { ai: true } : {}) },
  })
  if (tags.length > 0) await ensureTags(tags, { origin, firstUsedIn: saved.id })
  return { project: saved }
}

/**
 * 新建日程（v0.5 · Slice W，见 ADR-0018）：title + startAt 必填（400）；endAt 可选，
 * 缺省不写（单点日程）；endAt 早于 startAt → 400。全天缺省 false，状态缺省 confirmed
 * （可显式 tentative / cancelled）。关联 projectId / areaId 须真实存在（同 createTask 口径）；
 * 标签规格化并登记（origin manual）。审计 event.create（detail.fields 记录携带的可选字段）。
 * 不写 createdAt / updatedAt，与既有事件形状保持一致。
 */
async function createEvent(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title === '') throw Object.assign(new Error('标题不能为空'), { status: 400 })
  const startAt = typeof body.startAt === 'string' ? body.startAt.trim() : ''
  if (startAt === '') throw Object.assign(new Error('开始时间不能为空'), { status: 400 })
  const rawEnd = typeof body.endAt === 'string' ? body.endAt.trim() : ''
  const endAt = rawEnd === '' ? undefined : rawEnd
  if (endAt !== undefined && new Date(endAt).getTime() < new Date(startAt).getTime()) {
    throw Object.assign(new Error('结束时间不能早于开始时间'), { status: 400 })
  }
  const tags = normalizeTagList(body.tags)
  const explicitStatus = body.status === 'tentative' || body.status === 'cancelled' ? body.status : null
  const event = {
    id: await nextId('events'),
    title,
    startAt,
    allDay: body.allDay === true,
    status: explicitStatus ?? 'confirmed',
    tags,
  }
  const fields = []
  if (endAt !== undefined) {
    event.endAt = endAt
    fields.push('endAt')
  }
  if (body.allDay === true) fields.push('allDay')
  if (explicitStatus !== null) fields.push('status')
  const rawLocation = typeof body.location === 'string' ? body.location.trim() : ''
  if (rawLocation !== '') {
    event.location = rawLocation
    fields.push('location')
  }
  const rawNotes = typeof body.notes === 'string' ? body.notes.trim() : ''
  if (rawNotes !== '') {
    event.notes = rawNotes
    fields.push('notes')
  }
  if (typeof body.projectId === 'string' && body.projectId !== '') {
    if (!validId('projects', body.projectId) || (await readEntity('projects', body.projectId)) === null) {
      throw Object.assign(new Error('项目不存在'), { status: 400 })
    }
    event.projectId = body.projectId
    fields.push('projectId')
  }
  if (typeof body.areaId === 'string' && body.areaId !== '') {
    if (!validId('areas', body.areaId) || (await readEntity('areas', body.areaId)) === null) {
      throw Object.assign(new Error('区域不存在'), { status: 400 })
    }
    event.areaId = body.areaId
    fields.push('areaId')
  }
  if (tags.length > 0) fields.push('tags')
  const saved = await commit('events', event, {
    action: 'event.create',
    entity: 'event',
    id: event.id,
    detail: { title, fields },
  })
  if (tags.length > 0) await ensureTags(tags, { origin: 'manual', firstUsedIn: saved.id })
  return { event: saved }
}

/* ---------------------------------------------------------------------------
 * 课程 · c-（v0.5 · Slice H0）：可写 / 可回收实体族。
 * ------------------------------------------------------------------------- */

/**
 * 新建课程（Slice H0）：title 必填（trim 后非空，400）；sessions 经 courseCreateSchema +
 * normalizeCourseSessions 双校验（1..16 / end ≥ start）；teacher / location / notes 可选
 * （trim 后空则省略）；审计 course.create（detail 记 title + 时段数）。有 createdAt / updatedAt。
 */
async function createCourse(body) {
  const parsed = courseCreateSchema.parse(body)
  const title = parsed.title.trim()
  if (title === '') throw Object.assign(new Error('课程名不能为空'), { status: 400 })
  const sessions = normalizeCourseSessions(parsed.sessions)
  const course = {
    id: await nextId('courses'),
    title,
    sessions,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  }
  const rawTeacher = parsed.teacher !== undefined ? parsed.teacher.trim() : ''
  if (rawTeacher !== '') course.teacher = rawTeacher
  const rawLocation = parsed.location !== undefined ? parsed.location.trim() : ''
  if (rawLocation !== '') course.location = rawLocation
  const rawNotes = parsed.notes !== undefined ? parsed.notes.trim() : ''
  if (rawNotes !== '') course.notes = rawNotes
  const saved = await commit('courses', course, {
    action: 'course.create',
    entity: 'course',
    id: course.id,
    detail: { title, sessions: sessions.length },
  })
  return { course: saved }
}

/**
 * 课表导入（v0.5 · Slice H1）：一次写入多门课程（课程草稿确认后）。
 * 先对**全部**课程做校验 + 规格化（title 非空 / sessions 经 normalizeCourseSessions），
 * 全部通过后才逐条 commit——绝不因校验留下半成品（commit 失败属基础设施级，可接受）。
 * 审计 course.create（detail.via = 'timetable-import'）。返回 { created }。
 */
async function importCourses(body) {
  const parsed = coursesImportSchema.parse(body)
  // 阶段一：全部校验 + 规格化（不触碰磁盘）
  const prepared = parsed.courses.map((course) => {
    const title = course.title.trim()
    if (title === '') throw Object.assign(new Error('课程名不能为空'), { status: 400 })
    const sessions = normalizeCourseSessions(course.sessions)
    const record = { title, sessions }
    const rawTeacher = course.teacher !== undefined ? course.teacher.trim() : ''
    if (rawTeacher !== '') record.teacher = rawTeacher
    const rawLocation = course.location !== undefined ? course.location.trim() : ''
    if (rawLocation !== '') record.location = rawLocation
    const rawNotes = course.notes !== undefined ? course.notes.trim() : ''
    if (rawNotes !== '') record.notes = rawNotes
    return { record, sessionCount: sessions.length }
  })
  // 阶段二：逐条落盘（id 生成 + 原子写 + 审计）
  const created = []
  for (const { record, sessionCount } of prepared) {
    const id = await nextId('courses')
    const course = {
      id,
      title: record.title,
      sessions: record.sessions,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    }
    if (record.teacher !== undefined) course.teacher = record.teacher
    if (record.location !== undefined) course.location = record.location
    if (record.notes !== undefined) course.notes = record.notes
    const saved = await commit('courses', course, {
      action: 'course.create',
      entity: 'course',
      id,
      detail: { title: record.title, sessions: sessionCount, via: 'timetable-import' },
    })
    created.push(saved)
  }
  return { created }
}

/* ---------------------------------------------------------------------------
 * 区域 / 目标 / 习惯（v0.5 · Slice X，见 ADR-0019）
 * 关闭最后三个只读结构：创建 / 编辑（通用白名单）/ 删除（回收站）。
 * 区域与目标删除带「引用护栏」：被其它实体引用时 409（可读计数），未引用才可入回收站。
 * ------------------------------------------------------------------------- */

/** 区域引用扫描清单（kind + 中文名）；goals / habits 的 areaId 亦计入 */
const AREA_REF_KINDS = [
  ['tasks', '任务'],
  ['projects', '项目'],
  ['notes', '笔记'],
  ['resources', '资料'],
  ['events', '日程'],
  ['goals', '目标'],
  ['habits', '习惯'],
]

/** 统计区域被引用数（返回总数 + 可读明细，如「任务 3 · 项目 1」） */
async function countAreaRefs(areaId) {
  const snapshot = await readSnapshot()
  let total = 0
  const parts = []
  for (const [kind, cn] of AREA_REF_KINDS) {
    const count = (snapshot[kind] ?? []).filter((record) => record.areaId === areaId).length
    if (count > 0) {
      total += count
      parts.push(`${cn} ${count}`)
    }
  }
  return { total, text: parts.join(' · ') }
}

/** 统计目标被引用数（项目 goalId + 子目标 parentGoalId） */
async function countGoalRefs(goalId) {
  const snapshot = await readSnapshot()
  const projects = (snapshot.projects ?? []).filter((p) => p.goalId === goalId).length
  const children = (snapshot.goals ?? []).filter((g) => g.parentGoalId === goalId).length
  const parts = []
  if (projects > 0) parts.push(`项目 ${projects}`)
  if (children > 0) parts.push(`子目标 ${children}`)
  return { total: projects + children, text: parts.join(' · ') }
}

/** 创建区域（Slice X）：title 必填；standard / cadence / status 可选（缺省标准待补充 / weekly / active） */
async function createArea(body) {
  const parsed = areaCreateSchema.parse(body)
  const title = parsed.title.trim()
  if (title === '') throw Object.assign(new Error('区域名不能为空'), { status: 400 })
  const standard = parsed.standard !== undefined ? parsed.standard.trim() : ''
  const area = {
    id: await nextId('areas'),
    title,
    standard: standard !== '' ? standard.slice(0, 200) : '标准待补充',
    cadence: parsed.cadence ?? 'weekly',
    status: parsed.status ?? 'active',
  }
  const saved = await commit('areas', area, {
    action: 'area.create',
    entity: 'area',
    id: area.id,
    detail: { title },
  })
  return { area: saved }
}

/** 创建目标（Slice X）：title 必填；areaId 须真实存在；keyResults 本切片留空（写入延后） */
async function createGoal(body) {
  const parsed = goalCreateSchema.parse(body)
  const title = parsed.title.trim()
  if (title === '') throw Object.assign(new Error('目标名不能为空'), { status: 400 })
  if (parsed.areaId !== undefined && (await readEntity('areas', parsed.areaId)) === null) {
    throw Object.assign(new Error('区域不存在'), { status: 400 })
  }
  const goal = {
    id: await nextId('goals'),
    title,
    horizon: parsed.horizon ?? 'term',
    keyResults: [],
    status: parsed.status ?? 'active',
  }
  const fields = []
  if (parsed.areaId !== undefined) {
    goal.areaId = parsed.areaId
    fields.push('areaId')
  }
  if (parsed.targetDate !== undefined) {
    goal.targetDate = parsed.targetDate
    fields.push('targetDate')
  }
  if (parsed.horizon !== undefined) fields.push('horizon')
  if (parsed.status !== undefined) fields.push('status')
  const saved = await commit('goals', goal, {
    action: 'goal.create',
    entity: 'goal',
    id: goal.id,
    detail: { title, fields },
  })
  return { goal: saved }
}

/** 创建习惯（Slice X）：title 必填；areaId 须真实存在；log 空数组（打卡另经 check-in 端点） */
async function createHabit(body) {
  const parsed = habitCreateSchema.parse(body)
  const title = parsed.title.trim()
  if (title === '') throw Object.assign(new Error('习惯名不能为空'), { status: 400 })
  if (parsed.areaId !== undefined && (await readEntity('areas', parsed.areaId)) === null) {
    throw Object.assign(new Error('区域不存在'), { status: 400 })
  }
  const habit = {
    id: await nextId('habits'),
    title,
    cadence: parsed.cadence ?? 'daily',
    metric: parsed.metric ?? 'count',
    target: parsed.target ?? 1,
    log: [],
  }
  const fields = []
  if (parsed.trigger !== undefined && parsed.trigger.trim() !== '') {
    habit.trigger = parsed.trigger.trim().slice(0, 200)
    fields.push('trigger')
  }
  if (parsed.areaId !== undefined) {
    habit.areaId = parsed.areaId
    fields.push('areaId')
  }
  if (parsed.cadence !== undefined) fields.push('cadence')
  if (parsed.metric !== undefined) fields.push('metric')
  if (parsed.target !== undefined) fields.push('target')
  const saved = await commit('habits', habit, {
    action: 'habit.create',
    entity: 'habit',
    id: habit.id,
    detail: { title, fields },
  })
  return { habit: saved }
}

/** 本地时区「今天」（YYYY-MM-DD） */
function todayDateKey() {
  return nowIso().slice(0, 10)
}

/**
 * 打卡（Slice X）：向 habit.log 幂等加入 {date, value:1}（缺省今天）。
 * 已存在且 value>0 视为已打卡 → 不重复写、不审计；否则写入并审计 habit.checkin。
 */
async function checkinHabit(id, body) {
  const parsed = habitCheckinSchema.parse(body ?? {})
  const date = parsed.date ?? todayDateKey()
  const habit = await readEntity('habits', id)
  if (habit === null) throw Object.assign(new Error('习惯不存在'), { status: 404 })
  const log = Array.isArray(habit.log) ? [...habit.log] : []
  const index = log.findIndex((entry) => entry.date === date)
  if (index !== -1 && log[index].value > 0) {
    return { habit, changed: false, date }
  }
  if (index !== -1) log[index] = { date, value: 1 }
  else log.push({ date, value: 1 })
  log.sort((a, b) => String(a.date).localeCompare(String(b.date)))
  const saved = await commit('habits', { ...habit, log }, {
    action: 'habit.checkin',
    entity: 'habit',
    id,
    detail: { date },
  })
  return { habit: saved, changed: true, date }
}

/**
 * 取消打卡（Slice X）：从 habit.log 移除指定日期（缺省今天）；无该日期则幂等无操作（不审计）。
 */
async function uncheckinHabit(id, body) {
  const parsed = habitCheckinSchema.parse(body ?? {})
  const date = parsed.date ?? todayDateKey()
  const habit = await readEntity('habits', id)
  if (habit === null) throw Object.assign(new Error('习惯不存在'), { status: 404 })
  const before = Array.isArray(habit.log) ? habit.log : []
  const log = before.filter((entry) => entry.date !== date)
  if (log.length === before.length) return { habit, changed: false, date }
  const saved = await commit('habits', { ...habit, log }, {
    action: 'habit.uncheckin',
    entity: 'habit',
    id,
    detail: { date },
  })
  return { habit: saved, changed: true, date }
}

/** 删除区域：引用中 → 409（可读计数）；未引用 → 移入回收站（审计 area.remove） */
async function removeArea(id) {
  const area = await readEntity('areas', id)
  if (area === null) throw Object.assign(new Error('区域不存在'), { status: 404 })
  const refs = await countAreaRefs(id)
  if (refs.total > 0) {
    throw Object.assign(
      new Error(`该区域正被 ${refs.total} 条记录引用（${refs.text}），不能删除；请先解除引用`),
      { status: 409 },
    )
  }
  const record = await moveToTrash('areas', id, { action: 'area.remove', entity: 'area', id })
  return { trashed: { kind: 'areas', id }, record }
}

/** 删除目标：引用中（项目 / 子目标）→ 409；未引用 → 移入回收站（审计 goal.remove） */
async function removeGoal(id) {
  const goal = await readEntity('goals', id)
  if (goal === null) throw Object.assign(new Error('目标不存在'), { status: 404 })
  const refs = await countGoalRefs(id)
  if (refs.total > 0) {
    throw Object.assign(
      new Error(`该目标正被 ${refs.total} 条记录引用（${refs.text}），不能删除；请先解除引用`),
      { status: 409 },
    )
  }
  const record = await moveToTrash('goals', id, { action: 'goal.remove', entity: 'goal', id })
  return { trashed: { kind: 'goals', id }, record }
}

/** 删除习惯：无引用护栏（区域只是其出链），直接移入回收站（审计 habit.remove） */
async function removeHabit(id) {
  const habit = await readEntity('habits', id)
  if (habit === null) throw Object.assign(new Error('习惯不存在'), { status: 404 })
  const record = await moveToTrash('habits', id, { action: 'habit.remove', entity: 'habit', id })
  return { trashed: { kind: 'habits', id }, record }
}

/**
 * 聚类 / 整理共用 · 建项并归入内核（Slice R2；Slice N8 抽取复用）：读快照 → 校验区域 →
 * 过滤「存在 + 未归属 + 未完成」的任务 → 登记标签 → 创建项目（记撤销凭据 clusterTaskIds /
 * clusterTagIds）→ 逐条归入（task.update）。无可用任务返回 null（由调用方决定 400 文案）。
 * @param {{ title: string, outcome?: any, areaId?: any, tags?: any, taskIds: string[] }} parsed
 * @param {{ via: string, requireOpen?: boolean }} options 审计来源（cluster / organize）；
 *   requireOpen=true 时要求任务仍为打开态（仅 organize 使用；cluster-apply 保持原有「未归属即可」行为）
 * @returns {Promise<{ project: object, assigned: string[], createdTagIds: string[] } | null>}
 */
async function applyClusterCore(parsed, { via, requireOpen = false }) {
  const snapshot = await readSnapshot()
  const areaIds = new Set((snapshot.areas ?? []).map((a) => a.id))
  const rawArea = typeof parsed.areaId === 'string' ? parsed.areaId.trim() : ''
  if (rawArea !== '' && !areaIds.has(rawArea)) {
    throw Object.assign(new Error('区域不存在'), { status: 400 })
  }
  const taskMap = new Map((snapshot.tasks ?? []).map((t) => [t.id, t]))
  const targetIds = []
  for (const id of parsed.taskIds) {
    const task = taskMap.get(id)
    if (task === undefined) continue // 已不存在 / 臆造：丢弃
    if (task.projectId !== undefined && task.projectId !== '') continue // 已有归属：跳过
    // 仅 organize 要求任务仍「打开」；cluster-apply 保持原有「未归属即可」行为（不改既有契约）
    if (requireOpen && !OPEN_TASK_STATUS.has(task.status)) continue
    targetIds.push(id)
  }
  if (targetIds.length === 0) return null
  const tags = normalizeTagList(parsed.tags ?? [])
  const now = nowIso()
  const projectId = await nextId('projects')
  // 先登记标签（firstUsedIn = 预生成的 projectId），使 clusterTagIds 一并写入项目（一次写）
  let createdTagIds = []
  if (tags.length > 0) {
    const registered = await ensureTags(tags, { origin: 'ai', firstUsedIn: projectId })
    createdTagIds = registered.map((tag) => tag.id)
  }
  const rawOutcome = typeof parsed.outcome === 'string' ? parsed.outcome.trim() : ''
  const project = {
    id: projectId,
    title: String(parsed.title ?? '').slice(0, 60),
    outcome: rawOutcome !== '' ? rawOutcome.slice(0, 200) : '完成定义待整理（由 AI 归纳创建）',
    status: 'active',
    areaId: rawArea !== '' ? rawArea : 'a-0001',
    tags,
    createdAt: now,
    updatedAt: now,
    // 撤销凭据（catchall 允许）：本次归入的任务 + 本次新建的标签（仅删这类，绝不动既有标签）
    clusterTaskIds: targetIds,
    clusterTagIds: createdTagIds,
  }
  const savedProject = await commit('projects', project, {
    action: 'project.create',
    entity: 'project',
    id: project.id,
    detail: { title: project.title, via, memberCount: targetIds.length },
  })
  const assigned = []
  for (const id of targetIds) {
    const task = await readEntity('tasks', id)
    if (task === null) continue
    if (task.projectId !== undefined && task.projectId !== '') continue
    if (requireOpen && !OPEN_TASK_STATUS.has(task.status)) continue
    const next = { ...task, projectId: savedProject.id, updatedAt: nowIso() }
    await commit('tasks', next, {
      action: 'task.update',
      entity: 'task',
      id,
      detail: { fields: ['projectId'], projectId: savedProject.id, via },
    })
    assigned.push(id)
  }
  return { project: savedProject, assigned, createdTagIds }
}

/**
 * 聚类立项 · 应用（v0.5 · Slice R2，见 ADR-0016）：一次写入创建新项目，并把列出的
 * 「无归属任务」归入该项目（projectId）。服务端重新 Zod 校验（clusterApplySchema）+
 * 任务存在性 / 未归属校验，绝不信任客户端形状；标签以 origin 'ai' 登记；项目上记录
 * clusterTaskIds / clusterTagIds 供精确撤销。收件箱条目无 projectId 结构，仅作命名参考，
 * 本端点不触碰（澄清时由 AI 参考）。
 */
async function clusterApply(body) {
  const parsed = clusterApplySchema.parse(body)
  const title = parsed.title.trim()
  if (title === '') throw Object.assign(new Error('项目名不能为空'), { status: 400 })
  const result = await applyClusterCore({ ...parsed, title }, { via: 'cluster' })
  if (result === null) {
    throw Object.assign(new Error('没有可归入的未归属任务'), { status: 400 })
  }
  return result
}

/**
 * 聚类 / 整理共用 · 撤销内核（Slice R2；Slice N8 抽取复用）：按项目上的 clusterTaskIds 清除
 * 本次归入任务的 projectId（恢复无归属）→ pruneTags(clusterTagIds) 清本次新建且已无人使用的
 * 标签 → 项目移入回收站。项目不存在返回 null（由调用方决定 404）。审计 via 由调用方指定。
 * @param {string} projectId
 * @param {{ via: string }} options 审计来源（cluster-unapply / organize-unapply）
 * @returns {Promise<{ trashed: { kind: string, id: string }, restoredTaskIds: string[] } | null>}
 */
async function unapplyProjectCore(projectId, { via }) {
  const project = await readEntity('projects', projectId)
  if (project === null) return null
  const taskIds = Array.isArray(project.clusterTaskIds) ? project.clusterTaskIds : []
  const restoredTaskIds = []
  for (const id of taskIds) {
    const task = await readEntity('tasks', id)
    if (task === null) continue
    if (task.projectId !== projectId) continue
    const next = { ...task, updatedAt: nowIso() }
    delete next.projectId
    await commit('tasks', next, {
      action: 'task.update',
      entity: 'task',
      id,
      detail: { fields: ['projectId'], cleared: true, via },
    })
    restoredTaskIds.push(id)
  }
  const tagIds = Array.isArray(project.clusterTagIds) ? project.clusterTagIds : []
  if (tagIds.length > 0) await pruneTags(tagIds, { via })
  await moveToTrash('projects', projectId, {
    action: 'project.trash',
    entity: 'project',
    id: projectId,
    detail: { via, restoredTasks: restoredTaskIds.length },
  })
  return { trashed: { kind: 'projects', id: projectId }, restoredTaskIds }
}

/**
 * 聚类立项 · 撤销（v0.5 · Slice R2）：清除本次归入任务的 projectId（恢复为无归属）→
 * 清理本次新建且已无人使用的标签 → 把项目移入回收站。精确回到应用前基线；审计各步。
 */
async function clusterUnapply(body) {
  const { projectId } = clusterUnapplySchema.parse(body)
  const result = await unapplyProjectCore(projectId, { via: 'cluster-unapply' })
  if (result === null) throw Object.assign(new Error('项目不存在'), { status: 404 })
  return result
}

/**
 * AI 整理 · 应用（v0.5 · Slice N8）：先按 assignments 把任务归入高度相关的现有项目，再按
 * clusters 顺序新建项目并归入剩余任务（单个簇失败不阻断整批）。服务端重新 Zod 校验 +
 * 存在性 / 状态 / 未归属校验；标签 origin 'ai' 登记；所有簇内写入审计 via 'organize'。
 * 逐项错误收集进 errors（尽力而为），无任何落地则 400。
 * 响应：{ assignments:[{projectId,taskIds}], projects:[{id,title,taskIds}], createdTagIds, assignedTotal, errors }
 */
async function organizeApply(body) {
  const parsed = organizeApplySchema.parse(body)
  if (parsed.assignments.length === 0 && parsed.clusters.length === 0) {
    throw Object.assign(new Error('没有可应用的整理项'), { status: 400 })
  }
  const snapshot = await readSnapshot()
  const projectById = new Map((snapshot.projects ?? []).map((p) => [p.id, p]))
  const areaIds = new Set((snapshot.areas ?? []).map((a) => a.id))
  const result = { assignments: [], projects: [], createdTagIds: [], errors: [] }
  let assignedTotal = 0

  // 阶段 A：归并入现有项目（先执行，assignments 优先；单项失败仅记错误继续）
  for (const a of parsed.assignments) {
    try {
      const project = projectById.get(a.projectId)
      if (project === undefined) {
        result.errors.push(`项目 ${a.projectId} 不存在，已跳过`)
        continue
      }
      if (!ORGANIZE_PROJECT_STATUS.has(project.status)) {
        result.errors.push(`项目「${project.title}」状态为 ${project.status}，不归入`)
        continue
      }
      const applied = []
      const seen = new Set()
      for (const id of a.taskIds) {
        if (seen.has(id)) continue
        seen.add(id)
        const task = await readEntity('tasks', id)
        if (task === null) continue
        if (task.projectId !== undefined && task.projectId !== '') continue
        if (!OPEN_TASK_STATUS.has(task.status)) continue
        const next = { ...task, projectId: a.projectId, updatedAt: nowIso() }
        await commit('tasks', next, {
          action: 'task.update',
          entity: 'task',
          id,
          detail: { fields: ['projectId'], projectId: a.projectId, via: 'organize' },
        })
        applied.push(id)
      }
      if (applied.length > 0) {
        result.assignments.push({ projectId: a.projectId, taskIds: applied })
        assignedTotal += applied.length
      }
    } catch (err) {
      result.errors.push(`归入项目 ${a.projectId} 失败：${err?.message ?? err}`)
    }
  }

  // 阶段 B：顺序新建项目（Oracle fix #1：绝不并行；nextId 在每个簇提交前才分配）
  for (const c of parsed.clusters) {
    try {
      const title = c.title.trim().slice(0, 60)
      if (title === '') {
        result.errors.push('项目名不能为空，已跳过')
        continue
      }
      const rawArea = typeof c.areaId === 'string' ? c.areaId.trim() : ''
      if (rawArea !== '' && !areaIds.has(rawArea)) {
        result.errors.push(`区域 ${rawArea} 不存在，已跳过「${title}」`)
        continue
      }
      const parsedCluster = {
        title,
        outcome: c.outcome,
        areaId: rawArea !== '' ? rawArea : undefined,
        tags: c.tags ?? [],
        taskIds: c.taskIds,
      }
      const one = await applyClusterCore(parsedCluster, { via: 'organize', requireOpen: true })
      if (one === null) {
        result.errors.push(`「${title}」没有可应用的任务，已跳过`)
        continue
      }
      result.projects.push({ id: one.project.id, title: one.project.title, taskIds: one.assigned })
      result.createdTagIds.push(...one.createdTagIds)
      assignedTotal += one.assigned.length
    } catch (err) {
      result.errors.push(`新建项目失败：${err?.message ?? err}`)
    }
  }

  // Oracle fix #2：逐项失败已收集进 errors 并继续；全部未落地（无写入）才 400
  if (assignedTotal === 0 && result.projects.length === 0) {
    throw Object.assign(new Error('没有可应用的整理项'), { status: 400 })
  }
  return { ...result, assignedTotal }
}

/**
 * AI 整理 · 撤销（v0.5 · Slice N8）：逐项尽力复原——新建项目走 unapplyProjectCore（缺失静默跳过）；
 * 归并项仅在任务仍指向该项目时清除 projectId。不因单项缺失 / 已变动而 404 / 抛错。
 * 响应：{ trashed:[{kind,id}], restoredTaskIds, clearedTaskIds }
 */
async function organizeUnapply(body) {
  const parsed = organizeUnapplySchema.parse(body)
  const trashed = []
  const restoredTaskIds = []
  const clearedTaskIds = []
  for (const pid of parsed.projects) {
    try {
      const one = await unapplyProjectCore(pid, { via: 'organize-unapply' })
      if (one === null) continue
      trashed.push(one.trashed)
      restoredTaskIds.push(...one.restoredTaskIds)
    } catch (err) {
      console.error(`[data] organize-unapply 项目 ${pid} 失败：`, err?.message ?? err)
    }
  }
  for (const a of parsed.assignments) {
    const seen = new Set()
    for (const id of a.taskIds) {
      if (seen.has(id)) continue
      seen.add(id)
      try {
        const task = await readEntity('tasks', id)
        if (task === null) continue
        if (task.projectId !== a.projectId) continue
        const next = { ...task, updatedAt: nowIso() }
        delete next.projectId
        await commit('tasks', next, {
          action: 'task.update',
          entity: 'task',
          id,
          detail: { fields: ['projectId'], cleared: true, via: 'organize-unapply' },
        })
        clearedTaskIds.push(id)
      } catch (err) {
        console.error(`[data] organize-unapply 任务 ${id} 失败：`, err?.message ?? err)
      }
    }
  }
  return { trashed, restoredTaskIds, clearedTaskIds }
}

/** 更新配置（v0.5 · Slice R2）：白名单仅 aiAutomation；审计 config.update */
async function applyConfigUpdate(body) {
  const patch = configUpdateSchema.parse(body)
  return { config: await updateConfig(patch) }
}

/**
 * 新建笔记（v0.5 · Slice G）：通用创建端点，供「AI 对话归档」等调用。
 * title 非空（400）；type 取白名单（缺省 memo）；body 原文（markdown 文本）；审计 note.create。
 */
async function createNote(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title === '') throw Object.assign(new Error('标题不能为空'), { status: 400 })
  const text = typeof body.body === 'string' ? body.body : ''
  const allowed = new Set(['fleeting', 'literature', 'permanent', 'meeting', 'memo'])
  const type = allowed.has(body.type) ? body.type : 'memo'
  const tags = normalizeTagList(body.tags)
  const now = nowIso()
  const note = {
    id: await nextId('notes'),
    title,
    type,
    body: text,
    links: [],
    tags,
    distillLevel: 0,
    createdAt: now,
    updatedAt: now,
  }
  const saved = await commit('notes', note, {
    action: 'note.create',
    entity: 'note',
    id: note.id,
    detail: { title, type },
  })
  if (tags.length > 0) await ensureTags(tags, { origin: 'manual', firstUsedIn: saved.id })
  return { note: saved }
}

/**
 * 新建资料（v0.5 · Slice Y，见 ADR-0021）：title 必填（trim 后非空）；kind 缺省 article、
 * status 缺省 unread；可选 url / path / note / areaId / tags。areaId 须真实存在；标签规格化并
 * 登记（origin manual）。审计 resource.create（detail.fields 记录携带的可选字段）。
 * path 仅记录字符串（不校验磁盘存在，与文件投递澄清为资料时口径一致）。
 */
async function createResource(body) {
  const parsed = resourceCreateSchema.parse(body)
  const title = parsed.title.trim()
  if (title === '') throw Object.assign(new Error('标题不能为空'), { status: 400 })
  const tags = normalizeTagList(parsed.tags)
  if (parsed.areaId !== undefined && (await readEntity('areas', parsed.areaId)) === null) {
    throw Object.assign(new Error('区域不存在'), { status: 400 })
  }
  const resource = {
    id: await nextId('resources'),
    title,
    kind: parsed.kind ?? 'article',
    status: parsed.status ?? 'unread',
    tags,
    addedAt: nowIso(),
  }
  const fields = []
  if (parsed.kind !== undefined) fields.push('kind')
  if (parsed.status !== undefined) fields.push('status')
  if (parsed.url !== undefined && parsed.url.trim() !== '') {
    resource.url = parsed.url.trim()
    fields.push('url')
  }
  if (parsed.path !== undefined && parsed.path.trim() !== '') {
    resource.path = parsed.path.trim()
    fields.push('path')
  }
  if (parsed.note !== undefined && parsed.note.trim() !== '') {
    resource.note = parsed.note.trim()
    fields.push('note')
  }
  if (parsed.areaId !== undefined) {
    resource.areaId = parsed.areaId
    fields.push('areaId')
  }
  if (tags.length > 0) fields.push('tags')
  const saved = await commit('resources', resource, {
    action: 'resource.create',
    entity: 'resource',
    id: resource.id,
    detail: { title, fields },
  })
  if (tags.length > 0) await ensureTags(tags, { origin: 'manual', firstUsedIn: saved.id })
  return { resource: saved }
}

async function completeTask(id) {
  const task = await readEntity('tasks', id)
  if (task === null) throw Object.assign(new Error('任务不存在'), { status: 404 })
  if (task.status === 'done') return { task }
  const beforeStatus = task.status
  const now = nowIso()
  const next = { ...task, status: 'done', doneAt: now, updatedAt: now }
  const saved = await commit('tasks', next, {
    action: 'task.complete',
    entity: 'task',
    id,
    detail: { beforeStatus },
  })
  return { task: saved }
}

async function reopenTask(id) {
  const task = await readEntity('tasks', id)
  if (task === null) throw Object.assign(new Error('任务不存在'), { status: 404 })
  if (task.status !== 'done') return { task }
  const toStatus = (await lastCompleteStatus(id)) ?? 'next'
  const now = nowIso()
  const next = { ...task, status: toStatus, updatedAt: now }
  delete next.doneAt
  const saved = await commit('tasks', next, {
    action: 'task.reopen',
    entity: 'task',
    id,
    detail: { toStatus },
  })
  return { task: saved }
}

async function captureInbox(body) {
  const content = typeof body.content === 'string' ? body.content.trim() : ''
  if (content === '') throw Object.assign(new Error('内容不能为空'), { status: 400 })
  const item = {
    id: await nextId('inbox'),
    content,
    source: 'manual',
    capturedAt: nowIso(),
    status: 'unprocessed',
  }
  const saved = await commit('inbox', item, {
    action: 'inbox.capture',
    entity: 'inboxItem',
    id: item.id,
  })
  return { inbox: saved }
}

async function clarifyInbox(id, body) {
  const item = await readEntity('inbox', id)
  if (item === null) throw Object.assign(new Error('条目不存在'), { status: 404 })
  if (item.status !== 'unprocessed') {
    throw Object.assign(new Error('该条目已澄清或已丢弃'), { status: 409 })
  }
  const target = body.target
  if (!['task', 'project', 'note', 'resource', 'discard'].includes(target)) {
    throw Object.assign(new Error('澄清目标不合法'), { status: 400 })
  }

  // 审计标记：仅当显式 ai:true 才记录（undefined 会被 JSON.stringify 丢弃）
  const aiFlag = body.ai === true ? true : undefined

  if (target === 'discard') {
    const saved = await commit('inbox', { ...item, status: 'discarded' }, {
      action: 'inbox.discard',
      entity: 'inboxItem',
      id,
      detail: aiFlag === true ? { ai: true } : {},
    })
    return { inbox: saved, created: null }
  }

  // 可选覆盖字段（AI 应用 / 手工预填）；非法形状抛 zod 错误 → 全局处理器 400
  const details = body.details === undefined ? {} : clarifyDetailsSchema.parse(body.details)
  // 标签规格化（Slice T）；AI 建议的新标签在 created 落盘后登记（origin 'ai'）
  const detailTags = normalizeTagList(details.tags ?? [])
  const tagOrigin = aiFlag === true ? 'ai' : 'manual'

  const kind = CLARIFY_KINDS[target]
  const now = nowIso()
  let record
  if (kind === 'tasks') {
    record = {
      id: await nextId('tasks'),
      title: details.title ?? item.content,
      status: 'next',
      contexts: details.contexts ?? ['@computer'],
      energy: details.energy ?? 'low',
      importance: details.importance ?? 2,
      tags: detailTags,
      createdAt: now,
      updatedAt: now,
      sourceInboxId: item.id,
    }
    if (details.estimateMin !== undefined) record.estimateMin = details.estimateMin
    if (details.dueAt !== undefined) record.dueAt = details.dueAt
    // 关联：仅接受真实存在的项目 / 区域（防臆造 id；其他澄清目标忽略这两个字段）
    if (details.projectId !== undefined) {
      if (!validId('projects', details.projectId) || (await readEntity('projects', details.projectId)) === null) {
        throw Object.assign(new Error('项目不存在'), { status: 400 })
      }
      record.projectId = details.projectId
    }
    if (details.areaId !== undefined) {
      if (!validId('areas', details.areaId) || (await readEntity('areas', details.areaId)) === null) {
        throw Object.assign(new Error('区域不存在'), { status: 400 })
      }
      record.areaId = details.areaId
    }
  } else if (kind === 'projects') {
    // 澄清为项目：忽略 details（完成定义需后续在项目抽屉完善）
    record = {
      id: await nextId('projects'),
      title: item.content,
      outcome: '完成定义待整理（由收件箱澄清创建）',
      status: 'someday',
      areaId: 'a-0001',
      tags: [],
      createdAt: now,
      updatedAt: now,
    }
  } else if (kind === 'notes') {
    const truncated = item.content.length > 24 ? `${item.content.slice(0, 24)}…` : item.content
    record = {
      id: await nextId('notes'),
      title: details.title ?? truncated,
      type: 'fleeting',
      body: item.content,
      links: [],
      tags: detailTags,
      distillLevel: 0,
      createdAt: now,
      updatedAt: now,
    }
    // Slice V（F19/F31）：笔记也支持归属建议（note 实体本身有 projectId / areaId）；
    // 真实存在才接受，避免 UI 可编辑字段被静默丢弃。contexts / energy / 等任务专属字段对
    // 笔记无对应结构，UI 不再展示（见 src/lib/aiForm.ts 的 target × 字段矩阵）。
    if (details.projectId !== undefined) {
      if (!validId('projects', details.projectId) || (await readEntity('projects', details.projectId)) === null) {
        throw Object.assign(new Error('项目不存在'), { status: 400 })
      }
      record.projectId = details.projectId
    }
    if (details.areaId !== undefined) {
      if (!validId('areas', details.areaId) || (await readEntity('areas', details.areaId)) === null) {
        throw Object.assign(new Error('区域不存在'), { status: 400 })
      }
      record.areaId = details.areaId
    }
  } else {
    // 资源：文件投递澄清为资料时记录附件绝对路径（Slice E2）；非文件条目行为不变
    const isFile = item.file !== undefined && item.file !== null
    record = {
      id: await nextId('resources'),
      // Slice V（F19/F31）：标题对文件条目同样应用用户编辑（此前文件条目被强制用原文，属静默丢弃）
      title: details.title ?? item.content,
      kind: isFile ? 'file' : 'article',
      status: 'unread',
      tags: detailTags,
      addedAt: now,
    }
    if (isFile) {
      record.path = path.join(FILES_DIR, `${item.id}-${item.file.name}`)
    }
    // Slice R2.5：文件投递澄清为资料时写入「简介」（resource.note）
    if (typeof details.note === 'string') record.note = details.note.trim()
    // 资料仅有 areaId 归属（无 projectId）；真实存在才接受
    if (details.areaId !== undefined) {
      if (!validId('areas', details.areaId) || (await readEntity('areas', details.areaId)) === null) {
        throw Object.assign(new Error('区域不存在'), { status: 400 })
      }
      record.areaId = details.areaId
    }
  }
  const savedRecord = await commit(kind, record, {
    action: `inbox.clarify.${target}`,
    entity: 'inboxItem',
    id,
    detail: { createdKind: kind, createdId: record.id, ai: aiFlag },
  })
  // 录入即生成：以「实际落盘记录」的 tags 为准登记（project 目标不带 tags，天然不产生孤儿标签）
  const savedTags = Array.isArray(savedRecord.tags) ? savedRecord.tags : []
  if (savedTags.length > 0) {
    await ensureTags(savedTags, { origin: tagOrigin, firstUsedIn: savedRecord.id })
  }
  const savedItem = await commit('inbox', { ...item, status: 'clarified', linkedId: record.id }, {
    action: 'inbox.clarify',
    entity: 'inboxItem',
    id,
    detail: { target, linkedId: record.id, ai: aiFlag },
  })
  return { inbox: savedItem, created: { kind, record: savedRecord } }
}

/** 实体 id 前缀 → kind（用于撤销时定位产物） */
function kindOfId(id) {
  if (typeof id !== 'string') return null
  if (id.startsWith('t-')) return 'tasks'
  if (id.startsWith('n-')) return 'notes'
  if (id.startsWith('r-')) return 'resources'
  if (id.startsWith('p-')) return 'projects'
  if (id.startsWith('e-')) return 'events' // Slice N10：事件产物撤销定位
  return null
}

/** 动作挂接的项目 id：优先本批次新建项目（linkToNewProject），否则显式 projectId */
function resolveProjectForAction(action, newProject) {
  if (action.linkToNewProject === true && newProject !== null) return newProject.id
  return action.projectId
}

/**
 * 一揽子应用（v0.5 · Slice R1，见 ADR-0015）：一次写入把条目拆解出的全部动作落位。
 * 顺序：先建新项目（至多 1 个），再逐条建 task / note / resource（linkToNewProject 自动挂到新项目）。
 * 服务端重新 Zod 校验（inboxApplySchema）+ 关联 id 存在性校验（不信任客户端形状）；
 * 标签以 origin 'ai' 登记；条目置 clarified（linkedId 供深链、linkedIds 供完整撤销、
 * appliedTagIds 供撤销时恢复注册表基线）；审计 inbox.apply + 各实体 create。
 */
async function applyInboxActions(id, body) {
  const item = await readEntity('inbox', id)
  if (item === null) throw Object.assign(new Error('条目不存在'), { status: 404 })
  if (item.status !== 'unprocessed') {
    throw Object.assign(new Error('该条目已澄清或已丢弃'), { status: 409 })
  }
  const parsed = inboxApplySchema.parse(body)
  // Slice N4：来源摘要（可选）。zod 已限 ≤100；再防御性 trim + 截断（中文按字符）。
  // 缺省 / 空白 → ''，此时不写条目字段（向后兼容旧调用）。
  const summary =
    typeof parsed.summary === 'string'
      ? Array.from(parsed.summary.trim()).slice(0, 100).join('')
      : ''
  // 客户端的显式 null（"无关联"）统一移除，避免被当成臆造 id 拒绝
  let actions = parsed.actions.map((action) => {
    const out = { ...action }
    for (const key of ['projectId', 'areaId', 'dueAt', 'outcome', 'duplicateOf', 'note', 'startAt', 'endAt', 'allDay', 'location']) {
      if (out[key] === null) delete out[key]
    }
    return out
  })
  // Slice R2.5 纵深防御：文件条目只允许落地为一条资料（与解析侧 postValidateActions 同口径）
  const hasFile = item.file !== undefined && item.file !== null
  if (hasFile) {
    actions = actions.filter((action) => action.kind === 'resource').slice(0, 1)
    if (actions.length === 0) {
      throw Object.assign(new Error('文件条目只能应用为资料'), { status: 400 })
    }
  }
  if (actions.filter((a) => a.kind === 'project').length > 1) {
    throw Object.assign(new Error('一揽子应用至多包含一个新项目'), { status: 400 })
  }
  const snapshot = await readSnapshot()
  const areaIds = new Set((snapshot.areas ?? []).map((a) => a.id))
  const projectIds = new Set((snapshot.projects ?? []).map((p) => p.id))
  for (const action of actions) {
    if (action.areaId !== undefined && !areaIds.has(action.areaId)) {
      throw Object.assign(new Error('区域不存在'), { status: 400 })
    }
    if (action.projectId !== undefined && !projectIds.has(action.projectId)) {
      throw Object.assign(new Error('项目不存在'), { status: 400 })
    }
  }

  const now = nowIso()
  const created = []
  const linkedIds = []
  const tagFirstUsed = new Map()
  let newProject = null

  const trackTags = (tags, recordId) => {
    for (const name of tags) if (!tagFirstUsed.has(name)) tagFirstUsed.set(name, recordId)
  }

  const projectAction = actions.find((a) => a.kind === 'project')
  if (projectAction !== undefined) {
    const tags = normalizeTagList(projectAction.tags)
    const project = {
      id: await nextId('projects'),
      title: projectAction.title,
      outcome:
        typeof projectAction.outcome === 'string' && projectAction.outcome !== ''
          ? projectAction.outcome
          : '完成定义待整理（由收件箱一揽子应用创建）',
      status: 'active',
      areaId: projectAction.areaId ?? 'a-0001',
      tags,
      createdAt: now,
      updatedAt: now,
    }
    newProject = await commit('projects', project, {
      action: 'project.create',
      entity: 'project',
      id: project.id,
      detail: { title: project.title, via: 'inbox.apply' },
    })
    created.push({ kind: 'projects', record: newProject })
    linkedIds.push(newProject.id)
    trackTags(tags, newProject.id)
  }

  for (const action of actions) {
    if (action.kind === 'project') continue
    const tags = normalizeTagList(action.tags)
    let saved
    if (action.kind === 'task') {
      const record = {
        id: await nextId('tasks'),
        title: action.title,
        status: 'next',
        contexts: action.contexts.length > 0 ? action.contexts : ['@computer'],
        energy: action.energy ?? 'low',
        importance: action.importance ?? 2,
        tags,
        createdAt: now,
        updatedAt: now,
        sourceInboxId: item.id,
      }
      if (action.estimateMin !== undefined) record.estimateMin = action.estimateMin
      if (action.dueAt !== undefined) record.dueAt = action.dueAt
      const projectId = resolveProjectForAction(action, newProject)
      if (projectId !== undefined) record.projectId = projectId
      if (action.areaId !== undefined) record.areaId = action.areaId
      saved = await commit('tasks', record, {
        action: 'task.create',
        entity: 'task',
        id: record.id,
        detail: { title: record.title, via: 'inbox.apply' },
      })
      created.push({ kind: 'tasks', record: saved })
    } else if (action.kind === 'note') {
      const truncated = item.content.length > 24 ? `${item.content.slice(0, 24)}…` : item.content
      const record = {
        id: await nextId('notes'),
        title: action.title !== '' ? action.title : truncated,
        type: 'fleeting',
        body: item.content,
        links: [],
        tags,
        distillLevel: 0,
        createdAt: now,
        updatedAt: now,
      }
      const projectId = resolveProjectForAction(action, newProject)
      if (projectId !== undefined) record.projectId = projectId
      if (action.areaId !== undefined) record.areaId = action.areaId
      saved = await commit('notes', record, {
        action: 'note.create',
        entity: 'note',
        id: record.id,
        detail: { title: record.title, via: 'inbox.apply' },
      })
      created.push({ kind: 'notes', record: saved })
    } else if (action.kind === 'event') {
      // Slice N10：定点安排落盘为事件（对齐 POST /api/events：无 createdAt/updatedAt）
      const startTs = Date.parse(String(action.startAt ?? ''))
      if (!Number.isFinite(startTs)) continue // 纵深防御：无效 startAt 不落地
      const record = {
        id: await nextId('events'),
        title: action.title,
        startAt: action.startAt,
        allDay: action.allDay === true,
        status: 'confirmed',
        tags,
      }
      if (
        typeof action.endAt === 'string' &&
        Number.isFinite(Date.parse(action.endAt)) &&
        Date.parse(action.endAt) >= startTs
      ) {
        record.endAt = action.endAt
      }
      if (typeof action.location === 'string' && action.location.trim() !== '') {
        record.location = action.location.trim()
      }
      const projectId = resolveProjectForAction(action, newProject)
      if (projectId !== undefined) record.projectId = projectId
      if (action.areaId !== undefined) record.areaId = action.areaId
      saved = await commit('events', record, {
        action: 'event.create',
        entity: 'event',
        id: record.id,
        detail: { title: record.title, via: 'inbox.apply' },
      })
      created.push({ kind: 'events', record: saved })
    } else {
      const isFile = item.file !== undefined && item.file !== null
      const record = {
        id: await nextId('resources'),
        title: action.title,
        kind: isFile ? 'file' : 'article',
        status: 'unread',
        tags,
        addedAt: now,
      }
      if (isFile) record.path = path.join(FILES_DIR, `${item.id}-${item.file.name}`)
      if (action.areaId !== undefined) record.areaId = action.areaId
      // Slice R2.5：把小结写入 resource.note（资料详情页「简介」）
      if (typeof action.note === 'string' && action.note.trim() !== '') {
        record.note = action.note.trim()
      }
      // Slice N2：条目含网页链接时，把 resource.url 端到端持久化（Zod 已验形状）
      if (typeof action.url === 'string' && action.url.trim() !== '') {
        record.url = action.url.trim()
      }
      saved = await commit('resources', record, {
        action: 'resource.create',
        entity: 'resource',
        id: record.id,
        detail: { title: record.title, via: 'inbox.apply' },
      })
      created.push({ kind: 'resources', record: saved })
    }
    linkedIds.push(saved.id)
    trackTags(tags, saved.id)
  }

  // 录入即生成：本批次新标签以 origin 'ai' 登记（撤销时按 appliedTagIds 清理）
  let appliedTagIds = []
  if (tagFirstUsed.size > 0) {
    const registered = await ensureTags([...tagFirstUsed.keys()], {
      origin: 'ai',
      firstUsedInMap: Object.fromEntries(tagFirstUsed),
    })
    appliedTagIds = registered.map((tag) => tag.id)
  }

  // 政策信号（v0.5 · Slice N0）：本批次已应用动作里出现的义务适用条件（去重、保持首见顺序），
  // 仅作审计留痕，不落实体字段
  const conditions = []
  for (const action of actions) {
    if (action.kind !== 'task' || typeof action.condition !== 'string') continue
    const condition = action.condition.trim()
    if (condition === '' || conditions.includes(condition)) continue
    conditions.push(condition)
  }

  const nextItem = { ...item, status: 'clarified', linkedId: linkedIds[0], linkedIds, appliedTagIds }
  // Slice N4：summary 仅在本批次提供且非空时落档（缺省不写，兼容旧调用 / 旧记录）
  if (summary !== '') nextItem.summary = summary
  const savedItem = await commit(
    'inbox',
    nextItem,
    {
      action: 'inbox.apply',
      entity: 'inboxItem',
      id,
      detail: {
        created: created.map((entry) => ({ kind: entry.kind, id: entry.record.id })),
        projectId: newProject?.id ?? null,
        signals: { conditions },
        ai: true,
      },
    },
  )
  return { inbox: savedItem, created, project: newProject }
}

/**
 * 撤销 / 恢复条目（v0.5 · Slice V/F15/F37；Slice R1 扩展为多产物）：
 *   · clarified → 删除全部联动产物（linkedIds，兼容旧单 linkedId）+ 清理本次新建标签 → unprocessed；
 *   · discarded → 无产物，仅重置回 unprocessed（即「恢复」）；
 *   · unprocessed → 幂等无操作。
 * action 区分入口：revert（生命周期撤回 / 恢复）与 unapply（一揽子应用的撤销）。
 */
async function detachInbox(id, action) {
  const item = await readEntity('inbox', id)
  if (item === null) throw Object.assign(new Error('条目不存在'), { status: 404 })
  if (item.status === 'unprocessed') return { inbox: item, removed: null, removedAll: [] }

  const linked =
    Array.isArray(item.linkedIds) && item.linkedIds.length > 0
      ? item.linkedIds
      : typeof item.linkedId === 'string'
        ? [item.linkedId]
        : []
  const removedAll = []
  for (const linkedId of linked) {
    const kind = kindOfId(linkedId)
    if (kind === null) continue
    if ((await readEntity(kind, linkedId)) === null) continue
    await remove(kind, linkedId, {
      action: 'inbox.revert.remove',
      entity: kind,
      id: linkedId,
      detail: { fromInbox: id },
    })
    removedAll.push({ kind, id: linkedId })
  }
  if (Array.isArray(item.appliedTagIds) && item.appliedTagIds.length > 0) {
    await pruneTags(item.appliedTagIds)
  }
  const next = { ...item, status: 'unprocessed' }
  delete next.linkedId
  delete next.linkedIds
  delete next.appliedTagIds
  // Slice N4：summary 是 apply 期元数据，撤回 / 恢复后一并清除，避免陈旧摘要残留
  delete next.summary
  const saved = await commit('inbox', next, {
    action,
    entity: 'inboxItem',
    id,
    detail: removedAll.length > 0 ? { removedCount: removedAll.length } : {},
  })
  return { inbox: saved, removed: removedAll[0] ?? null, removedAll }
}

/** 撤回已澄清 / 恢复已丢弃（生命周期入口） */
async function revertInbox(id) {
  return detachInbox(id, 'inbox.revert')
}

/** 撤销一揽子应用（Slice R1）：与 revert 同语义（删除全部产物并恢复注册表基线） */
async function unapplyInbox(id) {
  return detachInbox(id, 'inbox.unapply')
}

/* ---------------------------------------------------------------------------
 * 回顾（v0.5 · Slice C：AI 草稿确认后落盘；撤销即删除）
 * ------------------------------------------------------------------------- */

/**
 * 创建回顾：服务端计算 id / 周期 / 指标 / 停滞项目（用户只提供摘要与决策）。
 * body.type='monthly' 时走月窗口（periodKey=YYYY-MM / computeMonthMetrics），缺省周（行为不变，Slice F）。
 */
async function createReview(body) {
  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  if (summary === '') throw Object.assign(new Error('摘要不能为空'), { status: 400 })
  if (!Array.isArray(body.decisions)) throw Object.assign(new Error('决策必须为数组'), { status: 400 })
  const decisions = body.decisions.map((item) => (typeof item === 'string' ? item.trim() : ''))
  if (decisions.some((item) => item === '')) {
    throw Object.assign(new Error('决策不能为空字符串'), { status: 400 })
  }
  const monthly = body.type === 'monthly'
  const snapshot = await readSnapshot()
  const now = new Date()
  const review = {
    id: await nextId('reviews'),
    type: monthly ? 'monthly' : 'weekly',
    periodKey: monthly ? monthKey(now) : isoWeekKey(now),
    date: nowIso(),
    metrics: monthly ? computeMonthMetrics(snapshot, now) : computeWeekMetrics(snapshot, now),
    decisions,
    summary,
    staleProjectIds: staleProjects(snapshot, 14, now).map((project) => project.id),
    source: body.source === 'ai' ? 'ai' : 'manual',
  }
  const saved = await commit('reviews', review, {
    action: 'review.create',
    entity: 'review',
    id: review.id,
    detail: { source: review.source },
  })
  return { review: saved }
}

/**
 * 编辑回顾（v0.5 · Slice L，见 ADR-0013）：白名单仅 summary / decisions；
 * 保留 id / type / periodKey / date / metrics / staleProjectIds；递增 updatedAt；
 * 审计 review.update（detail.fields 记录改动键）。供「保存回顾」更新自动归档的同一记录
 * （避免重复建记录）。
 */
async function updateReview(id, body) {
  const review = await readEntity('reviews', id)
  if (review === null) throw Object.assign(new Error('回顾不存在'), { status: 404 })
  const next = { ...review }
  const fields = []
  if (Object.prototype.hasOwnProperty.call(body, 'summary')) {
    const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
    if (summary === '') throw Object.assign(new Error('摘要不能为空'), { status: 400 })
    if (next.summary !== summary) {
      next.summary = summary
      fields.push('summary')
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, 'decisions')) {
    if (!Array.isArray(body.decisions)) {
      throw Object.assign(new Error('决策必须为数组'), { status: 400 })
    }
    const decisions = body.decisions.map((item) => (typeof item === 'string' ? item.trim() : ''))
    if (decisions.some((item) => item === '')) {
      throw Object.assign(new Error('决策不能为空字符串'), { status: 400 })
    }
    if (JSON.stringify(next.decisions) !== JSON.stringify(decisions)) {
      next.decisions = decisions
      fields.push('decisions')
    }
  }
  next.updatedAt = nowIso()
  const saved = await commit('reviews', next, {
    action: 'review.update',
    entity: 'review',
    id,
    detail: { fields },
  })
  return { review: saved }
}

/** 删除回顾（撤销保存 / 手动清理） */
async function removeReview(id) {
  const review = await readEntity('reviews', id)
  if (review === null) throw Object.assign(new Error('回顾不存在'), { status: 404 })
  await remove('reviews', id, { action: 'review.remove', entity: 'review', id })
  return { removed: { kind: 'reviews', id } }
}

/* ---------------------------------------------------------------------------
 * 编辑 / 回收站 / 文件位置（v0.5 · Slice E2，见 ADR-0009）
 * ------------------------------------------------------------------------- */

/**
 * 编辑实体：仅接受白名单字段；保留 id / createdAt；更新 updatedAt；经 kind 的 schema 校验。
 * body 中值为 null 的字段视为「清除」（从记录删除该键）。返回 { record }。
 */
async function updateEntity(kind, id, body) {
  const record = await readEntity(kind, id)
  if (record === null) throw Object.assign(new Error('记录不存在'), { status: 404 })
  const next = { ...record }
  const fields = []
  let hasField = false
  let tagList = null
  for (const key of EDITABLE_FIELDS[kind]) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue
    hasField = true
    let value = body[key]
    if (key === 'tags' && Array.isArray(value)) {
      // 标签规格化（裸名 → topic: 前缀等，Slice T）
      value = normalizeTagList(value)
      tagList = value
    }
    // Slice R3：编辑父任务时校验存在性 / 自引用 / 环（null = 清除，合法无需校验）
    if (key === 'parentTaskId' && value !== null) {
      await assertValidParentTask(id, value)
    }
    if (value === null) {
      if (Object.prototype.hasOwnProperty.call(next, key)) {
        delete next[key]
        fields.push(key)
      }
      continue
    }
    const before = JSON.stringify(next[key])
    next[key] = value
    if (before !== JSON.stringify(value)) fields.push(key)
  }
  // 日程跨字段校验（Slice W）：endAt 早于 startAt → 400；endAt 置空 = 清除结束（单点日程）
  if (kind === 'events' && next.startAt !== undefined && next.endAt !== undefined) {
    if (new Date(next.endAt).getTime() < new Date(next.startAt).getTime()) {
      throw Object.assign(new Error('结束时间不能早于开始时间'), { status: 400 })
    }
  }
  // 课程时段校验（Slice H0）：sessions 变动时规格化 + 强制 ≥1 且 end ≥ start；
  // null 清除 sessions 会令键被删除，normalize 收到 undefined → 可读 400「课程至少需要一个上课时段」
  if (
    kind === 'courses' &&
    (Object.prototype.hasOwnProperty.call(body, 'sessions') ||
      Object.prototype.hasOwnProperty.call(next, 'sessions'))
  ) {
    next.sessions = normalizeCourseSessions(next.sessions)
  }
  // 空 patch = 「touch」（Slice E2.5 回顾页「迁移」）：仍 bump updatedAt，审计 <singular>.touch
  // 日程 / 区域 / 目标 / 习惯无 updatedAt 字段（对齐既有形状），仅审计、不加时间戳
  if (!NO_TIMESTAMP_KINDS.has(kind)) next.updatedAt = nowIso()
  const saved = await commit(kind, next, {
    action: hasField ? `${SINGULAR[kind]}.update` : `${SINGULAR[kind]}.touch`,
    entity: SINGULAR[kind],
    id,
    // 审计自描述（Slice S）：状态变更时留新状态原值（中文可读判断留给前端）；title 由 commit 自动并入
    detail: { fields, ...(fields.includes('status') && typeof next.status === 'string' ? { status: next.status } : {}) },
  })
  // 录入即生成：编辑携带的新标签登记（origin 'manual'）
  if (tagList !== null && tagList.length > 0) await ensureTags(tagList, { origin: 'manual', firstUsedIn: id })
  return { record: saved }
}

/**
 * 分离式启动本地进程（Slice E2 / J2）：detached + stdio ignore + unref——
 * 不阻塞请求、不随数据服务退出（本地个人工具，无额外限制；见 ADR-0009 / ADR-0008）。
 */
function spawnDetached(command, args, extra = {}) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true, ...extra })
  // 启动失败（如可执行文件缺失）静默到 stdio ignore 后外部不可见——显式记入数据服务日志，便于诊断
  child.on('error', (err) => {
    console.error(`[local] ${command} 启动失败：`, err?.message ?? err)
  })
  child.unref()
}

/** 校验本地路径存在（不存在即 404）；返回是否目录 */
async function statLocalPath(raw) {
  if (raw === '') throw Object.assign(new Error('路径不能为空'), { status: 400 })
  const resolved = path.resolve(raw)
  if (!existsSync(resolved)) throw Object.assign(new Error('文件不存在'), { status: 404 })
  let stat
  try {
    stat = await fs.stat(resolved)
  } catch {
    throw Object.assign(new Error('文件不存在'), { status: 404 })
  }
  return { resolved, isDirectory: stat.isDirectory() }
}

/**
 * 在文件管理器中显示（Slice E2 · 仅本机）：校验路径存在后以 explorer.exe 打开。
 * 文件 → `/select,` 定位并选中；目录 → 直接打开。
 */
async function revealPath(body) {
  const raw = typeof body.path === 'string' ? body.path.trim() : ''
  const { resolved, isDirectory } = await statLocalPath(raw)
  if (isDirectory) {
    spawnDetached('explorer.exe', [resolved])
  } else {
    // 原生规范形式：`/select,"<path>"` 作为单参数整体传入，不加引号会被 explorer 二次解析
    spawnDetached('explorer.exe', [`/select,"${resolved}"`], { windowsVerbatimArguments: true })
  }
  return { ok: true }
}

/**
 * 以系统默认程序打开本地文件 / 目录（Slice J2 · 仅本机）：`cmd /c start "" "<path>"`。
 * start 负责走文件关联（.docx → Word 等）；detached + windowsHide：不弹控制台、不阻塞请求。
 * body.dryRun === true 时仅解析 + 校验并回传路径，**绝不 spawn**（自动化测试专用；真实 UI 永不传）。
 */
async function openPath(body) {
  const raw = typeof body.path === 'string' ? body.path.trim() : ''
  const { resolved } = await statLocalPath(raw)
  if (body.dryRun === true) return { ok: true, path: resolved, dryRun: true }
  spawnDetached('cmd.exe', ['/c', 'start', '', resolved])
  return { ok: true, path: resolved }
}

/**
 * 解析收件箱附件绝对路径（Slice J2）：条目 / 附件元数据 / 磁盘文件三重校验，缺一即 404。
 * 附件命名规则与上传 / 读取一致：`data/files/<id>-<file.name>`（见 ADR-0008）。
 */
async function resolveInboxFile(id) {
  const item = await readEntity('inbox', id)
  if (item === null || item.file === undefined || item.file === null) {
    throw Object.assign(new Error('文件不存在'), { status: 404 })
  }
  const filePath = path.join(FILES_DIR, `${id}-${item.file.name}`)
  try {
    await fs.stat(filePath)
  } catch {
    throw Object.assign(new Error('文件不存在'), { status: 404 })
  }
  return filePath
}

/**
 * 收件箱附件本机动作（Slice J2）：action='open' 以默认程序打开；action='reveal' 在文件管理器中定位。
 * body.dryRun === true 时仅解析 + 校验并回传路径，**绝不 spawn**（自动化测试专用；真实 UI 永不传）。
 */
async function inboxFileAction(id, action, body) {
  const filePath = await resolveInboxFile(id)
  if (body.dryRun === true) return { ok: true, path: filePath, dryRun: true }
  if (action === 'open') {
    spawnDetached('cmd.exe', ['/c', 'start', '', filePath])
    return { ok: true, path: filePath }
  }
  // 原生规范形式：`/select,"<path>"` 作为单参数整体传入（同 revealPath）
  spawnDetached('explorer.exe', [`/select,"${filePath}"`], { windowsVerbatimArguments: true })
  return { ok: true, path: filePath }
}

/* ---------------------------------------------------------------------------
 * 路由
 * ------------------------------------------------------------------------- */

const TASK_ID_RE = /^\/api\/tasks\/([^/]+)\/(complete|reopen)$/
const INBOX_ID_RE = /^\/api\/inbox\/([^/]+)\/(clarify|revert)$/
const INBOX_REMOVE_RE = /^\/api\/inbox\/([^/]+)\/remove$/
/** 长截图 AI 分片上传（RAW body）：/api/inbox/<id>/ai-preview?index=N（派生辅助资源，无审计） */
const INBOX_AI_PREVIEW_RE = /^\/api\/inbox\/([^/]+)\/ai-preview$/
/** 附件本机动作（Slice J2）：/api/inbox/<id>/(open|reveal) */
const INBOX_FILE_ACTION_RE = /^\/api\/inbox\/([^/]+)\/(open|reveal)$/
/** 一揽子应用 / 撤销（Slice R1）：/api/inbox/<id>/(apply|unapply) */
const INBOX_APPLY_RE = /^\/api\/inbox\/([^/]+)\/apply$/
const INBOX_UNAPPLY_RE = /^\/api\/inbox\/([^/]+)\/unapply$/
const FILES_RE = /^\/api\/files\/([^/]+)$/
const AI_INBOX_PARSE_RE = /^\/api\/ai\/inbox\/([^/]+)\/parse$/
const AI_INBOX_PARSE_STREAM_RE = /^\/api\/ai\/inbox\/([^/]+)\/parse-stream$/
const REVIEW_REMOVE_RE = /^\/api\/reviews\/([^/]+)\/remove$/
/** 编辑归档回顾（Slice L）：/api/reviews/<id>/update */
const REVIEW_UPDATE_RE = /^\/api\/reviews\/([^/]+)\/update$/
/** 编辑 / 移入回收站（Slice E2）：/api/<kind>/<id>/(update|trash) */
const EDITABLE_GROUP = EDITABLE_KINDS.join('|')
const ENTITY_ACTION_RE = new RegExp(`^/api/(${EDITABLE_GROUP})/([^/]+)/(update|trash)$`)
/** 日程删除（Slice W）：/api/events/<id>/remove（审计 event.remove；与通用 /trash 同语义） */
const EVENT_REMOVE_RE = /^\/api\/events\/([^/]+)\/remove$/
/** 课程删除（Slice H0）：/api/courses/<id>/remove（审计 course.remove；与通用 /trash 同语义） */
const COURSE_REMOVE_RE = /^\/api\/courses\/([^/]+)\/remove$/
/** 区域 / 目标 / 习惯（Slice X）：/api/<kind>/<id>/(update|remove) —— remove 带引用护栏 */
const AREA_ACTION_RE = /^\/api\/areas\/([^/]+)\/(update|remove)$/
const GOAL_ACTION_RE = /^\/api\/goals\/([^/]+)\/(update|remove)$/
const HABIT_ACTION_RE = /^\/api\/habits\/([^/]+)\/(update|remove)$/
/** 习惯打卡（Slice X）：/api/habits/<id>/(checkin|uncheckin) */
const HABIT_CHECKIN_RE = /^\/api\/habits\/([^/]+)\/(checkin|uncheckin)$/
/** 回收站恢复 / 彻底删除：/api/trash/<kind>/<id>/(restore|purge)（含 areas/goals/habits） */
const TRASHABLE_GROUP = TRASHABLE_KINDS.join('|')
const TRASH_ITEM_RE = new RegExp(`^/api/trash/(${TRASHABLE_GROUP})/([^/]+)/(restore|purge)$`)
/** 标签管理（Slice T）：/api/tags/<id>/(update|merge|remove) */
const TAG_ACTION_RE = /^\/api\/tags\/([^/]+)\/(update|merge|remove)$/

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}:${PORT}`)
  const pathname = url.pathname
  const method = req.method ?? 'GET'

  try {
    if (method === 'GET' && pathname === '/api/health') {
      send(res, 200, { ok: true, service: 'kernel-data', version: SERVICE_VERSION, time: nowIso() })
      return
    }
    if (method === 'GET' && pathname === '/api/snapshot') {
      send(res, 200, await readSnapshot())
      return
    }
    if (method === 'GET' && pathname === '/api/activity') {
      const limit = Math.min(Number(url.searchParams.get('limit') ?? 20) || 20, 200)
      send(res, 200, { items: await readActivity(limit) })
      return
    }
    if (method === 'GET' && pathname === '/api/trash') {
      send(res, 200, { items: await readTrash() })
      return
    }
    const filesMatch = FILES_RE.exec(pathname)
    if (method === 'GET' && filesMatch !== null) {
      const id = decodeURIComponent(filesMatch[1])
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      await serveFile(res, id)
      return
    }
    if (method === 'GET' && pathname === '/api/ai/health') {
      // Slice N5：追加 hasKey（= 本机 secrets 里有非空 deepseekApiKey；不影响现有字段）
      const health = await getAiHealth()
      send(res, 200, { ...health, hasKey: getDeepseekKey() !== '' })
      return
    }
    // AI Key 保存 / 清除（Slice N5）：存本机 data/meta/secrets.json（gitignore，绝不入库）；
    // 写后审计 ai.key.update（detail 仅 hasKey，绝不落 key 明文）。
    if (method === 'POST' && pathname === '/api/ai/key') {
      const { apiKey } = aiKeyUpdateSchema.parse(await readBody(req))
      const saved = await setDeepseekKey(apiKey)
      const hasKey = typeof saved.deepseekApiKey === 'string' && saved.deepseekApiKey !== ''
      await recordAudit({ action: 'ai.key.update', entity: 'ai', id: '-', detail: { hasKey } })
      console.log(`[data] ai.key.update hasKey=${hasKey}`)
      send(res, 200, { ok: true, hasKey })
      return
    }
    const aiParseMatch = AI_INBOX_PARSE_RE.exec(pathname)
    if (method === 'POST' && aiParseMatch !== null) {
      const id = decodeURIComponent(aiParseMatch[1])
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const item = await readEntity('inbox', id)
      if (item === null) return fail(res, 404, '条目不存在')
      if (item.status !== 'unprocessed') return fail(res, 409, '该条目已澄清或已丢弃')
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await parseInboxItem(item)
      } catch (err) {
        console.error(`[ai] inbox.parse ${id} 失败：`, err?.message ?? err)
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      console.log(`[ai] inbox.parse ${id} ok ${result.ms}ms`)
      send(res, 200, result)
      return
    }
    const aiParseStreamMatch = AI_INBOX_PARSE_STREAM_RE.exec(pathname)
    if (method === 'POST' && aiParseStreamMatch !== null) {
      const id = decodeURIComponent(aiParseStreamMatch[1])
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const item = await readEntity('inbox', id)
      if (item === null) return fail(res, 404, '条目不存在')
      if (item.status !== 'unprocessed') return fail(res, 409, '该条目已澄清或已丢弃')
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')

      // SSE：前置校验全部通过后才切入事件流
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders()
      let sseClosed = false
      req.on('close', () => {
        sseClosed = true
      })
      const emit = (event) => {
        if (sseClosed || res.writableEnded) return
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      try {
        await parseInboxItemStream(item, emit)
      } catch (err) {
        console.error(`[ai] inbox.parse-stream ${id} 失败：`, err?.message ?? err)
        emit({ kind: 'error', message: err?.message ?? 'AI 调用失败' })
      } finally {
        if (!sseClosed && !res.writableEnded) res.end()
      }
      return
    }
    // 课表解析（Slice H1）：课表来源（xlsx / 截图 / 粘贴文本）→ 课程草稿（绝不自动落盘）
    if (method === 'POST' && pathname === '/api/ai/timetable/draft') {
      const body = await readBody(req)
      const id = typeof body.id === 'string' ? body.id : ''
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const item = await readEntity('inbox', id)
      if (item === null) return fail(res, 404, '条目不存在')
      if (item.status !== 'unprocessed') return fail(res, 409, '该条目已澄清或已丢弃')
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await draftTimetable(item)
      } catch (err) {
        console.error(`[ai] timetable.draft ${id} 失败：`, err?.message ?? err)
        // 不可读附件护栏（OLE2 .xls / 扫描件等）抛 status 400 → 原样返回其指引
        if (typeof err?.status === 'number') return fail(res, err.status, err?.message ?? 'AI 调用失败')
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      console.log(`[ai] timetable.draft ${id} ok ${result.ms}ms`)
      send(res, 200, result)
      return
    }
    // 课表解析 · 流式（Slice H1.6）：与同步端点同前置校验；校验通过后切 SSE，
    // 脚手架逐字镜像 /api/ai/inbox/:id/parse-stream（id 取自 body，与同步端点同口径）。
    if (method === 'POST' && pathname === '/api/ai/timetable/draft-stream') {
      const body = await readBody(req)
      const id = typeof body.id === 'string' ? body.id : ''
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const item = await readEntity('inbox', id)
      if (item === null) return fail(res, 404, '条目不存在')
      if (item.status !== 'unprocessed') return fail(res, 409, '该条目已澄清或已丢弃')
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')

      // SSE：前置校验全部通过后才切入事件流
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      })
      res.flushHeaders()
      let sseClosed = false
      req.on('close', () => {
        sseClosed = true
      })
      const emit = (event) => {
        if (sseClosed || res.writableEnded) return
        res.write(`data: ${JSON.stringify(event)}\n\n`)
      }
      try {
        await draftTimetableStream(item, emit)
      } catch (err) {
        console.error(`[ai] timetable.draft-stream ${id} 失败：`, err?.message ?? err)
        emit({ kind: 'error', message: err?.message ?? 'AI 调用失败' })
      } finally {
        if (!sseClosed && !res.writableEnded) res.end()
      }
      return
    }
    // AI 对话（Slice G）：读库回答；历史有界（最近 20 条 / 单条 4000 字 / 合计 16000 字）
    if (method === 'POST' && pathname === '/api/ai/chat') {
      const body = await readBody(req)
      const raw = Array.isArray(body.messages) ? body.messages : []
      const messages = []
      let total = 0
      for (const entry of raw.slice(-CHAT_MAX_MESSAGES)) {
        if (entry === null || typeof entry !== 'object') continue
        const role =
          entry.role === 'assistant' ? 'assistant' : entry.role === 'user' ? 'user' : null
        if (role === null) continue
        const content =
          typeof entry.content === 'string' ? entry.content.slice(0, CHAT_MAX_CHARS).trim() : ''
        if (content === '') continue
        if (total + content.length > CHAT_TOTAL_CHARS) break
        total += content.length
        messages.push({ role, content })
      }
      if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
        return fail(res, 400, '对话内容不能为空，且最后一条必须为用户消息')
      }
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await chatWithKernel(messages)
      } catch (err) {
        console.error('[ai] chat 失败：', err?.message ?? err)
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      // 修改建议（只读）：校验 kind / id / fields 白名单；无效则回退文案且不下发 edits
      let reply = result.reply
      let edits = []
      if (result.editRequest !== null && result.editRequest !== undefined) {
        edits = await buildChatEdits(result.editRequest)
        if (edits.length === 0) {
          reply = '我没能确认这条记录的修改（找不到记录或字段不合法），请换一种说法再试。'
        }
      }
      console.log(`[ai] chat ok ${result.ms}ms`)
      send(res, 200, {
        reply,
        searched: result.searched,
        focused: result.focused,
        edits,
        model: result.model,
        ms: result.ms,
      })
      return
    }
    // 对话 → 笔记（Slice G.1）：把某条对话回答整理成独立笔记（AI 出草稿，服务端落盘；可撤销）
    if (method === 'POST' && pathname === '/api/ai/chat/note') {
      const body = await readBody(req)
      const parsed = chatNoteRequestSchema.safeParse(body)
      if (!parsed.success) return fail(res, 400, '整理要求或回答内容不合法')
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let draft
      try {
        draft = await draftChatNote(parsed.data.instruction, parsed.data.answer)
      } catch (err) {
        console.error('[ai] chat.note 失败：', err?.message ?? err)
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      const now = nowIso()
      const record = {
        id: await nextId('notes'),
        title: draft.title,
        type: 'memo',
        body: draft.body,
        links: [],
        tags: [],
        distillLevel: 0,
        createdAt: now,
        updatedAt: now,
      }
      const note = await commit('notes', record, {
        action: 'note.create',
        entity: 'note',
        id: record.id,
        detail: { title: record.title, via: 'chat.note' },
      })
      console.log(
        `[ai] chat.note ok ${draft.ms}ms（${draft.fallback ? '兜底' : draft.model ?? '未知模型'}）`,
      )
      send(res, 200, { note, model: draft.model, ms: draft.ms })
      return
    }
    // 任务快速新建 AI 补全（Slice H）：只填标题 → 建议（绝不自动落盘；应用走 /api/tasks/:id/update）
    if (method === 'POST' && pathname === '/api/ai/task/draft') {
      const body = await readBody(req)
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
      if (rawTitle === '') return fail(res, 400, '标题不能为空')
      const title = rawTitle.slice(0, TASK_DRAFT_MAX_TITLE_CHARS)
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await draftTask(title)
      } catch (err) {
        console.error('[ai] task.draft 失败：', err?.message ?? err)
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      console.log(`[ai] task.draft ok ${result.ms}ms`)
      send(res, 200, result)
      return
    }
    // 项目快速新建 AI 补全（Slice R1）：只填标题 → 建议完成定义 / 区域 / 标签（绝不自动落盘）
    if (method === 'POST' && pathname === '/api/ai/project/draft') {
      const body = await readBody(req)
      const rawTitle = typeof body.title === 'string' ? body.title.trim() : ''
      if (rawTitle === '') return fail(res, 400, '标题不能为空')
      const title = rawTitle.slice(0, PROJECT_DRAFT_MAX_TITLE_CHARS)
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await draftProject(title)
      } catch (err) {
        console.error('[ai] project.draft 失败：', err?.message ?? err)
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      console.log(`[ai] project.draft ok ${result.ms}ms`)
      send(res, 200, result)
      return
    }
    // 配置更新（Slice R2）：白名单 aiAutomation（confirm / auto）
    if (method === 'POST' && pathname === '/api/config') {
      const result = await applyConfigUpdate(await readBody(req))
      console.log(`[data] config.update aiAutomation=${result.config.aiAutomation}`)
      send(res, 200, result)
      return
    }
    // 学期信息更新（Slice H0）：startDate / totalWeeks 皆可选；审计 term.update
    if (method === 'POST' && pathname === '/api/term') {
      const patch = termUpdateSchema.parse(await readBody(req))
      const term = await updateTerm(patch)
      console.log('[data] term.update')
      send(res, 200, { term })
      return
    }
    // 笔记 AI 蒸馏（Slice M）：把笔记压缩到目标层级 → 返回草稿文本（绝不自动落盘）
    if (method === 'POST' && pathname === '/api/ai/note/distill') {
      const payload = noteDistillRequestSchema.parse(await readBody(req))
      const note = await readEntity('notes', payload.id)
      if (note === null) return fail(res, 404, '笔记不存在')
      const current = typeof note.distillLevel === 'number' ? note.distillLevel : 0
      // 缺省 = 当前层级 + 1；显式 targetLevel 与缺省值一并 clamp 到 1–3（封顶 L3）
      const target = Math.min(Math.max(payload.targetLevel ?? current + 1, 1), 3)
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await draftNoteDistill(note, target)
      } catch (err) {
        console.error('[ai] note.distill 失败：', err?.message ?? err)
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      console.log(`[ai] note.distill ok ${result.ms}ms（L${target}）`)
      send(res, 200, {
        text: result.text,
        targetLevel: target,
        model: result.model,
        ms: result.ms,
      })
      return
    }
    // 聚类立项草稿（Slice R2）：扫描无归属任务 + 未澄清条目 → 0~3 个「新项目」建议（只出建议，绝不落盘）
    if (method === 'POST' && pathname === '/api/ai/cluster/draft') {
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await draftClusters(await readSnapshot())
      } catch (err) {
        console.error('[ai] cluster.draft 失败：', err?.message ?? err)
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      console.log(`[ai] cluster.draft ok ${result.ms}ms（${result.proposals.length} 提案）`)
      send(res, 200, result)
      return
    }
    // AI 整理草稿（Slice N8）：无归属任务 → 先归入高度相关的现有项目，再用剩余条目建议新项目（只出建议，绝不落盘）
    if (method === 'POST' && pathname === '/api/ai/organize/draft') {
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await draftOrganize(await readSnapshot())
      } catch (err) {
        console.error('[ai] organize.draft 失败：', err?.message ?? err)
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      console.log(
        `[ai] organize.draft ok ${result.ms}ms（${result.assignments.length} 归并 / ${result.clusters.length} 新项目）`,
      )
      send(res, 200, result)
      return
    }
    if (method === 'POST' && pathname === '/api/ai/review/draft') {
      const body = await readBody(req)
      if (body.period !== undefined && body.period !== 'weekly' && body.period !== 'monthly') {
        return fail(res, 400, 'period 必须为 weekly 或 monthly')
      }
      const period = body.period === 'monthly' ? 'monthly' : 'weekly'
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await generateReviewDraft(period)
      } catch (err) {
        console.error('[ai] review.draft 失败：', err?.message ?? err)
        return fail(res, 502, err?.message ?? 'AI 调用失败')
      }
      // 自动归档（Slice L）：每次成功生成即落一条 review（审计 review.create + auto 标记），
      // 前端据此在「报告历史」按时间查阅；保存编辑走 /api/reviews/:id/update（不重复建）。
      const review = {
        id: await nextId('reviews'),
        type: period,
        periodKey: result.periodKey,
        // date 即归档时间（生成时刻）；updatedAt 由编辑路径 bump
        date: nowIso(),
        metrics: result.metrics,
        decisions: result.decisions,
        summary: result.summary,
        staleProjectIds: result.staleProjectIds,
        source: 'ai',
      }
      let saved
      try {
        saved = await commit('reviews', review, {
          action: 'review.create',
          entity: 'review',
          id: review.id,
          detail: { source: 'ai', auto: true, periodKey: review.periodKey, grounded: result.grounded },
        })
      } catch (err) {
        console.error('[ai] review.draft 归档失败：', err?.message ?? err)
        return fail(res, 500, `报告归档失败：${err?.message ?? err}`)
      }
      console.log(`[ai] review.draft ok ${result.ms}ms · 归档 ${saved.id}`)
      send(res, 200, { ...result, reviewId: saved.id, archivedAt: saved.date })
      return
    }
    if (method === 'POST' && pathname === '/api/reviews') {
      send(res, 201, await createReview(await readBody(req)))
      return
    }
    const reviewUpdateMatch = REVIEW_UPDATE_RE.exec(pathname)
    if (method === 'POST' && reviewUpdateMatch !== null) {
      const id = decodeURIComponent(reviewUpdateMatch[1])
      if (!validId('reviews', id)) return fail(res, 400, '回顾 id 格式不正确')
      const result = await updateReview(id, await readBody(req))
      console.log(`[data] review.update ${id}`)
      send(res, 200, result)
      return
    }
    const reviewRemoveMatch = REVIEW_REMOVE_RE.exec(pathname)
    if (method === 'POST' && reviewRemoveMatch !== null) {
      const id = decodeURIComponent(reviewRemoveMatch[1])
      if (!validId('reviews', id)) return fail(res, 400, '回顾 id 格式不正确')
      const result = await removeReview(id)
      console.log(`[data] review.remove ${id}`)
      send(res, 200, result)
      return
    }
    // 标签管理（Slice T）：扫描登记 / 重命名 / 合并 / 删除
    if (method === 'POST' && pathname === '/api/tags/backfill') {
      const result = await backfillTags()
      console.log(`[data] tag.backfill created=${result.created.length} scanned=${result.scanned}`)
      send(res, 200, result)
      return
    }
    const tagActionMatch = TAG_ACTION_RE.exec(pathname)
    if (method === 'POST' && tagActionMatch !== null) {
      const id = decodeURIComponent(tagActionMatch[1])
      if (!validId('tags', id)) return fail(res, 400, '标签 id 格式不正确')
      const action = tagActionMatch[2]
      if (action === 'update') {
        const patch = tagUpdateSchema.parse(await readBody(req))
        const result = await renameTag(id, patch)
        console.log(`[data] tag.rename ${id} → ${result.tag.name}（影响 ${result.affected}）`)
        send(res, 200, { tag: result.tag, affected: result.affected })
        return
      }
      if (action === 'merge') {
        const { targetId } = tagMergeSchema.parse(await readBody(req))
        const result = await mergeTags(id, targetId)
        console.log(`[data] tag.merge ${id} → ${targetId}（影响 ${result.affected}）`)
        send(res, 200, { tag: result.tag, affected: result.affected })
        return
      }
      const result = await removeTag(id)
      console.log(`[data] tag.remove ${id}`)
      send(res, 200, result)
      return
    }
    // 区域 / 目标 / 习惯 编辑 / 删除（Slice X）：remove 带引用护栏（区域 / 目标），未引用入回收站
    const areaActionMatch = AREA_ACTION_RE.exec(pathname)
    if (method === 'POST' && areaActionMatch !== null) {
      const id = decodeURIComponent(areaActionMatch[1])
      if (!validId('areas', id)) return fail(res, 400, '区域 id 格式不正确')
      if (areaActionMatch[2] === 'update') {
        const result = await updateEntity('areas', id, await readBody(req))
        console.log(`[data] area.update ${id}`)
        send(res, 200, result)
        return
      }
      const result = await removeArea(id)
      console.log(`[data] area.remove ${id}`)
      send(res, 200, result)
      return
    }
    const goalActionMatch = GOAL_ACTION_RE.exec(pathname)
    if (method === 'POST' && goalActionMatch !== null) {
      const id = decodeURIComponent(goalActionMatch[1])
      if (!validId('goals', id)) return fail(res, 400, '目标 id 格式不正确')
      if (goalActionMatch[2] === 'update') {
        const result = await updateEntity('goals', id, await readBody(req))
        console.log(`[data] goal.update ${id}`)
        send(res, 200, result)
        return
      }
      const result = await removeGoal(id)
      console.log(`[data] goal.remove ${id}`)
      send(res, 200, result)
      return
    }
    const habitActionMatch = HABIT_ACTION_RE.exec(pathname)
    if (method === 'POST' && habitActionMatch !== null) {
      const id = decodeURIComponent(habitActionMatch[1])
      if (!validId('habits', id)) return fail(res, 400, '习惯 id 格式不正确')
      if (habitActionMatch[2] === 'update') {
        const result = await updateEntity('habits', id, await readBody(req))
        console.log(`[data] habit.update ${id}`)
        send(res, 200, result)
        return
      }
      const result = await removeHabit(id)
      console.log(`[data] habit.remove ${id}`)
      send(res, 200, result)
      return
    }
    // 习惯打卡 / 取消打卡（Slice X）：幂等；date 缺省今天
    const habitCheckinMatch = HABIT_CHECKIN_RE.exec(pathname)
    if (method === 'POST' && habitCheckinMatch !== null) {
      const id = decodeURIComponent(habitCheckinMatch[1])
      if (!validId('habits', id)) return fail(res, 400, '习惯 id 格式不正确')
      const action = habitCheckinMatch[2]
      const result =
        action === 'checkin'
          ? await checkinHabit(id, await readBody(req))
          : await uncheckinHabit(id, await readBody(req))
      console.log(`[data] habit.${action} ${id} ${result.date}${result.changed === false ? '（已是最新）' : ''}`)
      send(res, 200, result)
      return
    }
    // 编辑 / 移入回收站（Slice E2）
    const entityActionMatch = ENTITY_ACTION_RE.exec(pathname)
    if (method === 'POST' && entityActionMatch !== null) {
      const kind = entityActionMatch[1]
      const id = decodeURIComponent(entityActionMatch[2])
      if (!validId(kind, id)) return fail(res, 400, 'id 格式不正确')
      if (entityActionMatch[3] === 'update') {
        const result = await updateEntity(kind, id, await readBody(req))
        console.log(`[data] ${SINGULAR[kind]}.update ${id}`)
        send(res, 200, result)
        return
      }
      const record = await moveToTrash(kind, id, {
        action: `${SINGULAR[kind]}.trash`,
        entity: SINGULAR[kind],
        id,
      })
      console.log(`[data] ${SINGULAR[kind]}.trash ${id}`)
      send(res, 200, { trashed: { kind, id }, record })
      return
    }
    // 日程删除（Slice W）：/api/events/<id>/remove → 回收站（审计 event.remove）
    const eventRemoveMatch = EVENT_REMOVE_RE.exec(pathname)
    if (method === 'POST' && eventRemoveMatch !== null) {
      const id = decodeURIComponent(eventRemoveMatch[1])
      if (!validId('events', id)) return fail(res, 400, '日程 id 格式不正确')
      const record = await moveToTrash('events', id, { action: 'event.remove', entity: 'event', id })
      console.log(`[data] event.remove ${id}`)
      send(res, 200, { trashed: { kind: 'events', id }, record })
      return
    }
    // 课程删除（Slice H0）：/api/courses/<id>/remove → 回收站（审计 course.remove）
    const courseRemoveMatch = COURSE_REMOVE_RE.exec(pathname)
    if (method === 'POST' && courseRemoveMatch !== null) {
      const id = decodeURIComponent(courseRemoveMatch[1])
      if (!validId('courses', id)) return fail(res, 400, '课程 id 格式不正确')
      const record = await moveToTrash('courses', id, { action: 'course.remove', entity: 'course', id })
      console.log(`[data] course.remove ${id}`)
      send(res, 200, { trashed: { kind: 'courses', id }, record })
      return
    }
    // 回收站恢复 / 彻底删除（Slice E2）
    const trashItemMatch = TRASH_ITEM_RE.exec(pathname)
    if (method === 'POST' && trashItemMatch !== null) {
      const kind = trashItemMatch[1]
      const id = decodeURIComponent(trashItemMatch[2])
      if (!validId(kind, id)) return fail(res, 400, 'id 格式不正确')
      if (trashItemMatch[3] === 'restore') {
        const record = await restoreFromTrash(kind, id, {
          action: `${SINGULAR[kind]}.restore`,
          entity: SINGULAR[kind],
          id,
        })
        console.log(`[data] ${SINGULAR[kind]}.restore ${id}`)
        send(res, 200, { kind, record })
        return
      }
      await purgeTrash(kind, id, {
        action: `${SINGULAR[kind]}.purge`,
        entity: SINGULAR[kind],
        id,
      })
      console.log(`[data] ${SINGULAR[kind]}.purge ${id}`)
      send(res, 200, { purged: { kind, id } })
      return
    }
    // 在文件管理器中显示（Slice E2 · 仅本机）
    if (method === 'POST' && pathname === '/api/reveal') {
      const result = await revealPath(await readBody(req))
      console.log(`[data] reveal ok`)
      send(res, 200, result)
      return
    }
    // 以默认程序打开本地文件 / 目录（Slice J2 · 仅本机）
    if (method === 'POST' && pathname === '/api/open') {
      const result = await openPath(await readBody(req))
      console.log(`[data] open ok`)
      send(res, 200, result)
      return
    }
    if (method === 'POST' && pathname === '/api/tasks') {
      send(res, 201, await createTask(await readBody(req)))
      return
    }
    // 新建日程（Slice W）：title + startAt 必填；endAt 可选（早于 startAt → 400）
    if (method === 'POST' && pathname === '/api/events') {
      const result = await createEvent(await readBody(req))
      console.log(`[data] event.create ${result.event.id}`)
      send(res, 201, result)
      return
    }
    // 课表导入（Slice H1）：一次写入多门课程（先全部校验，全部通过才逐条落盘）
    if (method === 'POST' && pathname === '/api/courses/import') {
      const result = await importCourses(await readBody(req))
      console.log(`[data] course.import ${result.created.length} 门（via timetable-import）`)
      send(res, 201, result)
      return
    }
    // 新建课程（Slice H0）：title 必填；sessions 1..16 且 endPeriod ≥ startPeriod
    if (method === 'POST' && pathname === '/api/courses') {
      const result = await createCourse(await readBody(req))
      console.log(`[data] course.create ${result.course.id}`)
      send(res, 201, result)
      return
    }
    // 新建区域 / 目标 / 习惯（Slice X）：见 ADR-0019
    if (method === 'POST' && pathname === '/api/areas') {
      const result = await createArea(await readBody(req))
      console.log(`[data] area.create ${result.area.id}`)
      send(res, 201, result)
      return
    }
    if (method === 'POST' && pathname === '/api/goals') {
      const result = await createGoal(await readBody(req))
      console.log(`[data] goal.create ${result.goal.id}`)
      send(res, 201, result)
      return
    }
    if (method === 'POST' && pathname === '/api/habits') {
      const result = await createHabit(await readBody(req))
      console.log(`[data] habit.create ${result.habit.id}`)
      send(res, 201, result)
      return
    }
    // 聚类立项 · 应用 / 撤销（Slice R2）：一次写入建项 + 归入任务；撤销精确复原
    if (method === 'POST' && pathname === '/api/projects/cluster-apply') {
      const result = await clusterApply(await readBody(req))
      console.log(`[data] project.cluster-apply ${result.project.id}（归入 ${result.assigned.length} 项）`)
      send(res, 201, result)
      return
    }
    if (method === 'POST' && pathname === '/api/projects/cluster-unapply') {
      const result = await clusterUnapply(await readBody(req))
      console.log(
        `[data] project.cluster-unapply ${result.trashed.id}（恢复 ${result.restoredTaskIds.length} 项）`,
      )
      send(res, 200, result)
      return
    }
    // AI 整理 · 应用 / 撤销（Slice N8）：先归入现有项目、再新建项目；撤销逐项精确 / 尽力复原
    if (method === 'POST' && pathname === '/api/projects/organize-apply') {
      const result = await organizeApply(await readBody(req))
      console.log(
        `[data] project.organize-apply（归并 ${result.assignments.length} 项 / 新建 ${result.projects.length} 项）`,
      )
      send(res, 201, result)
      return
    }
    if (method === 'POST' && pathname === '/api/projects/organize-unapply') {
      const result = await organizeUnapply(await readBody(req))
      console.log(
        `[data] project.organize-unapply（回收 ${result.trashed.length} 项 / 清理 ${result.clearedTaskIds.length} 项）`,
      )
      send(res, 200, result)
      return
    }
    if (method === 'POST' && pathname === '/api/projects') {
      send(res, 201, await createProject(await readBody(req)))
      return
    }
    if (method === 'POST' && pathname === '/api/notes') {
      send(res, 201, await createNote(await readBody(req)))
      return
    }
    // 新建资料（Slice Y）：title 必填；kind 缺省 article、status 缺省 unread；审计 resource.create
    if (method === 'POST' && pathname === '/api/resources') {
      const result = await createResource(await readBody(req))
      console.log(`[data] resource.create ${result.resource.id}`)
      send(res, 201, result)
      return
    }
    const taskMatch = TASK_ID_RE.exec(pathname)
    if (method === 'POST' && taskMatch !== null) {
      const id = decodeURIComponent(taskMatch[1])
      if (!validId('tasks', id)) return fail(res, 400, '任务 id 格式不正确')
      const action = taskMatch[2]
      const result = action === 'complete' ? await completeTask(id) : await reopenTask(id)
      console.log(`[data] task.${action} ${id}`)
      send(res, 200, result)
      return
    }
    if (method === 'POST' && pathname === '/api/inbox/upload') {
      const result = await uploadInbox(req, url)
      console.log(`[data] inbox.upload ${result.inbox.id}`)
      send(res, 201, result)
      return
    }
    if (method === 'POST' && pathname === '/api/inbox') {
      send(res, 201, await captureInbox(await readBody(req)))
      return
    }
    const inboxRemoveMatch = INBOX_REMOVE_RE.exec(pathname)
    if (method === 'POST' && inboxRemoveMatch !== null) {
      const id = decodeURIComponent(inboxRemoveMatch[1])
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const result = await removeInbox(id)
      console.log(`[data] inbox.remove ${id}`)
      send(res, 200, result)
      return
    }
    // 长截图 AI 分片上传（派生辅助资源）：落 data/files/<id>-ai-<index>.jpg，供解析时多发 file part。
    // 无审计（非用户数据；删除随条目一并清理）。RAW body = image/jpeg。
    const inboxPreviewMatch = INBOX_AI_PREVIEW_RE.exec(pathname)
    if (method === 'POST' && inboxPreviewMatch !== null) {
      const id = decodeURIComponent(inboxPreviewMatch[1])
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const index = Number(url.searchParams.get('index'))
      if (!Number.isInteger(index) || index < 1 || index > 6) return fail(res, 400, '预览分片序号不合法')
      const item = await readEntity('inbox', id)
      if (item === null) return fail(res, 404, '条目不存在')
      if (item.file === undefined || item.file === null || !isImageFile(item)) {
        return fail(res, 400, '该条目不是图片')
      }
      await fs.mkdir(FILES_DIR, { recursive: true })
      const dest = path.join(FILES_DIR, `${id}-ai-${index}.jpg`)
      try {
        await saveUpload(req, dest, MAX_PREVIEW_BYTES)
      } catch (err) {
        await fs.unlink(dest).catch(() => {})
        throw err
      }
      send(res, 201, { ok: true })
      return
    }
    const inboxFileMatch = INBOX_FILE_ACTION_RE.exec(pathname)
    if (method === 'POST' && inboxFileMatch !== null) {
      const id = decodeURIComponent(inboxFileMatch[1])
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const action = inboxFileMatch[2]
      const result = await inboxFileAction(id, action, await readBody(req))
      console.log(`[data] inbox.${action} ${id}${result.dryRun === true ? ' (dryRun)' : ''}`)
      send(res, 200, result)
      return
    }
    // 一揽子应用（Slice R1）：一次写入创建新项目（若有）+ 全部实体（linkToNewProject 自动挂接）
    const inboxApplyMatch = INBOX_APPLY_RE.exec(pathname)
    if (method === 'POST' && inboxApplyMatch !== null) {
      const id = decodeURIComponent(inboxApplyMatch[1])
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const result = await applyInboxActions(id, await readBody(req))
      console.log(`[data] inbox.apply ${id}（${result.created.length} 项）`)
      send(res, 200, result)
      return
    }
    // 撤销一揽子应用（Slice R1）：删除全部产物并恢复标签注册表基线
    const inboxUnapplyMatch = INBOX_UNAPPLY_RE.exec(pathname)
    if (method === 'POST' && inboxUnapplyMatch !== null) {
      const id = decodeURIComponent(inboxUnapplyMatch[1])
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const result = await unapplyInbox(id)
      console.log(`[data] inbox.unapply ${id}（移除 ${result.removedAll.length} 项）`)
      send(res, 200, result)
      return
    }
    const inboxMatch = INBOX_ID_RE.exec(pathname)
    if (method === 'POST' && inboxMatch !== null) {
      const id = decodeURIComponent(inboxMatch[1])
      if (!validId('inbox', id)) return fail(res, 400, '收件箱 id 格式不正确')
      const action = inboxMatch[2]
      const result =
        action === 'clarify'
          ? await clarifyInbox(id, await readBody(req))
          : await revertInbox(id)
      console.log(`[data] inbox.${action} ${id}`)
      send(res, 200, result)
      return
    }
    fail(res, 404, '接口不存在')
  } catch (err) {
    if (err !== null && typeof err === 'object' && Array.isArray(err.issues)) {
      const first = err.issues[0]
      const where = Array.isArray(first.path) && first.path.length > 0 ? `${first.path.join('.')}：` : ''
      fail(res, 400, `校验失败：${where}${first.message}`)
      return
    }
    const status = typeof err?.status === 'number' ? err.status : 500
    console.error(`[data] 处理 ${method} ${pathname} 失败：`, err?.message ?? err)
    fail(res, status, err?.message ?? '服务内部错误')
  }
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`[data] 端口 ${PORT} 已被占用（可能已有数据服务在运行）。`)
  } else {
    console.error('[data] 服务启动失败：', err)
  }
  process.exit(1)
})

server.listen(PORT, HOST, () => {
  console.log(`[data] KERNEL 数据服务已就绪：http://${HOST}:${PORT}（仅本机；写入唯一路径）`)
})
