// KERNEL · 数据服务 · HTTP 入口（唯一写入路径）
// 只监听 127.0.0.1:4097（永不暴露局域网；浏览器经 Vite 代理访问）。
// 路由：health / snapshot / activity / tasks(create·complete·reopen) / inbox(capture·clarify·revert)
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
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
  readTrash,
  remove,
  removeTag,
  renameTag,
  restoreFromTrash,
  updateConfig,
} from './store.mjs'
import {
  clarifyDetailsSchema,
  clusterApplySchema,
  clusterUnapplySchema,
  configUpdateSchema,
  ID_PATTERNS,
  inboxApplySchema,
  taskCreateFieldsSchema,
  tagMergeSchema,
  tagUpdateSchema,
} from './schemas.mjs'
import {
  CHAT_MAX_CHARS,
  CHAT_MAX_MESSAGES,
  CHAT_TOTAL_CHARS,
  chatWithKernel,
  computeMonthMetrics,
  computeWeekMetrics,
  draftClusters,
  draftProject,
  draftTask,
  generateReviewDraft,
  getAiHealth,
  isoWeekKey,
  monthKey,
  parseInboxItem,
  parseInboxItemStream,
  PROJECT_DRAFT_MAX_TITLE_CHARS,
  staleProjects,
  TASK_DRAFT_MAX_TITLE_CHARS,
} from './ai.mjs'

const HOST = '127.0.0.1'
const PORT = 4097
const BODY_LIMIT = 256 * 1024
const SERVICE_VERSION = '0.4.0'
/** 文件投递单文件上限（RAW body；超出即 413 并中断请求） */
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
/** 附件二进制目录（不进 git；见 ADR-0008） */
const FILES_DIR = path.join(DATA_DIR, 'files')

/** 澄清目标 → 实体 kind */
const CLARIFY_KINDS = { task: 'tasks', project: 'projects', note: 'notes', resource: 'resources' }

/** 可编辑 / 可回收的实体 kind 白名单 */
const EDITABLE_KINDS = ['tasks', 'projects', 'notes', 'resources']
/** kind → 审计用单数名 */
const SINGULAR = { tasks: 'task', projects: 'project', notes: 'note', resources: 'resource' }
/** 任务创建可携带的可选字段顺序（Slice O；用于审计 detail.fields） */
const CREATE_FIELD_KEYS = [
  'contexts', 'energy', 'importance', 'estimateMin', 'dueAt', 'projectId', 'areaId', 'tags',
]
/** 各 kind 允许编辑的字段白名单（其余一律忽略，见 ADR-0009） */
const EDITABLE_FIELDS = {
  tasks: [
    'title', 'status', 'contexts', 'energy', 'importance', 'estimateMin',
    'dueAt', 'deferUntil', 'projectId', 'areaId', 'tags', 'notes',
  ],
  projects: ['title', 'outcome', 'status', 'areaId', 'goalId', 'nextActionId', 'dueAt', 'tags'],
  notes: ['title', 'type', 'body', 'areaId', 'projectId', 'tags', 'distillLevel'],
  resources: ['title', 'kind', 'status', 'url', 'path', 'areaId', 'tags', 'note'],
}

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

/** id 形状校验（防目录穿越；不匹配即 400） */
function validId(kind, id) {
  const pattern = ID_PATTERNS[kind]
  return pattern !== undefined && pattern.test(id)
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
  if (item.file !== undefined && item.file !== null) {
    await fs.unlink(path.join(FILES_DIR, `${id}-${item.file.name}`)).catch(() => {})
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
    targetIds.push(id)
  }
  if (targetIds.length === 0) {
    throw Object.assign(new Error('没有可归入的未归属任务'), { status: 400 })
  }
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
    title: title.slice(0, 60),
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
    detail: { title: project.title, via: 'cluster', memberCount: targetIds.length },
  })
  const assigned = []
  for (const id of targetIds) {
    const task = await readEntity('tasks', id)
    if (task === null) continue
    if (task.projectId !== undefined && task.projectId !== '') continue
    const next = { ...task, projectId: savedProject.id, updatedAt: nowIso() }
    await commit('tasks', next, {
      action: 'task.update',
      entity: 'task',
      id,
      detail: { fields: ['projectId'], projectId: savedProject.id, via: 'cluster' },
    })
    assigned.push(id)
  }
  return { project: savedProject, assigned, createdTagIds }
}

/**
 * 聚类立项 · 撤销（v0.5 · Slice R2）：清除本次归入任务的 projectId（恢复为无归属）→
 * 清理本次新建且已无人使用的标签 → 把项目移入回收站。精确回到应用前基线；审计各步。
 */
async function clusterUnapply(body) {
  const { projectId } = clusterUnapplySchema.parse(body)
  const project = await readEntity('projects', projectId)
  if (project === null) throw Object.assign(new Error('项目不存在'), { status: 404 })
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
      detail: { fields: ['projectId'], cleared: true, via: 'cluster-unapply' },
    })
    restoredTaskIds.push(id)
  }
  const tagIds = Array.isArray(project.clusterTagIds) ? project.clusterTagIds : []
  if (tagIds.length > 0) await pruneTags(tagIds)
  await moveToTrash('projects', projectId, {
    action: 'project.trash',
    entity: 'project',
    id: projectId,
    detail: { via: 'cluster-unapply', restoredTasks: restoredTaskIds.length },
  })
  return { trashed: { kind: 'projects', id: projectId }, restoredTaskIds }
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
  // 客户端的显式 null（"无关联"）统一移除，避免被当成臆造 id 拒绝
  let actions = parsed.actions.map((action) => {
    const out = { ...action }
    for (const key of ['projectId', 'areaId', 'dueAt', 'outcome', 'duplicateOf', 'note']) {
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

  const savedItem = await commit(
    'inbox',
    { ...item, status: 'clarified', linkedId: linkedIds[0], linkedIds, appliedTagIds },
    {
      action: 'inbox.apply',
      entity: 'inboxItem',
      id,
      detail: {
        created: created.map((entry) => ({ kind: entry.kind, id: entry.record.id })),
        projectId: newProject?.id ?? null,
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
  // 空 patch = 「touch」（Slice E2.5 回顾页「迁移」）：仍 bump updatedAt，审计 <singular>.touch
  next.updatedAt = nowIso()
  const saved = await commit(kind, next, {
    action: hasField ? `${SINGULAR[kind]}.update` : `${SINGULAR[kind]}.touch`,
    entity: SINGULAR[kind],
    id,
    detail: { fields },
  })
  // 录入即生成：编辑携带的新标签登记（origin 'manual'）
  if (tagList !== null && tagList.length > 0) await ensureTags(tagList, { origin: 'manual', firstUsedIn: id })
  return { record: saved }
}

/**
 * 分离式启动本地进程（Slice E2 / J2）：detached + stdio ignore + unref——
 * 不阻塞请求、不随数据服务退出（本地个人工具，无额外限制；见 ADR-0009 / ADR-0008）。
 */
function spawnDetached(command, args) {
  const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: true })
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
  const args = isDirectory ? [resolved] : ['/select,', resolved]
  spawnDetached('explorer.exe', args)
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
  spawnDetached('explorer.exe', ['/select,', filePath])
  return { ok: true, path: filePath }
}

/* ---------------------------------------------------------------------------
 * 路由
 * ------------------------------------------------------------------------- */

const TASK_ID_RE = /^\/api\/tasks\/([^/]+)\/(complete|reopen)$/
const INBOX_ID_RE = /^\/api\/inbox\/([^/]+)\/(clarify|revert)$/
const INBOX_REMOVE_RE = /^\/api\/inbox\/([^/]+)\/remove$/
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
/** 回收站恢复 / 彻底删除：/api/trash/<kind>/<id>/(restore|purge) */
const TRASH_ITEM_RE = new RegExp(`^/api/trash/(${EDITABLE_GROUP})/([^/]+)/(restore|purge)$`)
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
      send(res, 200, await getAiHealth())
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
      console.log(`[ai] chat ok ${result.ms}ms`)
      send(res, 200, result)
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
    if (method === 'POST' && pathname === '/api/projects') {
      send(res, 201, await createProject(await readBody(req)))
      return
    }
    if (method === 'POST' && pathname === '/api/notes') {
      send(res, 201, await createNote(await readBody(req)))
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
