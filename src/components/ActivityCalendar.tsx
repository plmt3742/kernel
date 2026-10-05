// KERNEL · 活跃贡献日历（个人页 · ActivityCalendar）
// GitHub 式贡献网格：周一为列首、末列为当前周（未来日留空）；
// 强度 5 级（0=安静面 · 1/2/3/4=递增强调色透明度）。
// 复用既有的 `.k-heat*` 网格结构（与习惯热力图同款视觉），仅在 views.css 追加
// `.k-heat__cell.is-l1..is-l4` 强度修饰与 `.k-contrib*` 脚注（不改 components.css 基础规则）。
// 纯展示、非聚焦（无 tab 停靠）；`role="img"` + aria-label；reduced-motion 无动画。
import { clsx } from 'clsx'
import type { ReactNode } from 'react'
import { addDays, formatMonthDay, monthLabel, startOfWeek, toISODateString, toMonthKey } from '@/lib/date'

/** 单日活动（与服务端 `GET /api/activity/summary` 的 days 项同形） */
export interface ActivityDay {
  /** YYYY-MM-DD（本地） */
  date: string
  /** 当日活动计数（含习惯打卡；含 0 值日） */
  count: number
}

interface ActivityCalendarProps {
  /** 逐日活动（含零值日）；空数组 → 渲染全空网格 */
  days: ActivityDay[]
  /** 回看周数；缺省由 days 首日推导（末列恒为当前周） */
  weeks?: number
}

/** 行序与列内 days 一致：周一 → 周日；仅标一/三/五 */
const WEEKDAY_AXIS = ['一', '', '三', '', '五', '', ''] as const
/** 月份标签最小列距：与上一已发标签至少隔 3 列，避免相邻月拥挤 */
const MONTH_LABEL_MIN_GAP = 3
/** 空数据时回退的默认窗口周数 */
const DEFAULT_WEEKS = 20
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000

/** 计数 → 强度档位（0 = 空；1–2 / 3–5 / 6–9 / 10+） */
function levelOf(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0
  if (count <= 2) return 1
  if (count <= 5) return 2
  if (count <= 9) return 3
  return 4
}

interface Cell {
  date: string
  count: number
  level: 0 | 1 | 2 | 3 | 4
  future: boolean
}

interface Column {
  start: string
  monthLabel?: string
  days: Cell[]
}

export function ActivityCalendar({ days, weeks }: ActivityCalendarProps): ReactNode {
  const byDate = new Map(days.map((day) => [day.date, day.count]))
  const today = new Date()
  const todayKey = toISODateString(today)
  const lastMonday = startOfWeek(today)
  const firstMonday = days.length > 0 ? startOfWeek(days[0].date) : lastMonday
  const derivedWeeks = Math.max(
    1,
    Math.round((lastMonday.getTime() - firstMonday.getTime()) / MS_PER_WEEK) + 1,
  )
  const weekCount = Math.max(1, weeks ?? (days.length > 0 ? derivedWeeks : DEFAULT_WEEKS))
  const windowStart = addDays(lastMonday, -7 * (weekCount - 1))

  // 月份标签防碰撞：窗口首个不完整月（周一非 1 号）省略；其余新月份仅在列距 ≥ 阈值时给出。
  let previousMonth = ''
  let lastLabelIndex = Number.NEGATIVE_INFINITY
  const columns: Column[] = Array.from({ length: weekCount }, (_, weekIndex) => {
    const monday = addDays(windowStart, 7 * weekIndex)
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
    const cells: Cell[] = Array.from({ length: 7 }, (_, dayIndex) => {
      const date = toISODateString(addDays(monday, dayIndex))
      const count = byDate.get(date) ?? 0
      return { date, count, level: levelOf(count), future: date > todayKey }
    })
    return { start: toISODateString(monday), monthLabel: label, days: cells }
  })

  // 末个带月份标签的列：标签靠右锚定（与习惯热力图同款），避免 nowrap 文本溢出被裁切
  const lastLabelCol = columns.reduce(
    (last, week, index) => (week.monthLabel !== undefined ? index : last),
    -1,
  )

  const cells = columns.flatMap((column) => column.days)
  const activeDays = cells.filter((cell) => cell.count > 0).length
  const total = cells.reduce((sum, cell) => sum + cell.count, 0)

  const scope = `${formatMonthDay(columns[0]?.start ?? today)} – ${formatMonthDay(today)}`

  return (
    <div className="k-contrib">
      <div
        className="k-heat"
        role="img"
        aria-label={`活跃贡献日历 · ${scope} · 近 ${weekCount} 周活跃 ${activeDays} 天 · 共 ${total} 次`}
      >
        <div className="k-heat__months" aria-hidden>
          {columns.map((week, index) => (
            <span
              key={week.start}
              className={clsx('k-heat__month', index === lastLabelCol && 'is-tail')}
            >
              {week.monthLabel ?? ''}
            </span>
          ))}
        </div>
        <div className="k-heat__axis" aria-hidden>
          {WEEKDAY_AXIS.map((label, index) => (
            <span key={index} className="k-heat__axis-label">
              {label}
            </span>
          ))}
        </div>
        <div className="k-heat__grid" aria-hidden>
          {columns.map((week) => (
            <div key={week.start} className="k-heat__col">
              {week.days.map((day) => (
                <span
                  key={day.date}
                  className={clsx(
                    'k-heat__cell',
                    day.future ? 'is-future' : day.level > 0 && `is-l${day.level}`,
                  )}
                  title={`${day.date} · ${day.count} 次`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="k-contrib__foot">
        <span className="k-contrib__summary u-label">
          近 {weekCount} 周活跃 {activeDays} 天 · 共 {total} 次
        </span>
        <span className="k-contrib__legend u-label" aria-hidden>
          少
          <i className="k-contrib__swatch is-l1" />
          <i className="k-contrib__swatch is-l2" />
          <i className="k-contrib__swatch is-l3" />
          <i className="k-contrib__swatch is-l4" />
          多
        </span>
      </div>
    </div>
  )
}
