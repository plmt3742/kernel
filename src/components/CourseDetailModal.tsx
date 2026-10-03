// KERNEL · 课程详情弹窗（居中 · v0.5 · Slice H0）
// 与日程详情同一套约定：只读视图 / 内联编辑 + 编辑撤销（undoPatchOf）+ 删除入回收站（可撤销）。
import { useEffect, useState } from 'react'
import { Modal } from '@/components/Modal'
import { CourseForm, courseToFormValues, type CourseFormValues } from '@/components/CourseForm'
import { useToast } from '@/context/ToastContext'
import { getCourseById } from '@/lib/data'
import { removeCourse, restoreEntity, undoPatchOf, updateCourse } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { formatPeriods, formatWeeks } from '@/lib/schedule'
import { useDataRevision } from '@/lib/hooks'
import type { Weekday } from '@/types'

const WEEKDAY_LABEL: Record<Weekday, string> = {
  1: '周一',
  2: '周二',
  3: '周三',
  4: '周四',
  5: '周五',
  6: '周六',
  7: '周日',
}

interface CourseDetailModalProps {
  /** 目标课程 id；null 时弹窗关闭 */
  courseId: string | null
  onClose: () => void
}

export function CourseDetailModal({ courseId, onClose }: CourseDetailModalProps) {
  useDataRevision()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditing(false)
  }, [courseId])

  const course = courseId !== null ? getCourseById(courseId) : undefined

  const handleSave = (values: CourseFormValues): void => {
    if (course === undefined) return
    const id = course.id
    // 编辑：空可选字段显式写 null（服务端清除语义），保证「清空教师 / 地点 / 备注」可落盘
    const patch: Record<string, unknown> = {
      title: values.title,
      sessions: values.sessions,
      teacher: values.teacher ?? null,
      location: values.location ?? null,
      notes: values.notes ?? null,
    }
    const undo = undoPatchOf(course as unknown as Record<string, unknown>, patch)
    setSaving(true)
    void (async () => {
      try {
        await updateCourse(id, patch)
        setEditing(false)
        toast('已保存', {
          action: {
            label: '撤销',
            onClick: () => {
              void updateCourse(id, undo).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setSaving(false)
      }
    })()
  }

  const handleDelete = (): void => {
    if (course === undefined) return
    const id = course.id
    void (async () => {
      try {
        await removeCourse(id)
        onClose()
        toast('已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('courses', id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`删除失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  return (
    <Modal
      open={course !== undefined}
      onClose={onClose}
      kicker={`课程 · ${course?.id ?? ''}`}
      title={course?.title ?? ''}
      className="k-modal--detail"
      footer={
        course !== undefined && !editing ? (
          <div className="k-modal__foot-actions">
            <button type="button" className="k-btn k-btn--sm" onClick={() => setEditing(true)}>
              编辑
            </button>
            <button type="button" className="k-btn k-btn--sm is-danger" onClick={handleDelete}>
              删除
            </button>
          </div>
        ) : undefined
      }
    >
      {course !== undefined &&
        (editing ? (
          <CourseForm
            initial={courseToFormValues(course)}
            saving={saving}
            submitLabel="保存"
            onSubmit={handleSave}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="k-detail-grid">
            {course.notes !== undefined && course.notes !== '' && (
              <div className="k-detail-block">
                <span className="k-detail-block__label u-label">备注</span>
                <p className="k-detail-note">{course.notes}</p>
              </div>
            )}
            <dl className="k-dl">
              <dt>教师</dt>
              <dd>{course.teacher ?? '—'}</dd>
              <dt>默认地点</dt>
              <dd>{course.location ?? '—'}</dd>
            </dl>
            <div className="k-detail-block">
              <span className="k-detail-block__label u-label">上课时段</span>
              <ul className="k-timetable-detail__sessions">
                {course.sessions.map((session, index) => (
                  <li className="k-timetable-detail__session" key={index}>
                    <span className="k-timetable-detail__when">
                      {WEEKDAY_LABEL[session.dayOfWeek]} · {formatPeriods(session)}
                    </span>
                    <span className="k-timetable-detail__weeks">{formatWeeks(session.weeks)}</span>
                    <span className="k-timetable-detail__loc">
                      {session.location ?? course.location ?? '—'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ))}
    </Modal>
  )
}
