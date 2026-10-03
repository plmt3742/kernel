// KERNEL · 课程新建「先确认后写入」弹窗（v0.5 · Slice H0）
// 流程：课表「新建课程」/ 点空格 → 本居中弹窗 → 全部字段可编辑 → 点「创建课程」才写入（无 AI）。
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { CourseForm, type CourseFormValues } from '@/components/CourseForm'
import { createCourse } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import type { Course, Weekday } from '@/types'

/** 新建预设：点某天某节空格时预填该时段 */
export interface CourseDraftPreset {
  dayOfWeek: Weekday
  startPeriod: number
}

interface CourseDraftModalProps {
  open: boolean
  /** 预填时段（缺省 周一 第1-2节） */
  preset?: CourseDraftPreset
  onClose: () => void
  onCreated: (course: Course) => void
}

export function CourseDraftModal({ open, preset, onClose, onCreated }: CourseDraftModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const startPeriod = preset?.startPeriod ?? 1
  const initial: CourseFormValues = {
    title: '',
    sessions: [
      {
        dayOfWeek: preset?.dayOfWeek ?? 1,
        startPeriod,
        // 节次上限 12：预填末节时不溢出
        endPeriod: Math.min(12, startPeriod + 1),
      },
    ],
  }

  const handleSubmit = (values: CourseFormValues): void => {
    setError('')
    setSaving(true)
    void (async () => {
      try {
        const created = await createCourse(values)
        setSaving(false)
        onCreated(created)
      } catch (err) {
        setError(`创建失败：${errorText(err)}`)
        setSaving(false)
      }
    })()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="新建课程 · 先确认后写入"
      title="新建课程"
      className="k-modal--compose"
    >
      <CourseForm
        initial={initial}
        saving={saving}
        submitLabel="创建课程"
        onSubmit={handleSubmit}
        onCancel={onClose}
      />
      {error !== '' && (
        <p className="k-ai-form__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
