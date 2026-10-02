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
import { ID_PATTERNS } from './schemas.mjs'

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

  if (target === 'discard') {
    const saved = await commit('inbox', { ...item, status: 'discarded' }, {
      action: 'inbox.discard',
      entity: 'inboxItem',
      id,
    })
    return { inbox: saved, created: null }
  }

  const kind = CLARIFY_KINDS[target]
  const now = nowIso()
  let record
  if (kind === 'tasks') {
    record = {
      id: await nextId('tasks'),
      title: item.content,
      status: 'next',
      contexts: ['@computer'],
      energy: 'low',
      importance: 2,
      tags: [],
      createdAt: now,
      updatedAt: now,
      sourceInboxId: item.id,
    }
  } else if (kind === 'projects') {
    // 澄清为项目：以「将来」+ 待整理完成定义入列，可在项目抽屉继续完善（撤销即删除）
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
    const title = item.content.length > 24 ? `${item.content.slice(0, 24)}…` : item.content
    record = {
      id: await nextId('notes'),
      title,
      type: 'fleeting',
      body: item.content,
      links: [],
      tags: [],
      distillLevel: 0,
      createdAt: now,
      updatedAt: now,
    }
  } else {
    record = {
      id: await nextId('resources'),
      title: item.content,
      kind: 'article',
      status: 'unread',
      tags: [],
      addedAt: now,
    }
  }
  const savedRecord = await commit(kind, record, {
    action: `inbox.clarify.${target}`,
    entity: 'inboxItem',
    id,
    detail: { createdKind: kind, createdId: record.id },
  })
  const savedItem = await commit('inbox', { ...item, status: 'clarified', linkedId: record.id }, {
    action: 'inbox.clarify',
    entity: 'inboxItem',
    id,
    detail: { target, linkedId: record.id },
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
 * 路由
 * ------------------------------------------------------------------------- */

const TASK_ID_RE = /^\/api\/tasks\/([^/]+)\/(complete|reopen)$/
const INBOX_ID_RE = /^\/api\/inbox\/([^/]+)\/(clarify|revert)$/

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
