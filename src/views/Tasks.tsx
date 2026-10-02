// KERNEL · 任务 TASKS（P0）：筛选（状态 + 时间）/ 分组 / 行内完成动效 / 详情抽屉 / 快速新建
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { AlertTriangle, ChevronRight, Plus } from 'lucide-react'
import { clsx } from 'clsx'
import { FilterBar, type FilterGroup } from '@/components/FilterBar'
import { Checkbox } from '@/components/Checkbox'
import { Drawer } from '@/components/Drawer'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { EmptyState } from '@/components/EmptyState'
import { TagPill } from '@/components/TagPill'
import { TaskDetail } from '@/components/TaskDetail'
import { TaskDraftModal } from '@/components/TaskDraftModal'
import { useToast } from '@/context/ToastContext'
import { getAreas, getProjectById, getSnapshot, getTags } from '@/lib/data'
import { isTaskDone, restoreEntity, trashEntity, updateEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { ENERGY_LABEL, TASK_STATUS_LABEL, tagLabel } from '@/lib/format'
import {
  endOfWeek,
  humanizeDay,
  isPast,
  isSameDay,
  isWithinRange,
  startOfWeek,
  toDate,
} from '@/lib/date'
import { useDataRevision, useNow, useUndoableToggle } from '@/lib/hooks'
import { DUR, EASE_ENTER, STAGGER, STAGGER_MAX } from '@/lib/motion'
import type { Task } from '@/types'

type GroupMode = 'flat' | 'project' | 'context'

interface TaskGroup {
  key: string
  title: string
  tasks: Task[]
}

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
  useDataRevision()
  const toggleTask = useUndoableToggle()
  const now = useNow()
  const [searchParams, setSearchParams] = useSearchParams()
  const { toast } = useToast()
  const reduce = useReducedMotion()

  const [filters, setFilters] = useState<Record<string, string>>({ status: 'open' })
  const [groupMode, setGroupMode] = useState<GroupMode>('flat')
  const [showMore, setShowMore] = useState(false)
  const [quick, setQuick] = useState('')
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [pendingDone, setPendingDone] = useState<string[]>([])
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // 快速新建草稿确认弹窗（Slice O）：回车打开，确认前零写入
  const [composeOpen, setComposeOpen] = useState(false)
  const [composeTitle, setComposeTitle] = useState('')

  // 切换抽屉时退出编辑态
  useEffect(() => {
    setEditing(false)
  }, [drawerId])

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

  const base = allTasks.filter((task) => {
    if (filters.context !== undefined && !task.contexts.includes(filters.context)) return false
    if (filters.energy !== undefined && task.energy !== filters.energy) return false
    if (filters.area !== undefined && task.areaId !== filters.area) return false
    if (filters.role !== undefined && !task.tags.includes(filters.role)) return false
    if (!inTime(task)) return false
    return true
  })

  const visible = base
    .filter((task) => {
      const done = isTaskDone(task)
      if (statusValue === 'open') return (!done && task.status !== 'dropped') || pendingDone.includes(task.id)
      if (statusValue === 'done') return done
      if (statusValue === '') return true
      return task.status === statusValue
    })
    .sort(byDueTask)

  const groups = useMemo<TaskGroup[]>(() => {
    if (groupMode === 'flat') return [{ key: 'all', title: '全部', tasks: visible }]
    const map = new Map<string, Task[]>()
    for (const task of visible) {
      const key = groupMode === 'project' ? (task.projectId ?? '__none') : (task.contexts[0] ?? '__none')
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
            ? (getProjectById(key)?.title ?? key)
            : tagLabel(key),
      tasks,
    }))
  }, [groupMode, visible])

  const openCount = allTasks.filter(
    (task) => task.status !== 'dropped' && !isTaskDone(task),
  ).length
  const overdueCount = allTasks.filter(
    (task) =>
      task.dueAt !== undefined &&
      task.status !== 'dropped' &&
      !isTaskDone(task) &&
      isPast(task.dueAt),
  ).length
  const todayCount = allTasks.filter(
    (task) => task.dueAt !== undefined && !isTaskDone(task) && isSameDay(task.dueAt, new Date()),
  ).length

  const contexts = useMemo(
    () => Array.from(new Set(allTasks.flatMap((task) => task.contexts))).sort(),
    [allTasks],
  )

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
      chips: (['low', 'medium', 'high'] as const).map((energy) => ({
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

  const selected = drawerId !== null ? allTasks.find((task) => task.id === drawerId) : undefined
  const selectedDone = selected !== undefined && isTaskDone(selected)

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

  const handleSave = (patch: Record<string, unknown>): void => {
    if (selected === undefined) return
    setSaving(true)
    void (async () => {
      try {
        await updateEntity('tasks', selected.id, patch)
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
    if (selected === undefined) return
    const id = selected.id
    void (async () => {
      try {
        await trashEntity('tasks', id)
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
            <span>
              逾期 {overdueCount} · 今日 {todayCount}
            </span>
          </div>
        </>
      )}

      <Drawer
        open={selected !== undefined}
        onClose={closeDrawer}
        kicker={`任务 · ${selected?.id ?? ''}`}
        title={selected?.title ?? ''}
        footer={
          selected !== undefined && !editing ? (
            <>
              <div className="k-drawer__foot-main">
                <button
                  type="button"
                  className={selectedDone ? 'k-btn' : 'k-btn is-solid'}
                  onClick={() => handleToggle(selected.id)}
                >
                  {selectedDone ? '取消完成' : '标记完成'}
                </button>
                {selected.projectId !== undefined && (
                  <Link
                    to={`/projects?project=${selected.projectId}`}
                    viewTransition
                    className="k-btn"
                  >
                    查看项目
                  </Link>
                )}
              </div>
              <div className="k-drawer__foot-actions">
                <button type="button" className="k-btn k-btn--sm" onClick={() => setEditing(true)}>
                  编辑
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm is-danger"
                  onClick={handleDelete}
                >
                  删除
                </button>
              </div>
            </>
          ) : undefined
        }
      >
        {selected !== undefined &&
          (editing ? (
            <EntityEditForm
              fields={taskFields}
              initial={selected as unknown as Record<string, unknown>}
              saving={saving}
              onSubmit={handleSave}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <TaskDetail task={selected} />
          )          )}
      </Drawer>

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
