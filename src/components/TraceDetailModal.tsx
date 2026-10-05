// KERNEL · 踪迹详情弹窗（居中 · T6）
// 镜像 TaskDetailModal：同一份身体（阅读视图 / 编辑表单）+ 同一套操作（编辑 · 删除）。
// 另导出：TraceRefChip（区域 / 项目安静芯片）、TraceLightbox（图片灯箱），供踪迹页复用。
import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '@/components/Modal'
import { TagPill } from '@/components/TagPill'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { useToast } from '@/context/ToastContext'
import { getAreas, getProjects, getTraces, traceImageUrl } from '@/lib/data'
import { restoreEntity, trashEntity, undoPatchOf, updateEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { formatDateTime } from '@/lib/date'
import { tagLabel } from '@/lib/format'
import { deepLinkOfId } from '@/lib/relations'
import { useDataRevision } from '@/lib/hooks'
import type { Trace } from '@/types'

/** 踪迹图片灯箱目标（URL + 发生时间；时间用于标题） */
export interface TraceLightboxTarget {
  url: string
  at: string
}

/**
 * 区域 / 项目引用芯片：有深链则包一层 Link（点击不触发行弹窗），否则渲染静态 chip。
 * 深链口径与 Relations 一致（area → 设置页、project → 项目页）。
 */
export function TraceRefChip({ id, title }: { id: string; title: string }): ReactNode {
  const pill = <TagPill ghost>{title}</TagPill>
  const link = deepLinkOfId(id)
  if (link === null) return pill
  return (
    <Link
      to={link}
      viewTransition
      className="k-trace__ref"
      onClick={(event) => event.stopPropagation()}
    >
      {pill}
    </Link>
  )
}

/** 图片灯箱：复用 Modal（加宽变体），body 为单张 block 图；标题 / kicker 取自发生时间。 */
export function TraceLightbox({
  target,
  onClose,
}: {
  target: TraceLightboxTarget | null
  onClose: () => void
}): ReactNode {
  return (
    <Modal
      open={target !== null}
      onClose={onClose}
      kicker="踪迹图片"
      title={target !== null ? formatDateTime(target.at) : ''}
      className="k-modal--note"
    >
      {target !== null && (
        <div className="k-trace__lightbox">
          <img src={target.url} alt="" />
        </div>
      )}
    </Modal>
  )
}

interface TraceDetailModalProps {
  /** 目标踪迹 id；null 时弹窗关闭 */
  traceId: string | null
  /** 关闭：调用方负责同时清理深链参数（?trace=） */
  onClose: () => void
}

export function TraceDetailModal({ traceId, onClose }: TraceDetailModalProps): ReactNode {
  useDataRevision()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState<TraceLightboxTarget | null>(null)

  useEffect(() => {
    setEditing(false)
    setLightbox(null)
  }, [traceId])

  const trace: Trace | undefined =
    traceId !== null ? getTraces().find((item) => item.id === traceId) : undefined

  const fields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text' },
    { key: 'note', label: '补充', type: 'textarea', rows: 6 },
    { key: 'at', label: '时间', type: 'datetime' },
    { key: 'tags', label: '标签（逗号分隔）', type: 'list' },
    {
      key: 'areaId',
      label: '区域',
      type: 'select',
      clearable: true,
      options: getAreas().map((area) => ({ value: area.id, label: area.title })),
    },
    {
      key: 'projectId',
      label: '项目',
      type: 'select',
      clearable: true,
      options: getProjects().map((project) => ({ value: project.id, label: project.title })),
    },
  ]

  const handleSave = (patch: Record<string, unknown>): void => {
    if (trace === undefined) return
    const id = trace.id
    // 保存前快照被改字段的原值，toast「撤销」回写即往返还原（与 TaskDetailModal 同款）
    const undo = undoPatchOf(trace as unknown as Record<string, unknown>, patch)
    setSaving(true)
    void (async () => {
      try {
        await updateEntity('traces', id, patch)
        setEditing(false)
        toast('已保存', {
          action: {
            label: '撤销',
            onClick: () => {
              void updateEntity('traces', id, undo).catch((err) => {
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
    if (trace === undefined) return
    const id = trace.id
    void (async () => {
      try {
        await trashEntity('traces', id)
        onClose()
        toast('已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('traces', id).catch((err) => {
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

  const area =
    trace?.areaId !== undefined ? getAreas().find((item) => item.id === trace.areaId) : undefined
  const project =
    trace?.projectId !== undefined
      ? getProjects().find((item) => item.id === trace.projectId)
      : undefined
  const images = trace?.images ?? []

  return (
    <>
      <Modal
        open={trace !== undefined}
        onClose={onClose}
        kicker={`踪迹 · ${trace?.id ?? ''}`}
        title={trace?.title ?? ''}
        className="k-modal--detail"
        footer={
          trace !== undefined && !editing ? (
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
        {trace !== undefined &&
          (editing ? (
            <EntityEditForm
              fields={fields}
              initial={trace as unknown as Record<string, unknown>}
              saving={saving}
              onSubmit={handleSave}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="k-trace-detail">
              <p className="k-trace-detail__meta u-label">{formatDateTime(trace.at)}</p>
              {trace.note !== undefined && trace.note !== '' && (
                <p className="k-trace-detail__note">{trace.note}</p>
              )}
              {(trace.tags.length > 0 || area !== undefined || project !== undefined) && (
                <div className="k-trace-detail__tags">
                  {trace.tags.map((tag) => (
                    <TagPill key={tag}>{tagLabel(tag)}</TagPill>
                  ))}
                  {area !== undefined && <TraceRefChip id={area.id} title={area.title} />}
                  {project !== undefined && <TraceRefChip id={project.id} title={project.title} />}
                </div>
              )}
              {images.length > 0 && (
                <div className={`k-trace__imgs is-n${Math.min(images.length, 9)}`}>
                  {images.slice(0, 9).map((name) => (
                    <button
                      key={name}
                      type="button"
                      className="k-trace__imgbtn"
                      aria-label={`查看图片 ${name}`}
                      onClick={() => setLightbox({ url: traceImageUrl(name), at: trace.at })}
                    >
                      <img src={traceImageUrl(name)} alt="" loading="lazy" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))}
      </Modal>
      <TraceLightbox target={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}
