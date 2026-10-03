// KERNEL · 课表纯函数（v0.5 · Slice H0）
// 周次文本解析 / 格式化、节次格式化、学期周换算、时段过滤——均为纯函数，供 UI 复用。
// 纪律：不读全局快照、不产生副作用；错误以 Error 抛出由调用方展示。
import { startOfWeek, toDate } from '@/lib/date'
import type { Course, CourseSession, TermInfo } from '@/types'

/** 周次格式错误的统一文案（解析失败时抛出，UI 原样展示） */
export const WEEKS_FORMAT_ERROR = '周次格式：如 1-16 / 1-16单 / 1-8,10-16'

/**
 * 解析周次文本 → 升序唯一数组。
 * · 去首尾空白；去空格与「周」字；按 `,` / `，` 切分；
 * · 每段支持 `N` / `A-B` / `A-B单` / `A-B双`；
 * · 空输入 → `undefined`（= 每周，不做周过滤）；
 * · 任何非法段 → 抛 `Error(WEEKS_FORMAT_ERROR)`。
 */
export function parseWeeksInput(input: string): number[] | undefined {
  const cleaned = input.trim().replace(/[\s周]/g, '')
  if (cleaned === '' || cleaned === '每' || cleaned === '全') return undefined
  const tokens = cleaned.split(/[,，]/).filter((token) => token !== '')
  if (tokens.length === 0) return undefined

  const weeks = new Set<number>()
  for (const token of tokens) {
    const match = /^(\d+)(?:-(\d+))?(单|双)?$/.exec(token)
    if (match === null) throw new Error(WEEKS_FORMAT_ERROR)
    const start = Number(match[1])
    const end = match[2] !== undefined ? Number(match[2]) : start
    if (start < 1 || end < start) throw new Error(WEEKS_FORMAT_ERROR)
    const parity = match[3]
    for (let week = start; week <= end; week += 1) {
      if (parity === '单' && week % 2 === 0) continue
      if (parity === '双' && week % 2 !== 0) continue
      weeks.add(week)
    }
  }
  if (weeks.size === 0) throw new Error(WEEKS_FORMAT_ERROR)
  return [...weeks].sort((a, b) => a - b)
}

/**
 * 周次数组 → 可读文本。
 * · 缺省 / 空 → `'每周'`；
 * · 连续区间压缩：`'1–8、10–16 周'`（连接号用 en dash `–`）；
 * · 全部为奇数（且 >1 项）追加 `（单）`，全部为偶数追加 `（双）`。
 */
export function formatWeeks(weeks?: number[]): string {
  if (weeks === undefined || weeks.length === 0) return '每周'
  const sorted = [...new Set(weeks)].sort((a, b) => a - b)

  const runs: Array<[number, number]> = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i < sorted.length; i += 1) {
    const week = sorted[i]
    if (week === prev + 1) {
      prev = week
      continue
    }
    runs.push([start, prev])
    start = week
    prev = week
  }
  runs.push([start, prev])

  const allOdd = sorted.length > 1 && sorted.every((week) => week % 2 === 1)
  const allEven = sorted.length > 1 && sorted.every((week) => week % 2 === 0)
  // 单 / 双周且步长均为 2（如 1-16单 → 1,3,…,15）：压缩为「1–15 周（单）」
  const step2 = sorted.every((week, index) => index === 0 || week === sorted[index - 1] + 2)
  if ((allOdd || allEven) && step2) {
    const range =
      sorted[0] === sorted[sorted.length - 1]
        ? String(sorted[0])
        : `${sorted[0]}–${sorted[sorted.length - 1]}`
    return `${range} 周${allOdd ? '（单）' : '（双）'}`
  }
  const text = runs.map(([a, b]) => (a === b ? String(a) : `${a}–${b}`)).join('、')
  return `${text} 周`
}

/** 节次格式化：`第3-4节` / `第5节`（形参仅取起止，兼容 CourseSession / DayRun） */
export function formatPeriods(periods: { startPeriod: number; endPeriod: number }): string {
  return periods.startPeriod === periods.endPeriod
    ? `第${periods.startPeriod}节`
    : `第${periods.startPeriod}-${periods.endPeriod}节`
}

/** 星期 → 中文标签：`周一` … `周日`（1 = 周一 … 7 = 周日）；越界值保守回退 */
export function weekdayLabel(dayOfWeek: number): string {
  const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']
  return labels[dayOfWeek - 1] ?? `周${dayOfWeek}`
}

/**
 * 日期落在学期的第几周（周一为一周起点；startDate = 第 1 周周一）。
 * term 缺失 / 无 startDate → `null`。
 */
export function weekOfTerm(term: TermInfo | null, date: Date): number | null {
  if (term === null || term.startDate === undefined || term.startDate === '') return null
  const startMonday = startOfWeek(toDate(term.startDate))
  const targetMonday = startOfWeek(date)
  const diffDays = Math.round((targetMonday.getTime() - startMonday.getTime()) / 86_400_000)
  return Math.floor(diffDays / 7) + 1
}

/** 某时段是否在某周出现：时段无 weeks（=每周）或 week 未知 → true；否则按数组判定 */
export function sessionInWeek(session: CourseSession, week: number | null): boolean {
  if (session.weeks === undefined || session.weeks.length === 0) return true
  if (week === null) return true
  return session.weeks.includes(week)
}

/**
 * 合并后的单日连续课块（Slice H1.8）。
 * 同一天、同一门课、相邻 / 重叠节次（来源表格常分成两行）在显示层合成一个块，
 * 消除「带缝隙的两块」观感；数据本身不动，已导入课程直接生效。
 */
export interface DayRun {
  course: Course
  startPeriod: number
  endPeriod: number
  /** 合并后地点（run 内首个非空；全空 = null） */
  location: string | null
  /** run 内首个时段（供 tooltip 周次等） */
  first: CourseSession
}

/** 时段的有效地点：时段覆盖优先，回退课程默认；空串归一为 null */
function resolveLocation(course: Course, session: CourseSession): string | null {
  const raw = session.location ?? course.location
  return raw !== undefined && raw !== '' ? raw : null
}

/** 地点兼容：双方相等，或任一方为 null（缺地点不阻断合并） */
function locationsCompatible(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return true
  return a === b
}

/**
 * 合并某天某周的连续课块（Slice H1.8）。
 * 步骤：过滤该天该周全部时段（配对所属课程）→ 按 startPeriod 升序（并列按课程 id 稳定）
 * → 顺序合并：**按课程维护「最后一段」**，同课程且「相邻或重叠」（`startPeriod <= last.endPeriod + 1`）
 *   且地点兼容 → 合并（endPeriod 取 max、地点取首个非空）；否则新起一段。
 * 注：仅与全局末段比较会因同起始节次的其它课程插入而错过合并（QA 发现的排序依赖缺陷），
 *     故此处按 course.id 记 last（runs 数组顺序与渲染无关——块按绝对节次定位）。
 */
export function mergeDayRuns(courses: Course[], dayOfWeek: number, week: number | null): DayRun[] {
  const slots: Array<{ course: Course; session: CourseSession; location: string | null }> = []
  for (const course of courses) {
    for (const session of course.sessions) {
      if (session.dayOfWeek === dayOfWeek && sessionInWeek(session, week)) {
        slots.push({ course, session, location: resolveLocation(course, session) })
      }
    }
  }
  slots.sort((a, b) => {
    if (a.session.startPeriod !== b.session.startPeriod) {
      return a.session.startPeriod - b.session.startPeriod
    }
    return a.course.id < b.course.id ? -1 : a.course.id > b.course.id ? 1 : 0
  })

  const runs: DayRun[] = []
  const lastByCourse = new Map<string, DayRun>()
  for (const slot of slots) {
    const last = lastByCourse.get(slot.course.id)
    if (
      last !== undefined &&
      slot.session.startPeriod <= last.endPeriod + 1 &&
      locationsCompatible(last.location, slot.location)
    ) {
      last.endPeriod = Math.max(last.endPeriod, slot.session.endPeriod)
      if (last.location === null) last.location = slot.location
    } else {
      const run: DayRun = {
        course: slot.course,
        startPeriod: slot.session.startPeriod,
        endPeriod: slot.session.endPeriod,
        location: slot.location,
        first: slot.session,
      }
      runs.push(run)
      lastByCourse.set(slot.course.id, run)
    }
  }
  return runs
}
