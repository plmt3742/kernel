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
  toISODateString,
  upcomingDays,
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

/** 今日焦点口径：今日到期 ∪ 逾期未完成（v0.4：完成即落盘 status==='done'） */
export function getTodayTaskScope(now: Date = new Date()): TaskScope {
  const dayEnd = endOfDay(now)
  const isDone = (t: Task): boolean => t.status === 'done'
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

/** 即将到期的下一步行动：status==='next'、有 dueAt 且未逾期，按截止升序（不含逾期） */
export function getUpcomingNextActions(limit = 5, now: Date = new Date()): Task[] {
  return getSnapshot()
    .tasks.filter((t) => t.status === 'next' && t.dueAt !== undefined && !isPast(t.dueAt, now))
    .sort((a, b) => toDate(a.dueAt as string).getTime() - toDate(b.dueAt as string).getTime())
    .slice(0, limit)
}

/** 下一场事件（尚未结束、未取消） */
export function getNextEvent(now: Date = new Date()): CalendarEvent | undefined {
  return getSnapshot()
    .events.filter(
      (e) => e.status !== 'cancelled' && toDate(e.endAt ?? e.startAt).getTime() >= now.getTime(),
    )
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

/** 未来 7 天到期负载（含今天）：未完成且未丢弃的任务按 dueAt 落到天；index 0 标签为「今」 */
export function getDueLoadSeries(now: Date = new Date()): Array<{ label: string; value: number }> {
  const tasks = getSnapshot().tasks
  const days = upcomingDays(7, now)
  return days.map((day, index) => {
    const value = tasks.filter(
      (t) =>
        t.status !== 'done' &&
        t.status !== 'dropped' &&
        t.dueAt !== undefined &&
        isSameDay(t.dueAt, day),
    ).length
    // 今天用「今」，其余取单字星期（周六 → 六）
    const label = index === 0 ? '今' : formatWeekdayShort(day).replace(/^周/, '')
    return { label, value }
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

export interface CodingStreakDetail {
  /** 当前连续天数（与 getCodingStreak 同口径） */
  current: number
  /** 近 14 天点阵，oldest → newest（末位为今天）；key 为 MM-DD */
  window: Array<{ key: string; hit: boolean }>
  /** 窗口内命中天数 */
  hits: number
  /** 窗口内缺口日期（MM-DD，按时间升序） */
  gaps: string[]
}

/** 连续刷题明细：默认取"每日一题算法" h-0002（回退 habits[0]），供点阵与缺口排版 */
export function getCodingStreakDetail(now: Date = new Date()): CodingStreakDetail {
  const habits = getSnapshot().habits
  const habit = habits.find((h) => h.id === 'h-0002') ?? habits[0]
  const byDate = new Map((habit?.log ?? []).map((entry) => [entry.date, entry.value]))
  // 近 14 天：从 13 天前至今（含端点），oldest → newest
  const days = upcomingDays(14, addDays(now, -13))
  const window = days.map((day) => {
    const iso = toISODateString(day)
    const value = byDate.get(iso)
    return { key: iso.slice(5), hit: value !== undefined && value > 0 }
  })
  const gaps = window.filter((cell) => !cell.hit).map((cell) => cell.key)
  return {
    current: getCodingStreak(now),
    window,
    hits: window.filter((cell) => cell.hit).length,
    gaps,
  }
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
    const end = toDate(event.endAt ?? event.startAt).getTime()
    if (cluster.length > 0 && start >= clusterEnd) flush()
    const occupied = new Set(
      cluster
        .filter((item) => toDate(item.event.endAt ?? item.event.startAt).getTime() > start)
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
