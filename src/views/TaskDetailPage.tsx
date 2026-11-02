// KERNEL · 任务详情页（GitHub issue 式：面包屑 / 描述 / 子任务 / 关联 / 右侧元数据）
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { Checkbox } from '@/components/Checkbox'
import { Relations } from '@/components/Relations'
import { TaskDetailModal } from '@/components/TaskDetailModal'
import { PageHeader } from '@/components/shell/PageHeader'
import { useToast } from '@/context/ToastContext'
import {
  getAreaById,
  getChildTasks,
  getProjectById,
  getTaskById,
} from '@/lib/data'
import { createTask, restoreEntity, trashEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision, useUndoableToggle } from '@/lib/hooks'
import { ENERGY_LABEL, importanceLabel, TASK_STATUS_LABEL, tagLabel } from '@/lib/format'
import { formatDateTime, formatRelative, humanizeDay, isPast } from '@/lib/date'

const TABS = ['overview', 'subtasks', 'relations'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | undefined): value is Tab {
  return value !== undefined && (TABS as readonly string[]).includes(value)
}

export function TaskDetailPage() {
  useDataRevision()
  const { id, tab } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const toggleTask = useUndoableToggle()
  const [editing, setEditing] = useState(false)
  const [subtaskTitle, setSubtaskTitle] = useState('')
  const task = id !== undefined ? getTaskById(id) : undefined

  if (task === undefined) {
    return (
      <div className="gh-page">
        <PageHeader
          breadcrumb={[{ label: 'KERNEL', to: '/' }, { label: '任务', to: '/tasks' }, { label: '未找到' }]}
          title="任务不存在"
          description="它可能已被删除，或链接已失效。"
        />
        <Link to="/tasks" className="gh-btn">
          返回任务列表
        </Link>
      </div>
    )
  }

  const activeTab: Tab = isTab(tab) ? tab : 'overview'
  const done = task.status === 'done'
  const project = task.projectId !== undefined ? getProjectById(task.projectId) : undefined
  const area = task.areaId !== undefined ? getAreaById(task.areaId) : undefined
  const subtasks = getChildTasks(task.id)
  const overdue = task.dueAt !== undefined && !done && isPast(task.dueAt)

  const removeTask = (): void => {
    void (async () => {
      try {
        await trashEntity('tasks', task.id)
        navigate('/tasks')
        toast('任务已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('tasks', task.id).catch((err) => {
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

  const addSubtask = (): void => {
    const title = subtaskTitle.trim()
    if (title === '') return
    void (async () => {
      try {
        const created = await createTask({
          title,
          parentTaskId: task.id,
          projectId: task.projectId,
          areaId: task.areaId,
          ai: false,
        })
        setSubtaskTitle('')
        toast('已添加子任务 · 撤销', {
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
      }
    })()
  }

  return (
    <div className="gh-page">
      <PageHeader
        breadcrumb={[
          { label: 'KERNEL', to: '/' },
          { label: '任务', to: '/tasks' },
          { label: task.title },
        ]}
        title={task.title}
        description={task.notes !== undefined && task.notes.trim() !== '' ? task.notes.split('\n')[0] : undefined}
        meta={
          <>
            <b>{TASK_STATUS_LABEL[task.status]}</b>
            <span>{task.dueAt !== undefined ? humanizeDay(task.dueAt) : '无截止'}</span>
          </>
        }
        actions={
          <>
            <button
              type="button"
              className={clsx('gh-btn', 'gh-btn--primary')}
              onClick={() => {
                toggleTask(task)
              }}
            >
              {done ? <RotateCcw size={14} strokeWidth={1.8} aria-hidden /> : <Check size={14} strokeWidth={1.8} aria-hidden />}
              {done ? '重新打开' : '标记完成'}
            </button>
            <button type="button" className="gh-btn" onClick={() => setEditing(true)}>
              <Pencil size={14} strokeWidth={1.8} aria-hidden />
              编辑
            </button>
            <button type="button" className="gh-btn gh-btn--danger" onClick={removeTask}>
              <Trash2 size={14} strokeWidth={1.8} aria-hidden />
              删除
            </button>
          </>
        }
        tabs={
          <>
            <TaskTab id={task.id} tab="overview" active={activeTab}>
              概览
            </TaskTab>
            <TaskTab id={task.id} tab="subtasks" active={activeTab} count={subtasks.length}>
              子任务
            </TaskTab>
            <TaskTab id={task.id} tab="relations" active={activeTab}>
              关联
            </TaskTab>
          </>
        }
      />

      {activeTab === 'overview' && (
        <div className="gh-detail-grid">
          <div className="gh-detail-main">
            <section className="gh-card">
              <div className="gh-card__head">描述</div>
              <div className="gh-card__body gh-readme">
                {task.notes !== undefined && task.notes.trim() !== '' ? task.notes : '暂无描述。'}
              </div>
            </section>

            <section className="gh-card">
              <div className="gh-card__head">
                <span>子任务</span>
                <span className="gh-card__muted">{subtasks.length} 个</span>
              </div>
              {subtasks.length === 0 ? (
                <div className="gh-empty gh-empty--inset">
                  <b>暂无子任务</b>
                  <span>需要拆分时再加。</span>
                </div>
              ) : (
                <div>
                  {subtasks.slice(0, 8).map((subtask) => (
                    <div key={subtask.id} className="gh-project-task">
                      <Checkbox
                        checked={subtask.status === 'done'}
                        onToggle={() => toggleTask(subtask)}
                        label={`完成：${subtask.title}`}
                      />
                      <Link to={`/tasks/${subtask.id}`} className="gh-project-task__title">
                        {subtask.title}
                      </Link>
                      <span className="gh-project-task__meta">
                        <span className="gh-badge gh-badge--neutral">{TASK_STATUS_LABEL[subtask.status]}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {subtasks.length > 8 && (
                <div className="gh-card__foot">
                  <Link to={`/tasks/${task.id}/subtasks`} className="gh-link">
                    查看全部 {subtasks.length} 个子任务
                  </Link>
                </div>
              )}
            </section>

            <section className="gh-card">
              <div className="gh-card__head">关联</div>
              <div className="gh-card__body">
                <Relations kind="task" id={task.id} />
              </div>
            </section>
          </div>

          <aside className="gh-detail-side" aria-label="任务元数据">
            <section className="gh-card">
              <div className="gh-card__head">属性</div>
              <div className="gh-about">
                <MetaRow label="状态" value={TASK_STATUS_LABEL[task.status]} />
                <MetaRow label="项目" value={project?.title ?? '—'} link={project !== undefined ? `/projects/${project.id}` : undefined} />
                <MetaRow label="区域" value={area?.title ?? '—'} />
                <MetaRow label="截止" value={task.dueAt !== undefined ? humanizeDay(task.dueAt) : '—'} danger={overdue} />
                <MetaRow label="推迟至" value={task.deferUntil !== undefined ? humanizeDay(task.deferUntil) : '—'} />
                <MetaRow label="重要性" value={importanceLabel(task.importance)} />
                <MetaRow label="能量" value={`${ENERGY_LABEL[task.energy]}能`} />
                <MetaRow label="预估" value={task.estimateMin !== undefined ? `${task.estimateMin} 分钟` : '—'} />
                <MetaRow label="创建" value={formatDateTime(task.createdAt)} />
                <MetaRow label="更新" value={formatRelative(task.updatedAt)} />
                <div className="gh-about__row">
                  <span>标签</span>
                  <span className="gh-about__tags">
                    {task.tags.length > 0
                      ? task.tags.map((tag) => <span key={tag} className="gh-badge gh-badge--neutral">{tagLabel(tag)}</span>)
                      : '—'}
                  </span>
                </div>
              </div>
            </section>

            {task.sourceInboxId !== undefined && (
              <section className="gh-card">
                <div className="gh-card__head">来源</div>
                <div className="gh-card__body">
                  <Link to="/inbox" className="gh-link">
                    收件箱条目 {task.sourceInboxId}
                  </Link>
                </div>
              </section>
            )}
          </aside>
        </div>
      )}

      {activeTab === 'subtasks' && (
        <section className="gh-card">
          <div className="gh-card__head">子任务 · {subtasks.length}</div>
          <div className="gh-card__body gh-subtask-add">
            <Plus size={14} strokeWidth={1.8} aria-hidden />
            <input
              className="gh-input"
              value={subtaskTitle}
              onChange={(event) => setSubtaskTitle(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') addSubtask()
              }}
              placeholder="添加子任务，回车创建"
              aria-label="添加子任务"
            />
          </div>
          <div>
            {subtasks.map((subtask) => (
              <div key={subtask.id} className="gh-project-task is-wide">
                <Checkbox
                  checked={subtask.status === 'done'}
                  onToggle={() => toggleTask(subtask)}
                  label={`完成：${subtask.title}`}
                />
                <Link to={`/tasks/${subtask.id}`} className="gh-project-task__title">
                  {subtask.title}
                </Link>
                <span className="gh-project-task__meta">
                  <span className="gh-badge gh-badge--neutral">{TASK_STATUS_LABEL[subtask.status]}</span>
                  {subtask.dueAt !== undefined && <span>{humanizeDay(subtask.dueAt)}</span>}
                </span>
              </div>
            ))}
            {subtasks.length === 0 && (
              <div className="gh-empty gh-empty--inset">
                <b>暂无子任务</b>
                <span>在上方输入框回车即可添加。</span>
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'relations' && (
        <section className="gh-card">
          <div className="gh-card__head">关联</div>
          <div className="gh-card__body">
            <Relations kind="task" id={task.id} />
          </div>
        </section>
      )}

      {editing && <TaskDetailModal taskId={task.id} onClose={() => setEditing(false)} />}
    </div>
  )
}

function TaskTab({
  id,
  tab,
  active,
  count,
  children,
}: {
  id: string
  tab: Tab
  active: Tab
  count?: number
  children: React.ReactNode
}) {
  return (
    <Link
                to={tab === 'overview' ? `/tasks/${id}` : `/tasks/${id}/${tab}`}
                className={clsx('gh-tab', active === tab && 'is-active')}
                aria-current={active === tab ? 'page' : undefined}
              >
      {children}
      {count !== undefined && <span className="gh-tab__count">{count}</span>}
    </Link>
  )
}

function MetaRow({
  label,
  value,
  link,
  danger,
}: {
  label: string
  value: string
  link?: string
  danger?: boolean
}) {
  return (
    <div className="gh-about__row">
      <span>{label}</span>
      {link !== undefined ? (
        <Link to={link} className={clsx('gh-about__link', danger && 'is-danger')}>
          {value}
        </Link>
      ) : (
        <b className={clsx(danger && 'is-danger')}>{value}</b>
      )}
    </div>
  )
}
