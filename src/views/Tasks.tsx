// KERNEL · 任务 TASKS（P0）：筛选 / 分组 / 行内完成动效 / 详情抽屉 / 快速新建
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ChevronRight, Plus } from 'lucide-react'
import { FilterBar, type FilterGroup } from '@/components/FilterBar'
import { TaskRow } from '@/components/TaskRow'
import { Drawer } from '@/components/Drawer'
import { EmptyState } from '@/components/EmptyState'
import { TagPill } from '@/components/TagPill'
import { useToast } from '@/context/ToastContext'
import { getAreaById, getAreas, getProjectById, getSnapshot, getTags } from '@/lib/data'
import { addProtoTask, isTaskDone, useDone, useProtoTasks } from '@/lib/proto'
import { ENERGY_LABEL, TASK_STATUS_LABEL, tagLabel } from '@/lib/format'
import { formatDateTime, formatRelative, humanizeDay, isPast, isSameDay } from '@/lib/date'
import { DUR, EASE_ENTER, EASE_EXIT, STAGGER, STAGGER_MAX } from '@/lib/motion'
import type { Task } from '@/types'

type GroupMode = 'flat' | 'project' | 'context'

interface TaskGroup {
  key: string
  title: string
  tasks: Task[]
}

export function Tasks() {
  const { set: doneSet, toggle } = useDone()
  const protoTasks = useProtoTasks()
  const { toast } = useToast()
  const reduce = useReducedMotion()

  const [filters, setFilters] = useState<Record<string, string>>({ status: 'open' })
  const [groupMode, setGroupMode] = useState<GroupMode>('flat')
  const [showMore, setShowMore] = useState(false)
  const [quick, setQuick] = useState('')
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [pendingDone, setPendingDone] = useState<string[]>([])

  const snapshot = getSnapshot()
  const allTasks = useMemo<Task[]>(
    () => [...protoTasks, ...snapshot.tasks],
    [protoTasks, snapshot.tasks],
  )

  useEffect(() => {
    if (pendingDone.length === 0) return
    const timer = window.setTimeout(() => setPendingDone([]), 460)
    return () => window.clearTimeout(timer)
  }, [pendingDone])

  const statusValue = filters.status ?? ''

  const base = allTasks.filter((task) => {
    if (filters.context !== undefined && !task.contexts.includes(filters.context)) return false
    if (filters.energy !== undefined && task.energy !== filters.energy) return false
    if (filters.area !== undefined && task.areaId !== filters.area) return false
    if (filters.role !== undefined && !task.tags.includes(filters.role)) return false
    return true
  })

  const visible = base.filter((task) => {
    const done = isTaskDone(task, doneSet)
    if (statusValue === 'open') return (!done && task.status !== 'dropped') || pendingDone.includes(task.id)
    if (statusValue === 'done') return done
    if (statusValue === '') return true
    return task.status === statusValue
  })

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
    (task) => task.status !== 'dropped' && !isTaskDone(task, doneSet),
  ).length
  const overdueCount = allTasks.filter(
    (task) =>
      task.dueAt !== undefined &&
      task.status !== 'dropped' &&
      !isTaskDone(task, doneSet) &&
      isPast(task.dueAt),
  ).length
  const todayCount = allTasks.filter(
    (task) => task.dueAt !== undefined && !isTaskDone(task, doneSet) && isSameDay(task.dueAt, new Date()),
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
    const wasDone = isTaskDone(task, doneSet)
    toggle(id)
    if (!wasDone) setPendingDone((prev) => [...prev, id])
  }

  const handleQuickAdd = (): void => {
    const value = quick.trim()
    if (value === '') return
    addProtoTask(value)
    setQuick('')
    toast('原型态：任务已加入本地，v0.4 起持久化写入 data/')
  }

  const selected = drawerId !== null ? allTasks.find((task) => task.id === drawerId) : undefined
  const selectedDone = selected !== undefined && isTaskDone(selected, doneSet)

  return (
    <div className="k-view">
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
          placeholder="快速新建任务，回车加入（原型态，本地）"
          aria-label="快速新建任务"
        />
        <span className="u-label k-muted">ENTER</span>
      </div>

      <FilterBar groups={[statusGroup]} selected={filters} onSelect={handleFilterSelect} />

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
        groups.map((group) => (
          <div className="k-group" key={group.key}>
            {groupMode !== 'flat' && (
              <div className="k-group__head">
                <span className="k-group__title">{group.title}</span>
                <span className="k-muted u-label">{group.tasks.length}</span>
              </div>
            )}
            <AnimatePresence initial={false}>
              {group.tasks.map((task, index) => (
                <motion.div
                  key={task.id}
                  layout
                  initial={reduce === true ? { opacity: 0 } : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{
                    opacity: 0,
                    height: 0,
                    overflow: 'hidden',
                    transition: { duration: DUR.base, ease: EASE_EXIT },
                  }}
                  transition={{
                    duration: DUR.base,
                    ease: EASE_ENTER,
                    delay: reduce === true ? 0 : Math.min(index, STAGGER_MAX) * STAGGER,
                  }}
                >
                  <TaskRow
                    task={task}
                    done={isTaskDone(task, doneSet)}
                    onToggle={handleToggle}
                    onOpen={setDrawerId}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        ))
      )}

      <Drawer
        open={selected !== undefined}
        onClose={() => setDrawerId(null)}
        kicker={`任务 · ${selected?.id ?? ''}`}
        title={selected?.title ?? ''}
        footer={
          selected !== undefined ? (
            <>
              <button
                type="button"
                className={selectedDone ? 'k-btn' : 'k-btn is-solid'}
                onClick={() => handleToggle(selected.id)}
              >
                {selectedDone ? '取消完成' : '标记完成'}
              </button>
              <Link to="/projects" viewTransition className="k-btn">
                查看项目
              </Link>
            </>
          ) : undefined
        }
      >
        {selected !== undefined && (
          <div className="k-detail-grid">
            <dl className="k-dl">
              <dt>状态</dt>
              <dd>
                {TASK_STATUS_LABEL[selected.status]}
                {selectedDone && selected.status !== 'done' ? ' · 原型态已完成' : ''}
              </dd>
              <dt>能量</dt>
              <dd>{ENERGY_LABEL[selected.energy]}</dd>
              <dt>重要性</dt>
              <dd>{selected.importance} / 3</dd>
              <dt>上下文</dt>
              <dd>{selected.contexts.map(tagLabel).join(' · ') || '—'}</dd>
              <dt>区域</dt>
              <dd>
                {selected.areaId !== undefined
                  ? (getAreaById(selected.areaId)?.title ?? selected.areaId)
                  : '—'}
              </dd>
              <dt>项目</dt>
              <dd>
                {selected.projectId !== undefined
                  ? (getProjectById(selected.projectId)?.title ?? selected.projectId)
                  : '—'}
              </dd>
              <dt>截止</dt>
              <dd>
                {selected.dueAt !== undefined
                  ? `${formatDateTime(selected.dueAt)} · ${humanizeDay(selected.dueAt)}`
                  : '—'}
              </dd>
              <dt>预估</dt>
              <dd>{selected.estimateMin !== undefined ? `${selected.estimateMin} 分钟` : '—'}</dd>
              <dt>创建</dt>
              <dd>{formatRelative(selected.createdAt)}</dd>
            </dl>
            {selected.tags.length > 0 && (
              <div className="k-detail-block">
                <span className="k-detail-block__label u-label">标签</span>
                <div className="k-hstack">
                  {selected.tags.map((tag) => (
                    <TagPill key={tag}>{tagLabel(tag)}</TagPill>
                  ))}
                </div>
              </div>
            )}
            {selected.notes !== undefined && (
              <div className="k-detail-block">
                <span className="k-detail-block__label u-label">备注</span>
                <p className="k-detail-note">{selected.notes}</p>
              </div>
            )}
          </div>
        )}
      </Drawer>
    </div>
  )
}
