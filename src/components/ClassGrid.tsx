// KERNEL · 课表网格（v0.5 · Slice H0）
// 7 列（周一…周日）× N 行（节次）的周视图；时段按 dayOfWeek 落列、按节次跨行。
// 读取 courses / term（revision-aware）；viewWeek 本地状态（初始 = 当前周）。
// design system：块面只用表面阶 + 细描边，唯一强调色仅作「今天」列信号。
import { useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { EmptyState } from '@/components/EmptyState'
import { getCourses, getTerm } from '@/lib/data'
import { useDataRevision, useNow } from '@/lib/hooks'
import {
  formatPeriods,
  formatWeeks,
  mergeDayRuns,
  sessionInWeek,
  weekOfTerm,
} from '@/lib/schedule'
import type { CourseDraftPreset } from '@/components/CourseDraftModal'
import type { Weekday } from '@/types'

interface ClassGridProps {
  /** 点空格 / 点「新建课程」：预填该天该节（缺省 = 周一第 1 节） */
  onCreateCourse: (preset?: CourseDraftPreset) => void
  /** 点课程块：打开详情 */
  onOpenCourse: (id: string) => void
  /** 打开学期设置 */
  onOpenTerm: () => void
}

const WEEKDAYS: Array<{ value: Weekday; label: string }> = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

/** 今天的中文星期简称（1 = 一 … 7 = 日） */
const WEEKDAY_CN: Record<Weekday, string> = {
  1: '一',
  2: '二',
  3: '三',
  4: '四',
  5: '五',
  6: '六',
  7: '日',
}

/** JS getDay（0=周日）→ 1..7（周一=1） */
function weekdayOf(date: Date): Weekday {
  const day = date.getDay()
  return (day === 0 ? 7 : day) as Weekday
}

export function ClassGrid({ onCreateCourse, onOpenCourse, onOpenTerm }: ClassGridProps) {
  useDataRevision()
  const now = useNow()
  const courses = getCourses()
  const term = getTerm()

  const currentWeek = weekOfTerm(term, now)
  const [viewWeek, setViewWeek] = useState<number | null>(() => weekOfTerm(getTerm(), new Date()))

  // 数据水合后 term 可能由 null 变为已设置：此时把视图对齐到当前周
  useEffect(() => {
    setViewWeek((prev) => (prev === null && currentWeek !== null ? currentWeek : prev))
  }, [currentWeek])

  const effectiveWeek = viewWeek ?? currentWeek
  const totalWeeks = term?.totalWeeks
  const todayDow = weekdayOf(now)

  const rows = useMemo(() => {
    let maxEnd = 0
    for (const course of courses) {
      for (const session of course.sessions) {
        if (sessionInWeek(session, effectiveWeek)) maxEnd = Math.max(maxEnd, session.endPeriod)
      }
    }
    return Math.max(10, maxEnd)
  }, [courses, effectiveWeek])

  const todayRuns = mergeDayRuns(courses, todayDow, currentWeek)
  const todayText =
    todayRuns.length === 0
      ? '今天无课'
      : `今天 · 周${WEEKDAY_CN[todayDow]}：${todayRuns
          .map((run) => {
            const place = run.location !== null ? ` · ${run.location}` : ''
            return `${formatPeriods({ startPeriod: run.startPeriod, endPeriod: run.endPeriod })} ${run.course.title}${place}`
          })
          .join('；')}`

  const isTodayCol = effectiveWeek === currentWeek
  const canPrev = effectiveWeek === null || effectiveWeek > 1
  const canNext = totalWeeks === undefined || effectiveWeek === null || effectiveWeek < totalWeeks

  const goPrev = (): void => {
    const base = effectiveWeek ?? 1
    setViewWeek(Math.max(1, base - 1))
  }
  const goNext = (): void => {
    const base = effectiveWeek ?? 1
    const next = base + 1
    setViewWeek(totalWeeks !== undefined ? Math.min(totalWeeks, next) : next)
  }
  const goThisWeek = (): void => setViewWeek(currentWeek)

  return (
    <section className="k-timetable">
      <div className="k-timetable__bar">
        <div className="k-timetable__headline">
          <h2 className="k-timetable__week">
            {term !== null ? `第 ${effectiveWeek ?? 1} 周` : '全部课程'}
          </h2>
          {term !== null ? (
            <div className="k-timetable__nav" role="group" aria-label="周次导航">
              <button
                type="button"
                className="k-iconbtn"
                aria-label="上一周"
                disabled={!canPrev}
                onClick={goPrev}
              >
                <ChevronLeft size={15} strokeWidth={1.5} aria-hidden />
              </button>
              <button type="button" className="k-btn k-btn--sm" onClick={goThisWeek}>
                本周
              </button>
              <button
                type="button"
                className="k-iconbtn"
                aria-label="下一周"
                disabled={!canNext}
                onClick={goNext}
              >
                <ChevronRight size={15} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
          ) : (
            <span className="k-timetable__notice">未设置学期（不按周过滤）</span>
          )}
        </div>
        <div className="k-timetable__actions">
          <button
            type="button"
            className={term === null ? 'k-btn k-btn--sm is-solid' : 'k-btn k-btn--sm'}
            onClick={onOpenTerm}
          >
            设置学期
          </button>
          <button
            type="button"
            className={term === null ? 'k-btn k-btn--sm' : 'k-btn k-btn--sm is-solid'}
            onClick={() => onCreateCourse()}
          >
            新建课程
          </button>
        </div>
      </div>

      <p className="k-timetable__today">{todayText}</p>

      {courses.length === 0 ? (
        <EmptyState
          title="还没有课程"
          hint="点「新建课程」录入课表；设置学期后可按周查看。"
          guide
          action={
            <button type="button" className="k-btn is-solid" onClick={() => onCreateCourse()}>
              新建课程
            </button>
          }
        />
      ) : (
        <div className="k-timetable__scroll">
          <div className="k-timetable__grid">
            <div className="k-timetable__corner" aria-hidden />
            {WEEKDAYS.map((day) => (
              <div
                key={day.value}
                className={
                  isTodayCol && day.value === todayDow
                    ? 'k-timetable__head is-today'
                    : 'k-timetable__head'
                }
              >
                {day.label}
              </div>
            ))}

            <div className="k-timetable__periodcol">
              {Array.from({ length: rows }, (_, i) => (
                <div key={i} className="k-timetable__period">{`第${i + 1}节`}</div>
              ))}
            </div>

            {WEEKDAYS.map((day) => (
              <div
                key={day.value}
                className={
                  isTodayCol && day.value === todayDow
                    ? 'k-timetable__col is-today'
                    : 'k-timetable__col'
                }
              >
                {Array.from({ length: rows }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    className="k-timetable__cell"
                    tabIndex={-1}
                    aria-hidden
                    onClick={() => onCreateCourse({ dayOfWeek: day.value, startPeriod: i + 1 })}
                  />
                ))}
                {mergeDayRuns(courses, day.value, effectiveWeek).map((run) => {
                  const span = run.endPeriod - run.startPeriod + 1
                  return (
                    <button
                      key={`${run.course.id}-${run.startPeriod}`}
                      type="button"
                      className="k-timetable__block"
                      style={{
                        top: `calc(${run.startPeriod - 1} * var(--sched-row-h) + 2px)`,
                        height: `calc(${span} * var(--sched-row-h) - 4px)`,
                      }}
                      title={`${formatWeeks(run.first.weeks)} · ${formatPeriods({
                        startPeriod: run.startPeriod,
                        endPeriod: run.endPeriod,
                      })}`}
                      onClick={() => onOpenCourse(run.course.id)}
                    >
                      <span className="k-timetable__block-title">{run.course.title}</span>
                      {run.location !== null && (
                        <span className="k-timetable__block-loc">@ {run.location}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
