// KERNEL · 领域类型定义
// 事实源：docs/00-DESIGN-BRIEF.md §7
// 纪律：全严格类型；禁止 any；状态字段一律使用联合类型。

/* ---------------------------------------------------------------------------
 * 状态 / 枚举联合类型
 * ------------------------------------------------------------------------- */

/** 收件箱来源 */
export type InboxSource = 'manual' | 'file' | 'notification' | 'voice'
/** 收件箱澄清状态 */
export type InboxStatus = 'unprocessed' | 'clarified' | 'discarded'

/** 任务状态（GTD 可行动性） */
export type TaskStatus =
  | 'next'
  | 'waiting'
  | 'scheduled'
  | 'someday'
  | 'done'
  | 'dropped'

/** 能量级别 */
export type Energy = 'low' | 'medium' | 'high'

/** 项目状态 */
export type ProjectStatus = 'active' | 'onHold' | 'someday' | 'done' | 'archived'

/** 区域审视节奏 */
export type AreaCadence = 'weekly' | 'monthly' | 'quarterly'
/** 区域状态 */
export type AreaStatus = 'active' | 'archived'

/** 目标时间视野 */
export type GoalHorizon = 'term' | 'quarter' | 'year'
/** 目标状态 */
export type GoalStatus = 'active' | 'achieved' | 'dropped' | 'someday'

/** 习惯节奏 */
export type HabitCadence = 'daily' | 'weekly' | 'monthly'
/** 习惯度量方式 */
export type HabitMetric = 'count' | 'minutes' | 'bool'

/** 事件状态 */
export type EventStatus = 'confirmed' | 'tentative' | 'cancelled'

/** 笔记类型（Zettelkasten-lite + 会议/备忘） */
export type NoteType = 'fleeting' | 'literature' | 'permanent' | 'meeting' | 'memo'

/** 资料类型 */
export type ResourceKind =
  | 'article'
  | 'course'
  | 'book'
  | 'tool'
  | 'paper'
  | 'file'
/** 资料状态 */
export type ResourceStatus =
  | 'unread'
  | 'reading'
  | 'read'
  | 'reference'
  | 'archived'

/** 回顾类型 */
export type ReviewType = 'weekly' | 'monthly'

/* ---------------------------------------------------------------------------
 * 回收站（Slice E2）：可回收的实体类型与条目
 * ------------------------------------------------------------------------- */

/** 可回收实体类型（Slice W：日程 events 并入可写 / 可回收族） */
export type TrashKind = 'tasks' | 'projects' | 'notes' | 'resources' | 'events'

/** 回收站中的记录（原记录 + 移入时间戳） */
export type TrashRecord = (Task | Project | Note | Resource | CalendarEvent) & {
  trashedAt?: string
}

/** 回收站条目：kind + 原记录 */
export interface TrashItem {
  kind: TrashKind
  record: TrashRecord
}

/** 标签命名空间（有界分类，Johnny.Decimal 精神） */
export type TagNamespace = 'role' | 'context' | 'topic'

/** 身份标签（交叉筛选器，非容器） */
export type RoleTag =
  | 'role:student'
  | 'role:assistant'
  | 'role:competition-head'
  | 'role:acm'
  | 'role:monitor'
  | 'role:vibecoder'

/* ---------------------------------------------------------------------------
 * 实体
 * ------------------------------------------------------------------------- */

/** 收件箱条目 · i- */
export interface InboxItem {
  id: string
  content: string
  source: InboxSource
  capturedAt: string
  status: InboxStatus
  linkedId?: string
  note?: string
  /** 文件投递附件元数据（二进制存 data/files/<id>-<name>，不进 git；见 ADR-0008） */
  file?: {
    name: string
    size: number
    mime?: string
  }
}

/** 任务 · t- */
export interface Task {
  id: string
  title: string
  notes?: string
  status: TaskStatus
  /** 第一筛选轴，如 ["@lab","@campus"] */
  contexts: string[]
  energy: Energy
  estimateMin?: number
  /** 0–3，决策输入而非硬排名 */
  importance: number
  dueAt?: string
  deferUntil?: string
  projectId?: string
  areaId?: string
  parentTaskId?: string
  tags: string[]
  repeatRule?: string
  createdAt: string
  updatedAt: string
  doneAt?: string
  sourceInboxId?: string
}

/** 项目 · p- */
export interface Project {
  id: string
  title: string
  /** 完成定义（outcome） */
  outcome: string
  status: ProjectStatus
  areaId: string
  goalId?: string
  nextActionId?: string
  dueAt?: string
  tags: string[]
  createdAt: string
  updatedAt: string
}

/** 区域 · a-（标准式，非身份） */
export interface Area {
  id: string
  title: string
  standard: string
  cadence: AreaCadence
  status: AreaStatus
}

/** 关键结果 */
export interface KeyResult {
  text: string
  target: number
  current: number
  unit?: string
}

/** 目标 · g- */
export interface Goal {
  id: string
  title: string
  horizon: GoalHorizon
  areaId?: string
  parentGoalId?: string
  keyResults: KeyResult[]
  status: GoalStatus
  targetDate?: string
}

/** 习惯打卡记录 */
export interface HabitLogEntry {
  /** YYYY-MM-DD */
  date: string
  value: number
}

/** 习惯 · h- */
export interface Habit {
  id: string
  title: string
  cadence: HabitCadence
  /** 实施意图（trigger） */
  trigger: string
  metric: HabitMetric
  target: number
  areaId?: string
  log: HabitLogEntry[]
}

/** 事件 · e-（Slice W：可写实体；endAt 可选=单点日程，notes 可编辑） */
export interface CalendarEvent {
  id: string
  title: string
  startAt: string
  endAt?: string
  allDay: boolean
  location?: string
  areaId?: string
  projectId?: string
  tags: string[]
  status: EventStatus
  notes?: string
  /** 重复规则：仅展示保留，本期不开放编辑（见 ADR-0018） */
  repeatRule?: string
}

/** 笔记 · n- */
export interface Note {
  id: string
  title: string
  type: NoteType
  /** Markdown 正文 */
  body: string
  links: string[]
  areaId?: string
  projectId?: string
  tags: string[]
  /** 蒸馏层级 0–3（progressive summarization） */
  distillLevel: number
  createdAt: string
  updatedAt: string
}

/** 资料 · r- */
export interface Resource {
  id: string
  title: string
  url?: string
  /** 本地文件绝对路径（文件投递澄清为资料时写入；Slice E2） */
  path?: string
  kind: ResourceKind
  status: ResourceStatus
  tags: string[]
  areaId?: string
  addedAt: string
  note?: string
}

/** 周/月回顾指标（`migrated` 可缺省：生成流程暂不产出，编辑追踪落地后补） */
export interface ReviewMetrics {
  captured: number
  created: number
  completed: number
  overdue: number
  migrated?: number
}

/** 回顾来源（Slice L）：'ai' = 生成即自动归档；'manual' = 手工保存 */
export type ReviewSource = 'ai' | 'manual'

/** 回顾 · rev- */
export interface Review {
  id: string
  type: ReviewType
  /** 如 "2026-W40" */
  periodKey: string
  /** 归档时间（生成时刻；手工保存时为保存时刻） */
  date: string
  metrics: ReviewMetrics
  decisions: string[]
  summary: string
  staleProjectIds?: string[]
  /** 来源（Slice L 自动归档；旧记录缺省） */
  source?: ReviewSource
  /** 最近编辑时间（review.update 时 bump；旧记录缺省） */
  updatedAt?: string
}

/** AI 自动化档位（Slice R2）：confirm = 先确认后写入（默认）；auto = 自动应用低风险动作 */
export type AiAutomation = 'confirm' | 'auto'

/** 标签来源（Slice T）：seed = 种子内置；manual = 用户录入自动登记；ai = AI 提议并应用 */
export type TagOrigin = 'seed' | 'manual' | 'ai'

/** 标签定义 */
export interface TagItem {
  id: string
  name: string
  namespace: TagNamespace
  label: string
  /** 来源（旧记录缺省，UI 视作 seed） */
  origin?: TagOrigin
  /** 登记时间（ISO 8601；旧种子记录缺省） */
  createdAt?: string
  /** 首次随哪个实体登记（如 t-0003） */
  firstUsedIn?: string
}

/** 标签注册表（meta/tags.json） */
export interface TagRegistry {
  tags: TagItem[]
}

/** 应用配置（meta/config.json） */
export interface AppConfig {
  name: string
  owner: string
  version: string
  locale: string
  weekStart: string
  createdAt: string
  /** AI 自动化档位（Slice R2；旧配置缺省，UI 视作 'confirm'） */
  aiAutomation?: AiAutomation
}

/* ---------------------------------------------------------------------------
 * 别名 / 聚合
 * ------------------------------------------------------------------------- */

/** 事件实体别名（避免与 DOM 全局 Event 混淆） */
export type KernelEvent = CalendarEvent

/** 任一实体 */
export type KernelEntity =
  | InboxItem
  | Task
  | Project
  | Area
  | Goal
  | Habit
  | CalendarEvent
  | Note
  | Resource
  | Review

/** 数据快照（运行时读取结果） */
export interface KernelSnapshot {
  inbox: InboxItem[]
  tasks: Task[]
  projects: Project[]
  areas: Area[]
  goals: Goal[]
  habits: Habit[]
  events: CalendarEvent[]
  notes: Note[]
  resources: Resource[]
  reviews: Review[]
  config: AppConfig
  tags: TagItem[]
}
