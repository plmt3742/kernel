// KERNEL · 收件箱 AI 解析状态存储（Slice J；Slice N3 并行解析引擎）
// 纪律：解析过程不写数据（data/ 零写入）；AI 只出建议，落盘仍经 clarifyInbox。
// 背景（owner 反馈）：批量 AI 解析的过程状态原为组件级 useState，切页卸载即丢，
//   回来「好像没解析过」。此处把批量任务 / 每条目面板 / 单条建议缓存提升到模块级，
//   跨路由切换存活；完成条目以「AI 建议就绪」标记可见，无需再次点击。
// Slice N3（并行解析）：从「全局单令牌 + 单面板 + 顺序批量」重构为「每条目独立 job 的
//   并行调度器」（并发上限 AI_PARSE_CONCURRENCY）——每条目各自令牌与流缓冲，
//   新解析只取代同一 id 的在途结果，不再令其它条目的回调失效。
//   动机（owner 原文）：「我丢快点，跑一半的 ai 解析全断了」——旧实现任一新解析自增
//   全局令牌 → 所有旧解析 UI 回调失效、单面板被接管，视觉上即「断了」。HTTP 流本就
//   不中断；本次让每条目各自可见、完成各自回填。
import { errorText } from '@/lib/api'
import { getInbox } from '@/lib/data'
import {
  aiParseInboxStream,
  type AiActionKind,
  type AiParseResult,
  type AiStreamEvent,
} from '@/lib/mutations'
import type { AiSuggestionFormValues } from '@/lib/aiForm'
import type { InboxItem } from '@/types'

/** 解析过程阶段（由 SSE 事件驱动；文案安静、不夸大） */
export type AiStage = 'connecting' | 'thinking' | 'generating' | 'retry' | 'validating' | 'searching'

/** 实时预览保留的尾部字符数 */
export const AI_PREVIEW_MAX = 240

/** 流式增量节流窗口（Slice E2.6：~100ms，避免逐 delta 重渲染抖动） */
const DELTA_FLUSH_MS = 100

/** 并行解析并发上限（Slice N3）：超出则 FIFO 排队，完成一个自动进位 */
export const AI_PARSE_CONCURRENCY = 3

export type InboxAiPhase = 'idle' | 'parsing' | 'ready' | 'error'

/** 单条解析 job（每条目一份，互不干扰） */
export interface InboxAiJob {
  itemId: string
  /** 该 job 的令牌（入队时分配；与 itemTokens 当前值不符即失去回填资格） */
  token: number
  phase: 'parsing' | 'ready' | 'error'
  stage: AiStage
  /** 流式文本尾部（≤ AI_PREVIEW_MAX） */
  text: string
  /** 流式 reasoning 尾部（≤ AI_PREVIEW_MAX） */
  reasoning: string
  result: AiParseResult | null
  error: string
}

/** 模块级不可变快照（useSyncExternalStore 消费；每次变更换新引用） */
export interface InboxAiSnapshot {
  /** 活跃 job 表（key=itemId）；每次变更换新 Map 引用以触发订阅方重渲染 */
  jobs: ReadonlyMap<string, InboxAiJob>
  /** 批量运行中（期间所有批量动作禁用；单条解析共享调度器，不计入） */
  running: boolean
  /** 批量已完成数（完成驱动进度） */
  done: number
  /** 批量总数 */
  total: number
  /** 最近一次「开始」解析的条目 id（供自动展开 / 滚入跟随） */
  lastStartedId: string | null
  /** 建议缓存版本号（缓存变更时自增，触发订阅方重渲染） */
  cacheVersion: number
  /** 待播报的完成数（>0 时由收件箱消费一次并清零） */
  pendingCompletion: number
  /** 待播报的失败数（>0 时由收件箱消费一次并清零） */
  pendingFailures: number
}

let snapshot: InboxAiSnapshot = {
  jobs: new Map(),
  running: false,
  done: 0,
  total: 0,
  lastStartedId: null,
  cacheVersion: 0,
  pendingCompletion: 0,
  pendingFailures: 0,
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function setState(patch: Partial<InboxAiSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  emit()
}

export function subscribeInboxAi(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getInboxAiSnapshot(): InboxAiSnapshot {
  return snapshot
}

/* ---------------------------------------------------------------------------
 * 单条建议缓存（模块级 Map，跨路由切换存活于本会话）
 * - 收起 / 切页后回来：命中缓存 → 就绪卡（不重解析）。
 * - 条目离开未澄清列表（应用 / 撤销 / 水合）：reconcile 删除。
 * - 「重新解析」：覆盖该条缓存。
 * ------------------------------------------------------------------------- */
const suggestionCache = new Map<string, AiParseResult>()

/**
 * 显式作废集（纵深防御 · Slice N0.8）：唯一作废解析结果的意图 = 用户「忽略」。
 * 动机：结果珍贵，旧请求令牌（stale token）只意味着「面板不再更新」，不代表「结果该扔」。
 *   - 收起 / 展开不再杀解析（见 Inbox.toggleExpand）：切页 / 收起导致的迟到结果仍应入缓存；
 *   - 仅当用户显式忽略某条（clearCachedSuggestion）才标记作废，使其迟到结果不再回填；
 *   - 重新解析（parseItem 开始）即删除标记——新解析 = 新的意图；
 *   - 条目离开未澄清列表（reconcileInboxAiCache）时同步清理，避免长期驻留。
 */
const dismissedIds = new Set<string>()

export function getCachedSuggestion(id: string): AiParseResult | undefined {
  return suggestionCache.get(id)
}

/* ---------------------------------------------------------------------------
 * 一揽子处置卡的「用户编辑」缓存（Slice Y · F32）
 * 背景：重新解析会把活跃相位切到 parsing（result 置 null），AiActionsCard 被卸载重建，
 *   组件内 touchedRef/values 随之丢失。此处把「用户已手改的字段」提升到模块级，
 *   组件按 itemId 在挂载时恢复 → 重新解析后用户编辑不丢（kind 对齐才复用）。
 * 对账：条目离开未澄清列表（应用 / 撤销 / 水合）即清除；忽略（清空面板）亦清除。
 * ------------------------------------------------------------------------- */
export interface ActionEditCacheEntry {
  kinds: AiActionKind[]
  values: AiSuggestionFormValues[]
  touched: Set<string>[]
}

const actionEditCache = new Map<string, ActionEditCacheEntry>()

export function getActionEditCache(id: string): ActionEditCacheEntry | undefined {
  return actionEditCache.get(id)
}

export function setActionEditCache(id: string, entry: ActionEditCacheEntry): void {
  actionEditCache.set(id, entry)
}

/* ---------------------------------------------------------------------------
 * 「存为要点笔记」结果缓存（Slice N0.5 · 反馈修复）
 * 背景（owner 反馈）：点击「存为要点笔记」后保存成功但界面无任何动静——按钮无已存态、
 *   面板按建议缓存原样重渲染。此处把 (itemId → noteId) 提升到模块级，卡片按 itemId 读取，
 *   已存则渲染「已存为要点笔记 · 查看」深链；随条目存续，不随面板清空而清。
 * 对账：条目离开未澄清列表（应用 / 撤销 / 水合）即清除。
 * ------------------------------------------------------------------------- */
const factsNoteCache = new Map<string, string>()

export function getFactsNote(itemId: string): string | undefined {
  return factsNoteCache.get(itemId)
}

export function setFactsNote(itemId: string, noteId: string): void {
  factsNoteCache.set(itemId, noteId)
}

export function clearFactsNote(itemId: string): void {
  // 缓存变更需通知订阅方（Inbox / AiActionsCard 经 useSyncExternalStore 消费快照）：
  // 撤销「存为要点笔记」后当帧即可重渲染、按钮恢复可再存（对齐 clearCachedSuggestion）。
  if (factsNoteCache.delete(itemId)) bumpCacheVersion()
}

function bumpCacheVersion(): void {
  setState({ cacheVersion: snapshot.cacheVersion + 1 })
}

/** 缓存对账：删除已不在未澄清列表中的条目（应用 / 撤销 / 水合后调用） */
export function reconcileInboxAiCache(validIds: ReadonlySet<string>): void {
  let changed = false
  for (const id of [...suggestionCache.keys()]) {
    if (!validIds.has(id)) {
      suggestionCache.delete(id)
      changed = true
    }
  }
  for (const id of [...actionEditCache.keys()]) {
    if (!validIds.has(id)) actionEditCache.delete(id)
  }
  for (const id of [...factsNoteCache.keys()]) {
    if (!validIds.has(id)) factsNoteCache.delete(id)
  }
  // 同步清理显式作废集：条目已离开未澄清列表，无需再为其保留「忽略」意图
  for (const id of [...dismissedIds.keys()]) {
    if (!validIds.has(id)) dismissedIds.delete(id)
  }
  // Slice N3：清理已离开列表的 job（含令牌与增量缓冲），避免脏 job 残留
  for (const id of [...snapshot.jobs.keys()]) {
    if (!validIds.has(id)) clearInboxAiJob(id)
  }
  if (changed) bumpCacheVersion()
}

/**
 * 清除单条建议缓存（Slice N0.6 · 交互反馈修复）。
 * 背景（owner 反馈）：「忽略」原先只调旧的全局单面板清空函数，但面板派生会按 getCachedSuggestion()
 *   缓存回退重新渲染（行尾「AI 建议就绪」标记同源）→ 卡片原地不变 = 无反馈。
 * 语义：一并删除该条的建议缓存与编辑缓存（与 clearInboxAiJob 对齐）；**不动 factsNoteCache**
 *   （已存要点笔记随条目存续，忽略建议不应抹掉已保存的笔记深链）。
 */
export function clearCachedSuggestion(itemId: string): void {
  const hadSuggestion = suggestionCache.delete(itemId)
  actionEditCache.delete(itemId)
  // 登记显式作废意图：在途请求的迟到结果不再回填该条缓存（纵深防御 · Slice N0.8）。
  dismissedIds.add(itemId)
  if (hadSuggestion) bumpCacheVersion()
}

/** 消费一次完成播报（返回待播报条数并清零） */
export function takeInboxAiCompletion(): number {
  const count = snapshot.pendingCompletion
  if (count > 0) setState({ pendingCompletion: 0 })
  return count
}

/** 消费一次失败播报（返回待播报条数并清零） */
export function takeInboxAiFailures(): number {
  const count = snapshot.pendingFailures
  if (count > 0) setState({ pendingFailures: 0 })
  return count
}

/* ---------------------------------------------------------------------------
 * job 表操作（不可变：每次变更换新 Map 引用，useSyncExternalStore 方能感知）
 * ------------------------------------------------------------------------- */
function beginJob(itemId: string, token: number): void {
  const next = new Map(snapshot.jobs)
  next.set(itemId, {
    itemId,
    token,
    phase: 'parsing',
    stage: 'connecting',
    text: '',
    reasoning: '',
    result: null,
    error: '',
  })
  // 同一状态更新里记录「最近开始」的条目，供收件箱自动展开 / 滚入跟随（避免二次 emit）
  setState({ jobs: next, lastStartedId: itemId })
}

function patchJob(itemId: string, patch: Partial<InboxAiJob>): void {
  const current = snapshot.jobs.get(itemId)
  if (current === undefined) return
  const next = new Map(snapshot.jobs)
  next.set(itemId, { ...current, ...patch })
  setState({ jobs: next })
}

function dropJob(itemId: string): void {
  if (!snapshot.jobs.has(itemId)) return
  const next = new Map(snapshot.jobs)
  next.delete(itemId)
  setState({ jobs: next })
}

/* ---------------------------------------------------------------------------
 * 流式增量缓冲（Slice N3：按条目分桶 + 单一共享 ~100ms 计时器定时 flush 全部）
 * 动机：单面板时代的全局 deltaBuf 只能服务一条流；并行后每条目各自缓冲，
 *   但共享一个计时器即可（节流语义 DELTA_FLUSH_MS 不变，避免每条约一个定时器）。
 * ------------------------------------------------------------------------- */
const deltaBuf = new Map<string, { text: string; reasoning: string }>()
let deltaTimer: number | null = null

function clearDeltaTimer(): void {
  if (deltaTimer !== null) {
    window.clearTimeout(deltaTimer)
    deltaTimer = null
  }
}

/** 把全部条目缓冲增量写入各自 job（保留尾部），并清空缓冲 */
function flushAllDeltas(): void {
  clearDeltaTimer()
  if (deltaBuf.size === 0) return
  const next = new Map(snapshot.jobs)
  let changed = false
  for (const [id, buf] of deltaBuf) {
    const job = next.get(id)
    if (job === undefined) continue
    if (buf.text === '' && buf.reasoning === '') continue
    next.set(id, {
      ...job,
      text: buf.text === '' ? job.text : buf.text.slice(-AI_PREVIEW_MAX),
      reasoning: buf.reasoning === '' ? job.reasoning : buf.reasoning.slice(-AI_PREVIEW_MAX),
    })
    changed = true
  }
  deltaBuf.clear()
  if (changed) setState({ jobs: next })
}

/** 单独 flush 某条（重试 / 校验 / 结束 / 出错前最终写入；不动其它条目的缓冲与计时器） */
function flushItemDelta(itemId: string): void {
  const buf = deltaBuf.get(itemId)
  if (buf === undefined) return
  deltaBuf.delete(itemId)
  const job = snapshot.jobs.get(itemId)
  if (job === undefined) return
  if (buf.text === '' && buf.reasoning === '') return
  const next = new Map(snapshot.jobs)
  next.set(itemId, {
    ...job,
    text: buf.text === '' ? job.text : buf.text.slice(-AI_PREVIEW_MAX),
    reasoning: buf.reasoning === '' ? job.reasoning : buf.reasoning.slice(-AI_PREVIEW_MAX),
  })
  setState({ jobs: next })
}

/** 丢弃某条的增量缓冲（清除 job 时调用；无需 emit——快照不含缓冲） */
function dropItemDelta(itemId: string): void {
  deltaBuf.delete(itemId)
}

/** 增量入缓冲（尾部截断）；首个增量触发一次共享 ~100ms 节流窗口 */
function pushDelta(itemId: string, field: string, delta: string): void {
  if (field !== 'reasoning' && field !== 'text') return
  const buf = deltaBuf.get(itemId) ?? { text: '', reasoning: '' }
  if (field === 'reasoning') buf.reasoning = (buf.reasoning + delta).slice(-AI_PREVIEW_MAX)
  else buf.text = (buf.text + delta).slice(-AI_PREVIEW_MAX)
  deltaBuf.set(itemId, buf)
  if (deltaTimer === null) {
    deltaTimer = window.setTimeout(() => flushAllDeltas(), DELTA_FLUSH_MS)
  }
}

/* ---------------------------------------------------------------------------
 * 每条目令牌：入队即登记最新令牌，令同一 id 的在途流立即失去回填资格。
 * 全局单调自增，保证令牌永不重复。
 * ------------------------------------------------------------------------- */
const itemTokens = new Map<string, number>()
let tokenSeq = 0

/**
 * sentinel 错误（可识别文案）：供批量区分「跳过」与「失败」。
 * - INBOX_ITEM_GONE：启动前条目已离开未澄清列表（被应用 / 撤销 / 删除 / 水合）；
 * - INBOX_PARSE_SUPERSEDED：启动前该 id 已被更新的解析请求取代。
 * 两者均非用户可见错误，批量侧不计入失败数。
 */
const INBOX_ITEM_GONE = 'INBOX_ITEM_GONE'
const INBOX_PARSE_SUPERSEDED = 'INBOX_PARSE_SUPERSEDED'

function isSentinelError(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message === INBOX_ITEM_GONE || err.message === INBOX_PARSE_SUPERSEDED)
  )
}

/* ---------------------------------------------------------------------------
 * 并行调度器（FIFO 队列 + 并发上限）
 * pump()：只要运行中 job 数 < 上限且队列非空，就启动队首。
 * 每条目启动后再做最后一次存在性 / 令牌校验（期间可能被应用 / 撤销 / 取代）。
 * ------------------------------------------------------------------------- */
interface QueueEntry {
  item: InboxItem
  token: number
  resolve: (result: AiParseResult) => void
  reject: (err: unknown) => void
}

const queue: QueueEntry[] = []
const runningIds = new Set<string>()

function pump(): void {
  while (runningIds.size < AI_PARSE_CONCURRENCY && queue.length > 0) {
    const entry = queue.shift()
    if (entry === undefined) break
    void startEntry(entry)
  }
}

function itemStillUnprocessed(id: string): boolean {
  return getInbox().some((candidate) => candidate.id === id && candidate.status === 'unprocessed')
}

/** 启动一个 job：三次校验（存在 / 未澄清 / 令牌当前）→ 流式 → 完成或错误回填 */
async function startEntry(entry: QueueEntry): Promise<void> {
  const { item, token } = entry
  const id = item.id
  runningIds.add(id)
  try {
    // 启动前校验（排队期间状态可能已变）：条目仍存在且未澄清，否则跳过（sentinel）
    if (!itemStillUnprocessed(id)) {
      entry.reject(new Error(INBOX_ITEM_GONE))
      return
    }
    // 令牌已非当前（被 clearInboxAiJob 清除，或被更新的同 id 请求取代）→ 跳过
    if (itemTokens.get(id) !== token) {
      entry.reject(new Error(INBOX_PARSE_SUPERSEDED))
      return
    }
    beginJob(id, token)
    const result = await aiParseInboxStream(id, (event) => onStreamEvent(id, token, event))
    if (itemTokens.get(id) === token) {
      // 令牌仍当前：正常回填（flush 尾部 → 入缓存 → ready）
      flushItemDelta(id)
      suggestionCache.set(id, result)
      patchJob(id, { phase: 'ready', result, error: '' })
      bumpCacheVersion()
      entry.resolve(result)
      return
    }
    // 令牌失效（迟到结果）：不静默丢弃（纵深防御 · Slice N0.9）
    //   - 被 clearInboxAiJob 清除（itemTokens 无该 id）：若未被显式忽略且条目仍在，
    //     仍写建议缓存（收起 / 切页导致的迟到结果应可回来看见）；不复活已被移除的 job。
    //   - 被更新的同 id 请求取代（itemTokens 有更新令牌）：由新结果接管，不写缓存。
    if (itemTokens.get(id) === undefined) {
      flushItemDelta(id)
      if (!dismissedIds.has(id) && itemStillUnprocessed(id)) {
        suggestionCache.set(id, result)
        bumpCacheVersion()
      }
    }
    entry.resolve(result)
  } catch (err) {
    // 仅令牌仍当前时写错误态；否则不碰 job（可能已换上更新的 job 或已清除）。
    // sentinel（GONE / SUPERSEDED）是内部控制流，绝不露为可见错误态——
    //   即便恰好令牌仍当前（如 GONE 且无新请求），也只 reject 不 patch。
    if (!isSentinelError(err) && itemTokens.get(id) === token) {
      flushItemDelta(id)
      patchJob(id, { phase: 'error', error: errorText(err) })
    }
    entry.reject(err)
  } finally {
    runningIds.delete(id)
    pump()
  }
}

/** 单条流事件分发（先校验令牌；不符即静默忽略——其它条目 / 新请求不受影响） */
function onStreamEvent(id: string, token: number, event: AiStreamEvent): void {
  if (itemTokens.get(id) !== token) return
  if (event.kind === 'status') {
    if (event.status === 'busy') {
      const job = snapshot.jobs.get(id)
      if (job !== undefined && job.stage === 'connecting') patchJob(id, { stage: 'thinking' })
    } else if (event.status === 'searching') {
      patchJob(id, { stage: 'searching' })
    }
  } else if (event.kind === 'delta') {
    pushDelta(id, event.field, event.delta)
    if (event.field === 'reasoning') {
      // reasoning 增量表示进入思考；不在已生成阶段回退
      const job = snapshot.jobs.get(id)
      if (job !== undefined && job.stage !== 'generating') patchJob(id, { stage: 'thinking' })
    } else if (event.field === 'text') {
      patchJob(id, { stage: 'generating' })
    }
  } else if (event.kind === 'retry') {
    flushItemDelta(id)
    patchJob(id, { stage: 'retry' })
  } else if (event.kind === 'suggestion') {
    flushItemDelta(id)
    patchJob(id, { stage: 'validating' })
  }
}

/**
 * 入队一条解析请求（单条 / 批量共用）：分配令牌 → 登记 → FIFO 排队 → pump。
 * 同一 id 的新请求在入队时即覆盖令牌，旧在途流随后所有回调均被忽略（取代语义）。
 */
function enqueueParse(item: InboxItem): Promise<AiParseResult> {
  const token = (tokenSeq += 1)
  itemTokens.set(item.id, token)
  // 同 id 快速重解析：立即丢弃该 id 的旧增量缓冲（deltaBuf 按 id 分桶）。
  // 动机：旧流在 ~100ms 节流窗口内可能仍留有未 flush 的尾部；若不丢，共享计时器
  //   稍后 flush 时会把旧尾部写进已被 beginJob 重置的新 job（串流污染）。
  dropItemDelta(item.id)
  // 新解析 = 新的意图：撤销该条此前的「显式忽略」标记（纵深防御 · Slice N0.8）
  dismissedIds.delete(item.id)
  return new Promise<AiParseResult>((resolve, reject) => {
    queue.push({ item, token, resolve, reject })
    pump()
  })
}

/* ---------------------------------------------------------------------------
 * 对外 API
 * ------------------------------------------------------------------------- */

/** 运行单条 AI 解析（走共享调度器；失败抛出由调用方提示） */
export async function runSingleAi(item: InboxItem): Promise<AiParseResult> {
  return enqueueParse(item)
}

/**
 * 批量 AI 解析：经共享调度器并行请求（并发 ≤ AI_PARSE_CONCURRENCY，完成自动进位）、
 * 进度可见（完成驱动）、失败续跑、绝不自动应用。
 * 运行期间快照 running=true（所有批量动作据此禁用，含切页后回来，杜绝重复启动）。
 * 完成后：成功数进入完成播报；失败数进入失败播报（各消费一次，不刷屏）。
 * 批量期间用户手动触发的单条解析共享同一队列，不影响批量计数。
 */
export async function startBatchAi(ids: readonly string[]): Promise<void> {
  if (snapshot.running) return
  // 预过滤：仅保留当前真实存在且未澄清的条目（total 据此确定）
  const list = ids.filter((id) => id !== '' && itemStillUnprocessed(id))
  if (list.length === 0) return
  setState({ running: true, done: 0, total: list.length })
  let succeeded = 0
  let failed = 0
  const wrappers = list.map(async (id) => {
    const item = getInbox().find((candidate) => candidate.id === id)
    if (item === undefined || item.status !== 'unprocessed') return
    try {
      await enqueueParse(item)
      succeeded += 1
    } catch (err) {
      // sentinel（条目已消失 / 被取代）= 跳过，不计失败；其余计入失败
      if (!isSentinelError(err)) failed += 1
    } finally {
      // 完成驱动进度：每完成一条即推进（含被跳过者），切页回来亦见真实进度
      setState({ done: snapshot.done + 1 })
    }
  })
  await Promise.all(wrappers)
  setState({ running: false, done: 0, total: 0 })
  if (succeeded > 0) setState({ pendingCompletion: snapshot.pendingCompletion + succeeded })
  if (failed > 0) setState({ pendingFailures: snapshot.pendingFailures + failed })
}

/**
 * 清除单条 job 并作废其在途请求（Slice N3；取代单面板时代的全局清空）。
 * 语义：删除该条令牌（在途流自然跑完但全部回调被忽略）、移除 job、丢弃增量缓冲；
 *   job 一旦移除绝不复活（迟到结果的缓存规则见 startEntry，纵深防御 · Slice N0.9）。
 * 注意：本函数不登记「显式忽略」——若需作废迟到结果入缓存，须同时调 clearCachedSuggestion。
 */
export function clearInboxAiJob(itemId: string): void {
  itemTokens.delete(itemId)
  dropItemDelta(itemId)
  actionEditCache.delete(itemId)
  dropJob(itemId)
}
