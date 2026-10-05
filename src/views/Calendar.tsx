// KERNEL · 日程 CALENDAR：议程流（下一项高亮 + 今天/明天/本周/下周/更远 分组 + 迷你月历）
// Slice W（见 ADR-0018）：日程由只读转为可写——新建（先确认后写入）+ 点击详情（编辑 /
// 删除 / 状态快捷切换）+ 迷你月历日格可点（选中并滚动议程到该日）。
// Slice H2：课表搬到侧栏一级页面 /timetable，本页回退为纯议程。
// Slice H3（日程聚合）：日程不再只显示 events——把「有截止时间的未完成任务」与「今天的课程」
// 一并纳入议程流。边界：无截止的任务不显示；已完成 / 已丢弃的任务不计；课程仅今日（全周课表在 /timetable）。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useReducedMotion } from 'motion/react'
import { Panel } from '@/components/Panel'
import { EventDetailModal } from '@/components/EventDetailModal'
import { EventDraftModal } from '@/components/EventDraftModal'
import { CourseDetailModal } from '@/components/CourseDetailModal'
import { TaskDetailModal } from '@/components/TaskDetailModal'
import { EmptyState } from '@/components/EmptyState'
import { TagPill } from '@/components/TagPill'
import { useToast } from '@/context/ToastContext'
import { getCourses, getEvents, getProjectById, getTasks, getTerm } from '@/lib/data'
import { isTaskDone, removeEvent } from '@/lib/mutations'
import { formatPeriods, mergeDayRuns, weekdayLabel, weekOfTerm } from '@/lib/schedule'
import { errorText } from '@/lib/api'
import { EVENT_STATUS_LABEL } from '@/lib/format'
import {
  addDays,
  daysFromToday,
  endOfWeek,
  eventEndOf,
  formatFullDate,
  formatMonthDay,
  formatTime,
  formatWeekdayShort,
  isFuture,
  isSameDay,
  isToday,
  startOfWeek,
  toDate,
  toISODateTime,
} from '@/lib/date'
import { useDataRevision, useNow } from '@/lib/hooks'
import { createUiStore, useUiStore } from '@/lib/uiState'
import type { CalendarEvent, Task } from '@/types'

/* ---------------------------------------------------------------------------
 * 分组桶规则（以「今天」0 点为基准的日历偏移）
 * · 今天   offset ≤ 0（跨日进行中 / 逾期任务也归今天）
 * · 明天   offset === 1
 * · 本周   落在 [startOfWeek(now), endOfWeek(now)] 且 offset ≥ 2
 * · 下周   落在下周同区间（本周起点 +7 天）
 * · 更远   其余未来日期
 * 事件前置过滤：status !== 'cancelled' 且 end ≥ now（尚未结束），按开始时间升序。
 * 任务前置过滤：有 dueAt、未完成、未丢弃，按截止时间升序——无截止任务永不进入日程。
 * ------------------------------------------------------------------------- */
type BucketKey = 'today' | 'tomorrow' | 'thisWeek' | 'nextWeek' | 'later'

interface Bucket {
  key: BucketKey
  label: string
  events: CalendarEvent[]
  tasks: Task[]
}

const BUCKET_LABEL: Record<BucketKey, string> = {
  today: '今天',
  tomorrow: '明天',
  thisWeek: '本周',
  nextWeek: '下周',
  later: '更远',
}

const BUCKET_ORDER: BucketKey[] = ['today', 'tomorrow', 'thisWeek', 'nextWeek', 'later']

/** 迷你月历星期表头（周一为一周起点） */
const WEEKDAY_HEADER = ['一', '二', '三', '四', '五', '六', '日']

/** 日期（ISO）→ 分组桶：事件按 startAt、任务按 dueAt 都经此归桶 */
function bucketKeyOfDate(iso: string, now: Date): BucketKey {
  const offset = daysFromToday(iso, now)
  if (offset <= 0) return 'today'
  if (offset === 1) return 'tomorrow'
  const start = toDate(iso)
  const weekStart = startOfWeek(now)
  if (start >= weekStart && start <= endOfWeek(now)) return 'thisWeek'
  const nextWeekStart = addDays(weekStart, 7)
  if (start >= nextWeekStart && start <= endOfWeek(nextWeekStart)) return 'nextWeek'
  return 'later'
}

/** 分组头右侧的安静摘要（事件 + 任务合并后的日期范围 + 计数） */
function groupMeta(bucket: Bucket): string {
  // 事件按 startAt、任务按 dueAt 合并成统一日期序列，取首尾决定范围（调用时桶必非空）
  const dates = [
    ...bucket.events.map((event) => toDate(event.startAt)),
    ...bucket.tasks.map((task) => toDate(task.dueAt as string)),
  ].sort((a, b) => a.getTime() - b.getTime())
  const first = dates[0]
  const last = dates[dates.length - 1]
  const count =
    `${bucket.events.length} 场` +
    (bucket.tasks.length > 0 ? ` · ${bucket.tasks.length} 截止` : '')
  if (bucket.key === 'today' || bucket.key === 'tomorrow') {
    return `${formatWeekdayShort(first)} ${formatMonthDay(first)} · ${count}`
  }
  if (bucket.key === 'thisWeek') {
    const range = isSameDay(first, last)
      ? `${formatWeekdayShort(first)} ${formatMonthDay(first)}`
      : `${formatMonthDay(first)} – ${formatMonthDay(last)}`
    return `${range} · ${count}`
  }
  if (bucket.key === 'nextWeek') {
    const weekStart = startOfWeek(first)
    return `${formatMonthDay(weekStart)} – ${formatMonthDay(endOfWeek(weekStart))} · ${count}`
  }
  return `${formatMonthDay(first)} 起 · ${count}`
}

/** 行内时间：当天写「08:00–09:40」，跨天补星期「周一 15:00–16:00」；无结束则仅开始 */
function rowRange(event: CalendarEvent): string {
  return event.endAt !== undefined
    ? `${formatTime(event.startAt)}–${formatTime(event.endAt)}`
    : formatTime(event.startAt)
}

function rowTime(event: CalendarEvent, now: Date): string {
  return isSameDay(event.startAt, now) ? rowRange(event) : `${formatWeekdayShort(event.startAt)} ${rowRange(event)}`
}

/** 任务截止标签：已过期写「逾期 月日 时:分」，今 / 明写「截止 时:分」，更远补星期 */
function taskDueLabel(task: Task, now: Date): string {
  const due = task.dueAt as string
  if (toDate(due).getTime() < now.getTime()) {
    return `逾期 ${formatMonthDay(due)} ${formatTime(due)}`
  }
  if (daysFromToday(due, now) <= 1) return `截止 ${formatTime(due)}`
  return `截止 ${formatWeekdayShort(due)} ${formatTime(due)}`
}

/** 相对日：今天 / 明天 / 周X */
function relativeDay(input: string, now: Date): string {
  const offset = daysFromToday(input, now)
  if (offset <= 0) return '今天'
  if (offset === 1) return '明天'
  return formatWeekdayShort(input)
}

/** 倒计时：<48h「还有 X 小时 Y 分」，否则「还有 N 天」；已开始 = 进行中 */
function countdown(start: Date, now: Date): string {
  const diff = start.getTime() - now.getTime()
  if (diff <= 0) return '进行中'
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 48) {
    const mins = Math.floor((diff % 3_600_000) / 60_000)
    return `还有 ${hours} 小时 ${mins} 分`
  }
  return `还有 ${Math.ceil(diff / 86_400_000)} 天`
}

interface MiniCell {
  key: string
  day?: number
  isToday: boolean
  /** 事件 ∪ 任务截止 ∪ 有课（见 busyDays） */
  hasAny: boolean
}

/* ---------------------------------------------------------------------------
 * 日程页界面状态保留（Slice Z · F29，见 ADR-0022）：
 * 迷你月历选中日 + 当前显示月游标提升到模块级 store 并持久化——切路由或刷新后
 * 回到上次浏览的月份与选中日（时间以毫秒存，解析只接受有限数）。
 * Slice H2：课表搬到独立页面后移除视图模式字段；旧 localStorage 的 `mode`
 * 键会被自然忽略（parse 只读 selectedDayMs / monthCursorMs）。
 * ------------------------------------------------------------------------- */
interface CalendarUiState {
  selectedDayMs: number | null
  monthCursorMs: number
  /**
   * 周游标（本切片）：`null` = 实况 / 今天锚定默认视图；有限数 = 该时刻所在周，
   * 主议程切换为周一–周日周视图。旧 localStorage 缺此键 → 自然回退 `null`（向后兼容）。
   */
  weekCursorMs: number | null
  /** 「含已结束」开关（本切片）：默认 false，仅进行中事件；true 时在议程流首组追加已结束事件 */
  showPast: boolean
}

const CALENDAR_UI_KEY = 'kernel.ui.calendar.v1'

function parseCalendarUi(raw: unknown): CalendarUiState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const selectedDayMs =
    typeof v.selectedDayMs === 'number' && Number.isFinite(v.selectedDayMs)
      ? v.selectedDayMs
      : null
  const monthCursorMs =
    typeof v.monthCursorMs === 'number' && Number.isFinite(v.monthCursorMs)
      ? v.monthCursorMs
      : Date.now()
  const weekCursorMs =
    typeof v.weekCursorMs === 'number' && Number.isFinite(v.weekCursorMs)
      ? v.weekCursorMs
      : null
  return { selectedDayMs, monthCursorMs, weekCursorMs, showPast: v.showPast === true }
}

const calendarUiStore = createUiStore<CalendarUiState>(
  CALENDAR_UI_KEY,
  { selectedDayMs: null, monthCursorMs: Date.now(), weekCursorMs: null, showPast: false },
  { parse: parseCalendarUi },
)

export function Calendar() {
  const now = useNow()
  const revision = useDataRevision()
  const { toast } = useToast()
  // 无障碍：跟随系统「减少动态效果」，滚动定位到日为 auto（本切片周视图复用）
  const reduce = useReducedMotion() === true
  const [searchParams, setSearchParams] = useSearchParams()
  const [drawerId, setDrawerId] = useState<string | null>(null)
  // 新建弹窗：null = 关闭；否则为预填开始时刻（ISO）
  const [draftStartAt, setDraftStartAt] = useState<string | null>(null)
  // 课程 / 任务详情弹窗（聚合自「今日课程」与任务截止行）：null = 关闭
  const [courseId, setCourseId] = useState<string | null>(null)
  const [taskId, setTaskId] = useState<string | null>(null)
  // 周视图日区块滚动目标（本切片 · 0–6）：跨周定位需等新的一周挂载后再滚动
  const [weekScrollTarget, setWeekScrollTarget] = useState<number | null>(null)
  // 迷你月历选中日 / 显示月（Slice Z · F29）：来自模块级 store（跨路由 + 刷新保留）
  const calendarUi = useUiStore(calendarUiStore)
  const selectedDay = useMemo(
    () => (calendarUi.selectedDayMs !== null ? new Date(calendarUi.selectedDayMs) : null),
    [calendarUi.selectedDayMs],
  )
  const monthCursor = useMemo(() => new Date(calendarUi.monthCursorMs), [calendarUi.monthCursorMs])
  /** 周游标（本切片）：null = 今天锚定实况视图；否则主议程显示该时刻所在周 */
  const weekCursor = useMemo(
    () => (calendarUi.weekCursorMs !== null ? new Date(calendarUi.weekCursorMs) : null),
    [calendarUi.weekCursorMs],
  )
  const setSelectedDay = (date: Date | null): void => {
    calendarUiStore.set((state) => ({
      ...state,
      selectedDayMs: date === null ? null : date.getTime(),
    }))
  }
  /** 设置 / 清除周游标（本切片）：设置时同步迷你月历到游标所在月（保持「游标即所见」） */
  const setWeekCursor = (date: Date | null): void => {
    calendarUiStore.set((state) => ({
      ...state,
      weekCursorMs: date === null ? null : date.getTime(),
      monthCursorMs: date === null ? state.monthCursorMs : date.getTime(),
    }))
  }
  const heroRef = useRef<HTMLElement>(null)
  const todayRef = useRef<HTMLElement>(null)
  // 周视图日区块 DOM 引用（按星期索引 0–6）：点日头 / 迷你月历后滚动定位
  const weekDayRefs = useRef<Map<number, HTMLElement>>(new Map())
  // 事件行 DOM 引用（按事件 id）：迷你月历点击后滚动到该日首个事件
  const eventRefs = useRef<Map<string, HTMLButtonElement>>(new Map())
  // 任务行 DOM 引用（按任务 id）：该日无事件时，迷你月历点击回退滚动到首个截止任务
  const taskRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // 深链直达事件抽屉：/calendar?event=e-0003
  useEffect(() => {
    const id = searchParams.get('event')
    if (id !== null && getEvents().some((event) => event.id === id)) {
      setDrawerId(id)
    }
  }, [searchParams, revision])

  const closeDrawer = (): void => {
    setDrawerId(null)
    if (searchParams.get('event') !== null) {
      setSearchParams({}, { replace: true })
    }
  }

  const scrollToRef = (ref: RefObject<HTMLElement | null>): void => {
    const el = ref.current
    if (el === null) return
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }

  /** 未结束（end ≥ now）且未取消的未来事件，按开始时间升序 */
  const upcoming = useMemo(
    () =>
      getEvents()
        .filter((e) => e.status !== 'cancelled' && eventEndOf(e).getTime() >= now.getTime())
        .sort((a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime()),
    [now, revision],
  )

  const next = upcoming[0]

  /** 已结束（end < now）且未取消的事件，按开始时间倒序（最多 50）——仅「含已结束」开关打开时展示 */
  const pastEvents = useMemo(
    () =>
      getEvents()
        .filter((e) => e.status !== 'cancelled' && eventEndOf(e).getTime() < now.getTime())
        .sort((a, b) => toDate(b.startAt).getTime() - toDate(a.startAt).getTime())
        .slice(0, 50),
    [now, revision],
  )

  /** 已结束开关打开且有内容——用于渲染「已结束」组与放宽空态门槛 */
  const hasPastShown = calendarUi.showPast && pastEvents.length > 0

  /**
   * 有截止的未完成任务（未完成 / 未丢弃 / 未推迟到未来），按截止升序——无 dueAt 的任务永不进入日程。
   * 推迟：`deferUntil` 为有效未来时刻时从日程隐藏（`isFuture` 对无效输入保守返回 false，不会误伤）。
   */
  const dueTasks = useMemo(
    () =>
      getTasks()
        .filter(
          (task) =>
            task.dueAt !== undefined &&
            !isTaskDone(task) &&
            task.status !== 'dropped' &&
            !(task.deferUntil !== undefined && isFuture(task.deferUntil, now)),
        )
        .sort((a, b) => toDate(a.dueAt as string).getTime() - toDate(b.dueAt as string).getTime()),
    [revision, now],
  )

  /**
   * 今日课程块：周一 = 1 … 周日 = 7（`getDay()` 0 = 周日）。
   * term 未设置 → week = null → mergeDayRuns 展示该星期全部时段，与 /timetable 行为一致；
   * 只取「今天」这一天——全周课表仍在 /timetable 页。
   */
  const todayRuns = useMemo(() => {
    const dow = ((now.getDay() + 6) % 7) + 1
    const week = weekOfTerm(getTerm(), now)
    return mergeDayRuns(getCourses(), dow, week)
  }, [now, revision])

  /**
   * 周视图（本切片）：游标所在周一–周日的逐日聚合。
   * 每天含：该日事件（未取消；`showPast` 关闭时剔除已结束，按开始升序）、
   * 该日截止任务（复用 `dueTasks`，已含推迟过滤）、该日课程（`mergeDayRuns` + 学期周过滤）。
   * 仅当周游标激活时计算；默认实况视图不产生任何额外开销。
   */
  const weekDays = useMemo(() => {
    if (weekCursor === null) return []
    const start = startOfWeek(weekCursor)
    const term = getTerm()
    const courses = getCourses()
    const allEvents = getEvents()
    return Array.from({ length: 7 }, (_, index) => {
      const date = addDays(start, index)
      const dow = ((date.getDay() + 6) % 7) + 1
      const events = allEvents
        .filter((event) => event.status !== 'cancelled' && isSameDay(event.startAt, date))
        .filter((event) => calendarUi.showPast || eventEndOf(event).getTime() >= now.getTime())
        .sort((a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime())
      const tasks = dueTasks.filter((task) => isSameDay(task.dueAt as string, date))
      const runs = mergeDayRuns(courses, dow, weekOfTerm(term, date))
      return { date, dow, events, tasks, runs }
    })
  }, [weekCursor, dueTasks, now, revision, calendarUi.showPast])

  /** 周视图是否有任何内容——决定整周空态 */
  const weekHasContent = useMemo(
    () =>
      weekDays.some((day) => day.events.length > 0 || day.tasks.length > 0 || day.runs.length > 0),
    [weekDays],
  )

  /** 周视图统计（范围头右侧安静摘要）：事件 + 截止 + 课次 */
  const weekTotals = useMemo(
    () =>
      weekDays.reduce(
        (acc, day) => ({
          events: acc.events + day.events.length,
          tasks: acc.tasks + day.tasks.length,
          runs: acc.runs + day.runs.length,
        }),
        { events: 0, tasks: 0, runs: 0 },
      ),
    [weekDays],
  )

  const buckets = useMemo(() => {
    const map: Record<BucketKey, { events: CalendarEvent[]; tasks: Task[] }> = {
      today: { events: [], tasks: [] },
      tomorrow: { events: [], tasks: [] },
      thisWeek: { events: [], tasks: [] },
      nextWeek: { events: [], tasks: [] },
      later: { events: [], tasks: [] },
    }
    for (const event of upcoming) map[bucketKeyOfDate(event.startAt, now)].events.push(event)
    // 逾期任务（offset ≤ 0）归入「今天」桶
    for (const task of dueTasks) map[bucketKeyOfDate(task.dueAt as string, now)].tasks.push(task)
    return BUCKET_ORDER.map((key) => ({
      key,
      label: BUCKET_LABEL[key],
      events: map[key].events,
      tasks: map[key].tasks,
    }))
  }, [upcoming, dueTasks, now])

  /** 议程流是否有任何内容（事件或任务）——决定空态与滚动按钮可用性 */
  const hasStream = useMemo(
    () => buckets.some((bucket) => bucket.events.length > 0 || bucket.tasks.length > 0),
    [buckets],
  )

  /** 今天桶内的任务数（含逾期）——用于状态条摘要与空态判断 */
  const todayTaskCount = useMemo(() => {
    const bucket = buckets.find((item) => item.key === 'today')
    return bucket !== undefined ? bucket.tasks.length : 0
  }, [buckets])

  /* --- 迷你月历（显示月由 monthCursor 控制） --- */
  const year = monthCursor.getFullYear()
  const month = monthCursor.getMonth()

  const monthEvents = useMemo(
    () =>
      getEvents()
        .filter((e) => {
          if (e.status === 'cancelled') return false
          const d = toDate(e.startAt)
          return d.getFullYear() === year && d.getMonth() === month
        })
        .sort((a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime()),
    [year, month, revision],
  )

  /** 显示月内有截止的任务（含逾期，未完成） */
  const monthTasks = useMemo(
    () =>
      dueTasks.filter((task) => {
        const due = toDate(task.dueAt as string)
        return due.getFullYear() === year && due.getMonth() === month
      }),
    [dueTasks, year, month],
  )

  /**
   * 显示月内的课程：逐日按「星期 + 学期周」求合并课块，统计全月课次数并记录有课的日子。
   * term 未设置 → week = null → 每周规则生效（与 /timetable 一致）。
   */
  const monthCourse = useMemo(() => {
    const courses = getCourses()
    const term = getTerm()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const days = new Set<number>()
    let count = 0
    for (let d = 1; d <= daysInMonth; d += 1) {
      const date = new Date(year, month, d)
      const dow = ((date.getDay() + 6) % 7) + 1
      const runs = mergeDayRuns(courses, dow, weekOfTerm(term, date))
      if (runs.length > 0) days.add(d)
      count += runs.length
    }
    return { days, count }
  }, [year, month, revision])

  /** 迷你月历圆点：事件 ∪ 任务截止 ∪ 有课 */
  const busyDays = useMemo(() => {
    const set = new Set<number>(monthCourse.days)
    for (const event of monthEvents) set.add(toDate(event.startAt).getDate())
    for (const task of monthTasks) set.add(toDate(task.dueAt as string).getDate())
    return set
  }, [monthCourse, monthEvents, monthTasks])

  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const leading = (first.getDay() + 6) % 7 // JS 0=周日 → 周一为首列
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const list: MiniCell[] = []
    for (let i = 0; i < leading; i += 1) {
      list.push({ key: `void-${i}`, isToday: false, hasAny: false })
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      list.push({
        key: `d-${d}`,
        day: d,
        isToday: isSameDay(new Date(year, month, d), now),
        hasAny: busyDays.has(d),
      })
    }
    while (list.length % 7 !== 0) {
      list.push({ key: `tail-${list.length}`, isToday: false, hasAny: false })
    }
    return list
  }, [year, month, now, busyDays])

  /** 月统计口径：事件 + 截止 + 课程课次（三者之和） */
  const monthCount = monthEvents.length + monthTasks.length + monthCourse.count
  const monthFoot =
    monthCount === 0
      ? '本月暂无安排'
      : `事件 ${monthEvents.length} · 截止 ${monthTasks.length} · 课程 ${monthCourse.count}`

  // 迷你月历换月：清选中日与周游标（换月即离开当前周视图，monthCursor 落新月份）
  const shiftMonth = (delta: number): void => {
    setSelectedDay(null)
    calendarUiStore.set((state) => {
      const prev = new Date(state.monthCursorMs)
      return {
        ...state,
        weekCursorMs: null,
        monthCursorMs: new Date(prev.getFullYear(), prev.getMonth() + delta, 1).getTime(),
      }
    })
  }

  /** 周导航（本切片）：上一周 / 下一周——未设游标时以「今天」为锚，保持星期几，月历随游标同步 */
  const shiftWeek = (delta: number): void => {
    const anchor = weekCursor !== null ? weekCursor : now
    setSelectedDay(null)
    setWeekCursor(addDays(anchor, delta * 7))
  }

  /** 回到本周（本切片）：清周游标 + 选中日，月历回当月，恢复今天锚定实况视图 */
  const resetToThisWeek = (): void => {
    calendarUiStore.set((state) => ({
      ...state,
      weekCursorMs: null,
      selectedDayMs: null,
      monthCursorMs: now.getTime(),
    }))
  }

  // 「今天」= 滚到今天分组，无今天分组则回到顶部（下一项卡）
  const goToday = (): void => scrollToRef(todayRef.current !== null ? todayRef : heroRef)
  // 「回到现在」= 滚到下一项卡（顶部锚点）
  const goNow = (): void => scrollToRef(heroRef)

  // 周视图日区块延迟滚动：跨周切换需等新的一周挂载（ref 就绪）后再滚动，reduced-motion 感知
  useEffect(() => {
    if (weekScrollTarget === null) return
    const el = weekDayRefs.current.get(weekScrollTarget)
    if (el !== undefined) {
      el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
    }
    setWeekScrollTarget(null)
  }, [weekScrollTarget, reduce])

  /** 周视图日头点击（本切片）：选中该日并把日区块滚入视野 */
  const handleWeekDayClick = (index: number, date: Date): void => {
    setSelectedDay(date)
    setWeekScrollTarget(index)
  }

  /**
   * 迷你月历日格点击（F10）：选中该日。
   * 周游标激活时——把游标移到该日所在周并滚到对应日区块；
   * 实况视图下——沿用原语义：滚到该日首个未结束事件，无事件则回退首个截止任务。
   */
  const handleDayClick = (day: number): void => {
    const date = new Date(year, month, day)
    setSelectedDay(date)
    if (weekCursor !== null) {
      setWeekCursor(date)
      setWeekScrollTarget((date.getDay() + 6) % 7)
      return
    }
    const scrollRow = (el: HTMLElement): void => {
      el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
    }
    const eventTarget = upcoming.find((event) => isSameDay(event.startAt, date))
    if (eventTarget !== undefined) {
      const el = eventRefs.current.get(eventTarget.id)
      if (el !== undefined) scrollRow(el)
      return
    }
    const taskTarget = dueTasks.find((task) => isSameDay(task.dueAt as string, date))
    const el = taskTarget !== undefined ? taskRefs.current.get(taskTarget.id) : undefined
    if (el !== undefined) scrollRow(el)
  }

  /** 新建日程预填开始时刻：选中日 09:00；否则下一整点 */
  const defaultStartForCreate = (): string => {
    if (selectedDay !== null) {
      const d = new Date(selectedDay)
      d.setHours(9, 0, 0, 0)
      return toISODateTime(d)
    }
    const d = new Date(now)
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    return toISODateTime(d)
  }

  const handleCreate = (): void => setDraftStartAt(defaultStartForCreate())

  // 创建成功：关闭弹窗 + toast 撤销（删除走回收站，经 event.remove）
  const handleCreated = (event: CalendarEvent): void => {
    setDraftStartAt(null)
    setSelectedDay(null)
    toast(`已创建日程「${event.title}」`, {
      action: {
        label: '撤销',
        onClick: () => {
          void removeEvent(event.id).catch((err) => {
            toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
          })
        },
      },
    })
  }

  return (
    <div className="k-view k-cal-c">
      <div className="k-cal__bar">
        <div className="k-cal-c__meta">
          <span className="k-cal__date">今天 · {formatFullDate(now)}</span>
          <span className="u-label k-muted">
            接下来 {upcoming.length} 场
            {todayRuns.length > 0 ? ` · 今日 ${todayRuns.length} 节课` : ''}
            {todayTaskCount > 0 ? ` · ${todayTaskCount} 项截止` : ''} · 现在 {formatTime(now)}
          </span>
        </div>
        <div className="k-cal__nav">
          {/* 本切片：周导航——上一周 / 下一周 + 回到本周（游标激活时才出现） */}
          <div className="k-cal__weeknav" role="group" aria-label="周导航">
            <button type="button" className="k-iconbtn" onClick={() => shiftWeek(-1)} aria-label="上一周">
              <ChevronLeft size={15} strokeWidth={1.5} aria-hidden />
            </button>
            <button type="button" className="k-iconbtn" onClick={() => shiftWeek(1)} aria-label="下一周">
              <ChevronRight size={15} strokeWidth={1.5} aria-hidden />
            </button>
          </div>
          {weekCursor !== null && (
            <button type="button" className="k-btn" onClick={resetToThisWeek}>
              回到本周
            </button>
          )}
          <button type="button" className="k-btn" onClick={handleCreate}>
            新建日程
          </button>
          {/* Slice N0.6 · 交互反馈修复：无未来事件时锚点 ref 为 null，滚动点击会静默 no-op；
              故空议程下置禁用态（可见反馈）。Slice H3：存在「今日课程 / 任务截止」时同样可滚动。
              本切片：周视图下「今天 / 回到现在」无对应锚点，一并禁用（用「回到本周」退出）。 */}
          <button
            type="button"
            className="k-btn"
            onClick={goToday}
            disabled={weekCursor !== null || (!hasStream && todayRuns.length === 0)}
          >
            今天
          </button>
          <button
            type="button"
            className="k-btn"
            onClick={goNow}
            disabled={weekCursor !== null || (!hasStream && todayRuns.length === 0)}
          >
            回到现在
          </button>
          {/* 本切片：日程范围开关（进行中 / 含已结束）；复用资料筛选条同款 segmented */}
          <div className="k-lib__seg" role="group" aria-label="日程范围">
            <TagPill
              selected={!calendarUi.showPast}
              onClick={() => calendarUiStore.set((s) => ({ ...s, showPast: false }))}
            >
              进行中
            </TagPill>
            <TagPill
              selected={calendarUi.showPast}
              onClick={() => calendarUiStore.set((s) => ({ ...s, showPast: true }))}
            >
              含已结束
            </TagPill>
          </div>
        </div>
      </div>

      {next !== undefined ? (
        <section ref={heroRef} className="k-cal-c__next">
          <div className="k-cal-c__next-body">
            <span className="k-cal-c__next-kicker u-label">下一项 · NEXT</span>
            <h2 className="k-cal-c__next-title">{next.title}</h2>
            <span className="k-cal-c__next-meta">
              {relativeDay(next.startAt, now)} · {formatFullDate(next.startAt)} ·{' '}
              {rowRange(next)}
              {next.location !== undefined ? ` · ${next.location}` : ''}
            </span>
          </div>
          <div className="k-cal-c__next-side">
            <span className="k-cal-c__count">
              <b>{countdown(toDate(next.startAt), now)}</b>
              <span className="u-label">距开始</span>
            </span>
            <button type="button" className="k-btn" onClick={() => setDrawerId(next.id)}>
              详情
            </button>
          </div>
        </section>
      ) : (
        <p className="k-cal__quiet">
          {todayRuns.length + todayTaskCount > 0
            ? `接下来没有事件；今天有 ${todayRuns.length > 0 ? `${todayRuns.length} 节课` : ''}${
                todayRuns.length > 0 && todayTaskCount > 0 ? ' · ' : ''
              }${todayTaskCount > 0 ? `${todayTaskCount} 项截止` : ''}。`
            : '接下来没有安排。'}
        </p>
      )}

      <div className="k-cal-c__layout">
        <div className="k-cal-c__stream">
          {weekCursor !== null ? (
            weekHasContent ? (
              <>
                <div className="k-cal-c__weekhd">
                  <h2>
                    {formatMonthDay(weekDays[0].date)} – {formatMonthDay(weekDays[6].date)}
                  </h2>
                  <span className="k-mono">
                    {weekTotals.events} 场
                    {weekTotals.tasks > 0 ? ` · ${weekTotals.tasks} 项截止` : ''}
                    {weekTotals.runs > 0 ? ` · ${weekTotals.runs} 节课` : ''}
                  </span>
                </div>
                {weekDays.map((day, index) => {
                  const dayHasContent =
                    day.events.length > 0 || day.tasks.length > 0 || day.runs.length > 0
                  const dayIsToday = isToday(day.date)
                  return (
                    <section
                      key={day.date.toISOString()}
                      ref={(el) => {
                        if (el !== null) weekDayRefs.current.set(index, el)
                        else weekDayRefs.current.delete(index)
                      }}
                      className="k-cal-c__group"
                    >
                      <div className="k-cal-c__grouphd">
                        <h3>
                          <button
                            type="button"
                            className="k-cal-c__dayhd"
                            onClick={() => handleWeekDayClick(index, day.date)}
                            aria-label={`${formatFullDate(day.date)}，定位到当日`}
                            aria-pressed={selectedDay !== null && isSameDay(day.date, selectedDay)}
                          >
                            {weekdayLabel(day.dow)} {formatMonthDay(day.date)}
                            {dayIsToday && <span className="k-cal-c__daytag">今天</span>}
                          </button>
                        </h3>
                        <span className="k-mono">
                          {day.events.length} 场
                          {day.tasks.length > 0 ? ` · ${day.tasks.length} 截止` : ''}
                          {day.runs.length > 0 ? ` · ${day.runs.length} 节` : ''}
                        </span>
                      </div>
                      {dayHasContent ? (
                        <>
                          {/* 事件（按开始升序；已结束仅在「含已结束」开启时出现） */}
                          {day.events.map((event) => (
                            <button
                              type="button"
                              key={event.id}
                              className="k-lib-row"
                              onClick={() => setDrawerId(event.id)}
                            >
                              <span className="k-lib-row__kind k-mono">{rowTime(event, now)}</span>
                              <span className="k-lib-row__title">{event.title}</span>
                              <span className="k-lib-row__meta">
                                {event.location !== undefined
                                  ? event.location
                                  : EVENT_STATUS_LABEL[event.status]}
                              </span>
                            </button>
                          ))}
                          {/* 该日截止任务（已排除完成 / 丢弃 / 推迟到未来） */}
                          {day.tasks.map((task) => (
                            <button
                              type="button"
                              key={task.id}
                              className="k-lib-row"
                              onClick={() => setTaskId(task.id)}
                            >
                              <span className="k-lib-row__kind k-mono">{taskDueLabel(task, now)}</span>
                              <span className="k-lib-row__title">{task.title}</span>
                              <span className="k-lib-row__meta">
                                {task.projectId !== undefined
                                  ? (getProjectById(task.projectId)?.title ?? '')
                                  : ''}
                              </span>
                            </button>
                          ))}
                          {/* 该日课程（连堂合并 + 学期周过滤） */}
                          {day.runs.map((run) => (
                            <button
                              type="button"
                              key={`${run.course.id}-${run.startPeriod}`}
                              className="k-lib-row"
                              onClick={() => setCourseId(run.course.id)}
                            >
                              <span className="k-lib-row__kind k-mono">{formatPeriods(run)}</span>
                              <span className="k-lib-row__title">{run.course.title}</span>
                              <span className="k-lib-row__meta">
                                {run.location ?? run.course.teacher ?? ''}
                              </span>
                            </button>
                          ))}
                        </>
                      ) : (
                        <p className="k-cal-c__dayempty">无安排</p>
                      )}
                    </section>
                  )
                })}
              </>
            ) : (
              <EmptyState
                title="这一周没有安排"
                hint="空档适合安排深工作或休息。用上方箭头浏览其它周，或点「回到本周」。"
              />
            )
          ) : !hasStream && todayRuns.length === 0 && !hasPastShown ? (
            <EmptyState title="接下来没有安排" hint="空档适合安排深工作或休息。可点「新建日程」添加一场。" />
          ) : (
            <>
              {/* 已结束（本切片）：仅「含已结束」开关打开时出现，置于议程流首组（含过去 50 项） */}
              {hasPastShown && (
                <section className="k-cal-c__group is-past">
                  <div className="k-cal-c__grouphd">
                    <h3>已结束</h3>
                    <span className="k-mono">最近 {pastEvents.length} 项</span>
                  </div>
                  {pastEvents.map((event) => (
                    <button
                      type="button"
                      key={event.id}
                      className="k-lib-row"
                      onClick={() => setDrawerId(event.id)}
                    >
                      <span className="k-lib-row__kind k-mono">{rowTime(event, now)}</span>
                      <span className="k-lib-row__title">{event.title}</span>
                      <span className="k-lib-row__meta">
                        {event.location !== undefined
                          ? event.location
                          : EVENT_STATUS_LABEL[event.status]}
                      </span>
                    </button>
                  ))}
                </section>
              )}
              {/* 今日课程：仅当天（全周课表在 /timetable）；置于议程流最前 */}
              {todayRuns.length > 0 && (
                <section ref={todayRef} className="k-cal-c__group">
                  <div className="k-cal-c__grouphd">
                    <h3>今日课程</h3>
                    <span className="k-mono">{todayRuns.length} 节</span>
                  </div>
                  {todayRuns.map((run) => (
                    <button
                      type="button"
                      key={`${run.course.id}-${run.startPeriod}`}
                      className="k-lib-row"
                      onClick={() => setCourseId(run.course.id)}
                    >
                      <span className="k-lib-row__kind k-mono">{formatPeriods(run)}</span>
                      <span className="k-lib-row__title">{run.course.title}</span>
                      <span className="k-lib-row__meta">
                        {run.location ?? run.course.teacher ?? ''}
                      </span>
                    </button>
                  ))}
                </section>
              )}
              {buckets.map((bucket) =>
                bucket.events.length === 0 && bucket.tasks.length === 0 ? null : (
                  <section
                    key={bucket.key}
                    // 今日课程块已占用 todayRef 时不再重复挂载
                    ref={todayRuns.length === 0 && bucket.key === 'today' ? todayRef : undefined}
                    className="k-cal-c__group"
                  >
                    <div className="k-cal-c__grouphd">
                      <h3>{bucket.label}</h3>
                      <span className="k-mono">{groupMeta(bucket)}</span>
                    </div>
                    {bucket.events.map((event) => (
                      <button
                        type="button"
                        key={event.id}
                        className="k-lib-row"
                        ref={(el) => {
                          if (el !== null) eventRefs.current.set(event.id, el)
                          else eventRefs.current.delete(event.id)
                        }}
                        onClick={() => setDrawerId(event.id)}
                      >
                        <span className="k-lib-row__kind k-mono">{rowTime(event, now)}</span>
                        <span className="k-lib-row__title">{event.title}</span>
                        <span className="k-lib-row__meta">
                          {event.location !== undefined
                            ? event.location
                            : EVENT_STATUS_LABEL[event.status]}
                        </span>
                      </button>
                    ))}
                    {/* 任务截止行：事件之后；逾期归「今天」；无截止任务从不出现 */}
                    {bucket.tasks.map((task) => (
                      <button
                        type="button"
                        key={task.id}
                        className="k-lib-row"
                        ref={(el) => {
                          if (el !== null) taskRefs.current.set(task.id, el)
                          else taskRefs.current.delete(task.id)
                        }}
                        onClick={() => setTaskId(task.id)}
                      >
                        <span className="k-lib-row__kind k-mono">{taskDueLabel(task, now)}</span>
                        <span className="k-lib-row__title">{task.title}</span>
                        <span className="k-lib-row__meta">
                          {task.projectId !== undefined
                            ? (getProjectById(task.projectId)?.title ?? '')
                            : ''}
                        </span>
                      </button>
                    ))}
                  </section>
                ),
              )}
            </>
          )}
        </div>

        <aside className="k-cal-c__side">
          <Panel
            title={`${month + 1}月`}
            en={`${year}`}
            actions={
              <>
                <button
                  type="button"
                  className="k-iconbtn"
                  onClick={() => shiftMonth(-1)}
                  aria-label="上个月"
                >
                  <ChevronLeft size={15} strokeWidth={1.5} aria-hidden />
                </button>
                <button
                  type="button"
                  className="k-iconbtn"
                  onClick={() => shiftMonth(1)}
                  aria-label="下个月"
                >
                  <ChevronRight size={15} strokeWidth={1.5} aria-hidden />
                </button>
              </>
            }
          >
            <div className="k-minical" aria-label={`${year}年${month + 1}月`}>
              {WEEKDAY_HEADER.map((dow) => (
                <span key={dow} className="k-minical__dow">
                  {dow}
                </span>
              ))}
              {cells.map((cell) =>
                cell.day === undefined ? (
                  <span key={cell.key} className="k-minical__d is-void" aria-hidden>
                    ·
                  </span>
                ) : (
                  <button
                    type="button"
                    key={cell.key}
                    className={[
                      'k-minical__d',
                      cell.isToday ? 'is-today' : '',
                      cell.hasAny ? 'is-event' : '',
                      selectedDay !== null && isSameDay(new Date(year, month, cell.day), selectedDay)
                        ? 'is-selected'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-label={`${month + 1}月${cell.day}日`}
                    aria-pressed={
                      selectedDay !== null && isSameDay(new Date(year, month, cell.day), selectedDay)
                    }
                    onClick={() => handleDayClick(cell.day as number)}
                  >
                    {cell.day}
                  </button>
                ),
              )}
            </div>
            <div className="k-cal-c__legend">
              <span>
                <i className="is-today" />
                今天
              </span>
              <span>
                <i />
                有安排
              </span>
            </div>
          </Panel>

          <section className="k-stat">
            <span className="k-stat__label">本月 · {month + 1} 月安排</span>
            <span className="k-stat__value">
              {monthCount}
              <span className="k-stat__suffix">项</span>
            </span>
            <span className="k-stat__foot">{monthFoot}</span>
          </section>
        </aside>
      </div>

      {/* 日程详情（Slice W）：编辑 / 删除 / 状态快捷切换，由 EventDetailModal 承载 */}
      <EventDetailModal eventId={drawerId} onClose={closeDrawer} />

      {/* 课程详情（聚合自「今日课程」） */}
      <CourseDetailModal courseId={courseId} onClose={() => setCourseId(null)} />

      {/* 任务详情（聚合自任务截止行） */}
      <TaskDetailModal taskId={taskId} onClose={() => setTaskId(null)} />

      {/* 新建日程（先确认后写入，无 AI）：确认前零落盘 */}
      <EventDraftModal
        open={draftStartAt !== null}
        initialStartAt={draftStartAt ?? ''}
        onClose={() => setDraftStartAt(null)}
        onCreated={handleCreated}
      />
    </div>
  )
}
