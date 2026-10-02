// KERNEL · 项目详情弹窗（居中 · Slice K）
// 项目页与总览就地弹窗共用：同一份身体（ProjectDetail / 编辑表单）+ 同一套操作
// （编辑 · 删除），两处动作由构造保证一致。
import { useEffect, useState } from 'react'
import { Modal } from '@/components/Modal'
import { ProjectDetail } from '@/components/ProjectDetail'
import { TaskDetailModal } from '@/components/TaskDetailModal'
import { TaskDraftModal } from '@/components/TaskDraftModal'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { useToast } from '@/context/ToastContext'
import { getAreas, getProjectById, getSnapshot } from '@/lib/data'
import { restoreEntity, trashEntity, updateEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { PROJECT_STATUS_LABEL } from '@/lib/format'
import { useDataRevision, useUndoableToggle } from '@/lib/hooks'
import type { Project, Task } from '@/types'

/**
 * 项目弹窗内的覆盖层（Slice R3）：二选一——打开某任务详情，或「添加任务到本项目」草稿。
 * 采用**替换**呈现（覆盖层出现时项目弹窗退场，关闭后回归项目），复用既有 TaskDetailModal /
 * TaskDraftModal 全部动作与「先确认后写入」纪律，避免叠加弹窗的 ESC / 焦点争用。
 */
type Overlay = { kind: 'task'; id: string } | { kind: 'draft'; title: string } | null

interface ProjectDetailModalProps {
  /** 目标项目 id；null 时弹窗关闭 */
  projectId: string | null
  /** 关闭：调用方负责同时清理深链参数（?project=） */
  onClose: () => void
}

export function ProjectDetailModal({ projectId, onClose }: ProjectDetailModalProps) {
  useDataRevision()
  const toggleTask = useUndoableToggle()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // 内嵌覆盖层：任务详情 / 添加任务草稿（Slice R3）
  const [overlay, setOverlay] = useState<Overlay>(null)

  // 切换目标时退出编辑态与覆盖层
  useEffect(() => {
    setEditing(false)
    setOverlay(null)
  }, [projectId])

  const project = projectId !== null ? getProjectById(projectId) : undefined

  const handleTaskCreated = (task: Task): void => {
    setOverlay(null)
    toast(`已在本项目创建任务「${task.title}」`, {
      action: {
        label: '撤销',
        onClick: () => {
          void trashEntity('tasks', task.id).catch((err) => {
            toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
          })
        },
      },
    })
  }

  const projectFields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text' },
    { key: 'outcome', label: '完成定义', type: 'textarea' },
    {
      key: 'status',
      label: '状态',
      type: 'select',
      options: (Object.keys(PROJECT_STATUS_LABEL) as Project['status'][]).map((value) => ({
        value,
        label: PROJECT_STATUS_LABEL[value],
      })),
    },
    {
      key: 'areaId',
      label: '区域',
      type: 'select',
      clearable: true,
      options: getAreas().map((area) => ({ value: area.id, label: area.title })),
    },
    {
      key: 'nextActionId',
      label: '下一步',
      type: 'select',
      clearable: true,
      options: getSnapshot()
        .tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped')
        .map((task) => ({ value: task.id, label: task.title })),
    },
    {
      key: 'goalId',
      label: '目标',
      type: 'select',
      clearable: true,
      options: getSnapshot().goals.map((goal) => ({ value: goal.id, label: goal.title })),
    },
    { key: 'dueAt', label: '截止', type: 'datetime' },
    { key: 'tags', label: '标签（逗号分隔）', type: 'list' },
  ]

  const handleSave = (patch: Record<string, unknown>): void => {
    if (project === undefined) return
    setSaving(true)
    void (async () => {
      try {
        await updateEntity('projects', project.id, patch)
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
    if (project === undefined) return
    const id = project.id
    void (async () => {
      try {
        await trashEntity('projects', id)
        onClose()
        toast('已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('projects', id).catch((err) => {
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
    <>
      <Modal
        open={project !== undefined && overlay === null}
        onClose={onClose}
        kicker={
          project !== undefined
            ? `项目 · ${project.id} · ${PROJECT_STATUS_LABEL[project.status]}`
            : ''
        }
        title={project?.title ?? ''}
        className="k-modal--detail"
        footer={
          project !== undefined && !editing ? (
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
        {project !== undefined &&
          (editing ? (
            <EntityEditForm
              fields={projectFields}
              initial={project as unknown as Record<string, unknown>}
              saving={saving}
              onSubmit={handleSave}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <ProjectDetail
              project={project}
              onToggleTask={toggleTask}
              onOpenTask={(id) => setOverlay({ kind: 'task', id })}
              onQuickAddTask={(title) => setOverlay({ kind: 'draft', title })}
            />
          ))}
      </Modal>

      {/* 内嵌覆盖层：任务详情（复用全站动作 + 子任务导航）*/}
      <TaskDetailModal
        taskId={overlay?.kind === 'task' ? overlay.id : null}
        onClose={() => setOverlay(null)}
      />

      {/* 内嵌覆盖层：添加任务草稿确认（项目预填，确认前零落盘）*/}
      <TaskDraftModal
        open={overlay?.kind === 'draft'}
        initialTitle={overlay?.kind === 'draft' ? overlay.title : ''}
        initialProjectId={project?.id}
        onClose={() => setOverlay(null)}
        onCreated={handleTaskCreated}
      />
    </>
  )
}
