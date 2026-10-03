// KERNEL · 课程表单（v0.5 · Slice H0）
// 新建 / 编辑共用：课程名* / 教师 / 默认地点 / 备注 + 时段编辑器（星期 · 起止节次 · 周次）。
// 提交前校验：课程名非空、至少一个时段、周次可解析、结束节次 ≥ 开始节次（行内安静错误）。
import { Fragment, useId, useState, type FormEvent } from 'react'
import { Trash2 } from 'lucide-react'
import { WEEKS_FORMAT_ERROR, parseWeeksInput } from '@/lib/schedule'
import type { Course, CourseSession, Weekday } from '@/types'

/** 表单产出值（与课程创建入参同形；空可选字段缺省） */
export interface CourseFormValues {
  title: string
  teacher?: string
  location?: string
  sessions: CourseSession[]
  notes?: string
}

interface CourseFormProps {
  /** 编辑时的现有值（新建留空） */
  initial?: CourseFormValues
  saving: boolean
  submitLabel: string
  onSubmit: (values: CourseFormValues) => void
  onCancel: () => void
}

/** 星期选项（1..7） */
const WEEKDAY_OPTIONS: Array<{ value: Weekday; label: string }> = [
  { value: 1, label: '周一' },
  { value: 2, label: '周二' },
  { value: 3, label: '周三' },
  { value: 4, label: '周四' },
  { value: 5, label: '周五' },
  { value: 6, label: '周六' },
  { value: 7, label: '周日' },
]

const PERIOD_OPTIONS = Array.from({ length: 12 }, (_, i) => i + 1)

/** 表单内时段草稿：周次保持文本，提交时才解析 */
interface SessionDraft {
  dayOfWeek: Weekday
  startPeriod: number
  endPeriod: number
  weeks: string
}

/** 周次数组 → 可回填的紧凑文本（连续压缩为 A-B；可被 parseWeeksInput 往返解析） */
function weeksToInput(weeks: number[]): string {
  const sorted = [...new Set(weeks)].sort((a, b) => a - b)
  if (sorted.length === 0) return ''
  const parts: string[] = []
  let start = sorted[0]
  let prev = sorted[0]
  for (let i = 1; i < sorted.length; i += 1) {
    const week = sorted[i]
    if (week === prev + 1) {
      prev = week
      continue
    }
    parts.push(start === prev ? String(start) : `${start}-${prev}`)
    start = week
    prev = week
  }
  parts.push(start === prev ? String(start) : `${start}-${prev}`)
  return parts.join(',')
}

function toDraft(session: CourseSession): SessionDraft {
  return {
    dayOfWeek: session.dayOfWeek,
    startPeriod: session.startPeriod,
    endPeriod: session.endPeriod,
    weeks: session.weeks !== undefined && session.weeks.length > 0 ? weeksToInput(session.weeks) : '',
  }
}

/** 由已有课程构造表单初值 */
export function courseToFormValues(course: Course): CourseFormValues {
  return {
    title: course.title,
    ...(course.teacher !== undefined ? { teacher: course.teacher } : {}),
    ...(course.location !== undefined ? { location: course.location } : {}),
    sessions: course.sessions.map((session) => ({ ...session })),
    ...(course.notes !== undefined ? { notes: course.notes } : {}),
  }
}

const EMPTY_DRAFT: SessionDraft = { dayOfWeek: 1, startPeriod: 1, endPeriod: 2, weeks: '' }

export function CourseForm({ initial, saving, submitLabel, onSubmit, onCancel }: CourseFormProps) {
  const uid = useId()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [teacher, setTeacher] = useState(initial?.teacher ?? '')
  const [location, setLocation] = useState(initial?.location ?? '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [drafts, setDrafts] = useState<SessionDraft[]>(() =>
    initial !== undefined && initial.sessions.length > 0
      ? initial.sessions.map(toDraft)
      : [{ ...EMPTY_DRAFT }],
  )
  const [formError, setFormError] = useState('')
  const [rowErrors, setRowErrors] = useState<Record<number, string>>({})

  const updateDraft = (index: number, patch: Partial<SessionDraft>): void => {
    setDrafts((prev) => prev.map((draft, i) => (i === index ? { ...draft, ...patch } : draft)))
    setRowErrors((prev) => {
      if (prev[index] === undefined) return prev
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  const addDraft = (): void => setDrafts((prev) => [...prev, { ...EMPTY_DRAFT }])

  const removeDraft = (index: number): void => {
    setDrafts((prev) => prev.filter((_, i) => i !== index))
    setRowErrors({})
  }

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const trimmedTitle = title.trim()
    if (trimmedTitle === '') {
      setFormError('课程名不能为空')
      return
    }
    if (drafts.length === 0) {
      setFormError('至少添加一个上课时段')
      return
    }

    const nextRowErrors: Record<number, string> = {}
    const sessions: CourseSession[] = []
    drafts.forEach((draft, index) => {
      if (draft.endPeriod < draft.startPeriod) {
        nextRowErrors[index] = '结束节次不能早于开始节次'
        return
      }
      let weeks: number[] | undefined
      try {
        weeks = parseWeeksInput(draft.weeks)
      } catch (err) {
        nextRowErrors[index] = err instanceof Error ? err.message : WEEKS_FORMAT_ERROR
        return
      }
      sessions.push({
        dayOfWeek: draft.dayOfWeek,
        startPeriod: draft.startPeriod,
        endPeriod: draft.endPeriod,
        ...(weeks !== undefined ? { weeks } : {}),
      })
    })

    if (Object.keys(nextRowErrors).length > 0) {
      setRowErrors(nextRowErrors)
      setFormError('')
      return
    }

    setFormError('')
    setRowErrors({})
    const trimmedNotes = notes.trim() === '' ? undefined : notes
    onSubmit({
      title: trimmedTitle,
      ...(teacher.trim() !== '' ? { teacher: teacher.trim() } : {}),
      ...(location.trim() !== '' ? { location: location.trim() } : {}),
      sessions,
      ...(trimmedNotes !== undefined ? { notes: trimmedNotes } : {}),
    })
  }

  return (
    <form className="k-form k-timetable-form" onSubmit={handleSubmit}>
      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={`${uid}-title`}>
          课程名 *
        </label>
        <input
          id={`${uid}-title`}
          className="k-input"
          value={title}
          placeholder="如：高等数学"
          onChange={(event) => setTitle(event.target.value)}
        />
      </div>
      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={`${uid}-teacher`}>
          教师
        </label>
        <input
          id={`${uid}-teacher`}
          className="k-input"
          value={teacher}
          placeholder="如：张老师"
          onChange={(event) => setTeacher(event.target.value)}
        />
      </div>
      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={`${uid}-location`}>
          默认地点
        </label>
        <input
          id={`${uid}-location`}
          className="k-input"
          value={location}
          placeholder="如：某教室"
          onChange={(event) => setLocation(event.target.value)}
        />
      </div>

      <fieldset className="k-timetable-form__sessions">
        <legend className="k-field__label u-label">上课时段</legend>
        <div className="k-timetable-form__head" aria-hidden>
          <span>星期</span>
          <span>开始</span>
          <span>结束</span>
          <span>周次</span>
          <span />
        </div>
        {drafts.map((draft, index) => (
          <Fragment key={index}>
            <div className="k-timetable-form__row">
              <select
                className="k-select"
                value={draft.dayOfWeek}
                aria-label={`时段 ${index + 1} 星期`}
                onChange={(event) =>
                  updateDraft(index, { dayOfWeek: Number(event.target.value) as Weekday })
                }
              >
                {WEEKDAY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <select
                className="k-select"
                value={draft.startPeriod}
                aria-label={`时段 ${index + 1} 开始节次`}
                onChange={(event) => updateDraft(index, { startPeriod: Number(event.target.value) })}
              >
                {PERIOD_OPTIONS.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
              <select
                className="k-select"
                value={draft.endPeriod}
                aria-label={`时段 ${index + 1} 结束节次`}
                onChange={(event) => updateDraft(index, { endPeriod: Number(event.target.value) })}
              >
                {PERIOD_OPTIONS.map((period) => (
                  <option key={period} value={period}>
                    {period}
                  </option>
                ))}
              </select>
              <input
                className="k-input"
                value={draft.weeks}
                placeholder="留空=每周，如 1-16 / 1-16单 / 1-8,10-16"
                aria-label={`时段 ${index + 1} 周次`}
                onChange={(event) => updateDraft(index, { weeks: event.target.value })}
              />
              <button
                type="button"
                className="k-iconbtn k-timetable-form__del"
                aria-label={`删除时段 ${index + 1}`}
                onClick={() => removeDraft(index)}
              >
                <Trash2 size={15} strokeWidth={1.5} aria-hidden />
              </button>
            </div>
            {rowErrors[index] !== undefined && (
              <p className="k-timetable-form__error" role="alert">
                {rowErrors[index]}
              </p>
            )}
          </Fragment>
        ))}
        <button type="button" className="k-btn k-btn--sm" onClick={addDraft}>
          添加时段
        </button>
      </fieldset>

      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={`${uid}-notes`}>
          备注
        </label>
        <textarea
          id={`${uid}-notes`}
          className="k-textarea"
          rows={3}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      {formError !== '' && (
        <p className="k-timetable-form__error" role="alert">
          {formError}
        </p>
      )}

      <div className="k-form__actions">
        <button type="submit" className="k-btn is-solid" disabled={saving}>
          {saving ? '保存中…' : submitLabel}
        </button>
        <button type="button" className="k-btn" onClick={onCancel} disabled={saving}>
          取消
        </button>
      </div>
    </form>
  )
}
