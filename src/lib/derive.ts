// KERNEL · 派生查询（运行时计算，禁止落库）
// 组合 src/lib/data.ts 的 getter，产出各视图所需的口径与几何布局。
import type { CalendarEvent, Energy, KernelSnapshot, Task } from '@/types'
import { getHabitStreak, getSnapshot } from '@/lib/data'
import {
  addDays,
  endOfDay,
  formatWeekdayShort,
  isPast,
  isSameDay,
  startOfWeek,
  toDate,
} from '@/lib/date'

/* ---------------------------------------------------------------------------
 * 任务口径
 * ------------------------------------------------------------------------- */

export interface TaskScope {
  /** 到期日 ≤ 今天结束、且未丢弃的任务总数 */
  total: number
  done: number
  open: number
  overdue: number
  dueToday: number
}

/** 今日焦点口径：今日到期 ∪ 逾期未完成；doneSet 为原型态完成集合（可选） */
export function getTodayTaskScope(now: Date = new Date(), doneSet?: Set<string>): TaskScope {
  const dayEnd = endOfDay(now)
  const isDone = (t: Task): boolean => t.status === 'done' || (doneSet?.has(t.id) ?? false)
  const scoped = getSnapshot().tasks.filter(
    (t) => t.status !== 'dropped' && t.dueAt !== undefined && toDate(t.dueAt) <= dayEnd,
  )
  const done = scoped.filter(isDone).length
  const overdue = scoped.filter((t) => !isDone(t) && isPast(t.dueAt as string, now)).length
  const dueToday = scoped.filter(
    (t) => !isDone(t) && isSameDay(t.dueAt as string, now),
  ).length
  return { total: scoped.length, done, open: scoped.length - done, overdue, dueToday }
}

/** 逾期未完成任务 */
export function getOverdueOpen(now: Date = new Date()): Task[] {
  return getSnapshot().tasks.filter(
    (t) =>
      t.dueAt !== undefined &&
      t.status !== 'done' &&
      t.status !== 'dropped' &&
      isPast(t.dueAt, now),
  )
}

/** 下一场事件（尚未结束、未取消） */
export function getNextEvent(now: Date = new Date()): CalendarEvent | undefined {
  return getSnapshot()
    .events.filter((e) => e.status !== 'cancelled' && toDate(e.endAt).getTime() >= now.getTime())
    .sort((a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime())[0]
}

/** 本周每日完成数（周一为一周起点） */
export function getWeeklyCompletionSeries(
  now: Date = new Date(),
): Array<{ label: string; value: number }> {
  const done = getSnapshot().tasks.filter((t) => t.status === 'done' && t.doneAt !== undefined)
  const weekStart = startOfWeek(now)
  return Array.from({ length: 7 }, (_, i) => {
    const day = addDays(weekStart, i)
    const value = done.filter((t) => isSameDay(t.doneAt as string, day)).length
    return { label: formatWeekdayShort(day), value }
  })
}

/** 能量分布（默认统计未完成任务） */
export function getEnergyDistribution(
  tasks: Task[] = getSnapshot().tasks.filter((t) => t.status !== 'done' && t.status !== 'dropped'),
): Array<{ energy: Energy; value: number }> {
  const order: Energy[] = ['low', 'medium', 'high']
  return order.map((energy) => ({
    energy,
    value: tasks.filter((t) => t.energy === energy).length,
  }))
}

/** 连续打卡天数（默认取"每日一题算法" h-0002） */
export function getCodingStreak(now: Date = new Date()): number {
  const habits = getSnapshot().habits
  const habit = habits.find((h) => h.id === 'h-0002') ?? habits[0]
  return habit ? getHabitStreak(habit.id, now) : 0
}

/** 数据记录总数：10 类实体记录 + 配置 + 标签注册表（共 146 = 144 + 2） */
export function getDataRecordCount(snapshot: KernelSnapshot = getSnapshot()): number {
  const entityArrays = [
    snapshot.inbox,
    snapshot.tasks,
    snapshot.projects,
    snapshot.areas,
    snapshot.goals,
    snapshot.habits,
    snapshot.events,
    snapshot.notes,
    snapshot.resources,
    snapshot.reviews,
  ]
  return entityArrays.reduce((total, list) => total + list.length, 0) + 2
}

/* ---------------------------------------------------------------------------
 * 日程几何
 * ------------------------------------------------------------------------- */

export interface LaidOutEvent {
  event: CalendarEvent
  /** 重叠分组内的列序号（0 起） */
  col: number
  /** 该重叠分组的列总数 */
  cols: number
}

/** 事件重叠布局：贪心分列，返回每列的归属与总列数 */
export function layoutOverlaps(events: CalendarEvent[]): LaidOutEvent[] {
  const sorted = [...events].sort(
    (a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime(),
  )
  const result: LaidOutEvent[] = []
  let cluster: LaidOutEvent[] = []
  let clusterEnd = 0

  const flush = (): void => {
    if (cluster.length === 0) return
    const cols = cluster.reduce((max, item) => Math.max(max, item.col + 1), 1)
    for (const item of cluster) item.cols = cols
    result.push(...cluster)
    cluster = []
  }

  for (const event of sorted) {
    const start = toDate(event.startAt).getTime()
    const end = toDate(event.endAt).getTime()
    if (cluster.length > 0 && start >= clusterEnd) flush()
    const occupied = new Set(
      cluster
        .filter((item) => toDate(item.event.endAt).getTime() > start)
        .map((item) => item.col),
    )
    let col = 0
    while (occupied.has(col)) col += 1
    cluster.push({ event, col, cols: 1 })
    clusterEnd = Math.max(clusterEnd, end)
  }
  flush()
  return result
}

/** 分钟偏移（当天 0 点起） */
export function minutesOfDay(input: string | Date): number {
  const d = toDate(input)
  return d.getHours() * 60 + d.getMinutes()
}

/** 今日事件（含跨日？—— 仅取当天开始的事件，与数据层口径一致） */
export function eventsOnDay(date: Date): CalendarEvent[] {
  return getSnapshot()
    .events.filter((e) => e.status !== 'cancelled' && isSameDay(e.startAt, date))
    .sort((a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime())
}
