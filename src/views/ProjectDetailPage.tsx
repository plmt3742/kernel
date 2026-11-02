// KERNEL · 项目详情页（GitHub 式多层级：概览 / 任务 / 笔记与资料 / 动态 / 设置）
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { Checkbox } from '@/components/Checkbox'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { TaskDraftModal } from '@/components/TaskDraftModal'
import { PageHeader } from '@/components/shell/PageHeader'
import { useToast } from '@/context/ToastContext'
import {
  getAreaById,
  getAreas,
  getGoals,
  getNotes,
  getProjectById,
  getProjectProgress,
  getTasksByProject,
  getTaskById,
  getTraces,
} from '@/lib/data'
import { restoreEntity, trashEntity, updateEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision, useUndoableToggle } from '@/lib/hooks'
import { ENERGY_LABEL, PROJECT_STATUS_LABEL, TASK_STATUS_LABEL, tagLabel } from '@/lib/format'
import { formatDateTime, formatRelative, humanizeDay, isPast } from '@/lib/date'
import type { Project, Task } from '@/types'

const TABS = ['overview', 'tasks', 'notes', 'activity', 'settings'] as const
type Tab = (typeof TABS)[number]

function isTab(value: string | undefined): value is Tab {
  return value !== undefined && (TABS as readonly string[]).includes(value)
}

export function ProjectDetailPage() {
  useDataRevision()
  const { id, tab } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const toggleTask = useUndoableToggle()
  const [creatingTask, setCreatingTask] = useState(false)
  const [saving, setSaving] = useState(false)
  const project = id !== undefined ? getProjectById(id) : undefined

  if (project === undefined) {
    return (
      <div className="gh-page">
        <PageHeader
          breadcrumb={[{ label: 'KERNEL', to: '/' }, { label: '项目', to: '/projects' }, { label: '未找到' }]}
          title="项目不存在"
          description="它可能已被删除，或链接已失效。"
        />
        <Link to="/projects" className="gh-btn">
          返回项目列表
        </Link>
      </div>
    )
  }

  const activeTab: Tab = isTab(tab) ? tab : 'overview'
  const tasks = getTasksByProject(project.id)
  const openTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped')
  const notes = getNotes().filter((note) => note.projectId === project.id)
  const traces = getTraces().filter((trace) => trace.projectId === project.id)
  const area = project.areaId !== undefined ? getAreaById(project.areaId) : undefined
  const goal = project.goalId !== undefined ? getGoals().find((item) => item.id === project.goalId) : undefined
  const nextAction = project.nextActionId !== undefined ? getTaskById(project.nextActionId) : undefined
  const progress = getProjectProgress(project.id)
  const pct = Math.round(progress.ratio * 100)
  const recent = [
    ...notes.map((note) => ({ id: note.id, kind: '笔记', title: note.title, at: note.updatedAt })),
    ...traces.map((trace) => ({ id: trace.id, kind: '踪迹', title: trace.title, at: trace.at })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 5)

  const changeStatus = (status: Project['status']): void => {
    const previous = project.status
    void (async () => {
      try {
        await updateEntity('projects', project.id, { status })
        toast(`状态已设为「${PROJECT_STATUS_LABEL[status]}」 · 撤销`, {
          action: {
            label: '撤销',
            onClick: () => {
              void updateEntity('projects', project.id, { status: previous }).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`更新失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  const removeProject = (): void => {
    void (async () => {
      try {
        await trashEntity('projects', project.id)
        navigate('/projects')
        toast('项目已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('projects', project.id).catch((err) => {
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

  const fields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text' },
    { key: 'outcome', label: '完成定义', type: 'textarea', rows: 4 },
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
    { key: 'dueAt', label: '截止', type: 'datetime', clearable: true },
    { key: 'tags', label: '标签', type: 'list', placeholder: '用逗号分隔' },
  ]

  return (
    <div className="gh-page">
      <PageHeader
        breadcrumb={[
          { label: 'KERNEL', to: '/' },
          { label: '项目', to: '/projects' },
          { label: project.title },
        ]}
        title={project.title}
        description={project.outcome}
        meta={
          <>
            <b>{PROJECT_STATUS_LABEL[project.status]}</b>
            <span>
              进度 {progress.done}/{progress.total} · {pct}%
            </span>
          </>
        }
        actions={
          <>
            <select
              className="gh-select gh-status-select"
              value={project.status}
              aria-label="项目状态"
              onChange={(event) => changeStatus(event.target.value as Project['status'])}
            >
              {(Object.keys(PROJECT_STATUS_LABEL) as Project['status'][]).map((status) => (
                <option key={status} value={status}>
                  {PROJECT_STATUS_LABEL[status]}
                </option>
              ))}
            </select>
            <button type="button" className="gh-btn gh-btn--danger" onClick={removeProject}>
              <Trash2 size={14} strokeWidth={1.8} aria-hidden />
              删除
            </button>
          </>
        }
        tabs={
          <>
            <TabLink id={project.id} tab="overview" active={activeTab}>
              概览
            </TabLink>
            <TabLink id={project.id} tab="tasks" active={activeTab} count={openTasks.length}>
              任务
            </TabLink>
            <TabLink id={project.id} tab="notes" active={activeTab} count={notes.length}>
              笔记
            </TabLink>
            <TabLink id={project.id} tab="activity" active={activeTab}>
              动态
            </TabLink>
            <TabLink id={project.id} tab="settings" active={activeTab}>
              设置
            </TabLink>
          </>
        }
      />

      {activeTab === 'overview' && (
        <div className="gh-detail-grid">
          <div className="gh-detail-main">
            <section className="gh-card">
              <div className="gh-card__head">完成定义</div>
              <div className="gh-card__body gh-readme">{project.outcome || '还没有填写完成定义。'}</div>
            </section>

            <section className="gh-card">
              <div className="gh-card__head">
                <span>任务</span>
                <span className="gh-card__muted">{openTasks.length} 个未完成</span>
              </div>
              {openTasks.length === 0 ? (
                <div className="gh-empty gh-empty--inset">
                  <b>还没有任务</b>
                  <span>把项目拆成可执行的下一步。</span>
                </div>
              ) : (
                <div>
                  {openTasks.slice(0, 6).map((task) => (
                    <ProjectTaskRow
                      key={task.id}
                      task={task}
                      onToggle={() => toggleTask(task)}
                      onOpen={() => navigate(`/tasks/${task.id}`)}
                    />
                  ))}
                </div>
              )}
              {openTasks.length > 6 && (
                <div className="gh-card__foot">
                  <Link to={`/projects/${project.id}/tasks`} className="gh-link">
                    查看全部 {openTasks.length} 个任务
                  </Link>
                </div>
              )}
            </section>

            <section className="gh-card">
              <div className="gh-card__head">
                <span>最近记录</span>
                <span className="gh-card__muted">笔记 / 资料 / 踪迹</span>
              </div>
              {recent.length === 0 ? (
                <div className="gh-empty gh-empty--inset">
                  <b>暂无关联记录</b>
                  <span>在资料页把笔记或资料挂到这个项目。</span>
                </div>
              ) : (
                <div>
                  {recent.map((item) => (
                    <Link key={`${item.kind}-${item.id}`} to={linkOf(item.kind, item.id)} className="gh-row gh-row--link">
                      <span className="gh-row__main">
                        <span className="gh-row__title">{item.title}</span>
                        <span className="gh-row__meta">
                          <span className="gh-badge gh-badge--neutral">{item.kind}</span>
                          <span>{formatRelative(item.at)}</span>
                        </span>
                      </span>
                      <ExternalLink size={14} strokeWidth={1.7} aria-hidden />
                    </Link>
                  ))}
                </div>
              )}
            </section>

          </div>

          <aside className="gh-detail-side" aria-label="项目上下文">
            <section className="gh-card">
              <div className="gh-card__head">关于</div>
              <div className="gh-about">
                <AboutRow label="状态" value={PROJECT_STATUS_LABEL[project.status]} />
                <AboutRow label="区域" value={area?.title ?? '—'} />
                <AboutRow label="目标" value={goal?.title ?? '—'} />
                <AboutRow label="截止" value={project.dueAt !== undefined ? humanizeDay(project.dueAt) : '未设置'} />
                <AboutRow label="创建" value={formatDateTime(project.createdAt)} />
                <AboutRow label="更新" value={formatRelative(project.updatedAt)} />
                <div className="gh-about__row">
                  <span>标签</span>
                  <span className="gh-about__tags">
                    {project.tags.length > 0
                      ? project.tags.map((tag) => <span key={tag} className="gh-badge gh-badge--neutral">{tagLabel(tag)}</span>)
                      : '—'}
                  </span>
                </div>
                <div className="gh-about__progress">
                  <div className="gh-about__progressline">
                    <span>进度</span>
                    <b>{pct}%</b>
                  </div>
                  <div className="gh-progress">
                    <i style={{ width: `${pct}%` }} />
                  </div>
                  <span className="gh-card__muted">
                    {progress.done} / {progress.total} 个任务完成
                  </span>
                </div>
              </div>
            </section>

            <section className="gh-card">
              <div className="gh-card__head">下一步</div>
              <div className="gh-card__body">
                {nextAction !== undefined ? (
                  <>
                    <Link to={`/tasks/${nextAction.id}`} className="gh-next">
                      {nextAction.title}
                    </Link>
                    <p className="gh-card__muted gh-next__meta">
                      {nextAction.dueAt !== undefined ? humanizeDay(nextAction.dueAt) : '未设截止'} ·{' '}
                      {ENERGY_LABEL[nextAction.energy]}能
                    </p>
                  </>
                ) : (
                  <span className="gh-card__muted">未设置下一步</span>
                )}
              </div>
            </section>
          </aside>
        </div>
      )}

      {activeTab === 'tasks' && (
        <section className="gh-card">
          <div className="gh-card__head">
            <span>任务 · {tasks.length}</span>
            <button type="button" className="gh-btn gh-btn--sm" onClick={() => setCreatingTask(true)}>
              <Plus size={13} strokeWidth={1.8} aria-hidden />
              新建任务
            </button>
          </div>
          {tasks.length === 0 ? (
            <div className="gh-empty gh-empty--inset">
              <b>还没有任务</b>
              <span>把项目拆成可执行的下一步。</span>
            </div>
          ) : (
            <div>
              {tasks.map((task) => (
                <ProjectTaskRow
                  key={task.id}
                  task={task}
                  onToggle={() => toggleTask(task)}
                  onOpen={() => navigate(`/tasks/${task.id}`)}
                  wide
                />
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'notes' && (
        <section className="gh-card">
          <div className="gh-card__head">
            <span>笔记 · {notes.length}</span>
            <Link to="/library" className="gh-btn gh-btn--sm">
              打开资料页
            </Link>
          </div>
          <div>
            {notes.map((note) => (
              <Link key={note.id} to={`/library?note=${note.id}`} className="gh-row gh-row--link">
                <span className="gh-row__main">
                  <span className="gh-row__title">{note.title}</span>
                  <span className="gh-row__meta">
                    <span className="gh-badge gh-badge--neutral">笔记</span>
                    <span>{formatRelative(note.updatedAt)}</span>
                  </span>
                </span>
                <ExternalLink size={14} strokeWidth={1.7} aria-hidden />
              </Link>
            ))}
            {notes.length === 0 && (
              <div className="gh-empty gh-empty--inset">
                <b>暂无关联记录</b>
                <span>在资料页把笔记或资料挂到这个项目。</span>
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'activity' && (
        <section className="gh-card">
          <div className="gh-card__head">动态</div>
          <div>
            {[...tasks]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .slice(0, 20)
              .map((task) => (
                <div key={task.id} className="gh-activity">
                  <span className={clsx('gh-activity__dot', task.status === 'done' && 'is-done')} aria-hidden />
                  <span className="gh-activity__main">
                    <Link to={`/tasks/${task.id}`}>{task.title}</Link>
                    <span>
                      {TASK_STATUS_LABEL[task.status]} · {task.status === 'done' ? '已完成' : '更新于'} {formatRelative(task.updatedAt)}
                    </span>
                  </span>
                </div>
              ))}
            {tasks.length === 0 && (
              <div className="gh-empty gh-empty--inset">
                <b>暂无动态</b>
                <span>任务、笔记和资料的更新会显示在这里。</span>
              </div>
            )}
          </div>
        </section>
      )}

      {activeTab === 'settings' && (
        <div className="gh-settings-stack">
          <section className="gh-card">
            <div className="gh-card__head">项目设置</div>
            <div className="gh-card__body">
              <EntityEditForm
                fields={fields}
                initial={project as unknown as Record<string, unknown>}
                saving={saving}
                submitLabel="保存项目"
                onSubmit={(patch) => {
                  setSaving(true)
                  void (async () => {
                    try {
                      await updateEntity('projects', project.id, patch)
                      toast('项目已保存')
                    } catch (err) {
                      toast(`保存失败：${errorText(err)}`, { tone: 'error' })
                    } finally {
                      setSaving(false)
                    }
                  })()
                }}
                onCancel={() => navigate(`/projects/${project.id}`)}
              />
            </div>
          </section>
          <section className="gh-card gh-danger-zone">
            <div className="gh-card__head">危险区</div>
            <div className="gh-card__body gh-danger-zone__body">
              <div>
                <b>移入回收站</b>
                <p className="gh-card__muted">项目软删除；任务与引用保留，可在回收站恢复。</p>
              </div>
              <button type="button" className="gh-btn gh-btn--danger" onClick={removeProject}>
                <Trash2 size={14} strokeWidth={1.8} aria-hidden />
                删除项目
              </button>
            </div>
          </section>
        </div>
      )}

      <TaskDraftModal
        open={creatingTask}
        initialTitle=""
        initialProjectId={project.id}
        onClose={() => setCreatingTask(false)}
        onCreated={() => {
          setCreatingTask(false)
          toast('已创建任务')
        }}
      />
    </div>
  )
}

function TabLink({
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
                to={tab === 'overview' ? `/projects/${id}` : `/projects/${id}/${tab}`}
                className={clsx('gh-tab', active === tab && 'is-active')}
                aria-current={active === tab ? 'page' : undefined}
              >
      {children}
      {count !== undefined && <span className="gh-tab__count">{count}</span>}
    </Link>
  )
}

function AboutRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="gh-about__row">
      <span>{label}</span>
      <b>{value}</b>
    </div>
  )
}

function ProjectTaskRow({
  task,
  onToggle,
  onOpen,
  wide,
}: {
  task: Task
  onToggle: () => void
  onOpen: () => void
  wide?: boolean
}) {
  const done = task.status === 'done'
  const overdue = task.dueAt !== undefined && !done && isPast(task.dueAt)
  return (
    <div className={clsx('gh-project-task', wide && 'is-wide')}>
      <Checkbox checked={done} onToggle={onToggle} label={`完成：${task.title}`} />
      <button type="button" className="gh-project-task__title" onClick={onOpen}>
        {task.title}
      </button>
      <span className="gh-project-task__meta">
        <span className="gh-badge gh-badge--neutral">{TASK_STATUS_LABEL[task.status]}</span>
        {task.dueAt !== undefined && (
          <span className={clsx('gh-project-task__due', overdue && 'is-overdue')}>
            {overdue ? '逾期 ' : '截止 '}
            {humanizeDay(task.dueAt)}
          </span>
        )}
        {wide && <span className="gh-project-task__energy">{ENERGY_LABEL[task.energy]}能</span>}
      </span>
    </div>
  )
}

function linkOf(kind: string, id: string): string {
  if (kind === '笔记') return `/library?note=${id}`
  if (kind === '资料') return `/library?resource=${id}`
  return `/traces?trace=${id}`
}
