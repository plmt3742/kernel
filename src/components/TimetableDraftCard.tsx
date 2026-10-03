// KERNEL · 课表导入选择卡（v0.5 · Slice H1）
// 呈现 AI 从收件箱条目（xlsx / 截图 / 粘贴文本）提取的课程草稿：
//   · 逐行勾选（默认全选）+ 每门课程的时段明细（星期 / 节次 / 周次 / 地点）；
//   · 点「导入 N 门课程」才落盘（经 Inbox 的 importCourses）；「忽略」清空面板。
// 纪律：确认前绝不落盘；本组件只产出 onImport(selected)，勾选与导入态由父级承载。
// design system：与 .ic-ai / .ic-action 同一视觉语言，仅用 token 表面阶，无强调填充。
import { useState, type ReactNode } from 'react'
import { Checkbox } from '@/components/Checkbox'
import { formatPeriods, formatWeeks, weekdayLabel } from '@/lib/schedule'
import type { CourseCreateInput } from '@/lib/mutations'
import type { CourseSession } from '@/types'

interface TimetableDraftCardProps {
  courses: CourseCreateInput[]
  onImport: (selected: CourseCreateInput[]) => void
  onClear: () => void
  importing: boolean
}

/** 一条时段的安静明细：`周三 第3-4节 · 1–15 周（单） · 某教室` */
function sessionText(course: CourseCreateInput, session: CourseSession): string {
  const parts = [
    `${weekdayLabel(session.dayOfWeek)} ${formatPeriods(session)}`,
    formatWeeks(session.weeks),
  ]
  const location = session.location ?? course.location
  if (location !== undefined && location !== '') parts.push(location)
  return parts.join(' · ')
}

export function TimetableDraftCard({
  courses,
  onImport,
  onClear,
  importing,
}: TimetableDraftCardProps): ReactNode {
  // 勾选默认全选（与 AiActionsCard 的无条件默认纳入一致）
  const [included, setIncluded] = useState<boolean[]>(() => courses.map(() => true))
  const includedCount = included.filter(Boolean).length

  const toggle = (index: number): void => {
    setIncluded((prev) => prev.map((flag, i) => (i === index ? !flag : flag)))
  }

  const submit = (): void => {
    const selected = courses.filter((_, index) => included[index])
    if (selected.length === 0) return
    onImport(selected)
  }

  // 零识别优雅态（Slice H1.7）：未识别到课程时不渲染勾选列表与导入按钮，
  // 仅给安静说明 +「关闭」（onClear）；用户可改走「AI 解析」按资料归档或重试。
  if (courses.length === 0) {
    return (
      <div className="ic-tt">
        <div className="ic-tt__head">
          <span className="k-pill is-ghost">课表导入</span>
        </div>
        <p className="ic-tt__empty">未识别到课程 · 可点「AI 解析」按资料归档，或重试</p>
        <div className="ic-tt__foot">
          <button
            type="button"
            className="k-pill is-ghost"
            disabled={importing}
            onClick={onClear}
          >
            关闭
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="ic-tt">
      <div className="ic-tt__head">
        <span className="k-pill is-ghost">课表导入</span>
        <span className="ic-tt__title">识别到 {courses.length} 门课程 · 勾选后导入</span>
      </div>

      <ul className="ic-tt__list">
        {courses.map((course, index) => {
          const isIncluded = included[index]
          const meta: string[] = []
          if (course.teacher !== undefined && course.teacher !== '') meta.push(course.teacher)
          if (course.location !== undefined && course.location !== '') meta.push(course.location)
          return (
            <li
              className={isIncluded ? 'ic-tt__row' : 'ic-tt__row is-excluded'}
              key={`${course.title}-${index}`}
            >
              <div className="ic-tt__rowhead">
                <span className="ic-tt__checkbox">
                  <Checkbox
                    checked={isIncluded}
                    onToggle={() => toggle(index)}
                    label={`导入：${course.title}`}
                  />
                </span>
                <span className="ic-tt__course-title">{course.title}</span>
                {meta.length > 0 && <span className="ic-tt__meta">{meta.join(' · ')}</span>}
              </div>
              <ul className="ic-tt__sessions">
                {course.sessions.map((session, sessionIndex) => (
                  <li className="ic-tt__session" key={sessionIndex}>
                    {sessionText(course, session)}
                  </li>
                ))}
              </ul>
            </li>
          )
        })}
      </ul>

      <div className="ic-tt__foot">
        <button
          type="button"
          className="k-btn is-solid"
          disabled={includedCount === 0 || importing}
          onClick={submit}
        >
          导入 {includedCount} 门课程
        </button>
        <button type="button" className="k-pill is-ghost" disabled={importing} onClick={onClear}>
          忽略
        </button>
      </div>
    </div>
  )
}
