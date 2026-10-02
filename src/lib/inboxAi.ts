// KERNEL · 收件箱 AI 解析状态存储（Slice J）
// 纪律：解析过程不写数据（data/ 零写入）；AI 只出建议，落盘仍经 clarifyInbox。
// 背景（owner 反馈）：批量 AI 解析的过程状态原为组件级 useState，切页卸载即丢，
//   回来「好像没解析过」。此处把批量任务 / 活跃条目面板 / 单条建议缓存提升到模块级，
//   跨路由切换存活；完成条目以「AI 建议就绪」标记可见，无需再次点击。
import { errorText } from '@/lib/api'
import { getInbox } from '@/lib/data'
import { aiParseInboxStream, type AiActionKind, type AiParseResult } from '@/lib/mutations'
import type { AiSuggestionFormValues } from '@/lib/aiForm'
import type { InboxItem } from '@/types'

/** 解析过程阶段（由 SSE 事件驱动；文案安静、不夸大） */
export type AiStage = 'connecting' | 'thinking' | 'generating' | 'retry' | 'validating'

/** 实时预览保留的尾部字符数 */
export const AI_PREVIEW_MAX = 240

/** 流式增量节流窗口（Slice E2.6：~100ms，避免逐 delta 重渲染抖动） */
const DELTA_FLUSH_MS = 100

export type InboxAiPhase = 'idle' | 'parsing' | 'ready' | 'error'

/** 模块级不可变快照（useSyncExternalStore 消费；每次变更换新引用） */
export interface InboxAiSnapshot {
  /** 批量任务运行中（期间所有批量动作禁用） */
  running: boolean
  /** 批次当前序号（1 基；0 = 未运行） */
  current: number
  /** 批次总数 */
  total: number
  /** 当前活跃（解析中或最后完成）的条目 id */
  activeId: string | null
  /** 活跃条目面板相位 */
  phase: InboxAiPhase
  /** 活跃条目解析阶段 */
  stage: AiStage
  /** 活跃条目流式文本尾部 */
  text: string
  /** 活跃条目流式 reasoning 尾部 */
  reasoning: string
  /** 活跃条目完成后的建议结果 */
  result: AiParseResult | null
  /** 活跃条目错误文案 */
  error: string
  /** 建议缓存版本号（缓存变更时自增，触发订阅方重渲染） */
  cacheVersion: number
  /** 待播报的完成数（>0 时由收件箱消费一次并清零） */
  pendingCompletion: number
  /** 待播报的失败数（>0 时由收件箱消费一次并清零） */
  pendingFailures: number
}

let snapshot: InboxAiSnapshot = {
  running: false,
  current: 0,
  total: 0,
  activeId: null,
  phase: 'idle',
  stage: 'connecting',
  text: '',
  reasoning: '',
  result: null,
  error: '',
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
  if (changed) bumpCacheVersion()
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
 * 流式增量节流缓冲（模块级：切页不中断）
 * ------------------------------------------------------------------------- */
let deltaBuf: { text: string; reasoning: string } = { text: '', reasoning: '' }
let deltaTimer: number | null = null

function clearDeltaTimer(): void {
  if (deltaTimer !== null) {
    window.clearTimeout(deltaTimer)
    deltaTimer = null
  }
}

/** 清空增量缓冲并取消待 flush（开始 / 清空 / 出错时调用） */
function resetDeltas(): void {
  clearDeltaTimer()
  deltaBuf = { text: '', reasoning: '' }
}

/** 把缓冲增量一次性写入快照（保留尾部）；成功 / 重试 / 出错前做最终 flush */
function flushDeltas(token: number): void {
  clearDeltaTimer()
  const text = deltaBuf.text
  const reasoning = deltaBuf.reasoning
  deltaBuf = { text: '', reasoning: '' }
  if (token !== activeToken) return
  if (text !== '' || reasoning !== '') {
    setState({
      text: text === '' ? snapshot.text : text.slice(-AI_PREVIEW_MAX),
      reasoning: reasoning === '' ? snapshot.reasoning : reasoning.slice(-AI_PREVIEW_MAX),
    })
  }
}

/** 增量入缓冲（尾部截断）；首个增量触发一次 ~100ms 节流窗口 */
function pushDelta(token: number, field: string, delta: string): void {
  if (field === 'reasoning') deltaBuf.reasoning = (deltaBuf.reasoning + delta).slice(-AI_PREVIEW_MAX)
  else if (field === 'text') deltaBuf.text = (deltaBuf.text + delta).slice(-AI_PREVIEW_MAX)
  else return
  if (deltaTimer === null) {
    deltaTimer = window.setTimeout(() => flushDeltas(token), DELTA_FLUSH_MS)
  }
}

/* ---------------------------------------------------------------------------
 * 解析执行（单条 / 批量共用）
 * ------------------------------------------------------------------------- */
// 活跃请求令牌：清空面板 / 新请求时自增，令旧的流式回调失效（迟到不落状态、不入缓存）
let activeToken = 0

/**
 * 解析单条：设置活跃面板 → 流式 → 成功入缓存并置 ready；失败置 error 并抛出。
 * 同一时刻仅一条活跃流（批量循环内顺序调用）。
 */
async function parseItem(item: InboxItem): Promise<AiParseResult> {
  const token = (activeToken += 1)
  resetDeltas()
  setState({
    activeId: item.id,
    phase: 'parsing',
    stage: 'connecting',
    text: '',
    reasoning: '',
    result: null,
    error: '',
  })
  try {
    const result = await aiParseInboxStream(item.id, (event) => {
      if (activeToken !== token) return
      if (event.kind === 'status') {
        if (event.status === 'busy') {
          setState({ stage: snapshot.stage === 'connecting' ? 'thinking' : snapshot.stage })
        }
      } else if (event.kind === 'delta') {
        pushDelta(token, event.field, event.delta)
        if (event.field === 'reasoning') {
          if (snapshot.stage !== 'generating') setState({ stage: 'thinking' })
        } else if (event.field === 'text') {
          setState({ stage: 'generating' })
        }
      } else if (event.kind === 'retry') {
        flushDeltas(token)
        setState({ stage: 'retry' })
      } else if (event.kind === 'suggestion') {
        flushDeltas(token)
        setState({ stage: 'validating' })
      }
    })
    if (activeToken !== token) return result
    flushDeltas(token)
    suggestionCache.set(item.id, result)
    setState({ phase: 'ready', result, cacheVersion: snapshot.cacheVersion + 1 })
    return result
  } catch (err) {
    if (activeToken !== token) throw err
    flushDeltas(token)
    setState({ phase: 'error', error: errorText(err) })
    throw err
  }
}

/** 运行单条 AI 解析（共享模块面板；失败抛出由调用方提示） */
export async function runSingleAi(item: InboxItem): Promise<AiParseResult> {
  return parseItem(item)
}

/**
 * 批量 AI 解析：顺序解析选中项、进度可见、失败续跑、绝不自动应用。
 * 运行期间快照 running=true（所有批量动作据此禁用，含切页后回来，杜绝重复启动）。
 * 完成后：成功数进入完成播报；失败数进入失败播报（各消费一次，不刷屏）。
 */
export async function startBatchAi(ids: readonly string[]): Promise<void> {
  if (snapshot.running) return
  const list = ids.filter((id) => id !== '')
  if (list.length === 0) return
  setState({ running: true, current: 0, total: list.length, pendingFailures: 0 })
  let succeeded = 0
  let failed = 0
  for (let i = 0; i < list.length; i += 1) {
    const item = getInbox().find((candidate) => candidate.id === list[i])
    if (item === undefined || item.status !== 'unprocessed') continue
    setState({ current: i + 1 })
    try {
      await parseItem(item)
      succeeded += 1
    } catch {
      // 单条失败：跳过并继续（完成后统一播报失败数，不逐条刷屏）
      failed += 1
    }
  }
  setState({ running: false, current: 0, total: 0 })
  if (succeeded > 0) setState({ pendingCompletion: snapshot.pendingCompletion + succeeded })
  if (failed > 0) setState({ pendingFailures: snapshot.pendingFailures + failed })
}

/**
 * 清空活跃面板并作废在途请求（收起单条 / 应用建议 / 忽略时调用）。
 * 批量运行中由收件箱侧保护：不主动清空活跃批次项（见 Inbox.toggleExpand）。
 */
export function clearInboxAiActive(): void {
  activeToken += 1
  resetDeltas()
  if (snapshot.activeId !== null) actionEditCache.delete(snapshot.activeId)
  setState({
    activeId: null,
    phase: 'idle',
    stage: 'connecting',
    text: '',
    reasoning: '',
    result: null,
    error: '',
  })
}
