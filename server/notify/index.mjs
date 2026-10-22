// KERNEL · 通知服务（Phase 1：企业微信群机器人 webhook · 仅出站）
// 职责：
//   - 服务端定时器：每日简报（默认 08:00）+ 任务到期提醒（默认提前 30 分钟）
//   - 去重 / 失败 3 次指数退避 / 状态可查（data/meta/notify-state.json）
//   - 入站预留：POST /api/wechat/inbound（Bearer token + 本机 + msgId 幂等 → 收件箱）
// 纪律：webhook URL / token 只读 secrets.json；绝不回显、绝不写日志 / 审计明文。
import { createHash, timingSafeEqual } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import writeFileAtomic from 'write-file-atomic'
import { audit, commit, DATA_DIR, nextId, nowIso, readConfig, readSnapshot } from '../store.mjs'
import { getWechatConfig } from '../secrets.mjs'
import { createWecomNotifier } from './wecom.mjs'
import { wechatInboundSchema } from '../schemas.mjs'

const STATE_FILE = path.join(DATA_DIR, 'meta', 'notify-state.json')
const DEFAULT_DIGEST_TIME = '08:00'
const DEFAULT_DUE_MINUTES = 30
const MAX_TEXT_BYTES = 1800
const BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000]
const OUTBOUND_KEEP_MS = 30 * 24 * 3600_000
const INBOUND_KEEP_MS = 30 * 24 * 3600_000

function defaultState() {
  return {
    digestSent: {},
    digestFailed: {},
    dueSent: {},
    dueFailed: {},
    inbound: {},
    failures: {},
    lastDigestAt: null,
    lastSendAt: null,
    lastError: null,
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

async function readState() {
  try {
    const parsed = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'))
    if (!isPlainObject(parsed)) return defaultState()
    const base = defaultState()
    return {
      ...base,
      ...parsed,
      digestSent: isPlainObject(parsed.digestSent) ? parsed.digestSent : {},
      digestFailed: isPlainObject(parsed.digestFailed) ? parsed.digestFailed : {},
      dueSent: isPlainObject(parsed.dueSent) ? parsed.dueSent : {},
      dueFailed: isPlainObject(parsed.dueFailed) ? parsed.dueFailed : {},
      inbound: isPlainObject(parsed.inbound) ? parsed.inbound : {},
      failures: isPlainObject(parsed.failures) ? parsed.failures : {},
    }
  } catch {
    return defaultState()
  }
}

function pruneState(state, now = Date.now()) {
  const keep = (value) => {
    const raw = value !== null && typeof value === 'object' ? value.at : value
    const at = Date.parse(raw)
    return Number.isFinite(at) && now - at <= OUTBOUND_KEEP_MS
  }
  for (const key of Object.keys(state.digestSent)) if (!keep(state.digestSent[key])) delete state.digestSent[key]
  for (const key of Object.keys(state.digestFailed)) if (!keep(state.digestFailed[key])) delete state.digestFailed[key]
  for (const key of Object.keys(state.dueSent)) if (!keep(state.dueSent[key])) delete state.dueSent[key]
  for (const key of Object.keys(state.dueFailed)) if (!keep(state.dueFailed[key])) delete state.dueFailed[key]
  for (const key of Object.keys(state.inbound)) {
    const at = Date.parse(state.inbound[key]?.at ?? '')
    if (!Number.isFinite(at) || now - at > INBOUND_KEEP_MS) delete state.inbound[key]
  }
  for (const key of Object.keys(state.failures)) {
    const at = Date.parse(state.failures[key]?.nextAt ?? '')
    if (Number.isFinite(at) && now - at > OUTBOUND_KEEP_MS) delete state.failures[key]
  }
}

let stateChain = Promise.resolve()
function persistState(state) {
  pruneState(state)
  return fs.mkdir(path.dirname(STATE_FILE), { recursive: true }).then(() =>
    writeFileAtomic(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, { encoding: 'utf8' }),
  )
}

/** 串行读改写 notify-state（避免定时器 / 入站并发覆盖）。 */
function withState(mutator) {
  const run = stateChain.then(async () => {
    const state = await readState()
    const result = await mutator(state)
    await persistState(state)
    return result
  })
  stateChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function pad(n) {
  return String(n).padStart(2, '0')
}

function dateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function hhmm(date) {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatTime(date) {
  return hhmm(date)
}

function formatDateTime(date) {
  return `${date.getMonth() + 1}/${date.getDate()} ${hhmm(date)}`
}

function isOpenTask(task) {
  return task !== null && typeof task === 'object' && task.status !== 'done' && task.status !== 'dropped'
}

function isDeferred(task, now) {
  if (typeof task?.deferUntil !== 'string') return false
  const until = Date.parse(task.deferUntil)
  return Number.isFinite(until) && until > now.getTime()
}

function clipText(text, maxBytes = MAX_TEXT_BYTES) {
  let out = ''
  for (const ch of text) {
    if (Buffer.byteLength(out + ch, 'utf8') > maxBytes) return `${out}\n…`
    out += ch
  }
  return out
}

/** 今日简报文本（导出供测试 / 探针复用）。 */
export function buildDigest(snapshot, now = new Date()) {
  const today = dateKey(now)
  const dayStart = startOfDay(now)
  const events = (snapshot.events ?? [])
    .filter((event) => event?.status !== 'cancelled' && typeof event?.startAt === 'string')
    .filter((event) => dateKey(new Date(event.startAt)) === today)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
  const dueToday = (snapshot.tasks ?? [])
    .filter((task) => isOpenTask(task) && !isDeferred(task, now) && typeof task.dueAt === 'string')
    .filter((task) => dateKey(new Date(task.dueAt)) === today)
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  const overdue = (snapshot.tasks ?? [])
    .filter((task) => isOpenTask(task) && !isDeferred(task, now) && typeof task.dueAt === 'string')
    .filter((task) => new Date(task.dueAt).getTime() < dayStart.getTime())
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
  const inbox = (snapshot.inbox ?? []).filter((item) => item?.status === 'unprocessed').length

  const lines = [`KERNEL 每日简报 · ${today}`, '']
  lines.push(`今日日程（${events.length}）`)
  if (events.length === 0) lines.push('- 无')
  for (const event of events.slice(0, 8)) {
    const time = event.allDay === true ? '全天' : formatTime(new Date(event.startAt))
    lines.push(`- ${time} ${event.title}`)
  }
  if (events.length > 8) lines.push(`- …另有 ${events.length - 8} 项`)
  lines.push('', `今日到期（${dueToday.length}）`)
  if (dueToday.length === 0) lines.push('- 无')
  for (const task of dueToday.slice(0, 8)) {
    lines.push(`- ${formatTime(new Date(task.dueAt))} ${task.title}`)
  }
  if (dueToday.length > 8) lines.push(`- …另有 ${dueToday.length - 8} 项`)
  lines.push('', `逾期（${overdue.length}）`)
  if (overdue.length === 0) lines.push('- 无')
  for (const task of overdue.slice(0, 8)) {
    lines.push(`- ${formatDateTime(new Date(task.dueAt))} ${task.title}`)
  }
  if (overdue.length > 8) lines.push(`- …另有 ${overdue.length - 8} 项`)
  lines.push('', `收件箱：${inbox} 条待澄清`)
  return clipText(lines.join('\n'))
}

/** 到期提醒文本（导出供测试 / 探针复用）。 */
export function buildDueReminder(task, now = new Date()) {
  const due = new Date(task.dueAt)
  const minutes = Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 60_000))
  return clipText(`KERNEL 到期提醒\n- ${task.title}\n截止：${formatTime(due)}（剩余 ${minutes} 分钟）`)
}

function dueCandidates(snapshot, now, minutes) {
  const limit = now.getTime() + minutes * 60_000
  return (snapshot.tasks ?? [])
    .filter((task) => isOpenTask(task) && !isDeferred(task, now) && typeof task.dueAt === 'string')
    .filter((task) => {
      const due = Date.parse(task.dueAt)
      return Number.isFinite(due) && due >= now.getTime() && due <= limit
    })
    .sort((a, b) => new Date(a.dueAt).getTime() - new Date(b.dueAt).getTime())
}

function digestKeyFor(now) {
  return dateKey(now)
}

function dueKeyFor(task) {
  return `${task.id}|${task.dueAt}`
}

function safeError(err) {
  const message = err instanceof Error ? err.message : String(err ?? 'send failed')
  return message.replace(/\s+/g, ' ').slice(0, 240)
}

async function recordSendAudit(detail) {
  await audit({ action: 'wechat.send', entity: 'notify', id: detail.kind, detail }).catch((err) => {
    console.error(`[notify] 审计写入失败：${safeError(err)}`)
  })
}

/**
 * 发送一条并落状态：成功去重；失败按 1 / 5 / 15 分钟退避，3 次后标记失败。
 * @param {{ notifier: { send: (text: string) => Promise<void> }, kind: 'digest'|'due', key: string, text: string, now: Date, dryRun?: boolean, force?: boolean }} input
 */
async function sendAndRecord({ notifier, kind, key, text, now, dryRun = false }) {
  const state = await readState()
  const sent = kind === 'digest' ? state.digestSent[key] : state.dueSent[key]
  const failed = kind === 'digest' ? state.digestFailed[key] : state.dueFailed[key]
  if (sent !== undefined || failed !== undefined) return { kind, key, skipped: 'already-sent' }
  const failure = state.failures[key]
  if (failure !== undefined && Date.parse(failure.nextAt ?? '') > now.getTime()) {
    return { kind, key, skipped: 'backoff', nextAt: failure.nextAt }
  }
  if (dryRun) return { kind, key, dryRun: true, text }
  try {
    await notifier.send(text)
    await withState((next) => {
      if (kind === 'digest') next.digestSent[key] = nowIso()
      else next.dueSent[key] = nowIso()
      delete next.failures[key]
      next.lastSendAt = nowIso()
      next.lastError = null
      if (kind === 'digest') next.lastDigestAt = nowIso()
    })
    await recordSendAudit({ kind, ok: true, chars: text.length })
    return { kind, key, ok: true }
  } catch (err) {
    const attempts = (failure?.attempts ?? 0) + 1
    const message = safeError(err)
    const nextAt = new Date(now.getTime() + (BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0])).toISOString()
    await withState((next) => {
      next.lastError = message
      if (attempts >= 3) {
        if (kind === 'digest') next.digestFailed[key] = { at: nowIso(), attempts, error: message }
        else next.dueFailed[key] = { at: nowIso(), attempts, error: message }
        delete next.failures[key]
      } else {
        next.failures[key] = { attempts, nextAt, kind }
      }
    })
    await recordSendAudit({ kind, ok: false, attempts, error: message })
    return { kind, key, ok: false, attempts, error: message, nextAt }
  }
}

let tickChain = Promise.resolve()

/**
 * 执行一次通知 tick（可被定时器 / 测试时钟调用）。
 * @param {Date} [now]
 * @param {{ dryRun?: boolean, forceDigest?: boolean }} [options]
 */
export function runNotifyTick(now = new Date(), options = {}) {
  const run = tickChain.then(() => tick(now, options))
  tickChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function tick(now, { dryRun = false, forceDigest = false } = {}) {
  const { webhookUrl } = getWechatConfig()
  if (webhookUrl === '') return { configured: false, messages: [], sent: 0 }
  const config = (await readConfig()) ?? {}
  const digestTime =
    typeof config.notifyDailyDigestTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(config.notifyDailyDigestTime)
      ? config.notifyDailyDigestTime
      : DEFAULT_DIGEST_TIME
  const dueMinutes =
    Number.isInteger(config.notifyDueReminderMinutes) && config.notifyDueReminderMinutes >= 1
      ? Math.min(config.notifyDueReminderMinutes, 1440)
      : DEFAULT_DUE_MINUTES
  const snapshot = await readSnapshot()
  const state = await readState()
  const notifier = createWecomNotifier(webhookUrl)
  const messages = []
  const today = digestKeyFor(now)
  const digestDue = forceDigest || (hhmm(now) >= digestTime && state.digestSent[today] === undefined && state.digestFailed[today] === undefined)
  if (digestDue) {
    messages.push(
      await sendAndRecord({
        notifier,
        kind: 'digest',
        key: today,
        text: buildDigest(snapshot, now),
        now,
        dryRun,
      }),
    )
  }
  for (const task of dueCandidates(snapshot, now, dueMinutes)) {
    const key = dueKeyFor(task)
    if (state.dueSent[key] !== undefined || state.dueFailed[key] !== undefined) continue
    messages.push(
      await sendAndRecord({
        notifier,
        kind: 'due',
        key,
        text: buildDueReminder(task, now),
        now,
        dryRun,
      }),
    )
  }
  return {
    configured: true,
    now: now.toISOString(),
    digestDue,
    dueMinutes,
    messages,
    sent: messages.filter((item) => item.ok === true).length,
  }
}

/** 立即发送一条测试推送（设置页「测试推送」）。 */
export async function sendTestNotification() {
  const { webhookUrl } = getWechatConfig()
  if (webhookUrl === '') throw Object.assign(new Error('尚未配置 webhook'), { status: 400 })
  const text = clipText(`KERNEL 测试推送 · ${nowIso()}\n企业微信 webhook 已连通。`)
  try {
    await createWecomNotifier(webhookUrl).send(text)
  } catch (err) {
    const message = safeError(err)
    await withState((state) => {
      state.lastError = message
    })
    await recordSendAudit({ kind: 'test', ok: false, error: message })
    throw Object.assign(new Error(`测试推送失败：${message}`), { status: 502 })
  }
  await withState((state) => {
    state.lastSendAt = nowIso()
    state.lastError = null
  })
  await recordSendAudit({ kind: 'test', ok: true, chars: text.length })
  return { ok: true, at: nowIso() }
}

/** 通知状态（绝不含 webhook URL / token 明文）。 */
export async function getNotifyStatus() {
  const { webhookUrl, inboundToken } = getWechatConfig()
  const config = (await readConfig()) ?? {}
  const state = await readState()
  let webhookHost = ''
  if (webhookUrl !== '') {
    try {
      webhookHost = new URL(webhookUrl).hostname
    } catch {
      webhookHost = ''
    }
  }
  return {
    configured: webhookUrl !== '',
    webhookHost,
    hasInboundToken: inboundToken !== '',
    dailyDigestTime:
      typeof config.notifyDailyDigestTime === 'string' ? config.notifyDailyDigestTime : DEFAULT_DIGEST_TIME,
    dueReminderMinutes:
      Number.isInteger(config.notifyDueReminderMinutes) ? config.notifyDueReminderMinutes : DEFAULT_DUE_MINUTES,
    lastDigestAt: typeof state.lastDigestAt === 'string' ? state.lastDigestAt : null,
    lastSendAt: typeof state.lastSendAt === 'string' ? state.lastSendAt : null,
    lastError: typeof state.lastError === 'string' ? state.lastError : null,
    pendingFailures: Object.keys(state.failures).length,
    failedKeys: Object.keys(state.digestFailed).length + Object.keys(state.dueFailed).length,
  }
}

function isLoopback(address) {
  const value = typeof address === 'string' ? address.toLowerCase() : ''
  return value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'
}

function bearerToken(header) {
  const value = typeof header === 'string' ? header.trim() : ''
  const match = /^Bearer\s+(.+)$/i.exec(value)
  return match !== null ? match[1].trim() : ''
}

let inboundChain = Promise.resolve()

/**
 * 处理微信入站（Phase 1 预留）：Bearer token + 仅本机 + msgId 幂等 → 收件箱。
 * @param {{ authorization?: string, remoteAddress?: string, body?: unknown }} input
 */
export function handleWechatInbound(input) {
  const run = inboundChain.then(() => handleInbound(input))
  inboundChain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function handleInbound({ authorization, remoteAddress, body } = {}) {
  if (!isLoopback(remoteAddress)) {
    throw Object.assign(new Error('仅允许本机入站'), { status: 403 })
  }
  const { inboundToken } = getWechatConfig()
  if (inboundToken === '') {
    throw Object.assign(new Error('入站 token 未配置'), { status: 503 })
  }
  const token = bearerToken(authorization)
  const expected = Buffer.from(inboundToken)
  const actual = Buffer.from(token)
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw Object.assign(new Error('入站 token 无效'), { status: 401 })
  }
  const parsed = wechatInboundSchema.safeParse(body)
  if (!parsed.success) {
    throw Object.assign(new Error('msgId / text 不合法'), { status: 400 })
  }
  const { msgId, text } = parsed.data
  const state = await readState()
  if (state.inbound[msgId] !== undefined) {
    return { ok: true, duplicate: true, inboxId: state.inbound[msgId].inboxId ?? null }
  }
  const id = await nextId('inbox')
  const saved = await commit(
    'inbox',
    { id, content: text, source: 'wechat', capturedAt: nowIso(), status: 'unprocessed' },
    {
      action: 'wechat.inbound',
      entity: 'inboxItem',
      id,
      // 只记 msgId 哈希前缀 / 长度，不落消息正文
      detail: { msgId: createHash('sha256').update(msgId).digest('hex').slice(0, 12), chars: text.length },
    },
  )
  await withState((next) => {
    next.inbound[msgId] = { inboxId: saved.id, at: nowIso() }
  })
  return { ok: true, inbox: { id: saved.id } }
}

let started = false

/** 启动服务端定时器（不依赖浏览器常开）；失败仅记录，不拖垮数据服务。 */
export function startNotifyScheduler() {
  if (started) return
  started = true
  const tickOnce = () => {
    void runNotifyTick().catch((err) => {
      console.error(`[notify] 定时 tick 失败：${safeError(err)}`)
    })
  }
  setTimeout(tickOnce, 3000).unref?.()
  const timer = setInterval(tickOnce, 30_000)
  timer.unref?.()
}
