// KERNEL · 任务列表（GitHub issue 式：状态 tabs + 搜索 + 分组列表 + 详情页）
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronDown, Plus, Search } from 'lucide-react'
import { clsx } from 'clsx'
import { FilterBar, type FilterGroup } from '@/components/FilterBar'
import { Checkbox } from '@/components/Checkbox'
import { PageHeader } from '@/components/shell/PageHeader'
import { TaskDraftModal } from '@/components/TaskDraftModal'
import { useToast } from '@/context/ToastContext'
import { getAreas, getProjectById, getSnapshot, getTags } from '@/lib/data'
import { isTaskDone, trashEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { ENERGY_LABEL, TASK_STATUS_LABEL, tagLabel } from '@/lib/format'
import {
  endOfWeek,
  formatDateTime,
  humanizeDay,
  isFuture,
  isPast,
  isSameDay,
  isWithinRange,
  startOfWeek,
  toDate,
} from '@/lib/date'
import { useDataRevision, useNow, useUndoableToggle } from '@/lib/hooks'
import { bool, createUiStore, oneOf, useUiStore } from '@/lib/uiState'
import type { Task } from '@/types'

type GroupMode = 'flat' | 'project' | 'context'

interface TaskGroup {
  key: string
  title: string
  tasks: Task[]
}

interface TaskUiState {
  filters: Record<string, string>
  groupMode: GroupMode
  showMore: boolean
  showDeferred: boolean
}

const TASK_UI_KEY = 'kernel.ui.tasks.v2'
const TASK_UI_DEFAULT: TaskUiState = {
  filters: { status: 'open' },
  groupMode: 'flat',
  showMore: false,
  showDeferred: false,
}

function parseTaskUi(raw: unknown): TaskUiState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const filters: Record<string, string> = {}
  if (typeof v.filters === 'object' && v.filters !== null) {
    for (const [key, value] of Object.entries(v.filters)) {
      if (typeof value === 'string') filters[key] = value
    }
  }
  return {
    filters: Object.keys(filters).length > 0 ? filters : TASK_UI_DEFAULT.filters,
    groupMode: oneOf(v.groupMode, ['flat', 'project', 'context'] as const, 'flat'),
    showMore: bool(v.showMore),
    showDeferred: bool(v.showDeferred),
  }
}

const taskUiStore = createUiStore<TaskUiState>(TASK_UI_KEY, TASK_UI_DEFAULT, {
  parse: parseTaskUi,
})

const STATUS_TABS: Array<{ value: string; label: string }> = [
  { value: 'open', label: '未完成' },
  { value: 'next', label: '下一步' },
  { value: 'waiting', label: '等待中' },
  { value: 'scheduled', label: '已排期' },
  { value: 'someday', label: '将来' },
  { value: 'done', label: '已完成' },
  { value: 'dropped', label: '已丢弃' },
  { value: '', label: '全部' },
]

function byDueTask(a: Task, b: Task): number {
  const aDue = a.dueAt !== undefined ? toDate(a.dueAt).getTime() : Number.POSITIVE_INFINITY
  const bDue = b.dueAt !== undefined ? toDate(b.dueAt).getTime() : Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue
  if (a.importance !== b.importance) return b.importance - a.importance
  return a.id.localeCompare(b.id)
}

export function Tasks() {
  useDataRevision()
  const toggleTask = useUndoableToggle()
  const now = useNow()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const ui = useUiStore(taskUiStore)
  const { filters, groupMode, showMore, showDeferred } = ui
  const [query, setQuery] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTitle, setComposeTitle] = useState('')

  const setFilters = (
    next: Record<string, string> | ((prev: Record<string, string>) => Record<string, string>),
  ): void => {
    taskUiStore.set((state) => ({
      ...state,
      filters: typeof next === 'function' ? next(state.filters) : next,
    }))
  }
  const setGroupMode = (value: GroupMode): void => {
    taskUiStore.set((state) => ({ ...state, groupMode: value }))
  }
  const setShowMore = (value: boolean): void => {
    taskUiStore.set((state) => ({ ...state, showMore: value }))
  }
  const setShowDeferred = (value: boolean): void => {
    taskUiStore.set((state) => ({ ...state, showDeferred: value }))
  }

  const allTasks = getSnapshot().tasks

  useEffect(() => {
    const id = searchParams.get('task')
    if (id !== null && allTasks.some((task) => task.id === id)) {
      navigate(`/tasks/${id}`, { replace: true })
    }
  }, [searchParams, allTasks, navigate])

  const statusValue = filters.status !== undefined ? filters.status : 'open'
  const timeValue = filters.time ?? ''

  const inTime = (task: Task): boolean => {
    if (timeValue === '') return true
    if (task.dueAt === undefined) return false
    if (timeValue === 'overdue') return !isTaskDone(task) && isPast(task.dueAt, now)
    if (timeValue === 'today') return isSameDay(task.dueAt, now)
    return isWithinRange(task.dueAt, startOfWeek(now), endOfWeek(now))
  }

  const isDeferred = (task: Task): boolean =>
    task.deferUntil !== undefined &&
    isFuture(task.deferUntil, now) &&
    !isTaskDone(task) &&
    task.status !== 'dropped'

  const base = allTasks.filter((task) => {
    if (filters.context !== undefined && !task.contexts.includes(filters.context)) return false
    if (filters.energy !== undefined && task.energy !== filters.energy) return false
    if (filters.area !== undefined && task.areaId !== filters.area) return false
    if (filters.role !== undefined && !task.tags.includes(filters.role)) return false
    return true
  })

  const matchesStatus = (task: Task): boolean => {
    const done = isTaskDone(task)
    if (statusValue === 'open') return !done && task.status !== 'dropped'
    if (statusValue === 'done') return done
    if (statusValue === '') return true
    return task.status === statusValue
  }

  const needle = query.trim().toLowerCase()
  const visible = base
    .filter((task) => {
      if (isDeferred(task)) return showDeferred
      return inTime(task) && matchesStatus(task)
    })
    .filter((task) => {
      if (needle === '') return true
      const project = task.projectId !== undefined ? getProjectById(task.projectId) : undefined
      return [task.title, project?.title ?? '', ...task.contexts, ...task.tags]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    .sort(byDueTask)

  const groups = useMemo<TaskGroup[]>(() => {
    if (groupMode === 'flat') return [{ key: 'all', title: '全部', tasks: visible }]
    const map = new Map<string, Task[]>()
    for (const task of visible) {
      const key =
        groupMode === 'project'
          ? task.projectId !== undefined && getProjectById(task.projectId) !== undefined
            ? task.projectId
            : '__none'
          : (task.contexts[0] ?? '__none')
      const list = map.get(key)
      if (list === undefined) map.set(key, [task])
      else list.push(task)
    }
    return [...map.entries()].map(([key, tasks]) => ({
      key,
      title:
        key === '__none'
          ? groupMode === 'project'
            ? '无项目'
            : '无上下文'
          : groupMode === 'project'
            ? (getProjectById(key)?.title ?? '无项目')
            : tagLabel(key),
      tasks,
    }))
  }, [groupMode, visible])

  const openCount = allTasks.filter(
    (task) => task.status !== 'dropped' && !isTaskDone(task) && !isDeferred(task),
  ).length
  const overdueCount = allTasks.filter(
    (task) =>
      task.dueAt !== undefined &&
      task.status !== 'dropped' &&
      !isTaskDone(task) &&
      !isDeferred(task) &&
      isPast(task.dueAt),
  ).length
  const todayCount = allTasks.filter(
    (task) =>
      task.dueAt !== undefined &&
      !isTaskDone(task) &&
      !isDeferred(task) &&
      isSameDay(task.dueAt, new Date()),
  ).length

  const contexts = useMemo(() => {
    const used = allTasks.flatMap((task) => task.contexts)
    const registered = getTags()
      .filter((tag) => tag.namespace === 'context')
      .map((tag) => tag.name)
    return Array.from(new Set([...used, ...registered])).sort()
  }, [allTasks])

  const advancedGroups: FilterGroup[] = [
    {
      key: 'context',
      label: '上下文',
      chips: contexts.map((context) => ({ value: context, label: tagLabel(context) })),
    },
    {
      key: 'energy',
      label: '能量',
      chips: [
        { value: 'high', label: ENERGY_LABEL.high },
        { value: 'medium', label: ENERGY_LABEL.medium },
        { value: 'low', label: ENERGY_LABEL.low },
      ],
    },
    {
      key: 'area',
      label: '区域',
      chips: getAreas().map((area) => ({ value: area.id, label: area.title })),
    },
    {
      key: 'role',
      label: '身份',
      chips: getTags()
        .filter((tag) => tag.namespace === 'role')
        .map((tag) => ({ value: tag.name, label: tag.label })),
    },
  ]
  const timeGroup: FilterGroup = {
    key: 'time',
    label: '时间',
    chips: [
      { value: 'overdue', label: '逾期' },
      { value: 'today', label: '今天' },
      { value: 'week', label: '本周' },
    ],
  }
  const advancedActive = [timeGroup, ...advancedGroups].filter(
    (group) => filters[group.key] !== undefined,
  ).length

  const handleFilterSelect = (key: string, value: string): void => {
    setFilters((prev) => {
      const next = { ...prev }
      if (value === '') delete next[key]
      else next[key] = value
      return next
    })
  }

  const openCreate = (): void => {
    setComposeTitle('')
    setComposeOpen(true)
  }

  const handleCreated = (task: Task): void => {
    setComposeOpen(false)
    toast('已创建任务 · 撤销', {
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

  return (
    <div className="gh-page">
      <PageHeader
        breadcrumb={[{ label: 'KERNEL', to: '/' }, { label: '任务' }]}
        title="任务"
        description="所有未完成的事按截止排序；逾期和今天排在最前面。"
        meta={
          <>
            <b>{openCount} 未完成</b>
            <span>
              {overdueCount} 逾期 · {todayCount} 今天
            </span>
          </>
        }
        actions={
          <button type="button" className="gh-btn gh-btn--primary" onClick={openCreate}>
            <Plus size={14} strokeWidth={1.8} aria-hidden />
            新建任务
          </button>
        }
        tabs={
          <>
            {STATUS_TABS.map((item) => (
              <button
                key={item.value || 'all'}
                type="button"
                className={clsx('gh-tab', statusValue === item.value && 'is-active')}
                aria-pressed={statusValue === item.value}
                onClick={() => handleFilterSelect('status', item.value)}
              >
                {item.label}
              </button>
            ))}
          </>
        }
      />

      <div className="gh-toolbar">
        <label className="gh-search-input">
          <Search size={14} strokeWidth={1.8} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索任务、项目、上下文或标签…"
            aria-label="搜索任务"
          />
        </label>
        <div className="gh-toolbar__group">
          <div className="gh-seg" role="group" aria-label="分组">
            {(
              [
                ['flat', '平铺'],
                ['project', '按项目'],
                ['context', '按上下文'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={clsx('gh-seg__btn', groupMode === value && 'is-on')}
                onClick={() => setGroupMode(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="gh-btn gh-btn--sm gh-btn--ghost"
            onClick={() => setShowMore(!showMore)}
            aria-expanded={showMore}
          >
            筛选{advancedActive > 0 ? ` · ${advancedActive}` : ''}
            <ChevronDown size={13} strokeWidth={1.8} aria-hidden />
          </button>
          <button
            type="button"
            className={clsx('gh-btn', 'gh-btn--sm', showDeferred && 'gh-btn--primary')}
            onClick={() => setShowDeferred(!showDeferred)}
            aria-pressed={showDeferred}
          >
            含已推迟
          </button>
        </div>
      </div>

      {showMore && (
        <div className="gh-filter-panel">
          <FilterBar groups={[timeGroup, ...advancedGroups]} selected={filters} onSelect={handleFilterSelect} />
        </div>
      )}

      {visible.length === 0 ? (
        <div className="gh-empty">
          <b>此筛选下没有任务</b>
          <span>调整筛选条件，或新建一条任务。</span>
        </div>
      ) : (
        <div className="gh-issue-list">
          {groups.map((group) => (
            <div key={group.key}>
              {groupMode !== 'flat' && (
                <div className="gh-issue-group">
                  <span>{group.title}</span>
                  <span>{group.tasks.length}</span>
                </div>
              )}
              {group.tasks.map((task) => (
                <TaskListRow
                  key={task.id}
                  task={task}
                  onToggle={() => toggleTask(task)}
                  onOpen={() => navigate(`/tasks/${task.id}`)}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <TaskDraftModal
        open={composeOpen}
        initialTitle={composeTitle}
        onClose={() => setComposeOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  )
}

function TaskListRow({
  task,
  onToggle,
  onOpen,
}: {
  task: Task
  onToggle: () => void
  onOpen: () => void
}) {
  const done = isTaskDone(task)
  const overdue = task.dueAt !== undefined && !done && isPast(task.dueAt)
  const project = task.projectId !== undefined ? getProjectById(task.projectId) : undefined
  const deferred = task.deferUntil !== undefined && isFuture(task.deferUntil)
  return (
    <div
      className={clsx('gh-issue-row', done && 'is-done')}
      onClick={(event) => {
        const target = event.target
        if (target instanceof Element && target.closest('button, a, input, label') !== null) return
        onOpen()
      }}
    >
      <Checkbox checked={done} onToggle={onToggle} label={`完成：${task.title}`} />
      <div className="gh-issue-row__main">
        <button type="button" className="gh-issue-row__title" onClick={onOpen}>
          {task.title}
        </button>
        <div className="gh-issue-row__meta">
          <span className={clsx('gh-issue-state', done && 'is-done')}>{TASK_STATUS_LABEL[task.status]}</span>
          {project !== undefined && <span className="gh-issue-row__project">{project.title}</span>}
          {task.contexts.map((context) => (
            <span key={context} className="gh-badge gh-badge--neutral">
              {context}
            </span>
          ))}
          {deferred && task.deferUntil !== undefined && (
            <span className="gh-issue-row__deferred">推迟至 {formatDateTime(task.deferUntil)}</span>
          )}
        </div>
      </div>
      <div className="gh-issue-row__side">
        {task.dueAt !== undefined && (
          <span className={clsx('gh-issue-row__due', overdue && 'is-overdue')}>
            {overdue ? '逾期 ' : '截止 '}
            {humanizeDay(task.dueAt)}
          </span>
        )}
        <span>{ENERGY_LABEL[task.energy]}能</span>
      </div>
    </div>
  )
}
