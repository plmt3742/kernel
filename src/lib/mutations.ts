// KERNEL · 数据变更动作（唯一写入通道：经数据服务 API）
// 策略：本机写入毫秒级——任务完成采用乐观更新（即时反馈）+ 失败回滚；其余动作等待服务确认。
// 纪律：任何写入失败都要显式抛出（由调用方 toast 提示），不静默吞掉。
import { api } from '@/lib/api'
import { getTaskById, removeEntity, replaceSnapshot, setDataSource, upsertEntity } from '@/lib/data'
import { toISODateTime } from '@/lib/date'
import type {
  AppConfig,
  Area,
  CalendarEvent,
  Goal,
  Habit,
  InboxItem,
  KernelSnapshot,
  Note,
  Project,
  Resource,
  Review,
  ReviewMetrics,
  ReviewType,
  TagItem,
  Task,
  TrashItem,
  TrashKind,
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

/**
 * 创建任务入参（v0.5 · Slice O）：title 必填；可选字段在「预览确认」后一次性提交。
 * 仅传 { title } 时行为与旧版一致（服务端补默认值）。
 */
export interface TaskCreateInput {
  title: string
  contexts?: string[]
  energy?: Task['energy']
  importance?: number
  estimateMin?: number
  dueAt?: string
  projectId?: string
  areaId?: string
  /** Slice R3：父任务（生成子任务）；服务端校验存在且不成环 */
  parentTaskId?: string
  tags?: string[]
  /** Slice T：本次创建来自 AI 草稿确认——新标签按 origin:'ai' 登记 */
  ai?: boolean
}

export async function createTask(input: TaskCreateInput): Promise<Task> {
  const { task } = await api.post<{ task: Task }>('/api/tasks', input)
  upsertEntity('tasks', task)
  return task
}

/** 项目创建入参（Slice R1）：title 必填；outcome / areaId / tags 可选（草稿确认后提交） */
export interface ProjectCreateInput {
  title: string
  outcome?: string
  areaId?: string
  tags?: string[]
  /** 本次创建来自 AI 草稿确认——新标签按 origin:'ai' 登记 */
  ai?: boolean
}

/**
 * 新建项目：title 非空；默认 active + 区域 a-0001（Slice E2.5）。
 * 兼容旧调用：传字符串（或 title + areaId）时行为不变；传对象时可携带 outcome / tags。
 */
export async function createProject(
  titleOrInput: string | ProjectCreateInput,
  areaId?: string,
): Promise<Project> {
  const body: Record<string, unknown> =
    typeof titleOrInput === 'string'
      ? areaId === undefined
        ? { title: titleOrInput }
        : { title: titleOrInput, areaId }
      : { ...titleOrInput }
  const { project } = await api.post<{ project: Project }>('/api/projects', body)
  upsertEntity('projects', project)
  return project
}

/* ---------------------------------------------------------------------------
 * 日程（v0.5 · Slice W，见 ADR-0018）：最末一个只读实体转为可写。
 * 创建 = 「先确认后写入」（无 AI）；删除走回收站（审计 event.remove），撤销即恢复。
 * ------------------------------------------------------------------------- */

/** 日程创建入参：title / startAt 必填；endAt 可选（服务端校验 end ≥ start） */
export interface EventCreateInput {
  title: string
  startAt: string
  endAt?: string
  allDay?: boolean
  location?: string
  status?: CalendarEvent['status']
  projectId?: string
  areaId?: string
  tags?: string[]
  notes?: string
}

/** 新建日程（成功后 upsert 本地快照） */
export async function createEvent(input: EventCreateInput): Promise<CalendarEvent> {
  const { event } = await api.post<{ event: CalendarEvent }>('/api/events', input)
  upsertEntity('events', event)
  return event
}

/** 删除日程（移入回收站；服务端审计 event.remove）。撤销走 restoreEntity('events', id) */
export async function removeEvent(id: string): Promise<void> {
  await api.post<{ trashed: { kind: 'events'; id: string } }>(`/api/events/${id}/remove`)
  removeEntity('events', id)
}

/* ---------------------------------------------------------------------------
 * 区域 / 目标 / 习惯（v0.5 · Slice X，见 ADR-0019）：关闭最后三个只读结构。
 * 创建 / 编辑 / 删除（回收站，撤销走 restoreEntity）；习惯另有幂等打卡 / 取消打卡。
 * 区域与目标删除带服务端引用护栏（被引用 → 409，可读计数）。
 * ------------------------------------------------------------------------- */

/** 区域创建入参：title 必填；standard / cadence / status 可选（服务端补缺省） */
export interface AreaCreateInput {
  title: string
  standard?: string
  cadence?: Area['cadence']
  status?: Area['status']
}

export async function createArea(input: AreaCreateInput): Promise<Area> {
  const { area } = await api.post<{ area: Area }>('/api/areas', input)
  upsertEntity('areas', area)
  return area
}

/** 编辑区域（白名单 title / standard / cadence / status；成功后 upsert） */
export async function updateArea(id: string, patch: Record<string, unknown>): Promise<Area> {
  const { record } = await api.post<{ record: Area }>(`/api/areas/${id}/update`, patch)
  upsertEntity('areas', record)
  return record
}

/** 删除区域（被引用 → 服务端 409；未引用 → 回收站，撤销走 restoreEntity('areas', id)） */
export async function removeArea(id: string): Promise<void> {
  await api.post<{ trashed: { kind: 'areas'; id: string } }>(`/api/areas/${id}/remove`)
  removeEntity('areas', id)
}

/** 目标创建入参：title 必填；horizon / areaId / status / targetDate 可选（keyResults 本期留空） */
export interface GoalCreateInput {
  title: string
  horizon?: Goal['horizon']
  areaId?: string
  status?: Goal['status']
  targetDate?: string
}

export async function createGoal(input: GoalCreateInput): Promise<Goal> {
  const { goal } = await api.post<{ goal: Goal }>('/api/goals', input)
  upsertEntity('goals', goal)
  return goal
}

/** 编辑目标（白名单 title / horizon / areaId / status / targetDate；keyResults 不开放） */
export async function updateGoal(id: string, patch: Record<string, unknown>): Promise<Goal> {
  const { record } = await api.post<{ record: Goal }>(`/api/goals/${id}/update`, patch)
  upsertEntity('goals', record)
  return record
}

/** 删除目标（被项目 / 子目标引用 → 409；未引用 → 回收站） */
export async function removeGoal(id: string): Promise<void> {
  await api.post<{ trashed: { kind: 'goals'; id: string } }>(`/api/goals/${id}/remove`)
  removeEntity('goals', id)
}

/** 习惯创建入参：title 必填；cadence / metric / target / trigger / areaId 可选；log 空数组 */
export interface HabitCreateInput {
  title: string
  cadence?: Habit['cadence']
  metric?: Habit['metric']
  target?: number
  trigger?: string
  areaId?: string
}

export async function createHabit(input: HabitCreateInput): Promise<Habit> {
  const { habit } = await api.post<{ habit: Habit }>('/api/habits', input)
  upsertEntity('habits', habit)
  return habit
}

/** 编辑习惯（白名单 title / cadence / metric / target / trigger / areaId；log 由打卡端点维护） */
export async function updateHabit(id: string, patch: Record<string, unknown>): Promise<Habit> {
  const { record } = await api.post<{ record: Habit }>(`/api/habits/${id}/update`, patch)
  upsertEntity('habits', record)
  return record
}

/** 删除习惯（无引用护栏 → 回收站，撤销走 restoreEntity('habits', id)） */
export async function removeHabit(id: string): Promise<void> {
  await api.post<{ trashed: { kind: 'habits'; id: string } }>(`/api/habits/${id}/remove`)
  removeEntity('habits', id)
}

/** 打卡结果：changed=false 表示幂等无变化（已打卡 / 无该记录） */
export interface HabitCheckinResult {
  habit: Habit
  changed: boolean
  date: string
}

/** 打卡（缺省今天；服务端幂等：已存在则不重复写） */
export async function checkinHabit(id: string, date?: string): Promise<HabitCheckinResult> {
  const result = await api.post<HabitCheckinResult>(
    `/api/habits/${id}/checkin`,
    date !== undefined ? { date } : {},
  )
  upsertEntity('habits', result.habit)
  return result
}

/** 取消打卡（缺省今天；无该日期则幂等无操作） */
export async function uncheckinHabit(id: string, date?: string): Promise<HabitCheckinResult> {
  const result = await api.post<HabitCheckinResult>(
    `/api/habits/${id}/uncheckin`,
    date !== undefined ? { date } : {},
  )
  upsertEntity('habits', result.habit)
  return result
}

/* ---------------------------------------------------------------------------
 * 收件箱
 * ------------------------------------------------------------------------- */

export async function captureInbox(content: string): Promise<InboxItem> {
  const { inbox } = await api.post<{ inbox: InboxItem }>('/api/inbox', { content })
  upsertEntity('inbox', inbox)
  return inbox
}

/**
 * 文件投递（Slice D）：RAW body 上传，服务端流式落盘 data/files/ 并生成 source:'file' 条目。
 * 失败抛出可读错误（沿用 api.ts 的错误文案策略）。
 */
export async function uploadInboxFile(file: File, caption?: string): Promise<InboxItem> {
  const params = new URLSearchParams()
  params.set('name', file.name)
  if (file.type !== '') params.set('type', file.type)
  const trimmed = caption?.trim() ?? ''
  if (trimmed !== '') params.set('caption', trimmed)
  let response: Response
  try {
    response = await fetch(`/api/inbox/upload?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file,
    })
  } catch {
    throw new Error('数据服务不可用（确认 npm run dev 已启动数据服务）')
  }
  const text = await response.text()
  let data: unknown = null
  if (text !== '') {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    if (response.status >= 500 && data === null) {
      throw new Error('数据服务不可用（确认 npm run dev 已启动数据服务）')
    }
    const message =
      data !== null &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `上传失败（HTTP ${response.status}）`
    throw new Error(message)
  }
  const inbox = (data as { inbox: InboxItem }).inbox
  upsertEntity('inbox', inbox)
  return inbox
}

/** 附件本机动作结果（Slice J2）：open / reveal 均回传解析后的绝对路径 */
export interface InboxFileActionResult {
  ok: true
  path: string
}

/**
 * 以系统默认程序打开收件箱附件（Slice J2 · 仅本机）：服务端解析路径后经 `cmd /c start` 打开。
 * 不再经浏览器下载；失败抛出由调用方 toast。
 */
export async function openInboxFile(id: string): Promise<InboxFileActionResult> {
  return api.post<InboxFileActionResult>(`/api/inbox/${id}/open`)
}

/** 在文件管理器中定位收件箱附件（Slice J2 · 仅本机；explorer /select） */
export async function revealInboxFile(id: string): Promise<InboxFileActionResult> {
  return api.post<InboxFileActionResult>(`/api/inbox/${id}/reveal`)
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
  /** 首个被移除产物（向后兼容；多产物应用时见 removedAll） */
  removed: { kind: CreatedKind; id: string } | null
  /** 全部被移除产物（Slice R1：一揽子应用可能有多个产物） */
  removedAll: Array<{ kind: CreatedKind; id: string }>
}

/**
 * 撤销澄清 / 恢复条目（Slice V · F15/F37；Slice R1 扩展为多产物）：服务端语义=
 *   · clarified → 删除全部联动产物（linkedIds）并回到 unprocessed；
 *   · discarded → 无产物，仅重置回 unprocessed（即「恢复」）；
 *   · unprocessed → 幂等无操作。
 * 前端同一函数承载「撤回」（澄清行）与「恢复」（丢弃行）两个入口。
 */
export async function revertInbox(id: string): Promise<RevertResult> {
  const result = await api.post<RevertResult>(`/api/inbox/${id}/revert`)
  upsertEntity('inbox', result.inbox)
  const removed = result.removedAll ?? (result.removed === null ? [] : [result.removed])
  for (const entry of removed) removeEntity(entry.kind, entry.id)
  return result
}

/* ---------------------------------------------------------------------------
 * 一揽子应用 / 撤销（v0.5 · Slice R1，见 ADR-0015）
 * ------------------------------------------------------------------------- */

/**
 * AI 动作（对应服务端 aiActionSchema）：kind 决定字段子集；
 * project = 本批次要新建的项目；task / note 可用 linkToNewProject 挂接它。
 */
export type AiActionKind = 'task' | 'note' | 'resource' | 'project'

export interface AiAction {
  kind: AiActionKind
  title: string
  /** task 专属 */
  contexts: string[]
  energy?: Task['energy']
  importance?: number
  estimateMin?: number
  dueAt?: string
  /** 归属（task / note / resource / project） */
  projectId?: string
  areaId?: string
  tags: string[]
  /** resource 专属（Slice R2.5）：1–3 句简约小结，作为资料详情页「简介」 */
  note?: string
  /** project 专属：完成定义 */
  outcome?: string
  /** task / note：挂到本批次新建的项目（与 projectId 互斥） */
  linkToNewProject?: boolean
  /** task：疑似重复的既有任务 id */
  duplicateOf?: string
  reason: string
}

export interface InboxApplyResult {
  inbox: InboxItem
  created: Array<{ kind: CreatedKind; record: Task | Project | Note | Resource }>
  project: Project | null
}

/**
 * 一揽子应用：一次写入创建新项目（若有）+ 全部实体，并把条目置 clarified。
 * 成功后整体水合（应用会改变标签注册表）；水合失败时退回本地增量落位。
 */
export async function applyInbox(id: string, actions: AiAction[]): Promise<InboxApplyResult> {
  const result = await api.post<InboxApplyResult>(`/api/inbox/${id}/apply`, { actions })
  if (!(await hydrateFromServer())) {
    upsertEntity('inbox', result.inbox)
    for (const entry of result.created) upsertEntity(entry.kind, entry.record)
  }
  return result
}

export interface UnapplyResult {
  inbox: InboxItem
  removed: { kind: CreatedKind; id: string } | null
  removedAll: Array<{ kind: CreatedKind; id: string }>
}

/** 撤销一揽子应用：删除全部产物并恢复标签注册表基线（服务端 pruneTags）；成功后整体水合 */
export async function unapplyInbox(id: string): Promise<UnapplyResult> {
  const result = await api.post<UnapplyResult>(`/api/inbox/${id}/unapply`)
  if (!(await hydrateFromServer())) {
    upsertEntity('inbox', result.inbox)
    for (const entry of result.removedAll ?? []) removeEntity(entry.kind, entry.id)
  }
  return result
}

/**
 * 删除收件箱条目（Slice V · F34）：服务端一并清理附件文件（data/files/<id>-<name>）。
 * 已澄清条目服务端以 409 阻止（保护联动实体），需先经 revertInbox 撤回；调用方据此提示。
 */
export async function removeInbox(id: string): Promise<{ kind: 'inbox'; id: string }> {
  const result = await api.post<{ removed: { kind: 'inbox'; id: string } }>(
    `/api/inbox/${id}/remove`,
  )
  removeEntity('inbox', id)
  return result.removed
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
  /** 建议新建的项目名（Slice E2.5；与 projectId 互斥，≤40 字；仅提示，不自动创建） */
  newProjectHint?: string
  reason: string
}

export interface AiParseResult {
  /** 一揽子处置动作（Slice R1：一个条目可拆出 0~6 个动作） */
  actions: AiAction[]
  model: string | null
  ms: number
}

/** AI 流式解析过程事件（对应 GET/POST /api/ai/inbox/:id/parse-stream 的 SSE 帧） */
export type AiStreamEvent =
  | { kind: 'status'; status?: string }
  | { kind: 'delta'; field: string; delta: string }
  | { kind: 'retry'; reason: string }
  | { kind: 'suggestion'; actions: AiAction[]; model: string | null; ms: number }
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
      state.result = { actions: event.actions, model: event.model, ms: event.ms }
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
 * 任务快速新建 AI 补全（v0.5 · Slice H：只填标题 → 建议；绝不自动落盘）
 * ------------------------------------------------------------------------- */

/** AI 任务补全建议（对应服务端 taskDraftSchema；全部可选，拿不准则缺省） */
export interface TaskDraftSuggestion {
  contexts: string[]
  energy?: Task['energy']
  importance?: number
  estimateMin?: number
  dueAt?: string
  /** 关联建议（服务端已按快照过滤，保证 id / 标签真实存在） */
  projectId?: string
  areaId?: string
  tags: string[]
  reason: string
}

export interface TaskDraftResult {
  suggestion: TaskDraftSuggestion
  model: string | null
  ms: number
}

/** 请求 AI 为「只填标题」的新任务补全可推断字段；不写数据（失败抛出由调用方安静处理） */
export async function aiTaskDraft(title: string): Promise<TaskDraftResult> {
  return api.post<TaskDraftResult>('/api/ai/task/draft', { title })
}

/* ---------------------------------------------------------------------------
 * 项目快速新建 AI 补全（v0.5 · Slice R1：只填标题 → 建议完成定义 / 区域 / 标签）
 * ------------------------------------------------------------------------- */

/** AI 项目补全建议（对应服务端 projectDraftSchema；全部可选，拿不准则缺省） */
export interface ProjectDraftSuggestion {
  outcome?: string
  areaId?: string
  tags: string[]
  reason: string
}

export interface ProjectDraftResult {
  suggestion: ProjectDraftSuggestion
  model: string | null
  ms: number
}

/** 请求 AI 为「只填标题」的新项目补全可推断字段；不写数据（失败抛出由调用方安静处理） */
export async function aiProjectDraft(title: string): Promise<ProjectDraftResult> {
  return api.post<ProjectDraftResult>('/api/ai/project/draft', { title })
}

/* ---------------------------------------------------------------------------
 * 笔记 AI 蒸馏（v0.5 · Slice M，见 ADR-0020）：把笔记压缩到目标层级
 * AI 只出「草稿文本」，绝不自动落盘；应用由用户确认后经 updateEntity('notes', …)
 * 写 body + distillLevel。
 * ------------------------------------------------------------------------- */

export interface NoteDistillResult {
  /** 压缩后的正文（≤1200 字；目标 ≤300） */
  text: string
  /** 服务端最终目标层级（1–3；缺省 = 当前层级 + 1，封顶 L3） */
  targetLevel: number
  model: string | null
  ms: number
}

/**
 * 请求 AI 把笔记蒸馏到 targetLevel（省略则由服务端取「当前层级 + 1，封顶 L3」）。
 * 不写数据；失败抛出由调用方安静处理（非阻断）。
 */
export async function aiNoteDistill(id: string, targetLevel?: number): Promise<NoteDistillResult> {
  const body: { id: string; targetLevel?: number } = { id }
  if (targetLevel !== undefined) body.targetLevel = targetLevel
  return api.post<NoteDistillResult>('/api/ai/note/distill', body)
}

/* ---------------------------------------------------------------------------
 * 聚类立项（v0.5 · Slice R2，见 ADR-0016）：连续累积的相似任务 → 新项目
 * AI 只出「建议提案」，绝不自动建项；应用经 cluster-apply（一次写入建项 + 归入任务）。
 * ------------------------------------------------------------------------- */

/** 聚类提案（对应服务端 clusterProposalSchema；taskIds 均为无归属任务） */
export interface ClusterProposal {
  title: string
  outcome?: string
  reason: string
  taskIds: string[]
  /** 相关未澄清条目：仅作命名参考，澄清时 AI 会参考（本提案不写入它们） */
  inboxIds: string[]
  areaId?: string
  tags: string[]
}

export interface ClusterDraftResult {
  proposals: ClusterProposal[]
  model: string | null
  ms: number
  candidates: number
}

/** 请求 AI 归纳候选（无归属任务 + 未澄清条目）；不写数据（失败抛出由调用方安静处理） */
export async function aiClusterDraft(): Promise<ClusterDraftResult> {
  return api.post<ClusterDraftResult>('/api/ai/cluster/draft')
}

export interface ClusterApplyInput {
  title: string
  outcome?: string
  areaId?: string
  tags?: string[]
  taskIds: string[]
}

export interface ClusterApplyResult {
  project: Project
  assigned: string[]
  createdTagIds: string[]
}

/** 应用聚类提案：一次写入创建项目并把列出的无归属任务归入（成功后整体水合） */
export async function applyCluster(input: ClusterApplyInput): Promise<ClusterApplyResult> {
  const result = await api.post<ClusterApplyResult>('/api/projects/cluster-apply', input)
  if (!(await hydrateFromServer())) {
    upsertEntity('projects', result.project)
    for (const id of result.assigned) {
      const task = getTaskById(id)
      if (task !== undefined) upsertEntity('tasks', { ...task, projectId: result.project.id })
    }
  }
  return result
}

export interface ClusterUnapplyResult {
  trashed: { kind: 'projects'; id: string }
  restoredTaskIds: string[]
}

/** 撤销聚类立项：清任务 projectId + 项目入回收站（成功后整体水合） */
export async function unapplyCluster(projectId: string): Promise<ClusterUnapplyResult> {
  const result = await api.post<ClusterUnapplyResult>('/api/projects/cluster-unapply', { projectId })
  if (!(await hydrateFromServer())) {
    removeEntity('projects', projectId)
    for (const id of result.restoredTaskIds) {
      const task = getTaskById(id)
      if (task !== undefined) {
        const next = { ...task }
        delete next.projectId
        upsertEntity('tasks', next)
      }
    }
  }
  return result
}

/* ---------------------------------------------------------------------------
 * AI 自动化档位 + AI 动态（v0.5 · Slice R2，见 ADR-0016）
 * ------------------------------------------------------------------------- */

/** 更新 AI 自动化档位（白名单 aiAutomation）；成功后整体水合使设置即时生效 */
export async function updateAiAutomation(level: AppConfig['aiAutomation']): Promise<void> {
  await api.post<{ config: unknown }>('/api/config', { aiAutomation: level })
  await hydrateFromServer()
}

/** 审计日志条目（GET /api/activity；detail 供「AI 动态」筛选） */
export interface ActivityEntry {
  ts: string
  action: string
  entity: string
  id: string
  detail?: Record<string, unknown>
}

/** 读取审计日志尾部（时间倒序；limit 上限 200） */
export async function fetchActivity(limit = 200): Promise<ActivityEntry[]> {
  const res = await api.get<{ items: ActivityEntry[] }>(`/api/activity?limit=${limit}`)
  return res.items
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

/** AI 周回顾草稿（对应服务端 /api/ai/review/draft 响应；Slice L 起含自动归档 id） */
export interface ReviewDraft {
  /** 生成时自动归档的 review id——「保存回顾」据此更新同一记录（不重复建） */
  reviewId: string
  /** 归档时间（生成时刻） */
  archivedAt?: string
  periodKey: string
  metrics: ReviewMetrics
  /** 上一同等周期指标（环比基准，供 UI 参考；可选） */
  prevMetrics?: ReviewMetrics
  summary: string
  decisions: string[]
  staleAdvice: StaleAdvice[]
  /** 实际停滞项目 id（服务端计算；报告归档用） */
  staleProjectIds?: string[]
  /** 数字落地护栏结果：false 表示有越界数字（仍保留并记录） */
  grounded?: boolean
  model: string | null
  ms: number
}

/**
 * 请求 AI 生成回顾草稿（周 / 月，Slice F）；服务端成功后**自动归档**一条 review
 * （审计 review.create · auto），返回其 reviewId（Slice L）。失败抛出由调用方提示。
 */
export async function generateReviewDraft(period: ReviewType = 'weekly'): Promise<ReviewDraft> {
  return api.post<ReviewDraft>('/api/ai/review/draft', { period })
}

/** 保存回顾（fallback）：服务端计算 id / 周期 / 指标 / 停滞项目；返回落盘记录 */
export async function saveReview(
  summary: string,
  decisions: string[],
  type: ReviewType = 'weekly',
): Promise<Review> {
  const { review } = await api.post<{ review: Review }>('/api/reviews', {
    summary,
    decisions,
    type,
  })
  upsertEntity('reviews', review)
  return review
}

/**
 * 更新已归档回顾（Slice L）：编辑并保存「保存回顾」更新**同一**记录——
 * 服务端白名单仅 summary / decisions + 递增 updatedAt + 审计 review.update。
 */
export async function updateReview(
  id: string,
  summary: string,
  decisions: string[],
): Promise<Review> {
  const { review } = await api.post<{ review: Review }>(`/api/reviews/${id}/update`, {
    summary,
    decisions,
  })
  upsertEntity('reviews', review)
  return review
}

/** 删除回顾（撤销保存 / 删除归档报告） */
export async function removeReview(id: string): Promise<void> {
  await api.post<{ removed: { kind: 'reviews'; id: string } }>(`/api/reviews/${id}/remove`)
  removeEntity('reviews', id)
}

/* ---------------------------------------------------------------------------
 * 详情操作 · 编辑 / 回收站 / 文件位置（v0.5 · Slice E2，见 ADR-0009）
 * ------------------------------------------------------------------------- */

/** 可编辑 / 可回收实体记录 */
export type EditableRecord =
  | Task
  | Project
  | Note
  | Resource
  | CalendarEvent
  | Area
  | Goal
  | Habit

/**
 * 构造「编辑撤销」补丁（Slice Y · F36）：对 patch 中出现的每个键，取记录中的原值；
 * 原值缺失（undefined）→ null（服务端 update 端点的「清除」语义）。把该补丁回写即可往返还原。
 * 纯函数，供各详情弹窗保存成功后挂到 toast「撤销」上。
 */
export function undoPatchOf(
  record: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(patch)) {
    const prev = record[key]
    out[key] = prev === undefined ? null : prev
  }
  return out
}

/** 编辑实体：只提交 patch 中提供的白名单字段；成功后 upsert 本地快照 */
export async function updateEntity(
  kind: TrashKind,
  id: string,
  patch: Record<string, unknown>,
): Promise<EditableRecord> {
  const { record } = await api.post<{ record: EditableRecord }>(`/api/${kind}/${id}/update`, patch)
  upsertEntity(kind, record)
  return record
}

/** 移入回收站：成功后从本地快照移除（撤销走 restoreEntity） */
export async function trashEntity(kind: TrashKind, id: string): Promise<void> {
  await api.post<{ trashed: { kind: TrashKind; id: string } }>(`/api/${kind}/${id}/trash`)
  removeEntity(kind, id)
}

/** 从回收站恢复：成功后 upsert 回本地快照 */
export async function restoreEntity(kind: TrashKind, id: string): Promise<EditableRecord> {
  const { record } = await api.post<{ kind: TrashKind; record: EditableRecord }>(
    `/api/trash/${kind}/${id}/restore`,
  )
  upsertEntity(kind, record)
  return record
}

/** 彻底删除回收站记录 */
export async function purgeEntity(kind: TrashKind, id: string): Promise<void> {
  await api.post<{ purged: { kind: TrashKind; id: string } }>(`/api/trash/${kind}/${id}/purge`)
}

/** 读取回收站列表（按移入时间倒序） */
export async function fetchTrash(): Promise<TrashItem[]> {
  const { items } = await api.get<{ items: TrashItem[] }>('/api/trash')
  return items
}

/** 在文件管理器中显示本地文件 / 目录（仅本机；失败抛出由调用方提示） */
export async function revealPath(path: string): Promise<void> {
  await api.post<{ ok: true }>('/api/reveal', { path })
}

/** 以系统默认程序打开本地文件 / 目录（Slice J2 · 仅本机；失败抛出由调用方提示） */
export async function openPath(path: string): Promise<void> {
  await api.post<{ ok: true }>('/api/open', { path })
}

/* ---------------------------------------------------------------------------
 * AI 对话 · 归档为笔记（v0.5 · Slice G）
 * ------------------------------------------------------------------------- */

/** 一轮对话消息（user = 我 / assistant = KERNEL） */
export interface AiChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface AiChatResult {
  reply: string
  model: string | null
  ms: number
}

/**
 * 与本地 AI 对话：客户端携带有界历史（服务端再裁剪）；读当前数据快照作答。
 * 不写数据；失败抛出由调用方提示（对话由调用方本地保留）。
 */
export async function chatWithAi(messages: AiChatMessage[]): Promise<AiChatResult> {
  return api.post<AiChatResult>('/api/ai/chat', { messages })
}

export interface CreateNoteInput {
  title: string
  body: string
  type?: Note['type']
  tags?: string[]
}

/** 新建笔记（通用创建端点 `POST /api/notes`；成功后 upsert 本地快照） */
export async function createNote(input: CreateNoteInput): Promise<Note> {
  const { note } = await api.post<{ note: Note }>('/api/notes', input)
  upsertEntity('notes', note)
  return note
}

/** 资料创建入参（Slice Y）：title 必填；kind / status 缺省（服务端补 article / unread） */
export interface ResourceCreateInput {
  title: string
  kind?: Resource['kind']
  status?: Resource['status']
  url?: string
  path?: string
  note?: string
  areaId?: string
  tags?: string[]
}

/** 新建资料（`POST /api/resources`；成功后 upsert 本地快照）——Sliver Y · F5 */
export async function createResource(input: ResourceCreateInput): Promise<Resource> {
  const { resource } = await api.post<{ resource: Resource }>('/api/resources', input)
  upsertEntity('resources', resource)
  return resource
}

/* ---------------------------------------------------------------------------
 * 标签管理（v0.5 · Slice T，见 ADR-0014）：管理操作改变注册表并级联实体，
 * 故一律在成功后整体重新水合快照（服务端是事实源），使筛选条 / 面板即时刷新。
 * ------------------------------------------------------------------------- */

/** 重命名标签（级联重写全部实体 tags）；返回受影响记录数 */
export async function renameTag(
  id: string,
  name: string,
  label?: string,
): Promise<{ tag: TagItem; affected: number }> {
  const body: { name: string; label?: string } = { name }
  if (label !== undefined && label.trim() !== '') body.label = label.trim()
  const result = await api.post<{ tag: TagItem; affected: number }>(
    `/api/tags/${id}/update`,
    body,
  )
  await hydrateFromServer()
  return result
}

/** 合并标签：source 名在全部实体上替换为 target 名，source 移除；返回受影响记录数 */
export async function mergeTag(
  sourceId: string,
  targetId: string,
): Promise<{ tag: TagItem; affected: number }> {
  const result = await api.post<{ tag: TagItem; affected: number }>(
    `/api/tags/${sourceId}/merge`,
    { targetId },
  )
  await hydrateFromServer()
  return result
}

/** 删除标签（仅未被任何记录使用时可删；使用中服务端 409 阻止）；成功后重新水合 */
export async function removeTag(id: string): Promise<void> {
  await api.post<{ removed: { id: string } }>(`/api/tags/${id}/remove`)
  await hydrateFromServer()
}

/** 扫描并登记现有未注册标签；返回新建项与扫描到的标签数，成功后重新水合 */
export async function backfillTags(): Promise<{ created: TagItem[]; scanned: number }> {
  const result = await api.post<{ created: TagItem[]; scanned: number }>('/api/tags/backfill')
  await hydrateFromServer()
  return result
}
