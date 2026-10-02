// KERNEL · 日程详情弹窗（居中 · Slice W，见 ADR-0018）
// 与 Task/Project/Note/Resource 详情同一套约定：同一份身体（只读网格 / 编辑表单）
// + 同一套操作（编辑 / 删除）+ 状态快捷切换（quiet segmented，复用 .k-lib__seg 轨道）。
// 日程为最末一个由只读转为可写的实体；状态流 tentative → confirmed → cancelled 由此可执行。
import { useEffect, useState } from 'react'
import { Modal } from '@/components/Modal'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { TagPill } from '@/components/TagPill'
import { Relations } from '@/components/Relations'
import { useToast } from '@/context/ToastContext'
import { getAreas, getAreaById, getEventById, getProjectById, getSnapshot } from '@/lib/data'
import { removeEvent, restoreEntity, updateEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { EVENT_STATUS_LABEL, tagLabel } from '@/lib/format'
import { formatFullDate, formatTime } from '@/lib/date'
import { useDataRevision } from '@/lib/hooks'
import type { EventStatus } from '@/types'

/** 状态展示 / 快捷切换顺序：待定 → 已确认 → 已取消（与 docs/04 §5.5 状态流一致） */
const STATUS_ORDER: EventStatus[] = ['confirmed', 'tentative', 'cancelled']

interface EventDetailModalProps {
  /** 目标日程 id；null 时弹窗关闭 */
  eventId: string | null
  /** 关闭：调用方负责同时清理深链参数（?event=） */
  onClose: () => void
}

export function EventDetailModal({ eventId, onClose }: EventDetailModalProps) {
  useDataRevision()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setEditing(false)
  }, [eventId])

  const event = eventId !== null ? getEventById(eventId) : undefined

  const eventFields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text' },
    { key: 'startAt', label: '开始', type: 'datetime' },
    { key: 'endAt', label: '结束（可选）', type: 'datetime' },
    { key: 'allDay', label: '全天', type: 'boolean' },
    {
      key: 'status',
      label: '状态',
      type: 'select',
      options: STATUS_ORDER.map((status) => ({
        value: status,
        label: EVENT_STATUS_LABEL[status],
      })),
    },
    { key: 'location', label: '地点', type: 'text', clearable: true },
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

  const handleSave = (patch: Record<string, unknown>): void => {
    if (event === undefined) return
    setSaving(true)
    void (async () => {
      try {
        await updateEntity('events', event.id, patch)
        setEditing(false)
        toast('已保存')
      } catch (err) {
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setSaving(false)
      }
    })()
  }

  const handleDelete = (): void => {
    if (event === undefined) return
    const id = event.id
    void (async () => {
      try {
        await removeEvent(id)
        onClose()
        toast('已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('events', id).catch((err) => {
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

  // 状态快捷切换（quiet segmented）：静默写入 → toast + 撤销回原状态
  const handleSetStatus = (status: EventStatus): void => {
    if (event === undefined || event.status === status) return
    const id = event.id
    const prev = event.status
    void (async () => {
      try {
        await updateEntity('events', id, { status })
        toast(`状态已设为「${EVENT_STATUS_LABEL[status]}」`, {
          action: {
            label: '撤销',
            onClick: () => {
              void updateEntity('events', id, { status: prev }).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`设置失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  return (
    <Modal
      open={event !== undefined}
      onClose={onClose}
      kicker={`日程 · ${event?.id ?? ''}`}
      title={event?.title ?? ''}
      className="k-modal--detail"
      footer={
        event !== undefined && !editing ? (
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
      {event !== undefined &&
        (editing ? (
          <EntityEditForm
            fields={eventFields}
            initial={event as unknown as Record<string, unknown>}
            saving={saving}
            onSubmit={handleSave}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <div className="k-detail-grid">
            {event.notes !== undefined && event.notes !== '' && (
              <div className="k-detail-block">
                <span className="k-detail-block__label u-label">备注</span>
                <p className="k-detail-note">{event.notes}</p>
              </div>
            )}
            <dl className="k-dl">
              <dt>时间</dt>
              <dd>
                {formatTime(event.startAt)}
                {event.endAt !== undefined ? `–${formatTime(event.endAt)}` : ''}
              </dd>
              <dt>日期</dt>
              <dd>{formatFullDate(event.startAt)}</dd>
              <dt>全天</dt>
              <dd>{event.allDay ? '是' : '否'}</dd>
              <dt>地点</dt>
              <dd>{event.location ?? '—'}</dd>
              <dt>状态</dt>
              <dd>{EVENT_STATUS_LABEL[event.status]}</dd>
              <dt>区域</dt>
              <dd>
                {event.areaId !== undefined
                  ? (getAreaById(event.areaId)?.title ?? event.areaId)
                  : '—'}
              </dd>
              <dt>项目</dt>
              <dd>
                {event.projectId !== undefined
                  ? (getProjectById(event.projectId)?.title ?? event.projectId)
                  : '—'}
              </dd>
            </dl>
            <StatusSegmented status={event.status} onSelect={handleSetStatus} />
            {event.tags.length > 0 && (
              <div className="k-detail-block">
                <span className="k-detail-block__label u-label">标签</span>
                <div className="k-hstack">
                  {event.tags.map((tag) => (
                    <TagPill key={tag}>{tagLabel(tag)}</TagPill>
                  ))}
                </div>
              </div>
            )}
            <Relations kind="event" id={event.id} />
          </div>
        ))}
    </Modal>
  )
}

/** 状态快捷切换：安静 segmented（复用 .k-lib__seg 轨道 + TagPill 选中反转） */
function StatusSegmented({
  status,
  onSelect,
}: {
  status: EventStatus
  onSelect: (status: EventStatus) => void
}) {
  return (
    <div className="k-detail-block k-quickset">
      <span className="k-detail-block__label u-label">状态 · 快捷切换</span>
      <div className="k-lib__seg k-quickset__seg" role="group" aria-label="日程状态">
        {STATUS_ORDER.map((value) => (
          <TagPill key={value} selected={value === status} onClick={() => onSelect(value)}>
            {EVENT_STATUS_LABEL[value]}
          </TagPill>
        ))}
      </div>
      <p className="k-quickset__hint k-muted">待定 → 已确认 → 已取消</p>
    </div>
  )
}
