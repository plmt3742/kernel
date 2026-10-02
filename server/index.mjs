// KERNEL · 数据服务 · HTTP 入口（唯一写入路径）
// 只监听 127.0.0.1:4097（永不暴露局域网；浏览器经 Vite 代理访问）。
// 路由：health / snapshot / activity / tasks(create·complete·reopen) / inbox(capture·clarify·revert)
import http from 'node:http'
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream, existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import {
  commit,
  DATA_DIR,
  lastCompleteStatus,
  moveToTrash,
  nextId,
  nowIso,
  purgeTrash,
  readActivity,
  readEntity,
  readSnapshot,
  readTrash,
  remove,
  restoreFromTrash,
} from './store.mjs'
import { clarifyDetailsSchema, ID_PATTERNS } from './schemas.mjs'
import {
  CHAT_MAX_CHARS,
  CHAT_MAX_MESSAGES,
  CHAT_TOTAL_CHARS,
  chatWithKernel,
  computeMonthMetrics,
  computeWeekMetrics,
  draftTask,
  generateReviewDraft,
  getAiHealth,
  isoWeekKey,
  monthKey,
  parseInboxItem,
  parseInboxItemStream,
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

async function createTask(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title === '') throw Object.assign(new Error('标题不能为空'), { status: 400 })
  const now = nowIso()
  const task = {
    id: await nextId('tasks'),
    title,
    status: 'next',
    contexts: ['@computer'],
    energy: 'low',
    importance: 2,
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
  const saved = await commit('tasks', task, {
    action: 'task.create',
    entity: 'task',
    id: task.id,
    detail: { title },
  })
  return { task: saved }
}

/** 新建项目：title 非空（400）；默认 active + 区域 a-0001 + 完成定义待整理（Slice E2.5） */
async function createProject(body) {
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (title === '') throw Object.assign(new Error('标题不能为空'), { status: 400 })
  const rawArea = typeof body.areaId === 'string' ? body.areaId.trim() : ''
  const now = nowIso()
  const project = {
    id: await nextId('projects'),
    title,
    outcome: '完成定义待整理',
    status: 'active',
    areaId: rawArea !== '' ? rawArea : 'a-0001',
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
  const saved = await commit('projects', project, {
    action: 'project.create',
    entity: 'project',
    id: project.id,
    detail: { title },
  })
  return { project: saved }
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
  const tags = Array.isArray(body.tags) ? body.tags.filter((tag) => typeof tag === 'string') : []
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
      tags: details.tags ?? [],
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
      tags: details.tags ?? [],
      distillLevel: 0,
      createdAt: now,
      updatedAt: now,
    }
  } else {
    // 资源：文件投递澄清为资料时记录附件绝对路径（Slice E2）；非文件条目行为不变
    const isFile = item.file !== undefined && item.file !== null
    record = {
      id: await nextId('resources'),
      title: isFile ? item.content : (details.title ?? item.content),
      kind: isFile ? 'file' : 'article',
      status: 'unread',
      tags: details.tags ?? [],
      addedAt: now,
    }
    if (isFile) {
      record.path = path.join(FILES_DIR, `${item.id}-${item.file.name}`)
    }
  }
  const savedRecord = await commit(kind, record, {
    action: `inbox.clarify.${target}`,
    entity: 'inboxItem',
    id,
    detail: { createdKind: kind, createdId: record.id, ai: aiFlag },
  })
  const savedItem = await commit('inbox', { ...item, status: 'clarified', linkedId: record.id }, {
    action: 'inbox.clarify',
    entity: 'inboxItem',
    id,
    detail: { target, linkedId: record.id, ai: aiFlag },
  })
  return { inbox: savedItem, created: { kind, record: savedRecord } }
}

async function revertInbox(id) {
  const item = await readEntity('inbox', id)
  if (item === null) throw Object.assign(new Error('条目不存在'), { status: 404 })
  if (item.status === 'unprocessed') return { inbox: item, removed: null }

  let removed = null
  if (typeof item.linkedId === 'string') {
    const kind =
      item.linkedId.startsWith('t-') ? 'tasks'
      : item.linkedId.startsWith('n-') ? 'notes'
      : item.linkedId.startsWith('r-') ? 'resources'
      : item.linkedId.startsWith('p-') ? 'projects'
      : null
    if (kind !== null && (await readEntity(kind, item.linkedId)) !== null) {
      await remove(kind, item.linkedId, {
        action: 'inbox.revert.remove',
        entity: kind,
        id: item.linkedId,
        detail: { fromInbox: id },
      })
      removed = { kind, id: item.linkedId }
    }
  }
  const next = { ...item, status: 'unprocessed' }
  delete next.linkedId
  const saved = await commit('inbox', next, {
    action: 'inbox.revert',
    entity: 'inboxItem',
    id,
    detail: removed !== null ? { removedKind: removed.kind, removedId: removed.id } : {},
  })
  return { inbox: saved, removed }
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
  }
  const source = body.source === 'ai' || body.source === 'manual' ? body.source : undefined
  const saved = await commit('reviews', review, {
    action: 'review.create',
    entity: 'review',
    id: review.id,
    detail: { source },
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
  for (const key of EDITABLE_FIELDS[kind]) {
    if (!Object.prototype.hasOwnProperty.call(body, key)) continue
    hasField = true
    const value = body[key]
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
const FILES_RE = /^\/api\/files\/([^/]+)$/
const AI_INBOX_PARSE_RE = /^\/api\/ai\/inbox\/([^/]+)\/parse$/
const AI_INBOX_PARSE_STREAM_RE = /^\/api\/ai\/inbox\/([^/]+)\/parse-stream$/
const REVIEW_REMOVE_RE = /^\/api\/reviews\/([^/]+)\/remove$/
/** 编辑 / 移入回收站（Slice E2）：/api/<kind>/<id>/(update|trash) */
const EDITABLE_GROUP = EDITABLE_KINDS.join('|')
const ENTITY_ACTION_RE = new RegExp(`^/api/(${EDITABLE_GROUP})/([^/]+)/(update|trash)$`)
/** 回收站恢复 / 彻底删除：/api/trash/<kind>/<id>/(restore|purge) */
const TRASH_ITEM_RE = new RegExp(`^/api/trash/(${EDITABLE_GROUP})/([^/]+)/(restore|purge)$`)

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
      console.log(`[ai] review.draft ok ${result.ms}ms`)
      send(res, 200, result)
      return
    }
    if (method === 'POST' && pathname === '/api/reviews') {
      send(res, 201, await createReview(await readBody(req)))
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
