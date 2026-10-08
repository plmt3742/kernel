// KERNEL · 数据变更动作（唯一写入通道：经数据服务 API）
// 策略：本机写入毫秒级——任务完成采用乐观更新（即时反馈）+ 失败回滚；其余动作等待服务确认。
// 纪律：任何写入失败都要显式抛出（由调用方 toast 提示），不静默吞掉。
import { api } from '@/lib/api'
import { getTaskById, removeEntity, replaceSnapshot, setDataSource, upsertEntity } from '@/lib/data'
import { toISODateTime } from '@/lib/date'
import { sliceImageForAi } from '@/lib/imagePreview'
import type {
  AppConfig,
  Area,
  CalendarEvent,
  Course,
  CourseSession,
  Goal,
  Habit,
  InboxItem,
  KernelSnapshot,
  Note,
  Project,
  Resource,
  Review,
  ReviewMetrics,
  ReviewStaleAdvice,
  ReviewType,
  TagItem,
  Task,
  TermInfo,
  Trace,
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
  /** 软推迟（v0.5）：未来时刻前不出现在活跃工作列表；ISO 8601 带偏移 */
  deferUntil?: string
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
 * 踪迹（「踪迹」新功能）：记录「我刚刚做了什么」的时间戳条目。
 * 创建 = 先确认后写入；删除走回收站（撤销 = restoreEntity('traces', id)）。
 * ------------------------------------------------------------------------- */

/** 踪迹创建入参：title 必填；at 缺省由服务端填当前时刻 */
export interface TraceCreateInput {
  title: string
  note?: string
  at?: string
  tags?: string[]
  images?: string[]
  areaId?: string
  projectId?: string
}

/** 新建踪迹（成功后 upsert 本地快照） */
export async function createTrace(input: TraceCreateInput): Promise<Trace> {
  const { trace } = await api.post<{ trace: Trace }>('/api/traces', input)
  upsertEntity('traces', trace)
  return trace
}

/**
 * 上传踪迹图片（`POST /api/traces/images` RAW body）：png / jpeg / webp / gif，≤8MB。
 * 返回受管文件名（供 createTrace 的 images 引用）。失败抛错由调用方提示。
 */
export async function uploadTraceImage(file: File): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/traces/images', {
      method: 'POST',
      headers: { 'Content-Type': file.type !== '' ? file.type : 'application/octet-stream' },
      body: file,
    })
  } catch {
    throw new Error('数据服务离线 · 无法上传图片')
  }
  if (!response.ok) {
    let message = `上传失败（${response.status}）`
    try {
      const data = (await response.json()) as { error?: string }
      if (typeof data.error === 'string' && data.error !== '') message = data.error
    } catch {
      /* 用默认文案 */
    }
    throw new Error(message)
  }
  const data = (await response.json()) as { name?: string }
  if (typeof data.name !== 'string' || data.name === '') throw new Error('上传响应缺少文件名')
  return data.name
}

/* ---------------------------------------------------------------------------
 * 课表（v0.5 · Slice H0）：课程 + 学期元信息。
 * 课程 = 标题 + 若干时段（星期 / 节次 / 周次）；删除走回收站（撤销即恢复）。
 * 学期 `term` 是单例元信息，更新后整体水合（与 updateAiAutomation 同策略）。
 * ------------------------------------------------------------------------- */

/** 课程创建入参：title 必填；sessions 至少一个（服务端校验） */
export interface CourseCreateInput {
  title: string
  teacher?: string
  location?: string
  sessions: CourseSession[]
  notes?: string
}

/** 新建课程（成功后 upsert 本地快照） */
export async function createCourse(input: CourseCreateInput): Promise<Course> {
  const { course } = await api.post<{ course: Course }>('/api/courses', input)
  upsertEntity('courses', course)
  return course
}

/** 编辑课程（白名单 title / teacher / location / sessions / notes；成功后 upsert） */
export async function updateCourse(id: string, patch: Record<string, unknown>): Promise<Course> {
  const { record } = await api.post<{ record: Course }>(`/api/courses/${id}/update`, patch)
  upsertEntity('courses', record)
  return record
}

/** 删除课程（移入回收站，服务端审计 course.remove）。撤销走 restoreEntity('courses', id) */
export async function removeCourse(id: string): Promise<void> {
  await api.post<{ trashed: { kind: 'courses'; id: string } }>(`/api/courses/${id}/remove`)
  removeEntity('courses', id)
}

/** 更新学期设置（白名单 startDate / totalWeeks）；返回服务端最终 term */
export async function updateTerm(patch: {
  startDate?: string
  totalWeeks?: number
}): Promise<TermInfo> {
  const { term } = await api.post<{ term: TermInfo }>('/api/term', patch)
  await hydrateFromServer()
  return term
}

/* ---------------------------------------------------------------------------
 * 课表导入（v0.5 · Slice H1）：从收件箱条目（xlsx / 截图 / 粘贴文本）提取课程。
 * AI 只出「草稿」（CourseCreateInput[]），绝不自动落盘；用户勾选确认后经
 * /api/courses/import 一次写入（成功后整体水合，使课表即时刷新）。
 * ------------------------------------------------------------------------- */

/** AI 课表提取草稿：courses 为待确认课程；model / ms 供状态展示 */
export interface TimetableDraftResult {
  courses: CourseCreateInput[]
  model: string | null
  ms: number
}

/** 请求 AI 从收件箱条目提取课程草稿（同步，保留为回退路径）；不写数据（失败抛出由调用方安静处理） */
export async function aiTimetableDraft(id: string): Promise<TimetableDraftResult> {
  return api.post<TimetableDraftResult>('/api/ai/timetable/draft', { id })
}

/** AI 课表流式提取过程事件（对应 POST /api/ai/timetable/draft-stream 的 SSE 帧；同 parse-stream 格式） */
export type TimetableStreamEvent =
  | { kind: 'status'; status?: string }
  | { kind: 'delta'; field: string; delta: string }
  | { kind: 'retry'; reason: string }
  | { kind: 'suggestion'; courses: CourseCreateInput[]; model: string | null; ms: number }
  | { kind: 'error'; message: string }

/**
 * 流式请求 AI 课表提取（Slice H1.6）：POST + fetch 读取响应体（非 EventSource）。
 * 逐帧解析 SSE（`data: <json>\n\n`，chunk 边界不敏感），把过程事件交给 onEvent；
 * 收到 suggestion 帧时以 TimetableDraftResult 兑现；error 帧 / 非 2xx 响应以可读错误拒绝。
 * 与 aiParseInboxStream 同构，唯一差异：id 经 JSON body 传递、兑现值为课程草稿。
 */
export async function aiTimetableDraftStream(
  id: string,
  onEvent: (event: TimetableStreamEvent) => void,
): Promise<TimetableDraftResult> {
  let response: Response
  try {
    response = await fetch('/api/ai/timetable/draft-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
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

  const state: { result: TimetableDraftResult | null; failure: string | null; buffer: string } = {
    result: null,
    failure: null,
    buffer: '',
  }

  const handleFrame = (frame: string): void => {
    const line = frame.split('\n').find((part) => part.startsWith('data:'))
    if (line === undefined) return
    const payload = line.slice(5).trim()
    if (payload === '') return
    let event: TimetableStreamEvent
    try {
      event = JSON.parse(payload) as TimetableStreamEvent
    } catch {
      return
    }
    if (event.kind === 'suggestion') {
      state.result = { courses: event.courses, model: event.model, ms: event.ms }
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

/**
 * 批量导入课程（一次写入；成功后整体水合使课表即时刷新）。
 * 返回服务端新建的课程列表（撤销 = 逐条经 removeCourse 移入回收站）。
 */
export async function importCourses(courses: CourseCreateInput[]): Promise<Course[]> {
  const { created } = await api.post<{ created: Course[] }>('/api/courses/import', { courses })
  await hydrateFromServer()
  return created
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
  // 长图 / 大图：客户端切片后经 ai-preview 端点上传为多个图片 part（在返回前完成，
  // 使随后的解析能读到分片）；分片失败不阻断投递——解析端自动回退原图单 part。
  if (file.type.startsWith('image/')) {
    try {
      const tiles = await sliceImageForAi(file)
      for (let i = 0; i < tiles.length; i += 1) {
        await fetch(`/api/inbox/${inbox.id}/ai-preview?index=${i + 1}`, {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: tiles[i],
        })
      }
    } catch {
      // 预览分片失败不阻断投递：解析端自动回退原图
    }
  }
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
export type AiActionKind = 'task' | 'note' | 'resource' | 'project' | 'event' | 'trace'

export interface AiAction {
  kind: AiActionKind
  title: string
  /** task 专属 */
  contexts: string[]
  energy?: Task['energy']
  importance?: number
  estimateMin?: number
  dueAt?: string
  /** event 专属（Slice N10）：定点安排；startAt 必填（ISO8601 带时区） */
  startAt?: string
  /** event 专属：可选结束时间（须 ≥ startAt） */
  endAt?: string
  /** event 专属：只有日期、无具体时间 */
  allDay?: boolean
  /** event 专属：地点 */
  location?: string
  /** trace 专属（「踪迹」）：发生时间 ISO8601 带时区；缺省 = 应用时刻 */
  at?: string
  /** 归属（task / note / resource / project） */
  projectId?: string
  areaId?: string
  tags: string[]
  /** resource 专属（Slice R2.5）：1–3 句简约小结，作为资料详情页「简介」 */
  note?: string
  /** resource 专属（Slice N2）：资料链接（url）；null = 清除 */
  url?: string | null
  /** project 专属：完成定义 */
  outcome?: string
  /** task / note / event：挂到本批次新建的项目（与 projectId 互斥） */
  linkToNewProject?: boolean
  /** task：疑似重复的既有任务 id */
  duplicateOf?: string
  /** task：适用条件（Slice N0；如「仅出国（境）者」）；有条件的动作默认不勾选，由用户主动纳入 */
  condition?: string | null
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
 * Slice N4：可选 summary（≤40 字来源摘要）随本次 apply 一并提交，服务端写入 item.summary，
 * 供之后任务详情的「来源条目」以人话展示（空 / 缺省则不提交该字段）。
 */
export async function applyInbox(
  id: string,
  actions: AiAction[],
  summary?: string,
): Promise<InboxApplyResult> {
  const body: { actions: AiAction[]; summary?: string } = { actions }
  const trimmed = summary?.trim() ?? ''
  if (trimmed !== '') body.summary = trimmed
  const result = await api.post<InboxApplyResult>(`/api/inbox/${id}/apply`, body)
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
  /** 公告要点（Slice N0）：假日日期等硬信息，≤8 条、每条 ≤140 字；不落盘，供「存为要点笔记」 */
  facts: string[]
  /**
   * 来源摘要（Slice N4）：≤40 字的人话小结，由服务端清洗；apply 时写入条目（item.summary），
   * 供任务详情「来源条目」等关联展示复用。缺失 / 旧数据视为无摘要（归一化为空串）。
   */
  summary: string
  /** Slice N9：本次解析实际执行过的联网检索问题（无检索则缺省） */
  searched?: string[]
  model: string | null
  ms: number
}

/** AI 流式解析过程事件（对应 GET/POST /api/ai/inbox/:id/parse-stream 的 SSE 帧） */
export type AiStreamEvent =
  | { kind: 'status'; status?: string }
  | { kind: 'delta'; field: string; delta: string }
  | { kind: 'retry'; reason: string }
  | {
      kind: 'suggestion'
      actions: AiAction[]
      facts: string[]
      /** 来源摘要（Slice N4）：≤40 字；旧服务端 / 旧缓存可能缺省 */
      summary?: string
      model: string | null
      ms: number
    }
  | { kind: 'error'; message: string }

/** 请求 AI 解析收件箱条目（同步，保留为回退路径）；不写数据（失败抛出由调用方提示） */
export async function aiParseInbox(id: string): Promise<AiParseResult> {
  const result = await api.post<AiParseResult>(`/api/ai/inbox/${id}/parse`)
  // 服务端老版本可能不带 facts（Slice N0）/ summary（Slice N4）：缺省补齐，保证消费端稳定
  return { ...result, facts: result.facts ?? [], summary: result.summary ?? '' }
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
      // facts 缺省补齐（老服务端 / 无要点时）；消费端视为必填
      state.result = {
        actions: event.actions,
        facts: event.facts ?? [],
        // summary 缺省补齐（老服务端 / 无摘要时）；消费端视为必填
        summary: event.summary ?? '',
        model: event.model,
        ms: event.ms,
      }
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
 * AI 整理（organize）：一次性「归档既有任务 + 聚类立项」编排
 * AI 只出建议——assignments 归入既有项目 / clusters 建新项目，绝不自动落盘；
 * 应用经 organize-apply 一次写入（成功后整体水合，失败本地尽力回填）。
 * ------------------------------------------------------------------------- */

/** 归入既有项目的建议（taskIds 均为无归属任务） */
export interface OrganizeAssignmentProposal {
  projectId: string
  projectTitle: string
  taskIds: string[]
  reason: string
}

/** 新建项目聚类建议（成员 id 由服务端展开，抗幻觉由构造保证） */
export interface OrganizeClusterProposal {
  title: string
  outcome?: string
  reason: string
  taskIds: string[]
  /** 相关未澄清条目：仅作命名参考（本提案不写入它们） */
  inboxIds: string[]
  areaId?: string
  tags: string[]
}

export interface OrganizeDraftResult {
  assignments: OrganizeAssignmentProposal[]
  clusters: OrganizeClusterProposal[]
  model: string | null
  ms: number
  candidates: number
  /** N8.1：未纳入任何建议的候选数（单项事务或联系不足） */
  unplanned: number
}

/** 请求 AI 整理草稿（无 body；只读、不写数据；失败抛出由调用方安静处理） */
export async function aiOrganizeDraft(): Promise<OrganizeDraftResult> {
  return api.post<OrganizeDraftResult>('/api/ai/organize/draft')
}

export interface OrganizeApplyAssignmentInput {
  projectId: string
  taskIds: string[]
}

export interface OrganizeApplyClusterInput {
  title: string
  outcome?: string
  areaId?: string
  tags?: string[]
  taskIds: string[]
}

export interface OrganizeApplyInput {
  assignments: OrganizeApplyAssignmentInput[]
  clusters: OrganizeApplyClusterInput[]
}

export interface OrganizeApplyResult {
  assignments: OrganizeApplyAssignmentInput[]
  projects: { id: string; title: string; taskIds: string[] }[]
  createdTagIds: string[]
  errors: string[]
  assignedTotal: number
}

/**
 * 应用整理选择：一次写入（归入既有项目 + 建新项目并归入）；成功后整体水合。
 * 水合失败时尽力本地回填——把已归入任务就地改 projectId；新项目实体字段不全（仅有
 * id/title/taskIds），**不臆造半成品 Project 记录**，留待下次聚焦水合补全。
 */
export async function organizeApply(input: OrganizeApplyInput): Promise<OrganizeApplyResult> {
  const result = await api.post<OrganizeApplyResult>('/api/projects/organize-apply', input)
  if (!(await hydrateFromServer())) {
    const groups: OrganizeApplyAssignmentInput[] = [
      ...result.assignments,
      ...result.projects.map((p) => ({ projectId: p.id, taskIds: p.taskIds })),
    ]
    for (const group of groups) {
      for (const id of group.taskIds) {
        const task = getTaskById(id)
        if (task !== undefined && task.projectId !== group.projectId) {
          upsertEntity('tasks', { ...task, projectId: group.projectId })
        }
      }
    }
  }
  return result
}

export interface OrganizeUnapplyInput {
  projects: string[]
  assignments: OrganizeApplyAssignmentInput[]
}

export interface OrganizeUnapplyResult {
  trashed: { kind: string; id: string }[]
  restoredTaskIds: string[]
  clearedTaskIds: string[]
}

/** 撤销整理：新建项目入回收站 + 已归入任务清 projectId（成功后整体水合，失败尽力本地回填） */
export async function organizeUnapply(input: OrganizeUnapplyInput): Promise<OrganizeUnapplyResult> {
  const result = await api.post<OrganizeUnapplyResult>('/api/projects/organize-unapply', input)
  if (!(await hydrateFromServer())) {
    for (const item of result.trashed) {
      if (item.kind === 'projects') removeEntity('projects', item.id)
    }
    // restored / cleared 两组终态均为「无归属」，一并清除 projectId（尽力回填，下次水合校正）
    const detached = new Set([...result.restoredTaskIds, ...result.clearedTaskIds])
    for (const id of detached) {
      const task = getTaskById(id)
      if (task !== undefined && task.projectId !== undefined) {
        const next = { ...task }
        delete next.projectId
        upsertEntity('tasks', next)
      }
    }
  }
  return result
}

/* --- 兼容别名（并行协作期旧命名；与冻结契约同名导出并存，避免重复定义 --- */
/* 说明：服务端 / 早期 UI 使用无 Proposal 后缀的类型名与 applyOrganize / unapplyOrganize 函数名。 */
export type OrganizeAssignment = OrganizeAssignmentProposal
export type OrganizeCluster = OrganizeClusterProposal
export const applyOrganize = organizeApply
export const unapplyOrganize = organizeUnapply

/* ---------------------------------------------------------------------------
 * AI 自动化档位 + AI 动态（v0.5 · Slice R2，见 ADR-0016）
 * ------------------------------------------------------------------------- */

/** 更新 AI 自动化档位（白名单 aiAutomation）；成功后整体水合使设置即时生效 */
export async function updateAiAutomation(level: AppConfig['aiAutomation']): Promise<void> {
  await api.post<{ config: unknown }>('/api/config', { aiAutomation: level })
  await hydrateFromServer()
}

/* ---------------------------------------------------------------------------
 * 个人页（Profile）：显示名称 / 简介（POST /api/config）+ 头像（RAW 上传 / 移除）
 * 数据落 meta/config.json 与头像文件；成功后整体水合，使卡片 / 顶栏即时刷新。
 * ------------------------------------------------------------------------- */

/** 个人资料更新入参：仅提交提供的白名单字段（owner 显示名称 / bio 简介） */
export interface ProfileUpdateInput {
  owner?: string
  bio?: string
}

/** 更新显示名称 / 简介（`POST /api/config`）；成功后整体水合使 UI 即时刷新 */
export async function updateProfile(patch: ProfileUpdateInput): Promise<void> {
  await api.post<{ config: unknown }>('/api/config', patch)
  await hydrateFromServer()
}

/**
 * 上传头像（`POST /api/profile/avatar` RAW body）：png / jpeg / webp / gif，≤2MB。
 * 成功后整体水合，返回服务端最终 avatarPath（旧服务端缺省时回退空串）。
 */
export async function uploadProfileAvatar(file: File): Promise<string> {
  let response: Response
  try {
    response = await fetch('/api/profile/avatar', {
      method: 'POST',
      headers: { 'Content-Type': file.type !== '' ? file.type : 'application/octet-stream' },
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
  const avatarPath =
    data !== null &&
    typeof data === 'object' &&
    'avatarPath' in data &&
    typeof (data as { avatarPath: unknown }).avatarPath === 'string'
      ? (data as { avatarPath: string }).avatarPath
      : ''
  await hydrateFromServer()
  return avatarPath
}

/** 移除头像（`POST /api/profile/avatar/remove`）；成功后整体水合 */
export async function removeProfileAvatar(): Promise<void> {
  await api.post<{ ok: true }>('/api/profile/avatar/remove')
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
 * AI Key（v0.5 · Slice N5）：DeepSeek API Key 本机配置
 * 仅经唯一写者落盘到 data/meta/secrets.json（不进仓库、仅本机）；apiKey 空串 = 清除。
 * 响应 { ok, hasKey } ——hasKey 供设置页状态 pill 即时刷新。
 * ------------------------------------------------------------------------- */

/** 保存 / 清除 DeepSeek API Key（空串表示清除）；返回最新 hasKey */
export async function setAiKey(apiKey: string): Promise<boolean> {
  const res = await api.post<{ ok: true; hasKey: boolean }>('/api/ai/key', { apiKey })
  return res.hasKey
}

/* ---------------------------------------------------------------------------
 * 周回顾（v0.5 · Slice C：AI 只出草稿；确认后经 /api/reviews 落盘；撤销即删除）
 * ------------------------------------------------------------------------- */

/** 停滞项目处置建议（对应服务端 staleAdviceSchema；历史别名，正名为 ReviewStaleAdvice） */
export type StaleAdvice = ReviewStaleAdvice

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

/** 保存回顾（fallback）：服务端计算 id / 周期 / 指标 / 停滞项目；返回落盘记录。
 *  `staleAdvice`（可选）由调用方透传（回顾自动化），服务端形状校验后归档；缺省不写该键。 */
export async function saveReview(
  summary: string,
  decisions: string[],
  type: ReviewType = 'weekly',
  staleAdvice?: StaleAdvice[],
): Promise<Review> {
  const { review } = await api.post<{ review: Review }>('/api/reviews', {
    summary,
    decisions,
    type,
    ...(staleAdvice !== undefined ? { staleAdvice } : {}),
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
  | Trace
  | Area
  | Goal
  | Habit
  | Course

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

/** 实体修改提案（本切片）：AI 生成 · 用户确认后应用；确认前零写入 */
export interface ChatEditProposal {
  /** 目标实体类别（与回收站同族：tasks / events / …） */
  kind: TrashKind
  id: string
  /** 目标实体标题（服务端快照） */
  title: string
  /** 拟修改字段（服务端已按可编辑字段白名单过滤） */
  fields: Record<string, unknown>
  /** 变更前值（缺省字段以 null 表示「清除」；用于展示与撤销） */
  before: Record<string, unknown>
  /** 模型给出的一句话修改说明（可缺省） */
  label?: string
}

/** 踪迹提案（「踪迹」功能）：AI 从「我刚刚做了 X」识别出的一条记录；确认后才经 /api/traces 落盘 */
export interface ChatTraceProposal {
  title: string
  note?: string
  at?: string
}

/** 新建任务提案（本切片）：AI 从「帮我记一条任务 / 打算做 X」识别出的新任务；确认后才经 /api/tasks 落盘 */
export interface ChatTaskProposal {
  title: string
  /** 截止时间（ISO8601 带时区；仅当用户已明确给出日期 / 时间时由服务端下发） */
  dueAt?: string
  /** 重要性 0–3（可选） */
  importance?: number
}

/** 新建日程提案（本切片）：AI 从「定点安排（会议 / 面试 / 考试 / 活动）」识别出的新日程；确认后才经 /api/events 落盘 */
export interface ChatEventProposal {
  title: string
  /** 开始时间（ISO8601 带时区；服务端校验后必填） */
  startAt: string
  /** 结束时间（可选；须 ≥ startAt） */
  endAt?: string
  /** 全天（只有日期、无具体时刻；可选） */
  allDay?: boolean
  /** 地点（≤60 字；可选） */
  location?: string
}

/** 新建项目提案（本切片）：AI 从「帮我起一个项目 / 这件事该立个项目」识别；确认后才经 /api/projects 落盘 */
export interface ChatProjectProposal {
  title: string
  /** 完成定义（可缺省；≤200 字） */
  outcome?: string
}

/** 新建笔记提案（本切片）：AI 从对话内容整理出的一条独立笔记；确认后才经 /api/notes 落盘 */
export interface ChatNoteProposal {
  title: string
  /** 正文（Markdown 文本） */
  body: string
}

/** 操作提案可作用的实体类别（回收站同族子集；不含 courses / areas 等） */
export type ChatActionKind = 'tasks' | 'projects' | 'notes' | 'resources' | 'events' | 'traces'

/** 操作提案种类：标记完成 / 重新打开 / 删除（入回收站）/ 归档 */
export type ChatActionOp = 'complete' | 'reopen' | 'delete' | 'archive'

/** 操作提案（本切片）：对既有实体的就地操作；确认后才执行，撤销走对应反向动作 */
export interface ChatActionProposal {
  op: ChatActionOp
  kind: ChatActionKind
  id: string
  /** 目标实体标题（服务端快照） */
  title: string
  /** 变更前值（归档撤销用；缺省以「进行中」兜底） */
  before?: unknown
  /** 模型给出的一句话操作说明（可缺省） */
  label?: string
}

export interface AiChatResult {
  reply: string
  /** Slice G.1：本轮为作答实际执行的联网检索问题（空 / 缺省 = 未检索） */
  searched?: string[]
  /** 本切片：本轮为作答查阅过的实体标题（空 / 缺省 = 未查阅） */
  focused?: string[]
  /** 本切片：实体修改提案（服务端校验后；仅命中修改意图时存在） */
  edits?: ChatEditProposal[]
  /** 「踪迹」提案（服务端校验后；命中「我做了 X」意图时存在；**1–6 条**，支持同段拆分） */
  traces?: ChatTraceProposal[]
  /** 「新建任务」提案（服务端清洗后；**1–6 条**；可与 traces / events 同时存在） */
  tasks?: ChatTaskProposal[]
  /** 「新建日程」提案（服务端清洗后；**1–6 条**；可与 traces / tasks 同时存在） */
  events?: ChatEventProposal[]
  /** 「新建项目」提案（服务端清洗后；**1–6 条**；确认前零写入） */
  projects?: ChatProjectProposal[]
  /** 「新建笔记」提案（服务端清洗后；**1–6 条**；确认前零写入） */
  notes?: ChatNoteProposal[]
  /** 「操作既有实体」提案（服务端清洗后；**1–6 条**；确认前零写入） */
  actions?: ChatActionProposal[]
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

/** 对话附件引用（`POST /api/ai/chat/upload` 的返回）：服务端受管文件名 + 原始名 + MIME */
export interface ChatAttachment {
  stored: string
  name: string
  mime: string
}

/**
 * 上传对话附件（`POST /api/ai/chat/upload?name=&type=`，RAW body）。
 * 与 uploadInboxFile 同款 RAW 通道，但只返回文件引用（不生成收件箱条目）；
 * 失败抛出可读错误，由调用方提示。
 */
export async function uploadChatAttachment(file: File): Promise<ChatAttachment> {
  const params = new URLSearchParams()
  params.set('name', file.name)
  if (file.type !== '') params.set('type', file.type)
  let response: Response
  try {
    response = await fetch(`/api/ai/chat/upload?${params.toString()}`, {
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
  const ref = (data as { file?: Partial<ChatAttachment> } | null)?.file
  if (
    ref === undefined ||
    typeof ref.stored !== 'string' ||
    typeof ref.name !== 'string' ||
    typeof ref.mime !== 'string'
  ) {
    throw new Error('上传响应缺少文件信息')
  }
  return { stored: ref.stored, name: ref.name, mime: ref.mime }
}

/** AI 对话流式过程事件（对应 POST /api/ai/chat-stream 的 SSE 帧） */
export type AiChatStreamEvent =
  | { kind: 'status'; status: string }
  | { kind: 'delta'; field: 'text' | 'reasoning'; delta: string }
  | ({ kind: 'result' } & AiChatResult)
  | { kind: 'error'; message: string }

/**
 * 流式对话：POST /api/ai/chat-stream（镜像 aiParseInboxStream 的 fetch + reader + `\n\n` 帧解析）。
 * 过程帧（status / delta）交给 onEvent；收到 result 帧以 AiChatResult 兑现；error 帧 / 非 2xx 以可读错误拒绝。
 * 不写数据；对话历史由调用方本地保留。attachments 为 uploadChatAttachment 的返回值数组（可选）。
 */
export async function aiChatStream(
  messages: AiChatMessage[],
  attachments: ChatAttachment[] | undefined,
  onEvent: (event: AiChatStreamEvent) => void,
): Promise<AiChatResult> {
  const body: { messages: AiChatMessage[]; attachments?: ChatAttachment[] } = { messages }
  if (attachments !== undefined && attachments.length > 0) body.attachments = attachments
  let response: Response
  try {
    response = await fetch('/api/ai/chat-stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('数据服务不可用（确认 npm run dev 已启动数据服务）')
  }
  if (!response.ok) {
    // 前置校验失败（400/503 等）：响应体为 JSON，沿用 api.ts 的错误解析
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

  const streamBody = response.body
  if (streamBody === null) throw new Error('数据服务未返回流式响应')
  const reader = streamBody.getReader()
  const decoder = new TextDecoder()

  const state: { result: AiChatResult | null; failure: string | null; buffer: string } = {
    result: null,
    failure: null,
    buffer: '',
  }

  const handleFrame = (frame: string): void => {
    const line = frame.split('\n').find((part) => part.startsWith('data:'))
    if (line === undefined) return
    const payload = line.slice(5).trim()
    if (payload === '') return
    let event: AiChatStreamEvent
    try {
      event = JSON.parse(payload) as AiChatStreamEvent
    } catch {
      return
    }
    if (event.kind === 'result') {
      // result 帧携带完整 AiChatResult；剔除 kind 后即兑现值
      const { kind: _kind, ...result } = event
      void _kind
      state.result = result
      return
    }
    if (event.kind === 'error') {
      state.failure = event.message
      return
    }
    // status / delta 过程帧：交给调用方驱动流式气泡
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

/** 对话 → 笔记（Slice G.1）：把某条对话回答整理成独立笔记并落盘 */
export interface ChatNoteInput {
  instruction: string
  answer: string
}

export interface ChatNoteResult {
  note: { id: string; title: string }
  model?: string | null
  ms?: number
}

/** 对话 → 笔记（`POST /api/ai/chat/note`；AI 整理草稿，服务端落盘，可经回收站撤销） */
export async function chatNoteFromChat(input: ChatNoteInput): Promise<ChatNoteResult> {
  return api.post<ChatNoteResult>('/api/ai/chat/note', input)
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
