// KERNEL · 类型化数据层（v2：可变更快照 + 订阅；v0.4 起数据服务为事实源）
// 首帧：构建期静态读取 data/**（seed，保证离线首屏可用）；
// 水合：App 挂载后经 /api/snapshot 拉取数据服务快照替换（server）；
// 写入：一律经 src/lib/mutations.ts → 数据服务 API（禁止前端直接写文件）。
// 纪律：禁止在 JSON 中存派生值；进度等一律运行时计算。
import type {
  AppConfig,
  Area,
  CalendarEvent,
  Goal,
  Habit,
  HabitLogEntry,
  InboxItem,
  KernelSnapshot,
  Note,
  Project,
  Resource,
  Review,
  TagItem,
  Task,
} from '@/types'
import { daysFromToday, isPast, isSameDay, toDate } from '@/lib/date'

/* ---------------------------------------------------------------------------
 * 原始模块收集（seed 首帧）
 * ------------------------------------------------------------------------- */

interface JsonModule {
  default: unknown
}

const modules = import.meta.glob<JsonModule>('/data/**/*.json', { eager: true })

/** 读取某目录下全部 JSON 记录，按 id 升序（id 四位补零，字典序即数值序） */
function readKind<T extends { id: string }>(folder: string): T[] {
  const prefix = `/data/${folder}/`
  return Object.entries(modules)
    .filter(([path]) => path.startsWith(prefix) && path.endsWith('.json'))
    .map(([, mod]) => mod.default as T)
    .sort((a, b) => a.id.localeCompare(b.id))
}

/** 读取单个 JSON（不存在返回 fallback） */
function readOne<T>(path: string, fallback: T): T {
  const mod = modules[path]
  return mod ? (mod.default as T) : fallback
}

const DEFAULT_CONFIG: AppConfig = {
  name: 'KERNEL',
  owner: 'unknown',
  version: '0.1.0',
  locale: 'zh-CN',
  weekStart: 'monday',
  createdAt: '2026-10-02T00:00:00+08:00',
}

const seedSnapshot: KernelSnapshot = {
  tasks: readKind<Task>('tasks'),
  events: readKind<CalendarEvent>('events'),
  projects: readKind<Project>('projects'),
  areas: readKind<Area>('areas'),
  goals: readKind<Goal>('goals'),
  habits: readKind<Habit>('habits'),
  notes: readKind<Note>('notes'),
  resources: readKind<Resource>('resources'),
  reviews: readKind<Review>('reviews'),
  inbox: readKind<InboxItem>('inbox'),
  config: readOne<AppConfig>('/data/meta/config.json', DEFAULT_CONFIG),
  tags: readOne<{ tags: TagItem[] }>('/data/meta/tags.json', { tags: [] }).tags,
}

/* ---------------------------------------------------------------------------
 * 可变更快照 store（订阅 / 版本号；数据服务水合与写入动作在此落位）
 * ------------------------------------------------------------------------- */

export type DataSource = 'seed' | 'server' | 'offline'
export type EntityKind =
  | 'inbox'
  | 'tasks'
  | 'projects'
  | 'areas'
  | 'goals'
  | 'habits'
  | 'events'
  | 'notes'
  | 'resources'
  | 'reviews'

let state: KernelSnapshot = seedSnapshot
let source: DataSource = 'seed'
let revision = 0
const listeners = new Set<() => void>()

function emit(): void {
  revision += 1
  for (const listener of listeners) listener()
}

export function subscribeData(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getRevision(): number {
  return revision
}

export function getDataSource(): DataSource {
  return source
}

export function setDataSource(next: DataSource): void {
  if (source !== next) {
    source = next
    emit()
  }
}

/** 用数据服务快照整体替换（App 挂载水合 / 窗口聚焦刷新） */
export function replaceSnapshot(next: KernelSnapshot): void {
  state = next
  if (source !== 'server') source = 'server'
  emit()
}

/** 单实体 upsert（写入动作的本地落位；按 id 排序保持稳定） */
export function upsertEntity<T extends { id: string }>(kind: EntityKind, record: T): void {
  const list = state[kind] as unknown as Array<{ id: string }>
  const existing = list.some((item) => item.id === record.id)
  const nextList = existing
    ? list.map((item) => (item.id === record.id ? record : item))
    : [...list, record].sort((a, b) => a.id.localeCompare(b.id))
  state = { ...state, [kind]: nextList } as KernelSnapshot
  emit()
}

/** 单实体移除（撤销澄清产物等） */
export function removeEntity(kind: EntityKind, id: string): void {
  const list = state[kind] as Array<{ id: string }>
  state = { ...state, [kind]: list.filter((item) => item.id !== id) } as KernelSnapshot
  emit()
}

/* ---------------------------------------------------------------------------
 * 基础 getter
 * ------------------------------------------------------------------------- */

export function getTasks(): Task[] {
  return state.tasks
}
export function getEvents(): CalendarEvent[] {
  return state.events
}
export function getProjects(): Project[] {
  return state.projects
}
export function getAreas(): Area[] {
  return state.areas
}
export function getGoals(): Goal[] {
  return state.goals
}
export function getHabits(): Habit[] {
  return state.habits
}
export function getNotes(): Note[] {
  return state.notes
}
export function getResources(): Resource[] {
  return state.resources
}
export function getReviews(): Review[] {
  return state.reviews
}
export function getInbox(): InboxItem[] {
  return state.inbox
}
export function getConfig(): AppConfig {
  return state.config
}
export function getTags(): TagItem[] {
  return state.tags
}

/** 完整快照（供上层一次性消费） */
export function getSnapshot(): KernelSnapshot {
  return state
}

/* ---------------------------------------------------------------------------
 * 按 id 查找
 * ------------------------------------------------------------------------- */

function byId<T extends { id: string }>(list: T[], id: string): T | undefined {
  return list.find((item) => item.id === id)
}

export const getTaskById = (id: string): Task | undefined => byId(state.tasks, id)
export const getProjectById = (id: string): Project | undefined => byId(state.projects, id)
export const getEventById = (id: string): CalendarEvent | undefined => byId(state.events, id)
export const getAreaById = (id: string): Area | undefined => byId(state.areas, id)
export const getGoalById = (id: string): Goal | undefined => byId(state.goals, id)
export const getHabitById = (id: string): Habit | undefined => byId(state.habits, id)
export const getNoteById = (id: string): Note | undefined => byId(state.notes, id)
export const getResourceById = (id: string): Resource | undefined => byId(state.resources, id)
export const getInboxById = (id: string): InboxItem | undefined => byId(state.inbox, id)

/* ---------------------------------------------------------------------------
 * 派生查询
 * ------------------------------------------------------------------------- */

export interface ProjectProgress {
  projectId: string
  total: number
  done: number
  /** 0–1；无任务时为 0 */
  ratio: number
}

/** 项目进度：仅由该项目的任务运行时计算（禁止存派生值） */
export function getProjectProgress(projectId: string): ProjectProgress {
  const scoped = state.tasks.filter((t) => t.projectId === projectId)
  const done = scoped.filter((t) => t.status === 'done').length
  const total = scoped.length
  return { projectId, total, done, ratio: total === 0 ? 0 : done / total }
}

/** 某项目的全部任务 */
export function getTasksByProject(projectId: string): Task[] {
  return state.tasks.filter((t) => t.projectId === projectId)
}

/** 某任务的直接子任务（parentTaskId 指向它；Slice R3） */
export function getChildTasks(parentTaskId: string): Task[] {
  return state.tasks.filter((t) => t.parentTaskId === parentTaskId)
}

/** 按上下文筛选任务（第一筛选轴） */
export function getTasksByContext(context: string): Task[] {
  return state.tasks.filter((t) => t.contexts.includes(context))
}

/** 按状态筛选任务 */
export function getTasksByStatus(status: Task['status']): Task[] {
  return state.tasks.filter((t) => t.status === status)
}

/** 按身份/领域标签筛选任务 */
export function getTasksByTag(tag: string): Task[] {
  return state.tasks.filter((t) => t.tags.includes(tag))
}

/** 未澄清收件箱水位 */
export function getInboxCount(): number {
  return state.inbox.filter((i) => i.status === 'unprocessed').length
}

/** 逾期任务：有 dueAt、已过期、且未 done/dropped */
export function getOverdueTasks(now: Date = new Date()): Task[] {
  return state.tasks.filter(
    (t) =>
      t.dueAt !== undefined &&
      isPast(t.dueAt, now) &&
      t.status !== 'done' &&
      t.status !== 'dropped',
  )
}

/** 今日事件（按开始时间升序） */
export function getTodayEvents(now: Date = new Date()): CalendarEvent[] {
  return state.events
    .filter((e) => e.status !== 'cancelled' && isSameDay(e.startAt, now))
    .sort((a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime())
}

/** 未来 days 天内的事件（含今天，排除已取消，升序） */
export function getUpcomingEvents(days: number, now: Date = new Date()): CalendarEvent[] {
  return state.events
    .filter((e) => {
      if (e.status === 'cancelled') return false
      const diff = daysFromToday(e.endAt, now)
      const startDiff = daysFromToday(e.startAt, now)
      return startDiff >= 0 && diff <= days
    })
    .sort((a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime())
}

/** 活跃项目 */
export function getActiveProjects(): Project[] {
  return state.projects.filter((p) => p.status === 'active')
}

/** 停滞项目：active 但 updatedAt 超过 staleDays 天未更新 */
export function getStaleProjects(staleDays = 14, now: Date = new Date()): Project[] {
  return state.projects.filter(
    (p) => p.status === 'active' && -daysFromToday(p.updatedAt, now) >= staleDays,
  )
}

/** 下一步行动：next 状态，按 importance 降序、能量低者优先，可限条数 */
export function getNextActions(limit?: number): Task[] {
  const energyRank: Record<Task['energy'], number> = { low: 0, medium: 1, high: 2 }
  const sorted = state.tasks
    .filter((t) => t.status === 'next')
    .sort((a, b) => {
      if (b.importance !== a.importance) return b.importance - a.importance
      return energyRank[a.energy] - energyRank[b.energy]
    })
  return limit === undefined ? sorted : sorted.slice(0, limit)
}

/** 习惯打卡记录（供热力图），带原始 date/value */
export function getHabitLog(habitId: string): HabitLogEntry[] {
  const habit = byId(state.habits, habitId)
  return habit ? habit.log : []
}

/** 习惯连续打卡天数（从今天或昨天向前连续计） */
export function getHabitStreak(habitId: string, now: Date = new Date()): number {
  const habit = byId(state.habits, habitId)
  if (!habit) return 0
  const byDate = new Map(habit.log.map((entry) => [entry.date, entry.value]))
  let streak = 0
  let cursor = 0
  // 允许今天尚未打卡：从今天或昨天起算
  const todayKey = keyOf(now, 0)
  if (!byDate.has(todayKey)) cursor = 1
  for (;;) {
    const key = keyOf(now, cursor)
    const value = byDate.get(key)
    if (value === undefined || value <= 0) break
    streak += 1
    cursor += 1
  }
  return streak
}

function keyOf(base: Date, offsetDays: number): string {
  const d = new Date(base)
  d.setDate(d.getDate() - offsetDays)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 某笔记的反向链接（哪些笔记 links 指向它） */
export function getBacklinks(noteId: string): Note[] {
  return state.notes.filter((n) => n.links.includes(noteId))
}

/** 标签使用计数（用于有界标签视图） */
export function getTagUsage(): Array<{ tag: string; count: number }> {
  const counts = new Map<string, number>()
  const bump = (list: string[]): void => {
    for (const tag of list) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  for (const t of state.tasks) bump(t.tags)
  for (const e of state.events) bump(e.tags)
  for (const n of state.notes) bump(n.tags)
  for (const r of state.resources) bump(r.tags)
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}
