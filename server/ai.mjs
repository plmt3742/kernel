// KERNEL · AI 代理（经本地 opencode 服务；仅数据服务在服务端调用）
// 纪律：AI 只经 127.0.0.1:4096 的 opencode serve 接入，不外泄、不越权；
//       AI 只产出「建议」，落盘仍由 server/index.mjs 经 commit() 唯一路径完成。
// 依据：.qa/v13/probe4/5 实证——variant:'low' 下 deepseek-flash 约 4~5s 返回干净 JSON；
//       format:json_schema 在 thinking 模式报 tool_choice 错误，故采用「指令式 JSON + Zod + 一次重试」。
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import { aiSuggestionSchema, reviewDraftSchema } from './schemas.mjs'
import { readActivity, readSnapshot } from './store.mjs'

const OPENCODE_URL = process.env.KERNEL_OPENCODE_URL ?? 'http://127.0.0.1:4096'
const SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? ''
const HEALTH_TIMEOUT_MS = 3_000
const PROMPT_TIMEOUT_MS = 120_000
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** SDK 返回解包：{ data, error } → data（与探针 pick() 一致） */
const pick = (r) => (r && typeof r === 'object' && 'data' in r ? r.data : r)

let client = null

/** 惰性单例 opencode 客户端（可选 Basic 认证） */
function getClient() {
  if (client === null) {
    const headers =
      SERVER_PASSWORD !== ''
        ? { Authorization: `Basic ${Buffer.from(`opencode:${SERVER_PASSWORD}`).toString('base64')}` }
        : undefined
    client = createOpencodeClient({ baseUrl: OPENCODE_URL, headers })
  }
  return client
}

/** 带超时的 Promise 包装（超时后吞掉原 Promise 的迟到拒绝，避免未处理拒绝） */
function withTimeout(promise, ms, timeoutMessage) {
  promise.catch(() => {})
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/* ---------------------------------------------------------------------------
 * 健康检查
 * ------------------------------------------------------------------------- */

/**
 * 探测 opencode 是否可用（约 3s 超时；不可达不抛错，返回 available:false）
 * @returns {Promise<{ available: boolean, model: string | null, url: string }>}
 */
export async function getAiHealth() {
  try {
    const cfg = pick(await withTimeout(getClient().config.get(), HEALTH_TIMEOUT_MS, '健康检查超时'))
    return { available: true, model: cfg?.model ?? null, url: OPENCODE_URL }
  } catch {
    return { available: false, model: null, url: OPENCODE_URL }
  }
}

/* ---------------------------------------------------------------------------
 * 收件箱解析
 * ------------------------------------------------------------------------- */

/** 安全读快照：数据缺失时降级为空摘要（不阻断解析） */
async function loadSnapshot() {
  try {
    return await readSnapshot()
  } catch {
    return { projects: [], areas: [], tasks: [], tags: [] }
  }
}

/** 打开的（未完成）任务状态 */
const OPEN_TASK_STATUS = new Set(['next', 'waiting', 'scheduled', 'someday'])

/**
 * 构造系统现状摘要（紧凑中文；项目 / 区域 / 标签 / 近期未完成任务）
 * 供模型做关联判断（projectId / areaId / tags / duplicateOf）；
 * 控制在 ~4KB 内：任务按 updatedAt 倒序，超预算即截断。
 */
function buildDigest(snapshot) {
  const projects = (snapshot.projects ?? []).map(
    (p) => `${p.id} · ${p.title} · [${(p.tags ?? []).join(',')}]`,
  )
  const areas = (snapshot.areas ?? []).map((a) => `${a.id} · ${a.title}`)

  const tagGroups = new Map()
  for (const tag of snapshot.tags ?? []) {
    const ns = tag.namespace ?? 'other'
    if (!tagGroups.has(ns)) tagGroups.set(ns, [])
    tagGroups.get(ns).push(tag.name)
  }
  const tagLines = [...tagGroups.entries()].map(([ns, names]) => `${ns}: ${names.join(',')}`)

  const tasks = [...(snapshot.tasks ?? [])]
    .filter((t) => OPEN_TASK_STATUS.has(t.status))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    .slice(0, 50)
    .map((t) => `${t.id} · ${t.title} · ${t.status}`)

  let out = `【项目】\n${projects.join('\n') || '（无）'}\n【区域】\n${areas.join('\n') || '（无）'}\n【标签】\n${tagLines.join('\n') || '（无）'}\n【未完成任务（updatedAt 倒序，最多 50）】\n`
  for (const line of tasks) {
    if (Buffer.byteLength(`${out}${line}\n`, 'utf8') > 3800) break
    out += `${line}\n`
  }
  return out.trim()
}

/** 构造系统提示词（注入当前本地时间 + 系统现状摘要 + 关联建议字段规则） */
function buildSystem(digest) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `你是 KERNEL 个人事务系统的收件箱解析器。把用户的收件箱内容解析为结构化 JSON。
只输出一个 JSON 对象：不要 markdown 代码块、不要解释、不要多余文字。字段：
- target: "task" | "note" | "resource" | "discard"
- title: 提炼后的标题（不超过 40 字）
- contexts: 字符串数组，只能从 ["@lab","@computer","@campus","@phone","@org-room"] 中选
- energy: "low" | "medium" | "high"
- importance: 1 | 2 | 3（整数）
- estimateMin: 预计所需分钟数（整数，最少 1 分钟）
- dueAt: ISO8601 带时区或 null。现在是 ${stamp}
- projectId: 字符串或 null。仅当内容明确属于下方某个项目时，填该项目 id；否则 null
- areaId: 字符串或 null。仅当内容明确属于下方某个区域时，填该区域 id；否则 null
- tags: 字符串数组，只能从下方标签名中选，最多 3 个（无把握则空数组）
- duplicateOf: 字符串或 null。仅当与下方某个未完成任务高度可能重复时，填该任务 id；否则 null
- reason: 一句话说明判断理由

【系统现状摘要】
${digest}

规则：projectId / areaId / tags / duplicateOf 只能取摘要中列出的 id 或标签名；拿不准一律填 null（tags 可为空数组）。`
}

/** 从模型响应中抽取纯文本（多段拼接） */
function extractText(res) {
  return (res?.parts ?? [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
}

/** zod 错误 → 可读中文原因 */
function describeError(err) {
  if (err !== null && typeof err === 'object' && Array.isArray(err.issues)) {
    const first = err.issues[0]
    const where = Array.isArray(first.path) && first.path.length > 0 ? `${first.path.join('.')}：` : ''
    return `${where}${first.message}`
  }
  return err?.message ?? String(err)
}

/** 丢弃模型显式给出的 null 关联字段（dueAt / projectId / areaId / duplicateOf），保持输出干净 */
function normalizeSuggestion(suggestion) {
  const out = { ...suggestion }
  if (out.dueAt === null || out.dueAt === undefined) delete out.dueAt
  for (const key of ['projectId', 'areaId', 'duplicateOf']) {
    if (out[key] === null) delete out[key]
  }
  return out
}

/**
 * 关联字段按快照后校验：未知 id / 标签一律丢弃（模型可能臆造）
 * projectId 必须在 projects；areaId 必须在 areas；duplicateOf 必须在 tasks；tags 必须在注册表。
 */
function postValidate(suggestion, snapshot) {
  const out = { ...suggestion }
  const projectIds = new Set((snapshot.projects ?? []).map((p) => p.id))
  const areaIds = new Set((snapshot.areas ?? []).map((a) => a.id))
  const taskIds = new Set((snapshot.tasks ?? []).map((t) => t.id))
  const tagNames = new Set((snapshot.tags ?? []).map((t) => t.name))
  if (out.projectId !== undefined && !projectIds.has(out.projectId)) delete out.projectId
  if (out.areaId !== undefined && !areaIds.has(out.areaId)) delete out.areaId
  if (out.duplicateOf !== undefined && !taskIds.has(out.duplicateOf)) delete out.duplicateOf
  if (Array.isArray(out.tags)) out.tags = out.tags.filter((name) => tagNames.has(name))
  return out
}

/** 解析 + 校验单次响应；返回 { ok, suggestion } 或 { ok:false, reason } */
function tryParseSuggestion(res) {
  const cleaned = extractText(res)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, reason: `JSON 解析失败（${err.message}）` }
  }
  try {
    return { ok: true, suggestion: normalizeSuggestion(aiSuggestionSchema.parse(obj)) }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/** 单次带超时的 prompt 调用（结果解包；默认模型由 serve 决定，不传 model/format） */
function promptOnce(sessionID, system, text) {
  return withTimeout(
    getClient().session.prompt({
      sessionID,
      system,
      variant: 'low',
      parts: [{ type: 'text', text }],
    }),
    PROMPT_TIMEOUT_MS,
    'AI 响应超时',
  ).then(pick)
}

/** 创建解析会话并返回 sessionID */
async function createSession() {
  const created = pick(await getClient().session.create({ title: 'kernel:inbox-parse' }))
  const sessionID = created?.id
  if (typeof sessionID !== 'string' || sessionID === '') {
    throw new Error('无法创建 opencode 会话')
  }
  return sessionID
}

/** 从响应信息中取模型标识 */
function modelOf(res) {
  const info = res?.info
  return info?.providerID !== undefined && info?.modelID !== undefined
    ? `${info.providerID}/${info.modelID}`
    : null
}

/**
 * 单会话内「prompt → 解析 → 一次重试」；失败抛错。
 * emit 存在时在重试前发出 { kind:'retry', reason }（流式路径用）。
 */
async function promptWithRetry(sessionID, system, item, emit) {
  let res = await promptOnce(sessionID, system, item.content)
  let parsed = tryParseSuggestion(res)
  if (!parsed.ok) {
    if (emit) emit({ kind: 'retry', reason: parsed.reason })
    console.warn(`[ai] inbox.parse 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象，不要任何多余文字。`,
    )
    parsed = tryParseSuggestion(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, suggestion: parsed.suggestion }
}

/**
 * 解析收件箱条目为 AI 建议（同步；保持既有契约不变）
 * @param {{ id: string, content: string }} item
 * @returns {Promise<{ suggestion: object, model: string | null, ms: number }>}
 */
export async function parseInboxItem(item) {
  const t0 = Date.now()
  const snapshot = await loadSnapshot()
  const system = buildSystem(buildDigest(snapshot))
  const sessionID = await createSession()
  const { res, suggestion } = await promptWithRetry(sessionID, system, item, null)
  const clean = postValidate(suggestion, snapshot)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(`[ai] inbox.parse ${item.id} 完成 ${ms}ms（${model ?? '未知模型'}）`)
  return { suggestion: clean, model, ms }
}

/**
 * 流式解析收件箱条目：先订阅事件流，边解析边 emit 过程事件。
 * @param {{ id: string, content: string }} item
 * @param {(event: object) => void} emit
 *   事件：{kind:'status',status} | {kind:'delta',field,delta} |
 *         {kind:'retry',reason} | {kind:'suggestion',suggestion,model,ms} | {kind:'error',message}
 * 说明：失败只 emit error，不抛出（SSE 路由由事件收尾）。
 */
export async function parseInboxItemStream(item, emit) {
  const t0 = Date.now()

  // 必须先订阅（避免漏掉会话创建后的早期事件）
  let stream = null
  try {
    const sub = await getClient().event.subscribe()
    stream = sub?.stream ?? null
  } catch (err) {
    console.warn(`[ai] event.subscribe 失败：${err?.message ?? err}`)
    stream = null
  }

  let closed = false
  let sessionID = null
  const safeEmit = (event) => {
    if (closed) return
    try {
      emit(event)
    } catch {
      /* 客户端已断开：忽略 */
    }
  }

  let pump = null
  if (stream !== null && typeof stream[Symbol.asyncIterator] === 'function') {
    pump = (async () => {
      try {
        for await (const ev of stream) {
          if (closed) break
          if (sessionID === null) continue
          const props = ev?.properties
          if (props?.sessionID !== sessionID) continue
          if (ev.type === 'session.status') {
            safeEmit({ kind: 'status', status: props.status?.type })
          } else if (ev.type === 'message.part.delta') {
            safeEmit({ kind: 'delta', field: props.field, delta: props.delta })
          }
        }
      } catch {
        /* 事件流异常不影响主解析路径（prompt 自身会报错） */
      }
    })()
  }

  try {
    const snapshot = await loadSnapshot()
    const system = buildSystem(buildDigest(snapshot))
    sessionID = await createSession()
    const { res, suggestion } = await promptWithRetry(sessionID, system, item, safeEmit)
    const clean = postValidate(suggestion, snapshot)
    const model = modelOf(res)
    const ms = Date.now() - t0
    safeEmit({ kind: 'suggestion', suggestion: clean, model, ms })
    console.log(`[ai] inbox.parse-stream ${item.id} 完成 ${ms}ms（${model ?? '未知模型'}）`)
  } catch (err) {
    console.error(`[ai] inbox.parse-stream ${item.id} 失败：`, err?.message ?? err)
    safeEmit({ kind: 'error', message: err?.message ?? 'AI 调用失败' })
  } finally {
    closed = true
    try {
      await stream?.return?.()
    } catch {
      /* 忽略关闭错误 */
    }
    if (pump !== null) await pump.catch(() => {})
  }
}

/* ---------------------------------------------------------------------------
 * 周回顾（v0.5 · Slice C）：周期 / 指标 / 停滞项目（服务端事实源）
 * 说明：computeWeekMetrics 与 staleProjects 同时供「AI 草稿」与「写入路径」复用；
 *       staleProjects 与前端 src/lib/data.ts getStaleProjects 口径严格一致。
 * ------------------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000

/** 当前周起点（本机时区周一 00:00） */
function startOfWeekMonday(now = new Date()) {
  const d = new Date(now)
  const diff = (d.getDay() + 6) % 7 // 周日=0 → 距周一的天数
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 日历日差值（镜像 date-fns differenceInCalendarDays：a − b，按本机日历日计） */
function calendarDayDiff(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate())
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((da.getTime() - db.getTime()) / MS_PER_DAY)
}

/** ISO 周键：2026-W40（ISO 周 · 周一起点 · 零填充；无依赖） */
export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/** 是否落在 [start, end]（含端点；ISO 字符串非法返回 false） */
function inRange(isoValue, start, end) {
  if (typeof isoValue !== 'string') return false
  const t = new Date(isoValue).getTime()
  return Number.isFinite(t) && t >= start.getTime() && t <= end.getTime()
}

/**
 * 本周指标：当前周（本机时区周一 00:00 → 现在）。
 * captured = 收件箱 capturedAt 入区间；created = 任务 createdAt 入区间；
 * completed = 任务 doneAt 入区间；overdue = dueAt < now 且 status ∈ next/waiting/scheduled。
 * 注：migrated 刻意不产出（无编辑追踪来源），见 ADR-0007。
 */
export function computeWeekMetrics(snapshot, now = new Date()) {
  const weekStart = startOfWeekMonday(now)
  const captured = (snapshot.inbox ?? []).filter((i) => inRange(i.capturedAt, weekStart, now)).length
  const created = (snapshot.tasks ?? []).filter((t) => inRange(t.createdAt, weekStart, now)).length
  const completed = (snapshot.tasks ?? []).filter((t) => inRange(t.doneAt, weekStart, now)).length
  const overdue = (snapshot.tasks ?? []).filter(
    (t) =>
      typeof t.dueAt === 'string' &&
      new Date(t.dueAt).getTime() < now.getTime() &&
      ['next', 'waiting', 'scheduled'].includes(t.status),
  ).length
  return { captured, created, completed, overdue }
}

/** 停滞项目：active 且 updatedAt 距 now ≥ staleDays 个日历日（镜像前端 getStaleProjects） */
export function staleProjects(snapshot, staleDays = 14, now = new Date()) {
  return (snapshot.projects ?? []).filter((p) => {
    if (p.status !== 'active' || typeof p.updatedAt !== 'string') return false
    const updated = new Date(p.updatedAt)
    if (!Number.isFinite(updated.getTime())) return false
    return -calendarDayDiff(updated, now) >= staleDays
  })
}

/** 近 N 天习惯命中数（log.date 在窗口内且 value > 0） */
function habitHitsLastDays(habit, days, now) {
  const start = new Date(now)
  start.setDate(start.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)
  return (habit.log ?? []).filter((entry) => {
    if (typeof entry?.date !== 'string' || !(entry.value > 0)) return false
    const d = new Date(`${entry.date}T00:00:00`)
    return Number.isFinite(d.getTime()) && d >= start && d <= now
  }).length
}

/** 构造紧凑中文周回顾摘要（指标 / 完成 / 逾期 / 停滞 / 习惯 / 活动计数） */
async function buildReviewDigest(snapshot, metrics, now) {
  const weekStart = startOfWeekMonday(now)
  const daysLate = (due) => Math.max(0, calendarDayDiff(now, new Date(due)))

  const completed = (snapshot.tasks ?? [])
    .filter((t) => inRange(t.doneAt, weekStart, now))
    .map((t) => t.title)

  const overdue = (snapshot.tasks ?? [])
    .filter(
      (t) =>
        typeof t.dueAt === 'string' &&
        new Date(t.dueAt).getTime() < now.getTime() &&
        ['next', 'waiting', 'scheduled'].includes(t.status),
    )
    .map((t) => `${t.title}（逾期 ${daysLate(t.dueAt)} 天）`)

  const staleList = staleProjects(snapshot, 14, now)
  const stale = staleList.map((p) => {
    const staleDays = Math.abs(calendarDayDiff(new Date(p.updatedAt), now))
    const next = p.nextActionId === undefined ? '' : ` · 下一步 ${p.nextActionId}`
    return `${p.id} · ${p.title} · 停滞 ${staleDays} 天 · 完成定义：${p.outcome}${next}`
  })

  const habits = (snapshot.habits ?? []).map(
    (h) => `${h.title} · 近 7 天命中 ${habitHitsLastDays(h, 7, now)} · 目标 ${h.target} · 节奏 ${h.cadence}`,
  )

  const activity = (await readActivity(200)).filter((entry) => {
    const t = Date.parse(entry.ts)
    return Number.isFinite(t) && t >= weekStart.getTime()
  })
  const counts = new Map()
  for (const entry of activity) counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1)
  const activityLines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([action, count]) => `${action} ×${count}`)

  return [
    `【本周指标】捕获 ${metrics.captured} · 新增 ${metrics.created} · 完成 ${metrics.completed} · 逾期 ${metrics.overdue}`,
    `【本周完成（${completed.length}）】\n${completed.join('\n') || '（无）'}`,
    `【当前逾期（${overdue.length}）】\n${overdue.join('\n') || '（无）'}`,
    `【停滞项目（≥14 天未更新，共 ${stale.length}）】\n${stale.join('\n') || '（无）'}`,
    `【可处置停滞项目 id】${staleList.map((p) => p.id).join(', ') || '（无）'}`,
    `【习惯（近 7 天）】\n${habits.join('\n') || '（无）'}`,
    `【本周活动计数】\n${activityLines.join('\n') || '（无）'}`,
  ].join('\n\n')
}

/** 构造周回顾系统提示词（指令式 JSON） */
function buildReviewSystem(digest) {
  return `你是 KERNEL 的周回顾助手。只输出一个 JSON 对象：不要 markdown、不要解释。字段：
- summary（≤200 字中文，具体、克制、不夸大，总结本周推进与问题）
- decisions（2–4 条中文，动作导向，如迁移 / 聚焦 / 处置）
- staleAdvice（数组，可空：{ projectId, action: 'archive'|'migrate'|'reactivate', reason }，仅针对摘要中列出的停滞项目）

【本周数据摘要】
${digest}

规则：staleAdvice.projectId 只能取「可处置停滞项目 id」中列出的 id；没有把握就返回空数组。`
}

/** 解析 + 校验单次周回顾响应；返回 { ok, draft } 或 { ok:false, reason } */
function tryParseReview(res) {
  const cleaned = extractText(res)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, reason: `JSON 解析失败（${err.message}）` }
  }
  try {
    const parsed = reviewDraftSchema.parse(obj)
    if (parsed.summary.trim() === '') return { ok: false, reason: '摘要为空' }
    return { ok: true, draft: parsed }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/** 按实际停滞集合后校验 + 文本归一化（trim；丢弃臆造的 projectId） */
function postValidateDraft(draft, staleIds) {
  return {
    summary: draft.summary.trim(),
    decisions: draft.decisions.map((d) => d.trim()).filter((d) => d !== ''),
    staleAdvice: draft.staleAdvice
      .filter((a) => staleIds.has(a.projectId))
      .map((a) => ({ projectId: a.projectId, action: a.action, reason: a.reason.trim() })),
  }
}

/** 单会话内「prompt → 解析 → 一次重试」；失败抛错 */
async function promptReviewWithRetry(sessionID, system, text) {
  let res = await promptOnce(sessionID, system, text)
  let parsed = tryParseReview(res)
  if (!parsed.ok) {
    console.warn(`[ai] review.draft 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象，不要任何多余文字。`,
    )
    parsed = tryParseReview(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, draft: parsed.draft }
}

/**
 * 生成本周回顾草稿（AI 只出草稿；落盘仍由用户确认后走 /api/reviews）。
 * @returns {Promise<{ periodKey: string, metrics: object, summary: string, decisions: string[], staleAdvice: object[], model: string | null, ms: number }>}
 */
export async function generateReviewDraft() {
  const t0 = Date.now()
  const now = new Date()
  const snapshot = await loadSnapshot()
  const metrics = computeWeekMetrics(snapshot, now)
  const staleIds = new Set(staleProjects(snapshot, 14, now).map((p) => p.id))
  const system = buildReviewSystem(await buildReviewDigest(snapshot, metrics, now))
  const created = pick(await getClient().session.create({ title: 'kernel:review-draft' }))
  const sessionID = created?.id
  if (typeof sessionID !== 'string' || sessionID === '') {
    throw new Error('无法创建 opencode 会话')
  }
  const { res, draft } = await promptReviewWithRetry(sessionID, system, '请生成本周回顾草稿。')
  const clean = postValidateDraft(draft, staleIds)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(`[ai] review.draft 完成 ${ms}ms（${model ?? '未知模型'}）`)
  return {
    periodKey: isoWeekKey(now),
    metrics,
    summary: clean.summary,
    decisions: clean.decisions,
    staleAdvice: clean.staleAdvice,
    model,
    ms,
  }
}
