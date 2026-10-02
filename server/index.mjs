// KERNEL · 数据服务 · HTTP 入口（唯一写入路径）
// 只监听 127.0.0.1:4097（永不暴露局域网；浏览器经 Vite 代理访问）。
// 路由：health / snapshot / activity / tasks(create·complete·reopen) / inbox(capture·clarify·revert)
import http from 'node:http'
import {
  commit,
  lastCompleteStatus,
  nextId,
  nowIso,
  readActivity,
  readEntity,
  readSnapshot,
  remove,
} from './store.mjs'
import { clarifyDetailsSchema, ID_PATTERNS } from './schemas.mjs'
import {
  computeWeekMetrics,
  generateReviewDraft,
  getAiHealth,
  isoWeekKey,
  parseInboxItem,
  parseInboxItemStream,
  staleProjects,
} from './ai.mjs'

const HOST = '127.0.0.1'
const PORT = 4097
const BODY_LIMIT = 256 * 1024
const SERVICE_VERSION = '0.4.0'

/** 澄清目标 → 实体 kind */
const CLARIFY_KINDS = { task: 'tasks', project: 'projects', note: 'notes', resource: 'resources' }

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
    record = {
      id: await nextId('resources'),
      title: details.title ?? item.content,
      kind: 'article',
      status: 'unread',
      tags: details.tags ?? [],
      addedAt: now,
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

/** 创建周回顾：服务端计算 id / 周期 / 指标 / 停滞项目（用户只提供摘要与决策） */
async function createReview(body) {
  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  if (summary === '') throw Object.assign(new Error('摘要不能为空'), { status: 400 })
  if (!Array.isArray(body.decisions)) throw Object.assign(new Error('决策必须为数组'), { status: 400 })
  const decisions = body.decisions.map((item) => (typeof item === 'string' ? item.trim() : ''))
  if (decisions.some((item) => item === '')) {
    throw Object.assign(new Error('决策不能为空字符串'), { status: 400 })
  }
  const snapshot = await readSnapshot()
  const now = new Date()
  const review = {
    id: await nextId('reviews'),
    type: 'weekly',
    periodKey: isoWeekKey(now),
    date: nowIso(),
    metrics: computeWeekMetrics(snapshot, now),
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
 * 路由
 * ------------------------------------------------------------------------- */

const TASK_ID_RE = /^\/api\/tasks\/([^/]+)\/(complete|reopen)$/
const INBOX_ID_RE = /^\/api\/inbox\/([^/]+)\/(clarify|revert)$/
const AI_INBOX_PARSE_RE = /^\/api\/ai\/inbox\/([^/]+)\/parse$/
const AI_INBOX_PARSE_STREAM_RE = /^\/api\/ai\/inbox\/([^/]+)\/parse-stream$/
const REVIEW_REMOVE_RE = /^\/api\/reviews\/([^/]+)\/remove$/

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
    if (method === 'POST' && pathname === '/api/ai/review/draft') {
      const health = await getAiHealth()
      if (health.available === false) return fail(res, 503, 'opencode 服务未就绪（127.0.0.1:4096）')
      let result
      try {
        result = await generateReviewDraft()
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
    if (method === 'POST' && pathname === '/api/tasks') {
      send(res, 201, await createTask(await readBody(req)))
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
    if (method === 'POST' && pathname === '/api/inbox') {
      send(res, 201, await captureInbox(await readBody(req)))
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
