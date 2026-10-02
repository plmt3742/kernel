// KERNEL · 日程新建「先确认后写入」弹窗（v0.5 · Slice W，见 ADR-0018）
// 流程：日历「新建日程」→ 本居中弹窗 → 全部字段可编辑 → 点「创建日程」才写入（无 AI）。
// 复用 EntityEditForm（同一套字段组件 / token）；预填开始时刻来自日历选中日或今天。
import { useState } from 'react'
import { Modal } from '@/components/Modal'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { createEvent } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { getAreas, getSnapshot } from '@/lib/data'
import { EVENT_STATUS_LABEL } from '@/lib/format'
import { toDate } from '@/lib/date'
import type { CalendarEvent, EventStatus } from '@/types'

/** 新建仅提供 已确认 / 待定（「已取消」经详情状态切换生效） */
const CREATE_STATUSES: EventStatus[] = ['confirmed', 'tentative']

interface EventDraftModalProps {
  open: boolean
  /** 预填开始时刻（ISO 8601；来自日历选中日或今天） */
  initialStartAt: string
  onClose: () => void
  onCreated: (event: CalendarEvent) => void
}

export function EventDraftModal({
  open,
  initialStartAt,
  onClose,
  onCreated,
}: EventDraftModalProps) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const fields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text', placeholder: '如：学生组织例会' },
    { key: 'startAt', label: '开始', type: 'datetime' },
    { key: 'endAt', label: '结束（可选）', type: 'datetime' },
    { key: 'allDay', label: '全天', type: 'boolean' },
    {
      key: 'status',
      label: '状态',
      type: 'select',
      options: CREATE_STATUSES.map((status) => ({
        value: status,
        label: EVENT_STATUS_LABEL[status],
      })),
    },
    { key: 'location', label: '地点', type: 'text', placeholder: '如：6A-301 / 线上' },
    {
      key: 'projectId',
      label: '项目',
      type: 'select',
      clearable: true,
      options: getSnapshot().projects.map((project) => ({
        value: project.id,
        label: project.title,
      })),
    },
    {
      key: 'areaId',
      label: '区域',
      type: 'select',
      clearable: true,
      options: getAreas().map((area) => ({ value: area.id, label: area.title })),
    },
    { key: 'tags', label: '标签（逗号分隔）', type: 'list' },
    { key: 'notes', label: '备注', type: 'textarea' },
  ]

  const initial: Record<string, unknown> = {
    title: '',
    startAt: initialStartAt,
    endAt: '',
    allDay: false,
    status: 'confirmed',
    location: '',
    projectId: '',
    areaId: '',
    tags: [],
    notes: '',
  }

  const handleSubmit = (patch: Record<string, unknown>): void => {
    const title = typeof patch.title === 'string' ? patch.title.trim() : ''
    if (title === '') {
      setError('标题不能为空')
      return
    }
    const startAt = typeof patch.startAt === 'string' ? patch.startAt : ''
    if (startAt === '') {
      setError('请填写开始时间')
      return
    }
    const endAt = typeof patch.endAt === 'string' ? patch.endAt : undefined
    if (endAt !== undefined && toDate(endAt).getTime() < toDate(startAt).getTime()) {
      setError('结束时间不能早于开始时间')
      return
    }
    setError('')
    setSaving(true)
    void (async () => {
      try {
        const created = await createEvent({
          title,
          startAt,
          ...(endAt !== undefined ? { endAt } : {}),
          allDay: patch.allDay === true,
          status: CREATE_STATUSES.includes(patch.status as EventStatus)
            ? (patch.status as EventStatus)
            : 'confirmed',
          ...(typeof patch.location === 'string' && patch.location.trim() !== ''
            ? { location: patch.location.trim() }
            : {}),
          ...(typeof patch.projectId === 'string' && patch.projectId !== ''
            ? { projectId: patch.projectId }
            : {}),
          ...(typeof patch.areaId === 'string' && patch.areaId !== ''
            ? { areaId: patch.areaId }
            : {}),
          ...(Array.isArray(patch.tags) ? { tags: patch.tags.map(String) } : {}),
          ...(typeof patch.notes === 'string' && patch.notes.trim() !== ''
            ? { notes: patch.notes }
            : {}),
        })
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
      kicker="新建日程 · 先确认后写入"
      title="新建日程"
      className="k-modal--compose"
    >
      <EntityEditForm
        fields={fields}
        initial={initial}
        saving={saving}
        submitLabel="创建日程"
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
