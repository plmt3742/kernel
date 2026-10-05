// KERNEL · 习惯 HABITS（独立页）：每个习惯一张卡——今日打卡 + 近 16 周热力图（可折叠）+ 定义管理。
// 习惯 CRUD 从设置页「区域 / 目标 / 习惯」管理区迁出，归本页所有（设置页只保留区域 / 目标）。
// 视觉：token-only；打卡开关复用 .k-streak__toggle；热力图复用既有 HabitHeatmap（不改动）。
// 深链：/habits?habit=<id> 打开对应习惯的编辑表单（与 Projects / Library 同款 useSearchParams 读取）。
import { useEffect, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { clsx } from 'clsx'
import { Check, Plus } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { EmptyState } from '@/components/EmptyState'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { HabitHeatmap } from '@/components/HabitHeatmap'
import { useToast } from '@/context/ToastContext'
import { getAreaById, getHabits, getSnapshot } from '@/lib/data'
import {
  checkinHabit,
  createHabit,
  removeHabit,
  restoreEntity,
  uncheckinHabit,
  updateHabit,
} from '@/lib/mutations'
import { getHabitStats, isHabitHitToday } from '@/lib/derive'
import { errorText } from '@/lib/api'
import { useDataRevision, useNow } from '@/lib/hooks'
import { cleanPatch, opts } from '@/components/DimensionManagers'
import type { Habit } from '@/types'

const HABIT_CADENCE_LABEL: Record<NonNullable<Habit['cadence']>, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
}
const HABIT_METRIC_LABEL: Record<NonNullable<Habit['metric']>, string> = {
  count: '次数',
  minutes: '分钟',
  bool: '是否',
}

const HABIT_FIELDS: EditFieldSpec[] = [
  { key: 'title', label: '习惯名', type: 'text', placeholder: '如：23:30 前入睡' },
  {
    key: 'cadence',
    label: '节奏',
    type: 'select',
    options: opts([
      ['daily', '每日'],
      ['weekly', '每周'],
      ['monthly', '每月'],
    ]),
  },
  {
    key: 'metric',
    label: '度量方式',
    type: 'select',
    options: opts([
      ['count', '次数'],
      ['minutes', '分钟'],
      ['bool', '是否'],
    ]),
  },
  { key: 'target', label: '目标值', type: 'number', placeholder: '如：1 / 20 / 3' },
  {
    key: 'trigger',
    label: '触发条件（实施意图）',
    type: 'text',
    clearable: true,
    placeholder: '如：洗漱后立刻关灯上床',
  },
  { key: 'areaId', label: '所属区域', type: 'select', clearable: true, options: [] },
]

const CREATE_INITIAL: Record<string, unknown> = {
  title: '',
  cadence: 'daily',
  metric: 'count',
  target: '1',
  trigger: '',
  areaId: '',
}

function editInitialOf(habit: Habit): Record<string, unknown> {
  return {
    title: habit.title,
    cadence: habit.cadence ?? 'daily',
    metric: habit.metric ?? 'count',
    target: String(habit.target ?? 1),
    trigger: habit.trigger ?? '',
    areaId: habit.areaId ?? '',
  }
}

/* ---------------------------------------------------------------------------
 * 单个习惯卡：今日打卡 + 统计 + 可折叠热力图 + 编辑 / 删除
 * ------------------------------------------------------------------------- */

interface HabitCardProps {
  habit: Habit
  now: Date
  onEdit: (habit: Habit) => void
  onDelete: (habit: Habit) => void
}

function HabitCard({ habit, now, onEdit, onDelete }: HabitCardProps): ReactNode {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const stats = getHabitStats(habit.id, now)
  const hit = isHabitHitToday(habit.id, now)
  const area = habit.areaId !== undefined ? getAreaById(habit.areaId) : undefined

  // 今日打卡切换：point 态反映今天的 log；点击幂等打卡 / 取消打卡 + toast 撤销（与总览原行为一致）
  const toggleToday = (): void => {
    if (busy) return
    const label = habit.title.length > 12 ? `${habit.title.slice(0, 12)}…` : habit.title
    setBusy(true)
    void (async () => {
      try {
        if (hit) await uncheckinHabit(habit.id)
        else await checkinHabit(habit.id)
        toast(hit ? `已取消今日打卡 · ${label}` : `今日已打卡 · ${label}`, {
          action: {
            label: '撤销',
            onClick: () => {
              void (hit ? checkinHabit(habit.id) : uncheckinHabit(habit.id)).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`打卡失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setBusy(false)
      }
    })()
  }

  return (
    <section className="k-habit" aria-label={habit.title}>
      <div className="k-habit__head">
        <div className="k-habit__titleline">
          <h2 className="k-habit__title">{habit.title}</h2>
          {area !== undefined && <span className="k-pill is-ghost">{area.title}</span>}
        </div>
        <span className="k-habit__streak k-mono">
          连续 <span className="k-heat__stats-n">{stats.current}</span> 天
        </span>
      </div>

      <div className="k-habit__meta k-mono k-muted">
        {HABIT_CADENCE_LABEL[habit.cadence ?? 'daily']} ·{' '}
        {HABIT_METRIC_LABEL[habit.metric ?? 'count']} · 目标 {habit.target ?? 1} · 最长{' '}
        {stats.longest} 天 · 累计 {stats.total} 次
      </div>

      <div className="k-habit__row">
        <button
          type="button"
          className={clsx('k-streak__toggle', hit && 'is-done')}
          aria-pressed={hit}
          disabled={busy}
          onClick={toggleToday}
        >
          {hit && <Check size={12} aria-hidden />}
          {hit ? '今日已打卡' : '今日打卡'}
        </button>
        <button
          type="button"
          className="k-habit__expand"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? '收起热力图' : '展开热力图 · 近 16 周'}
        </button>
      </div>

      {open && (
        <div className="k-habit__heat">
          <HabitHeatmap habitId={habit.id} />
        </div>
      )}

      <div className="k-habit__ops">
        <button type="button" className="k-btn k-btn--sm" onClick={() => onEdit(habit)}>
          编辑
        </button>
        <button type="button" className="k-btn k-btn--sm is-danger" onClick={() => onDelete(habit)}>
          删除
        </button>
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------------------
 * 习惯页
 * ------------------------------------------------------------------------- */

export function Habits() {
  useDataRevision()
  const now = useNow()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()

  const habits = getHabits()
  const areas = getSnapshot().areas

  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<Habit | null>(null)
  const [saving, setSaving] = useState(false)

  const areaOptions = opts(areas.map((area) => [area.id, area.title]))
  const fields = HABIT_FIELDS.map((field) =>
    field.key === 'areaId' ? { ...field, options: areaOptions } : field,
  )

  // 深链直达编辑弹窗：/habits?habit=h-0001
  useEffect(() => {
    const id = searchParams.get('habit')
    if (id !== null && habits.some((habit) => habit.id === id)) {
      setEditingId(id)
    }
  }, [searchParams, habits])

  const clearHabitParam = (): void => {
    if (searchParams.get('habit') !== null) {
      setSearchParams({}, { replace: true })
    }
  }

  const closeEdit = (): void => {
    setEditingId(null)
    clearHabitParam()
  }

  const editing = editingId !== null ? (habits.find((habit) => habit.id === editingId) ?? null) : null

  const run = (action: () => Promise<void>, ok: string, done: () => void): void => {
    if (saving) return
    setSaving(true)
    void (async () => {
      try {
        await action()
        toast(ok)
        done()
      } catch (err) {
        toast(`操作失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setSaving(false)
      }
    })()
  }

  // 创建：写入后 toast 撤销（撤销 = 移入回收站，与项目快速新建同款）
  const submitCreate = (patch: Record<string, unknown>): void => {
    if (saving) return
    const cleaned = cleanPatch(patch)
    const title = typeof cleaned.title === 'string' ? cleaned.title : ''
    if (title.trim() === '') {
      toast('习惯名不能为空', { tone: 'error' })
      return
    }
    setSaving(true)
    void (async () => {
      try {
        const habit = await createHabit({
          title,
          cadence: cleaned.cadence as Habit['cadence'] | undefined,
          metric: cleaned.metric as Habit['metric'] | undefined,
          target: typeof cleaned.target === 'number' ? cleaned.target : undefined,
          trigger: typeof cleaned.trigger === 'string' ? cleaned.trigger : undefined,
          areaId: typeof cleaned.areaId === 'string' ? cleaned.areaId : undefined,
        })
        setCreating(false)
        toast('已创建习惯 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void removeHabit(habit.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`创建失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setSaving(false)
      }
    })()
  }

  const submitEdit = (habit: Habit, patch: Record<string, unknown>): void => {
    run(
      async () => {
        await updateHabit(habit.id, patch)
      },
      '已保存习惯',
      closeEdit,
    )
  }

  // 删除：移入回收站 + toast 撤销（撤销 = 从回收站恢复）
  const submitDelete = (habit: Habit): void => {
    if (saving) return
    setSaving(true)
    void (async () => {
      try {
        await removeHabit(habit.id)
        setDeleting(null)
        toast('习惯已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('habits', habit.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`删除失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setSaving(false)
      }
    })()
  }

  return (
    <div className="k-view">
      <p className="k-view__intro">
        习惯按「节奏 + 度量 + 目标值」定义；这里每日打卡、查看近 16 周热力图，并管理习惯定义本身。打卡记录（log）不在此编辑。
      </p>

      <div className="k-habits__toolbar">
        <span className="u-label k-muted">共 {habits.length} 个习惯</span>
        <button
          type="button"
          className="k-btn k-btn--sm is-solid"
          onClick={() => setCreating(true)}
          disabled={creating || saving}
        >
          <Plus size={14} strokeWidth={1.5} aria-hidden />
          新建习惯
        </button>
      </div>

      {habits.length === 0 ? (
        <EmptyState
          title="还没有习惯"
          hint="从一个小习惯开始：每晚 23:30 前入睡、每天 20 个俯卧撑，或 15 分钟英语。"
          action={
            <button type="button" className="k-btn is-solid" onClick={() => setCreating(true)}>
              新建习惯
            </button>
          }
        />
      ) : (
        <div className="k-habits">
          {habits.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              now={now}
              onEdit={(target) => setEditingId(target.id)}
              onDelete={setDeleting}
            />
          ))}
        </div>
      )}

      {creating && (
        <Modal
          open
          onClose={() => setCreating(false)}
          kicker="新建 · HABITS"
          title="新建习惯"
          className="k-modal--detail"
        >
          <EntityEditForm
            key="create"
            fields={fields}
            initial={CREATE_INITIAL}
            saving={saving}
            submitLabel="创建"
            onSubmit={submitCreate}
            onCancel={() => setCreating(false)}
          />
        </Modal>
      )}

      {editing !== null && (
        <Modal
          open
          onClose={closeEdit}
          kicker={editing.id}
          title="编辑习惯"
          className="k-modal--detail"
        >
          <EntityEditForm
            key={editing.id}
            fields={fields}
            initial={editInitialOf(editing)}
            saving={saving}
            submitLabel="保存"
            onSubmit={(patch) => submitEdit(editing, patch)}
            onCancel={closeEdit}
          />
        </Modal>
      )}

      {deleting !== null && (
        <Modal
          open
          onClose={() => setDeleting(null)}
          kicker={deleting.id}
          title="删除习惯"
          className="k-modal--detail"
          footer={
            <div className="k-modal__foot-actions">
              <button
                type="button"
                className="k-btn is-solid is-danger"
                disabled={saving}
                onClick={() => submitDelete(deleting)}
              >
                {saving ? '删除中…' : '确认删除'}
              </button>
              <button type="button" className="k-btn" onClick={() => setDeleting(null)}>
                取消
              </button>
            </div>
          }
        >
          <p className="k-view__intro k-muted">
            「{deleting.title}」（<code>{deleting.id}</code>）将移入回收站，可随时恢复或彻底删除。
          </p>
        </Modal>
      )}
    </div>
  )
}
