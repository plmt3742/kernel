// KERNEL · 派生查询（运行时计算，禁止落库）
// 组合 src/lib/data.ts 的 getter，产出各视图所需的口径与几何布局。
import type { CalendarEvent, Energy, Habit, KernelSnapshot, Task } from '@/types'
import { getHabitStreak, getHabits, getSnapshot } from '@/lib/data'
import {
  addDays,
  endOfDay,
  formatWeekdayShort,
  isPast,
  isSameDay,
  monthLabel,
  startOfWeek,
  toDate,
  toISODateString,
  toMonthKey,
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

/**
 * 总览「习惯打卡」条所选习惯：取快照中排序后的首个习惯（id 升序；种子为 h-0001）。
 * v0.5 · Slice X 修复此前硬编码 h-0002 的问题——改为确定性选择首个习惯，标题随之为该习惯标题
 * （见 ADR-0019）。无习惯时返回 undefined。
 */
function getFeaturedHabit(): Habit | undefined {
  return getSnapshot().habits[0]
}

/** 连续打卡天数（默认取首个习惯；见 getFeaturedHabit） */
export function getCodingStreak(now: Date = new Date()): number {
  const habit = getFeaturedHabit()
  return habit ? getHabitStreak(habit.id, now) : 0
}

export interface CodingStreakDetail {
  /** 所选习惯 id（无习惯为 null） */
  habitId: string | null
  /** 所选习惯标题（供监视柱标签；无习惯为空串） */
  habitTitle: string
  /** 今天是否已打卡（供「今日打卡」按钮态） */
  todayHit: boolean
  /** 当前连续天数（与 getCodingStreak 同口径） */
  current: number
  /** 近 14 天点阵，oldest → newest（末位为今天）；key 为 MM-DD */
  window: Array<{ key: string; hit: boolean }>
  /** 窗口内命中天数 */
  hits: number
  /** 窗口内缺口日期（MM-DD，按时间升序） */
  gaps: string[]
}

/** 连续打卡明细：默认取首个习惯（见 getFeaturedHabit），供点阵与缺口排版 */
export function getCodingStreakDetail(now: Date = new Date()): CodingStreakDetail {
  const habit = getFeaturedHabit()
  const byDate = new Map((habit?.log ?? []).map((entry) => [entry.date, entry.value]))
  // 近 14 天：从 13 天前至今（含端点），oldest → newest
  const days = upcomingDays(14, addDays(now, -13))
  const window = days.map((day) => {
    const iso = toISODateString(day)
    const value = byDate.get(iso)
    return { key: iso.slice(5), hit: value !== undefined && value > 0 }
  })
  const gaps = window.filter((cell) => !cell.hit).map((cell) => cell.key)
  const todayKey = toISODateString(now)
  const todayValue = byDate.get(todayKey)
  return {
    habitId: habit?.id ?? null,
    habitTitle: habit?.title ?? '',
    todayHit: todayValue !== undefined && todayValue > 0,
    current: getCodingStreak(now),
    window,
    hits: window.filter((cell) => cell.hit).length,
    gaps,
  }
}

/* ---------------------------------------------------------------------------
 * 习惯：统计与热力图窗口（v0.5 · 切片）
 * 只读派生（禁止落库）；habit.log 可能缺省（?? []）；日期为本地 YYYY-MM-DD。
 * ------------------------------------------------------------------------- */

export interface HabitStats {
  /** 当前连续天数（与 getHabitStreak 同口径：今天尚未打卡不中断） */
  current: number
  /** 全 log 内最长连续命中天数 */
  longest: number
  /** 命中累计（value > 0 的条目数） */
  total: number
}

/** 习惯统计：连续 / 最长 / 累计（读取 getHabits()，只读派生） */
export function getHabitStats(habitId: string, now: Date = new Date()): HabitStats {
  const habit = getHabits().find((item) => item.id === habitId)
  const hits = (habit?.log ?? []).filter((entry) => entry.value > 0)
  const total = hits.length
  const current = getHabitStreak(habitId, now)

  // 最长连续：按日期去重升序，逐日以「前一日 + 1 天」判定连续（date 助手，避开时区/DST 误差）
  const dates = Array.from(new Set(hits.map((entry) => entry.date))).sort()
  let longest = 0
  let run = 0
  let previous: string | null = null
  for (const date of dates) {
    run = previous !== null && toISODateString(addDays(toDate(previous), 1)) === date ? run + 1 : 1
    if (run > longest) longest = run
    previous = date
  }

  return { current, longest, total }
}

export interface HabitHeatDay {
  /** YYYY-MM-DD（本地） */
  date: string
  /** 当日有 value > 0 的打卡记录 */
  hit: boolean
  /** 晚于今天（窗口末周的未来占位） */
  future: boolean
}

export interface HabitHeatWeek {
  /** 该列周一 YYYY-MM-DD */
  start: string
  /** 月份标签（仅在新月份首列且与上一标签间隔 ≥ MONTH_LABEL_MIN_GAP 时给出，如「8月」） */
  monthLabel?: string
  /** 周一 → 周日的 7 天 */
  days: HabitHeatDay[]
}

/** 月份标签最小列距：与上一个已发出标签至少隔 3 列，避免「6月7月」相邻拥挤 */
const MONTH_LABEL_MIN_GAP = 3

/**
 * 习惯热力图窗口：近 `weeks` 周（默认 16），周一为列首、末列为本周（含今天）。
 * 未来日置 future=true（占位）；habit.log 缺省按空处理。只读派生。
 *
 * 月份标签防碰撞：窗口首个不完整月（周一非 1 号）直接省略（残月，信息量低且最易与
 * 下月标签相邻）；其余新月份仅在与上一已发标签的列距 ≥ MONTH_LABEL_MIN_GAP 时才给出。
 */
export function getHabitHeatWeeks(
  habitId: string,
  weeks = 16,
  now: Date = new Date(),
): HabitHeatWeek[] {
  const habit = getHabits().find((item) => item.id === habitId)
  const byDate = new Map((habit?.log ?? []).map((entry) => [entry.date, entry.value]))
  const todayKey = toISODateString(now)
  const firstMonday = addDays(startOfWeek(now), -7 * (weeks - 1))
  let previousMonth = ''
  let lastLabelIndex = Number.NEGATIVE_INFINITY
  return Array.from({ length: weeks }, (_, weekIndex) => {
    const monday = addDays(firstMonday, 7 * weekIndex)
    const month = toMonthKey(monday)
    let label: string | undefined
    if (month !== previousMonth) {
      const leadingPartial = weekIndex === 0 && monday.getDate() !== 1
      const farEnough = weekIndex - lastLabelIndex >= MONTH_LABEL_MIN_GAP
      if (!leadingPartial && farEnough) {
        label = monthLabel(monday)
        lastLabelIndex = weekIndex
      }
    }
    previousMonth = month
    const days = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = toISODateString(addDays(monday, dayIndex))
      const value = byDate.get(date)
      return { date, hit: value !== undefined && value > 0, future: date > todayKey }
    })
    return { start: toISODateString(monday), monthLabel: label, days }
  })
}

/* ---------------------------------------------------------------------------
 * 习惯：常用排序与「今日是否打卡」（v0.5 · 习惯独立页）
 * 只读派生，禁止落盘。供总览入口卡挑选常用习惯，及习惯页判定今日态。
 * ------------------------------------------------------------------------- */

/**
 * 常用习惯：按「近 30 天打卡次数」降序 → 「当前连续天数」降序 → id 升序 取前 limit 个。
 * 30 天窗口为含今天的滚动窗口（今天与 29 天前均含）；value > 0 才计为一次命中。
 */
export function getFrequentHabits(limit = 3, now: Date = new Date()): Habit[] {
  const todayKey = toISODateString(now)
  const lowerKey = toISODateString(addDays(now, -29))
  const recentHits = (habit: Habit): number =>
    (habit.log ?? []).filter(
      (entry) => entry.value > 0 && entry.date >= lowerKey && entry.date <= todayKey,
    ).length
  return [...getHabits()]
    .sort((a, b) => {
      const byRecent = recentHits(b) - recentHits(a)
      if (byRecent !== 0) return byRecent
      const byStreak = getHabitStreak(b.id, now) - getHabitStreak(a.id, now)
      if (byStreak !== 0) return byStreak
      return a.id.localeCompare(b.id)
    })
    .slice(0, limit)
}

/** 今日是否已打卡（habit.log 中今天存在 value > 0 的条目） */
export function isHabitHitToday(habitId: string, now: Date = new Date()): boolean {
  const habit = getHabits().find((item) => item.id === habitId)
  const todayKey = toISODateString(now)
  return (habit?.log ?? []).some((entry) => entry.date === todayKey && entry.value > 0)
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
