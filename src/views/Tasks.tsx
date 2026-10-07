// KERNEL · 任务 TASKS（P0）：筛选（状态 + 时间）/ 分组 / 行内完成动效 / 详情抽屉 / 快速新建
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { FilterBar, type FilterGroup } from '@/components/FilterBar'
import { Checkbox } from '@/components/Checkbox'
import { TaskDetailModal } from '@/components/TaskDetailModal'
import { EmptyState } from '@/components/EmptyState'
import { TagPill } from '@/components/TagPill'
import { TaskDraftModal } from '@/components/TaskDraftModal'
import { useToast } from '@/context/ToastContext'
import { getAreas, getProjectById, getSnapshot, getTags } from '@/lib/data'
import { isTaskDone, trashEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { ENERGY_LABEL, ENERGY_OPTIONS, TASK_STATUS_LABEL, tagLabel } from '@/lib/format'
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
import { DUR, EASE_ENTER, STAGGER, STAGGER_MAX } from '@/lib/motion'
import { bool, createUiStore, oneOf, str, useUiStore } from '@/lib/uiState'
import type { Task } from '@/types'

type GroupMode = 'flat' | 'project' | 'context'

interface TaskGroup {
  key: string
  title: string
  tasks: Task[]
}

/* ---------------------------------------------------------------------------
 * 任务页界面状态保留（Slice Z · F26，见 ADR-0022）：
 * 筛选 / 分组 / 更多筛选展开 / 快速新建草稿提升到模块级 store 并持久化，
 * 切路由或刷新后原样还原（纯界面状态，绝不落盘数据）。
 * ------------------------------------------------------------------------- */
interface TaskUiState {
  filters: Record<string, string>
  groupMode: GroupMode
  showMore: boolean
  /** 软推迟（v0.5）：是否在列表中显示已推迟任务（默认隐藏） */
  showDeferred: boolean
  quick: string
}

const TASK_UI_KEY = 'kernel.ui.tasks.v1'
const TASK_UI_DEFAULT: TaskUiState = {
  filters: { status: 'open' },
  groupMode: 'flat',
  showMore: false,
  showDeferred: false,
  quick: '',
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
    quick: str(v.quick),
  }
}

const taskUiStore = createUiStore<TaskUiState>(TASK_UI_KEY, TASK_UI_DEFAULT, {
  parse: parseTaskUi,
})

/** 默认排序：截止近者优先（无截止垫底），其次重要性，最后按 id 稳定 */
function byDueTask(a: Task, b: Task): number {
  const aDue = a.dueAt !== undefined ? toDate(a.dueAt).getTime() : Number.POSITIVE_INFINITY
  const bDue = b.dueAt !== undefined ? toDate(b.dueAt).getTime() : Number.POSITIVE_INFINITY
  if (aDue !== bDue) return aDue - bDue
  if (a.importance !== b.importance) return b.importance - a.importance
  return a.id.localeCompare(b.id)
}

/* ---------------------------------------------------------------------------
 * 快速新建（Slice O）：回车打开「草稿确认」弹窗（TaskDraftModal）——AI 先补全，
 * 用户在弹窗内编辑并点「创建任务」后才写入。确认前零写入。
 * ------------------------------------------------------------------------- */

export function Tasks() {
  const revision = useDataRevision()
  const toggleTask = useUndoableToggle()
  const now = useNow()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast } = useToast()
  const reduce = useReducedMotion()

  // 界面状态（Slice Z · F26）：来自模块级 store（跨路由 + 刷新保留）
  const ui = useUiStore(taskUiStore)
  const { filters, groupMode, showMore, showDeferred, quick } = ui
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
  const setShowMore = (next: boolean | ((prev: boolean) => boolean)): void => {
    taskUiStore.set((state) => ({
      ...state,
      showMore: typeof next === 'function' ? next(state.showMore) : next,
    }))
  }
  const setShowDeferred = (next: boolean | ((prev: boolean) => boolean)): void => {
    taskUiStore.set((state) => ({
      ...state,
      showDeferred: typeof next === 'function' ? next(state.showDeferred) : next,
    }))
  }
  const setQuick = (value: string): void => {
    taskUiStore.set((state) => ({ ...state, quick: value }))
  }
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [pendingDone, setPendingDone] = useState<string[]>([])
  // 快速新建草稿确认弹窗（Slice O）：回车打开，确认前零写入
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTitle, setComposeTitle] = useState('')

  const allTasks = getSnapshot().tasks

  useEffect(() => {
    if (pendingDone.length === 0) return
    const timer = window.setTimeout(() => setPendingDone([]), 460)
    return () => window.clearTimeout(timer)
  }, [pendingDone])

  // 深链直达任务抽屉（总览「下一步行动」等入口）：/tasks?task=t-0001
  useEffect(() => {
    const id = searchParams.get('task')
    if (id !== null && allTasks.some((task) => task.id === id)) {
      setDrawerId(id)
    }
  }, [searchParams, allTasks])

  const closeDrawer = (): void => {
    setDrawerId(null)
    if (searchParams.get('task') !== null) {
      setSearchParams({}, { replace: true })
    }
  }

  const statusValue = filters.status ?? ''
  const timeValue = filters.time ?? ''

  const inTime = (task: Task): boolean => {
    if (timeValue === '') return true
    if (task.dueAt === undefined) return false
    if (timeValue === 'overdue') return !isTaskDone(task) && isPast(task.dueAt, now)
    if (timeValue === 'today') return isSameDay(task.dueAt, now)
    // 本周：周一 00:00 ～ 周日 23:59（区间落点，含本周内已过期的项）
    return isWithinRange(task.dueAt, startOfWeek(now), endOfWeek(now))
  }

  // 软推迟（v0.5）：deferUntil 为有效未来时刻且未完成 / 未丢弃 = 已推迟（运行时计算，绝不落盘标记）。
  // 推迟默认从活跃工作列表隐藏；仅由 `showDeferred` 一个闸门控制（不写入状态 / 时间维度筛选）。
  const isDeferred = (task: Task): boolean =>
    task.deferUntil !== undefined &&
    isFuture(task.deferUntil, now) &&
    !isTaskDone(task) &&
    task.status !== 'dropped'

  // 基础筛选（上下文 / 能量 / 区域 / 身份）：时间维度下移到状态筛选之后，
  // 使「含已推迟」打开时推迟行可越过状态 / 时间筛选展示（推迟开关是唯一闸门）。
  const base = allTasks.filter((task) => {
    if (filters.context !== undefined && !task.contexts.includes(filters.context)) return false
    if (filters.energy !== undefined && task.energy !== filters.energy) return false
    if (filters.area !== undefined && task.areaId !== filters.area) return false
    if (filters.role !== undefined && !task.tags.includes(filters.role)) return false
    return true
  })

  const matchesStatus = (task: Task): boolean => {
    const done = isTaskDone(task)
    if (statusValue === 'open') return (!done && task.status !== 'dropped') || pendingDone.includes(task.id)
    if (statusValue === 'done') return done
    if (statusValue === '') return true
    return task.status === statusValue
  }

  const visible = base
    .filter((task) => {
      if (isDeferred(task)) return showDeferred
      return inTime(task) && matchesStatus(task)
    })
    .sort(byDueTask)

  const groups = useMemo<TaskGroup[]>(() => {
    if (groupMode === 'flat') return [{ key: 'all', title: '全部', tasks: visible }]
    const map = new Map<string, Task[]>()
    for (const task of visible) {
      // 悬挂的项目引用（项目已删除 / 移入回收站）归入「无项目」，绝不打印原始 id
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

  // 计数一律排除已推迟任务（无论「含已推迟」是否打开）——代表活跃工作量。
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
  const deferredCount = allTasks.filter(isDeferred).length

  // 上下文筛选候选（Slice Y · F24）：已用情境 ∪ 注册表情境——
  // 使「已登记但暂无任务」的情境仍可选，避免注册表情境在 UI 中不可达。
  const contexts = useMemo(() => {
    const used = allTasks.flatMap((task) => task.contexts)
    const registered = getTags()
      .filter((tag) => tag.namespace === 'context')
      .map((tag) => tag.name)
    return Array.from(new Set([...used, ...registered])).sort()
  }, [allTasks, revision])

  const filterGroups: FilterGroup[] = [
    {
      key: 'status',
      label: '状态',
      chips: [
        { value: 'open', label: '未完成' },
        { value: 'next', label: TASK_STATUS_LABEL.next },
        { value: 'waiting', label: TASK_STATUS_LABEL.waiting },
        { value: 'scheduled', label: TASK_STATUS_LABEL.scheduled },
        { value: 'someday', label: TASK_STATUS_LABEL.someday },
        { value: 'done', label: TASK_STATUS_LABEL.done },
        { value: 'dropped', label: TASK_STATUS_LABEL.dropped },
      ],
    },
    {
      key: 'context',
      label: '上下文',
      chips: contexts.map((context) => ({ value: context, label: tagLabel(context) })),
    },
    {
      key: 'energy',
      label: '能量',
      chips: ENERGY_OPTIONS.map((energy) => ({
        value: energy,
        label: ENERGY_LABEL[energy],
      })),
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

  const [statusGroup, ...advancedGroups] = filterGroups
  const timeGroup: FilterGroup = {
    key: 'time',
    label: '时间',
    chips: [
      { value: 'overdue', label: '逾期' },
      { value: 'today', label: '今天' },
      { value: 'week', label: '本周' },
    ],
  }
  const advancedActive = advancedGroups.filter((group) => filters[group.key] !== undefined).length

  const handleFilterSelect = (key: string, value: string): void => {
    setFilters((prev) => {
      const next = { ...prev }
      if (value === '') delete next[key]
      else next[key] = value
      return next
    })
  }

  const handleToggle = (id: string): void => {
    const task = allTasks.find((item) => item.id === id)
    if (task === undefined) return
    const wasDone = toggleTask(task)
    if (!wasDone) setPendingDone((prev) => [...prev, id])
  }

  // 回车：打开草稿确认弹窗（只读预览，不写任何数据）；标题随入弹窗预填
  const handleQuickAdd = (): void => {
    const value = quick.trim()
    if (value === '') return
    setComposeTitle(value)
    setComposeOpen(true)
  }

  // 弹窗内确认创建成功：清空输入 + 撤销 toast（撤销＝移入回收站，复用既有机制）
  const handleCreated = (task: Task): void => {
    setComposeOpen(false)
    setQuick('')
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
    <div className="k-view">
      {/* 工具条：计数并入一行 + 快速新建（把纵向空间留给表格） */}
      <div className="k-tasks__toolbar">
        <div className="k-tasks__counts">
          <div className="k-count">
            <span className="k-count__num">{openCount}</span>
            <span className="u-label k-muted">未完成 OPEN</span>
          </div>
          <div className="k-count">
            <span className={overdueCount > 0 ? 'k-count__num is-accent' : 'k-count__num'}>
              {overdueCount}
            </span>
            <span className="u-label k-muted">逾期 OVERDUE</span>
          </div>
          <div className="k-count">
            <span className="k-count__num">{todayCount}</span>
            <span className="u-label k-muted">今日 TODAY</span>
          </div>
        </div>

        <div className="k-quickadd">
          <Plus size={16} strokeWidth={1.5} className="k-muted" aria-hidden />
          <input
            className="k-quickadd__input"
            value={quick}
            onChange={(event) => setQuick(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleQuickAdd()
            }}
            placeholder="快速新建任务，回车预览 AI 补全（先确认后写入）"
            aria-label="快速新建任务"
          />
          <span className="u-label k-muted">ENTER</span>
        </div>
      </div>

      {/* 筛选压缩为一行（状态 + 时间；结构不变，仅排版收敛） */}
      <div className="k-tasks__filters">
        <FilterBar groups={[statusGroup, timeGroup]} selected={filters} onSelect={handleFilterSelect} />
      </div>

      <div className="k-tasks__groupbar">
        <button
          type="button"
          className="k-collapse-head"
          aria-expanded={showMore}
          onClick={() => setShowMore((prev) => !prev)}
        >
          <ChevronRight size={14} strokeWidth={1.5} className="k-collapse-head__caret" aria-hidden />
          <span className="u-label">
            更多筛选 MORE{advancedActive > 0 ? ` · ${advancedActive}` : ''}
          </span>
        </button>
        <div className="k-tabs" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          {(
            [
              ['flat', '平铺 TASKS'],
              ['project', '按项目 PROJECT'],
              ['context', '按上下文 CONTEXT'],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={groupMode === value ? 'k-tab is-active' : 'k-tab'}
              onClick={() => setGroupMode(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {/* 软推迟（v0.5）：默认隐藏已推迟任务；打开后列出（推迟行越过状态 / 时间筛选） */}
        <TagPill selected={showDeferred} onClick={() => setShowDeferred((prev) => !prev)}>
          含已推迟{deferredCount > 0 ? ` · ${deferredCount}` : ''}
        </TagPill>
      </div>

      {showMore && (
        <FilterBar groups={advancedGroups} selected={filters} onSelect={handleFilterSelect} />
      )}

      {visible.length === 0 ? (
        <EmptyState
          index="00"
          title="此筛选下没有任务"
          hint="调整筛选条件，或清空筛选查看全部。"
        />
      ) : (
        <>
          {/* 每个分组一张表：吸顶表头 + 稠密行；窄屏由容器查询逐级收列 */}
          {groups.map((group) => (
            <div className="k-group" key={group.key}>
              {groupMode !== 'flat' && (
                <div className="k-group__head">
                  <span className="k-group__title">{group.title}</span>
                  <span className="k-muted u-label">{group.tasks.length}</span>
                </div>
              )}
              <table className="k-table k-tasks__table" aria-label="任务列表">
                <colgroup>
                  <col className="k-tasks__col--check" />
                  <col />
                  <col className="k-tasks__col--ctx" />
                  <col className="k-tasks__col--energy" />
                  <col className="k-tasks__col--due" />
                  <col className="k-tasks__col--proj" />
                </colgroup>
                <thead>
                  <tr>
                    <th scope="col">完成</th>
                    <th scope="col">标题</th>
                    <th scope="col" className="k-tasks__col--ctx">
                      上下文
                    </th>
                    <th scope="col" className="k-tasks__col--energy">
                      能量
                    </th>
                    <th scope="col" className="k-tasks__col--due">
                      截止
                    </th>
                    <th scope="col" className="k-tasks__col--proj">
                      项目
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <AnimatePresence initial={false}>
                    {group.tasks.map((task, index) => {
                      const done = isTaskDone(task)
                      const overdue = task.dueAt !== undefined && !done && isPast(task.dueAt)
                      const deferred = isDeferred(task)
                      const project =
                        task.projectId !== undefined
                          ? getProjectById(task.projectId)?.title
                          : undefined
                      return (
                        <motion.tr
                          key={task.id}
                          className={clsx('k-tasks__row', done && 'is-done')}
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          transition={{
                            duration: DUR.base,
                            ease: EASE_ENTER,
                            delay: reduce === true ? 0 : Math.min(index, STAGGER_MAX) * STAGGER,
                          }}
                        >
                          <td className="k-tasks__col--check">
                            <Checkbox
                              checked={done}
                              onToggle={() => handleToggle(task.id)}
                              label={`完成：${task.title}`}
                            />
                          </td>
                          <td>
                            <button
                              type="button"
                              className="k-task__open k-tasks__title-btn"
                              onClick={() => setDrawerId(task.id)}
                              aria-label={`查看任务：${task.title}`}
                            >
                              <span className="k-task__titlewrap">
                                <span className="k-task__title">{task.title}</span>
                                <span className="k-task__strike" aria-hidden />
                              </span>
                            </button>
                            {deferred && task.deferUntil !== undefined && (
                              <span className="u-label k-muted">
                                推迟至 {formatDateTime(task.deferUntil)}
                              </span>
                            )}
                          </td>
                          <td className="k-tasks__col--ctx">
                            <span className="k-tasks__ctx">
                              {task.contexts.map((context) => (
                                <TagPill key={context} ghost>
                                  {context}
                                </TagPill>
                              ))}
                            </span>
                          </td>
                          <td className="k-tasks__col--energy">
                            <span className="k-task__energy">{ENERGY_LABEL[task.energy]}能</span>
                          </td>
                          <td className="k-tasks__col--due">
                            {task.dueAt === undefined ? (
                              <span className="k-tasks__due k-muted">无截止</span>
                            ) : (
                              <span
                                className={clsx(
                                  'k-task__due',
                                  'k-tasks__due',
                                  overdue && 'is-overdue',
                                )}
                              >
                                {overdue && (
                                  <AlertTriangle size={11} strokeWidth={1.5} aria-hidden />
                                )}
                                {overdue ? '逾期 ' : '截止 '}
                                {humanizeDay(task.dueAt)}
                              </span>
                            )}
                          </td>
                          <td className="k-tasks__col--proj">
                            {project !== undefined ? (
                              <span className="k-tasks__proj">{project}</span>
                            ) : (
                              <span className="k-tasks__proj k-muted">—</span>
                            )}
                          </td>
                        </motion.tr>
                      )
                    })}
                  </AnimatePresence>
                </tbody>
              </table>
            </div>
          ))}

          <div className="k-tasks__foot u-label">
            <span>显示 {visible.length} 项 · 按截止升序</span>
            {deferredCount > 0 && (
              <TagPill ghost onClick={() => setShowDeferred((prev) => !prev)}>
                {deferredCount} 项已推迟
              </TagPill>
            )}
            <span>
              逾期 {overdueCount} · 今日 {todayCount}
            </span>
          </div>
        </>
      )}

      {/* 任务详情居中弹窗（Slice K）：与总览就地弹窗共用同一组件，动作一致。
          行内完成后的塌缩动效经 onToggled 回传（未完成 → 已完成时短暂保留在列表中）。 */}
      <TaskDetailModal
        taskId={drawerId}
        onClose={closeDrawer}
        onToggled={(task, wasDone) => {
          if (!wasDone) setPendingDone((prev) => [...prev, task.id])
        }}
      />

      {/* 快速新建草稿确认弹窗（Slice O）：ESC / 遮罩 / 取消 → 零写入 */}
      <TaskDraftModal
        open={composeOpen}
        initialTitle={composeTitle}
        onClose={() => setComposeOpen(false)}
        onCreated={handleCreated}
      />
    </div>
  )
}
