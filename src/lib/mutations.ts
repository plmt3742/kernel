// KERNEL · 数据变更动作（唯一写入通道：经数据服务 API）
// 策略：本机写入毫秒级——任务完成采用乐观更新（即时反馈）+ 失败回滚；其余动作等待服务确认。
// 纪律：任何写入失败都要显式抛出（由调用方 toast 提示），不静默吞掉。
import { api } from '@/lib/api'
import { getTaskById, removeEntity, replaceSnapshot, setDataSource, upsertEntity } from '@/lib/data'
import { toISODateTime } from '@/lib/date'
import type {
  InboxItem,
  KernelSnapshot,
  Note,
  Project,
  Resource,
  Review,
  ReviewMetrics,
  Task,
} from '@/types'

/* ---------------------------------------------------------------------------
 * 快照水合（挂载 / 窗口聚焦 / 多标签同步）
 * ------------------------------------------------------------------------- */

export async function hydrateFromServer(): Promise<boolean> {
  try {
    const snapshot = await api.get<KernelSnapshot>('/api/snapshot')
    replaceSnapshot(snapshot)
    return true
  } catch {
    setDataSource('offline')
    return false
  }
}

/* ---------------------------------------------------------------------------
 * 任务
 * ------------------------------------------------------------------------- */

/** 有效完成态（v0.4 起完成即落盘 status==='done' + doneAt） */
export function isTaskDone(task: Task): boolean {
  return task.status === 'done'
}

function optimisticTask(id: string, patch: Partial<Task>): Task | undefined {
  const prev = getTaskById(id)
  if (prev !== undefined) {
    upsertEntity('tasks', { ...prev, ...patch, updatedAt: toISODateTime(new Date()) })
  }
  return prev
}

export async function completeTask(id: string): Promise<Task> {
  const prev = optimisticTask(id, { status: 'done', doneAt: toISODateTime(new Date()) })
  try {
    const { task } = await api.post<{ task: Task }>(`/api/tasks/${id}/complete`)
    upsertEntity('tasks', task)
    return task
  } catch (err) {
    if (prev !== undefined) upsertEntity('tasks', prev)
    throw err
  }
}

export async function reopenTask(id: string): Promise<Task> {
  const prev = optimisticTask(id, { status: 'next', doneAt: undefined })
  try {
    const { task } = await api.post<{ task: Task }>(`/api/tasks/${id}/reopen`)
    upsertEntity('tasks', task)
    return task
  } catch (err) {
    if (prev !== undefined) upsertEntity('tasks', prev)
    throw err
  }
}

export async function createTask(title: string): Promise<Task> {
  const { task } = await api.post<{ task: Task }>('/api/tasks', { title })
  upsertEntity('tasks', task)
  return task
}

/* ---------------------------------------------------------------------------
 * 收件箱
 * ------------------------------------------------------------------------- */

export async function captureInbox(content: string): Promise<InboxItem> {
  const { inbox } = await api.post<{ inbox: InboxItem }>('/api/inbox', { content })
  upsertEntity('inbox', inbox)
  return inbox
}

export type ClarifyTarget = 'task' | 'project' | 'note' | 'resource' | 'discard'

export type CreatedKind = 'tasks' | 'projects' | 'notes' | 'resources'

export interface ClarifyResult {
  inbox: InboxItem
  created: { kind: CreatedKind; record: Task | Project | Note | Resource } | null
}

/** 澄清时可选覆盖字段（AI 应用 / 手工预填；服务端 clarifyDetailsSchema 校验） */
export interface ClarifyDetails {
  title?: string
  contexts?: string[]
  energy?: Task['energy']
  importance?: number
  estimateMin?: number
  dueAt?: string
  tags?: string[]
  /** 关联项目（仅 task 目标生效；服务端校验必须存在） */
  projectId?: string
  /** 关联区域（仅 task 目标生效；服务端校验必须存在） */
  areaId?: string
}

export interface ClarifyOptions {
  details?: ClarifyDetails
  /** 标记本次澄清来自 AI 建议（写入审计） */
  ai?: boolean
}

export async function clarifyInbox(
  id: string,
  target: ClarifyTarget,
  options?: ClarifyOptions,
): Promise<ClarifyResult> {
  const result = await api.post<ClarifyResult>(`/api/inbox/${id}/clarify`, { target, ...options })
  upsertEntity('inbox', result.inbox)
  if (result.created !== null) upsertEntity(result.created.kind, result.created.record)
  return result
}

export interface RevertResult {
  inbox: InboxItem
  removed: { kind: CreatedKind; id: string } | null
}

export async function revertInbox(id: string): Promise<RevertResult> {
  const result = await api.post<RevertResult>(`/api/inbox/${id}/revert`)
  upsertEntity('inbox', result.inbox)
  if (result.removed !== null) removeEntity(result.removed.kind, result.removed.id)
  return result
}

/* ---------------------------------------------------------------------------
 * AI 解析（v0.5 · 只读调用：AI 只出建议，落盘仍经 clarifyInbox）
 * ------------------------------------------------------------------------- */

/** AI 收件箱解析建议（对应服务端 aiSuggestionSchema；target 不含 project） */
export interface AiSuggestion {
  target: 'task' | 'note' | 'resource' | 'discard'
  title: string
  contexts: string[]
  energy: Task['energy']
  importance: number
  estimateMin?: number
  dueAt?: string
  /** 关联建议（服务端已按快照过滤，保证 id / 标签真实存在） */
  projectId?: string
  areaId?: string
  /** 仅从标签注册表筛选出的标签名 */
  tags: string[]
  /** 疑似重复的既有任务 id */
  duplicateOf?: string
  reason: string
}

export interface AiParseResult {
  suggestion: AiSuggestion
  model: string | null
  ms: number
}

/** AI 流式解析过程事件（对应 GET/POST /api/ai/inbox/:id/parse-stream 的 SSE 帧） */
export type AiStreamEvent =
  | { kind: 'status'; status?: string }
  | { kind: 'delta'; field: string; delta: string }
  | { kind: 'retry'; reason: string }
  | { kind: 'suggestion'; suggestion: AiSuggestion; model: string | null; ms: number }
  | { kind: 'error'; message: string }

/** 请求 AI 解析收件箱条目（同步，保留为回退路径）；不写数据（失败抛出由调用方提示） */
export async function aiParseInbox(id: string): Promise<AiParseResult> {
  return api.post<AiParseResult>(`/api/ai/inbox/${id}/parse`)
}

/**
 * 流式请求 AI 解析：POST + fetch 读取响应体（非 EventSource）。
 * 逐帧解析 SSE（`data: <json>\n\n`，chunk 边界不敏感），把过程事件交给 onEvent；
 * 收到 suggestion 帧时以 AiParseResult 兑现；error 帧 / 非 2xx 响应以可读错误拒绝。
 */
export async function aiParseInboxStream(
  id: string,
  onEvent: (event: AiStreamEvent) => void,
): Promise<AiParseResult> {
  let response: Response
  try {
    response = await fetch(`/api/ai/inbox/${id}/parse-stream`, { method: 'POST' })
  } catch {
    throw new Error('数据服务不可用（确认 npm run dev 已启动数据服务）')
  }
  if (!response.ok) {
    // 前置校验失败（400/404/409/503）：响应体为 JSON，沿用 api.ts 的错误解析
    const text = await response.text()
    let data: unknown = null
    if (text !== '') {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }
    if (response.status >= 500 && data === null) {
      throw new Error('数据服务不可用（确认 npm run dev 已启动数据服务）')
    }
    const message =
      data !== null &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }

  const body = response.body
  if (body === null) throw new Error('数据服务未返回流式响应')
  const reader = body.getReader()
  const decoder = new TextDecoder()

  const state: { result: AiParseResult | null; failure: string | null; buffer: string } = {
    result: null,
    failure: null,
    buffer: '',
  }

  const handleFrame = (frame: string): void => {
    const line = frame.split('\n').find((part) => part.startsWith('data:'))
    if (line === undefined) return
    const payload = line.slice(5).trim()
    if (payload === '') return
    let event: AiStreamEvent
    try {
      event = JSON.parse(payload) as AiStreamEvent
    } catch {
      return
    }
    if (event.kind === 'suggestion') {
      state.result = { suggestion: event.suggestion, model: event.model, ms: event.ms }
    } else if (event.kind === 'error') {
      state.failure = event.message
    }
    onEvent(event)
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    state.buffer += decoder.decode(value, { stream: true })
    let index = state.buffer.indexOf('\n\n')
    while (index !== -1) {
      const frame = state.buffer.slice(0, index)
      state.buffer = state.buffer.slice(index + 2)
      handleFrame(frame)
      index = state.buffer.indexOf('\n\n')
    }
  }
  state.buffer += decoder.decode()
  if (state.buffer.trim() !== '') handleFrame(state.buffer)

  if (state.failure !== null) throw new Error(state.failure)
  if (state.result === null) throw new Error('AI 流式响应异常结束')
  return state.result
}

/* ---------------------------------------------------------------------------
 * 周回顾（v0.5 · Slice C：AI 只出草稿；确认后经 /api/reviews 落盘；撤销即删除）
 * ------------------------------------------------------------------------- */

/** 停滞项目处置建议（对应服务端 staleAdviceSchema） */
export interface StaleAdvice {
  projectId: string
  action: 'archive' | 'migrate' | 'reactivate'
  reason: string
}

/** AI 周回顾草稿（对应服务端 /api/ai/review/draft 响应） */
export interface ReviewDraft {
  periodKey: string
  metrics: ReviewMetrics
  summary: string
  decisions: string[]
  staleAdvice: StaleAdvice[]
  model: string | null
  ms: number
}

/** 请求 AI 生成周回顾草稿；不写数据（失败抛出由调用方提示） */
export async function generateReviewDraft(): Promise<ReviewDraft> {
  return api.post<ReviewDraft>('/api/ai/review/draft')
}

/** 保存周回顾：服务端计算 id / 周期 / 指标 / 停滞项目；返回落盘记录 */
export async function saveReview(summary: string, decisions: string[]): Promise<Review> {
  const { review } = await api.post<{ review: Review }>('/api/reviews', { summary, decisions })
  upsertEntity('reviews', review)
  return review
}

/** 删除回顾（撤销保存） */
export async function removeReview(id: string): Promise<void> {
  await api.post<{ removed: { kind: 'reviews'; id: string } }>(`/api/reviews/${id}/remove`)
  removeEntity('reviews', id)
}
