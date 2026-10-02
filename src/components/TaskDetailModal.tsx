// KERNEL · 任务详情弹窗（居中 · Slice K）
// 任务页与总览就地弹窗共用：同一份身体（TaskDetail / 编辑表单）+ 同一套操作
// （标记完成 / 取消完成 · 查看项目 · 编辑 · 删除），从此两处动作由构造保证一致。
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '@/components/Modal'
import { TaskDetail } from '@/components/TaskDetail'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { useToast } from '@/context/ToastContext'
import { getAreas, getSnapshot, getTags, getTaskById } from '@/lib/data'
import { isTaskDone, restoreEntity, trashEntity, updateEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { ENERGY_LABEL, TASK_STATUS_LABEL } from '@/lib/format'
import { useDataRevision, useUndoableToggle } from '@/lib/hooks'
import type { Task } from '@/types'

interface TaskDetailModalProps {
  /** 目标任务 id；null 时弹窗关闭 */
  taskId: string | null
  /** 关闭：调用方负责同时清理深链参数（?task=） */
  onClose: () => void
  /** 完成切换后的通知（Tasks 页用于行塌缩动效）；wasDone = 切换前是否已完成 */
  onToggled?: (task: Task, wasDone: boolean) => void
}

export function TaskDetailModal({ taskId, onClose, onToggled }: TaskDetailModalProps) {
  useDataRevision()
  const { toast } = useToast()
  const toggleTask = useUndoableToggle()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // 切换目标时退出编辑态
  useEffect(() => {
    setEditing(false)
  }, [taskId])

  const task = taskId !== null ? getTaskById(taskId) : undefined
  const done = task !== undefined && isTaskDone(task)

  const contextNames = getTags()
    .filter((tag) => tag.namespace === 'context')
    .map((tag) => tag.name)

  const taskFields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text' },
    {
      key: 'status',
      label: '状态',
      type: 'select',
      options: (Object.keys(TASK_STATUS_LABEL) as Task['status'][]).map((value) => ({
        value,
        label: TASK_STATUS_LABEL[value],
      })),
    },
    {
      key: 'energy',
      label: '能量',
      type: 'select',
      options: (['low', 'medium', 'high'] as const).map((value) => ({
        value,
        label: ENERGY_LABEL[value],
      })),
    },
    {
      key: 'importance',
      label: '重要性',
      type: 'select',
      numeric: true,
      options: [0, 1, 2, 3].map((n) => ({ value: String(n), label: `${n} / 3` })),
    },
    {
      key: 'contexts',
      label: '上下文（逗号分隔）',
      type: 'list',
      placeholder: contextNames.join(', '),
    },
    { key: 'estimateMin', label: '预估（分钟）', type: 'number', clearable: true },
    { key: 'dueAt', label: '截止', type: 'datetime' },
    { key: 'deferUntil', label: '推迟至', type: 'datetime' },
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

  const handleToggle = (): void => {
    if (task === undefined) return
    const wasDone = toggleTask(task)
    onToggled?.(task, wasDone)
  }

  const handleSave = (patch: Record<string, unknown>): void => {
    if (task === undefined) return
    setSaving(true)
    void (async () => {
      try {
        await updateEntity('tasks', task.id, patch)
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
    if (task === undefined) return
    const id = task.id
    void (async () => {
      try {
        await trashEntity('tasks', id)
        onClose()
        toast('已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('tasks', id).catch((err) => {
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
      open={task !== undefined}
      onClose={onClose}
      kicker={`任务 · ${task?.id ?? ''}`}
      title={task?.title ?? ''}
      className="k-modal--detail"
      footer={
        task !== undefined && !editing ? (
          <>
            <div className="k-modal__foot-main">
              <button
                type="button"
                className={done ? 'k-btn' : 'k-btn is-solid'}
                onClick={handleToggle}
              >
                {done ? '取消完成' : '标记完成'}
              </button>
              {task.projectId !== undefined && (
                <Link
                  to={`/projects?project=${task.projectId}`}
                  viewTransition
                  className="k-btn"
                  onClick={onClose}
                >
                  查看项目
                </Link>
              )}
            </div>
            <div className="k-modal__foot-actions">
              <button type="button" className="k-btn k-btn--sm" onClick={() => setEditing(true)}>
                编辑
              </button>
              <button type="button" className="k-btn k-btn--sm is-danger" onClick={handleDelete}>
                删除
              </button>
            </div>
          </>
        ) : undefined
      }
    >
      {task !== undefined &&
        (editing ? (
          <EntityEditForm
            fields={taskFields}
            initial={task as unknown as Record<string, unknown>}
            saving={saving}
            onSubmit={handleSave}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <TaskDetail task={task} />
        ))}
    </Modal>
  )
}
