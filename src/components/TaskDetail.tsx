// KERNEL · 任务详情渲染（备注 / 字段网格 / 标签 / 子任务 / 关联）
// 任务抽屉（Tasks 页）与总览「就地弹窗」（Overview）共用，避免字段逻辑重复。
// Slice R3：新增「子任务」区块——列出直接子任务（点击 → 打开其详情）+ 安静 quick-add
//   （回车即建，继承父任务的 projectId；toast 可撤销）。
import { useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import { TagPill } from '@/components/TagPill'
import { Relations } from '@/components/Relations'
import { useToast } from '@/context/ToastContext'
import { getAreaById, getChildTasks, getProjectById } from '@/lib/data'
import { createTask, isTaskDone, trashEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { ENERGY_LABEL, TASK_STATUS_LABEL, tagLabel } from '@/lib/format'
import { formatDateTime, formatRelative, humanizeDay } from '@/lib/date'
import type { Task } from '@/types'
import { clsx } from 'clsx'

interface TaskDetailProps {
  task: Task
  /** 点击子任务 → 在当前弹窗内打开其详情（Slice R3；缺省时仍列出但不可点） */
  onOpenTask?: (id: string) => void
}

export function TaskDetail({ task, onOpenTask }: TaskDetailProps) {
  return (
    <div className="k-detail-grid">
      {/* 主内容区：可读内容（备注）优先；无备注则不渲染，不造假数据 */}
      {task.notes !== undefined && (
        <div className="k-detail-block">
          <span className="k-detail-block__label u-label">备注</span>
          <p className="k-detail-note">{task.notes}</p>
        </div>
      )}
      {/* 元数据区：2 列紧凑字段网格（dt/dd 成对） */}
      <dl className="k-dl">
        <dt>状态</dt>
        <dd>{TASK_STATUS_LABEL[task.status]}</dd>
        <dt>能量</dt>
        <dd>{ENERGY_LABEL[task.energy]}</dd>
        <dt>重要性</dt>
        <dd>{task.importance} / 3</dd>
        <dt>上下文</dt>
        <dd>{task.contexts.map(tagLabel).join(' · ') || '—'}</dd>
        <dt>区域</dt>
        <dd>
          {task.areaId !== undefined ? (getAreaById(task.areaId)?.title ?? task.areaId) : '—'}
        </dd>
        <dt>项目</dt>
        <dd>
          {task.projectId !== undefined
            ? (getProjectById(task.projectId)?.title ?? task.projectId)
            : '—'}
        </dd>
        <dt>截止</dt>
        <dd>
          {task.dueAt !== undefined
            ? `${formatDateTime(task.dueAt)} · ${humanizeDay(task.dueAt)}`
            : '—'}
        </dd>
        {/* 推迟至（Slice Y · F18）：仅设置时显示；编辑仍在编辑表单内 */}
        {task.deferUntil !== undefined && (
          <>
            <dt>推迟至</dt>
            <dd>
              {`${formatDateTime(task.deferUntil)} · ${humanizeDay(task.deferUntil)}`}
            </dd>
          </>
        )}
        <dt>预估</dt>
        <dd>{task.estimateMin !== undefined ? `${task.estimateMin} 分钟` : '—'}</dd>
        <dt>创建</dt>
        <dd>{formatRelative(task.createdAt)}</dd>
      </dl>
      {/* 标签区：主内容之后扫描 */}
      {task.tags.length > 0 && (
        <div className="k-detail-block">
          <span className="k-detail-block__label u-label">标签</span>
          <div className="k-hstack">
            {task.tags.map((tag) => (
              <TagPill key={tag}>{tagLabel(tag)}</TagPill>
            ))}
          </div>
        </div>
      )}
      <SubtaskSection task={task} onOpenTask={onOpenTask} />
      <Relations kind="task" id={task.id} />
    </div>
  )
}

/**
 * 子任务区块（Slice R3）：直接子任务列表 + 安静 quick-add。
 * 列表随数据版本刷新（TaskDetailModal 已订阅 revision）；点击子任务在当前弹窗内打开其详情。
 * quick-add 回车即建：继承父任务 projectId（其余走默认），toast 提供「撤销」（移入回收站）。
 */
function SubtaskSection({
  task,
  onOpenTask,
}: {
  task: Task
  onOpenTask?: (id: string) => void
}) {
  const { toast } = useToast()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const children = getChildTasks(task.id)

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const value = title.trim()
    if (value === '' || busy) return
    setBusy(true)
    void (async () => {
      try {
        // 继承父任务的项目归属（Slice R3）；其余字段走服务端默认
        const created = await createTask({
          title: value,
          parentTaskId: task.id,
          ...(task.projectId !== undefined ? { projectId: task.projectId } : {}),
        })
        setTitle('')
        toast(`已添加子任务「${created.title}」`, {
          action: {
            label: '撤销',
            onClick: () => {
              void trashEntity('tasks', created.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`添加失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <div className="k-detail-block">
      <span className="k-detail-block__label u-label">子任务 · {children.length}</span>
      {children.length > 0 && (
        <ul className="k-subtasks">
          {children.map((child) => (
            <li key={child.id}>
              <button
                type="button"
                className="k-subtask"
                onClick={() => onOpenTask?.(child.id)}
                aria-label={`查看子任务：${child.title}`}
                disabled={onOpenTask === undefined}
              >
                <span className={clsx('k-subtask__title', isTaskDone(child) && 'is-done')}>
                  {child.title}
                </span>
                <span className="k-subtask__meta u-label">{TASK_STATUS_LABEL[child.status]}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form className="k-inline-add" onSubmit={submit}>
        <Plus size={14} strokeWidth={1.5} className="k-muted" aria-hidden />
        <input
          className="k-inline-add__input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="添加子任务，回车创建"
          aria-label="添加子任务"
          disabled={busy}
        />
      </form>
    </div>
  )
}
