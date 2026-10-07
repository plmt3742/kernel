// KERNEL · 任务详情弹窗（居中 · Slice K）
// 任务页与总览就地弹窗共用：同一份身体（TaskDetail / 编辑表单）+ 同一套操作
// （标记完成 / 取消完成 · 查看项目 · 编辑 · 删除），从此两处动作由构造保证一致。
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Modal } from '@/components/Modal'
import { TaskDetail } from '@/components/TaskDetail'
import {
  EntityEditForm,
  type EditFieldOption,
  type EditFieldSpec,
} from '@/components/EntityEditForm'
import { useToast } from '@/context/ToastContext'
import { getAreas, getProjectById, getSnapshot, getTags, getTaskById } from '@/lib/data'
import { isTaskDone, restoreEntity, trashEntity, undoPatchOf, updateEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import {
  ENERGY_LABEL,
  ENERGY_OPTIONS,
  IMPORTANCE_OPTIONS,
  importanceLabel,
  TASK_STATUS_LABEL,
} from '@/lib/format'
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

/**
 * 候选父任务（Slice R3）：仅未完成 / 未丢弃的任务，排除自身与全部后代（防环）。
 * 当前父项若不在候选中（如已完成）仍补入，保证编辑表单能正确回显。
 */
function parentTaskOptions(task: Task): EditFieldOption[] {
  const all = getSnapshot().tasks
  const childrenByParent = new Map<string, string[]>()
  for (const item of all) {
    if (item.parentTaskId === undefined) continue
    const arr = childrenByParent.get(item.parentTaskId) ?? []
    arr.push(item.id)
    childrenByParent.set(item.parentTaskId, arr)
  }
  const blocked = new Set<string>([task.id])
  const stack = [...(childrenByParent.get(task.id) ?? [])]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || blocked.has(id)) continue
    blocked.add(id)
    const kids = childrenByParent.get(id)
    if (kids !== undefined) stack.push(...kids)
  }
  const options: EditFieldOption[] = all
    .filter((item) => !blocked.has(item.id) && item.status !== 'done' && item.status !== 'dropped')
    .map((item) => ({ value: item.id, label: item.title }))
  if (task.parentTaskId !== undefined && !options.some((o) => o.value === task.parentTaskId)) {
    const current = all.find((item) => item.id === task.parentTaskId)
    if (current !== undefined) options.unshift({ value: current.id, label: current.title })
  }
  return options
}

export function TaskDetailModal({ taskId, onClose, onToggled }: TaskDetailModalProps) {
  useDataRevision()
  const { toast } = useToast()
  const toggleTask = useUndoableToggle()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // 子任务导航栈（Slice R3）：在当前弹窗内打开子任务，可逐级返回；切换根目标时清空
  const [navStack, setNavStack] = useState<string[]>([])

  useEffect(() => {
    setEditing(false)
    setNavStack([])
  }, [taskId])

  const activeId = navStack.length > 0 ? navStack[navStack.length - 1] : taskId
  const task = activeId !== null ? getTaskById(activeId) : undefined
  const done = task !== undefined && isTaskDone(task)
  const openChild = (id: string): void => setNavStack((prev) => [...prev, id])
  const goBack = (): void => setNavStack((prev) => prev.slice(0, -1))

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
      options: ENERGY_OPTIONS.map((value) => ({
        value,
        label: ENERGY_LABEL[value],
      })),
    },
    {
      key: 'importance',
      label: '重要性',
      type: 'select',
      numeric: true,
      options: IMPORTANCE_OPTIONS.map((n) => ({ value: String(n), label: importanceLabel(n) })),
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
    {
      key: 'parentTaskId',
      label: '父任务',
      type: 'select',
      clearable: true,
      options: task !== undefined ? parentTaskOptions(task) : [],
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
    const id = task.id
    // Slice Y · F36：保存前快照被改字段的原值，toast「撤销」回写即往返还原
    const undo = undoPatchOf(task as unknown as Record<string, unknown>, patch)
    setSaving(true)
    void (async () => {
      try {
        await updateEntity('tasks', id, patch)
        setEditing(false)
        toast('已保存', {
          action: {
            label: '撤销',
            onClick: () => {
              void updateEntity('tasks', id, undo).catch((err) => {
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
              {navStack.length > 0 && (
                <button type="button" className="k-btn" onClick={goBack}>
                  ← 返回
                </button>
              )}
              <button
                type="button"
                className={done ? 'k-btn' : 'k-btn is-solid'}
                onClick={handleToggle}
              >
                {done ? '取消完成' : '标记完成'}
              </button>
              {task.projectId !== undefined && getProjectById(task.projectId) !== undefined && (
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
          <TaskDetail task={task} onOpenTask={openChild} />
        ))}
    </Modal>
  )
}
