// KERNEL · 日期工具（date-fns 包装 · zh-CN 区域）
// 所有对外函数接受 string（ISO）或 Date，内部统一转换。
import {
  addDays,
  differenceInCalendarDays,
  endOfDay as endOfDayFns,
  endOfWeek as endOfWeekFns,
  format,
  formatDistance,
  isSameDay as isSameDayFns,
  isToday as isTodayFns,
  isWithinInterval,
  parseISO,
  startOfDay as startOfDayFns,
  startOfWeek as startOfWeekFns,
} from 'date-fns'
import { zhCN } from 'date-fns/locale'

/** 可接受的日期输入 */
export type DateInput = string | number | Date

/** 安全转换为 Date（无效输入返回当前时间） */
export function toDate(input: DateInput): Date {
  if (input instanceof Date) return input
  if (typeof input === 'number') return new Date(input)
  const parsed = parseISO(input)
  return Number.isNaN(parsed.getTime()) ? new Date(input) : parsed
}

const WEEK_OPTS = { weekStartsOn: 1 as const } // 周一为一周起点（中文习惯）

/* --------------------------- 格式化 --------------------------- */

/** 时刻：14:30 */
export function formatTime(input: DateInput): string {
  return format(toDate(input), 'HH:mm')
}

/** 月日：10月2日（不补零） */
export function formatMonthDay(input: DateInput): string {
  return format(toDate(input), 'M月d日', { locale: zhCN })
}

/** 星期：星期五 */
export function formatWeekday(input: DateInput): string {
  return format(toDate(input), 'EEEE', { locale: zhCN })
}

/** 短星期：周五 */
export function formatWeekdayShort(input: DateInput): string {
  return format(toDate(input), 'EEE', { locale: zhCN })
}

/** 完整日期：2026年10月2日 星期五（不补零） */
export function formatFullDate(input: DateInput): string {
  return format(toDate(input), 'yyyy年M月d日 EEEE', { locale: zhCN })
}

/** 日期时间：2026-10-02 14:30 */
export function formatDateTime(input: DateInput): string {
  return format(toDate(input), 'yyyy-MM-dd HH:mm')
}

/** 相对时间：3 小时前 / 2 天后 */
export function formatRelative(input: DateInput, base: DateInput = new Date()): string {
  return formatDistance(toDate(input), toDate(base), { addSuffix: true, locale: zhCN })
}

/** YYYY-MM-DD（用于习惯打卡 date 字段） */
export function toISODateString(input: DateInput): string {
  return format(toDate(input), 'yyyy-MM-dd')
}

/** ISO 8601（含 +08:00 偏移的本地时刻） */
export function toISODateTime(input: DateInput): string {
  return format(toDate(input), "yyyy-MM-dd'T'HH:mm:ssxxx")
}

/** 周键：2026-W40 */
export function toWeekKey(input: DateInput): string {
  return format(toDate(input), "RRRR-'W'II", { locale: zhCN })
}

/** 月键：2026-09 */
export function toMonthKey(input: DateInput): string {
  return format(toDate(input), 'yyyy-MM')
}

/* --------------------------- 判定 / 范围 --------------------------- */

export function isToday(input: DateInput): boolean {
  return isTodayFns(toDate(input))
}

export function isSameDay(a: DateInput, b: DateInput): boolean {
  return isSameDayFns(toDate(a), toDate(b))
}

export function startOfDay(input: DateInput): Date {
  return startOfDayFns(toDate(input))
}

export function endOfDay(input: DateInput): Date {
  return endOfDayFns(toDate(input))
}

export function startOfWeek(input: DateInput): Date {
  return startOfWeekFns(toDate(input), WEEK_OPTS)
}

export function endOfWeek(input: DateInput): Date {
  // date-fns 的 endOfWeek 返回当周最后一刻（周日 23:59:59.999），配合周一起点
  return endOfWeekFns(toDate(input), WEEK_OPTS)
}

export { addDays }

/** 与今天相差的日历天数（今天=0，昨天=-1，明天=1） */
export function daysFromToday(input: DateInput, today: DateInput = new Date()): number {
  return differenceInCalendarDays(toDate(input), toDate(today))
}

/** 是否落在 [start, end] 闭区间内 */
export function isWithinRange(input: DateInput, start: DateInput, end: DateInput): boolean {
  return isWithinInterval(toDate(input), { start: toDate(start), end: toDate(end) })
}

/** 是否为过去（严格早于 now） */
export function isPast(input: DateInput, now: DateInput = new Date()): boolean {
  return toDate(input).getTime() < toDate(now).getTime()
}

/** 是否为未来（严格晚于 now） */
export function isFuture(input: DateInput, now: DateInput = new Date()): boolean {
  return toDate(input).getTime() > toDate(now).getTime()
}

/** 距今天数的人类可读表述：今天 / 明天 / 3 天后 / 2 天前 */
export function humanizeDay(input: DateInput, base: DateInput = new Date()): string {
  const diff = differenceInCalendarDays(toDate(input), toDate(base))
  if (diff === 0) return '今天'
  if (diff === 1) return '明天'
  if (diff === 2) return '后天'
  if (diff === -1) return '昨天'
  return diff > 0 ? `${diff} 天后` : `${Math.abs(diff)} 天前`
}

/** 从 now 起向后 count 天的日期数组（用于热力图 / 周条） */
export function upcomingDays(count: number, from: DateInput = new Date()): Date[] {
  const start = startOfDay(from)
  return Array.from({ length: count }, (_, i) => addDays(start, i))
}
