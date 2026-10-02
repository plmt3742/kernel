// KERNEL · 区域 / 目标 / 习惯管理（v0.5 · Slice X，见 ADR-0019）
// 设置页三个管理区：关闭此前只读的 areas / goals / habits 结构——列表 + 新建 + 编辑 + 删除。
// 区域 / 目标删除带引用护栏（被引用 → 服务端 409；UI 亦按快照预判并说明）；删除入回收站可恢复。
// 视觉：quiet token-only，与设置其它区一致；所有操作成功后经 useDataRevision 刷新。
import { useState, type ReactNode } from 'react'
import { Panel } from '@/components/Panel'
import { Modal } from '@/components/Modal'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { useToast } from '@/context/ToastContext'
import { useDataRevision } from '@/lib/hooks'
import { getHabitStreak, getSnapshot } from '@/lib/data'
import {
  createArea,
  createGoal,
  createHabit,
  removeArea,
  removeGoal,
  removeHabit,
  updateArea,
  updateGoal,
  updateHabit,
} from '@/lib/mutations'
import { errorText } from '@/lib/api'
import type { Area, Goal, Habit } from '@/types'

const AREA_CADENCE_LABEL: Record<NonNullable<Area['cadence']>, string> = {
  weekly: '每周',
  monthly: '每月',
  quarterly: '每季',
}
const AREA_STATUS_LABEL: Record<NonNullable<Area['status']>, string> = {
  active: '进行中',
  archived: '已归档',
}
const GOAL_HORIZON_LABEL: Record<NonNullable<Goal['horizon']>, string> = {
  term: '学期',
  quarter: '季度',
  year: '年度',
}
const GOAL_STATUS_LABEL: Record<NonNullable<Goal['status']>, string> = {
  active: '进行中',
  achieved: '已达成',
  dropped: '已放弃',
  someday: '将来',
}
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

/** 选项构造（label 中文 + value） */
function opts(pairs: Array<[string, string]>): EditFieldSpec['options'] {
  return pairs.map(([value, label]) => ({ value, label }))
}

/** 创建提交：剔除空串 / null（服务端补缺省；编辑则保留 null 语义 = 清除） */
function cleanPatch(patch: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === '') continue
    out[key] = value
  }
  return out
}

/** 区域被引用记录数（任务 / 项目 / 笔记 / 资料 / 日程 / 目标 / 习惯） */
function countAreaRefs(areaId: string): number {
  const s = getSnapshot()
  const lists = [s.tasks, s.projects, s.notes, s.resources, s.events, s.goals, s.habits] as Array<
    Array<{ areaId?: string }>
  >
  return lists.reduce(
    (total, list) => total + list.filter((item) => item.areaId === areaId).length,
    0,
  )
}

/** 目标被引用记录数（项目 goalId + 子目标 parentGoalId） */
function countGoalRefs(goalId: string): number {
  const s = getSnapshot()
  return (
    s.projects.filter((p) => p.goalId === goalId).length +
    s.goals.filter((g) => g.parentGoalId === goalId).length
  )
}

/* ---------------------------------------------------------------------------
 * 通用管理壳：列表 + 新建 / 编辑（EntityEditForm）/ 删除（带护栏提示）
 * ------------------------------------------------------------------------- */

interface DimensionManagerProps<T extends { id: string; title: string }> {
  title: string
  en: string
  intro: ReactNode
  items: T[]
  fields: EditFieldSpec[]
  createInitial: Record<string, unknown>
  editInitial: (item: T) => Record<string, unknown>
  renderMeta: (item: T) => ReactNode
  /** 返回非 null 表示被引用（阻止删除并展示说明） */
  guardOf?: (item: T) => ReactNode | null
  /** 编辑弹窗中追加的只读区块（如目标的关键结果） */
  editExtra?: (item: T) => ReactNode
  onCreate: (patch: Record<string, unknown>) => Promise<void>
  onUpdate: (item: T, patch: Record<string, unknown>) => Promise<void>
  onRemove: (item: T) => Promise<void>
  toastCreated: string
  toastUpdated: string
  toastRemoved: string
  /** 深链定位：打开页面即展开该实体的编辑弹窗 */
  focusId?: string
}

function DimensionManager<T extends { id: string; title: string }>({
  title,
  en,
  intro,
  items,
  fields,
  createInitial,
  editInitial,
  renderMeta,
  guardOf,
  editExtra,
  onCreate,
  onUpdate,
  onRemove,
  toastCreated,
  toastUpdated,
  toastRemoved,
  focusId,
}: DimensionManagerProps<T>): ReactNode {
  useDataRevision()
  const { toast } = useToast()
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<T | null>(() => {
    if (focusId === undefined) return null
    return items.find((item) => item.id === focusId) ?? null
  })
  const [deleting, setDeleting] = useState<T | null>(null)
  const [saving, setSaving] = useState(false)

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

  const submitCreate = (patch: Record<string, unknown>): void => {
    run(() => onCreate(cleanPatch(patch)), toastCreated, () => setCreating(false))
  }
  const submitEdit = (item: T, patch: Record<string, unknown>): void => {
    run(() => onUpdate(item, patch), toastUpdated, () => setEditing(null))
  }
  const submitDelete = (item: T): void => {
    run(() => onRemove(item), toastRemoved, () => setDeleting(null))
  }

  return (
    <Panel
      title={title}
      en={en}
      actions={
        <div className="k-mgr__actions">
          <span className="u-label k-muted">共 {items.length}</span>
          <button
            type="button"
            className="k-btn k-btn--sm"
            onClick={() => setCreating(true)}
            disabled={creating || saving}
          >
            新建
          </button>
        </div>
      }
    >
      {intro}

      {items.length === 0 ? (
        <p className="k-settings__empty">暂无{title}；点右上「新建」创建第一条。</p>
      ) : (
        <div className="k-mgr__list" role="list">
          {items.map((item) => (
            <div className="k-mgr__row" role="listitem" key={item.id}>
              <div className="k-mgr__main">
                <span className="k-mgr__label">{item.title}</span>
                <span className="k-mono k-muted k-mgr__id">{item.id}</span>
              </div>
              <div className="k-mgr__meta">{renderMeta(item)}</div>
              <div className="k-mgr__ops">
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  onClick={() => setEditing(item)}
                  disabled={saving}
                >
                  编辑
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm is-danger"
                  onClick={() => setDeleting(item)}
                  disabled={saving}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <Modal
          open
          onClose={() => setCreating(false)}
          kicker={`新建 · ${en}`}
          title={`新建${title}`}
          className="k-modal--detail"
        >
          <EntityEditForm
            key="create"
            fields={fields}
            initial={createInitial}
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
          onClose={() => setEditing(null)}
          kicker={editing.id}
          title={`编辑${title}`}
          className="k-modal--detail"
        >
          <EntityEditForm
            key={editing.id}
            fields={fields}
            initial={editInitial(editing)}
            saving={saving}
            submitLabel="保存"
            onSubmit={(patch) => submitEdit(editing, patch)}
            onCancel={() => setEditing(null)}
          />
          {editExtra !== undefined && editExtra(editing)}
        </Modal>
      )}

      {deleting !== null &&
        (() => {
          const guard = guardOf !== undefined ? guardOf(deleting) : null
          const blocked = guard !== null
          return (
            <Modal
              open
              onClose={() => setDeleting(null)}
              kicker={deleting.id}
              title={`删除${title}`}
              className="k-modal--detail"
              footer={
                <div className="k-modal__foot-actions">
                  <button
                    type="button"
                    className="k-btn is-solid is-danger"
                    disabled={blocked || saving}
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
              {blocked ? (
                <p className="k-view__intro" role="alert">
                  {guard}
                </p>
              ) : (
                <p className="k-view__intro k-muted">
                  「{deleting.title}」（<code>{deleting.id}</code>）将移入回收站，可随时恢复或彻底删除。
                </p>
              )}
            </Modal>
          )
        })()}
    </Panel>
  )
}

/* ---------------------------------------------------------------------------
 * 区域
 * ------------------------------------------------------------------------- */

const AREA_FIELDS: EditFieldSpec[] = [
  { key: 'title', label: '区域名', type: 'text', placeholder: '如：学业 / 学生工作' },
  {
    key: 'standard',
    label: '标准（长期责任说明）',
    type: 'text',
    clearable: true,
    placeholder: '如：无挂科；作业不过夜',
  },
  {
    key: 'cadence',
    label: '审视节奏',
    type: 'select',
    options: opts([
      ['weekly', '每周'],
      ['monthly', '每月'],
      ['quarterly', '每季'],
    ]),
  },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    options: opts([
      ['active', '进行中'],
      ['archived', '已归档'],
    ]),
  },
]

export function AreaManager({ focusId }: { focusId?: string }): ReactNode {
  const areas = getSnapshot().areas
  return (
    <DimensionManager<Area>
      title="区域"
      en="AREAS"
      focusId={focusId}
      intro={
        <p className="k-view__intro">
          区域是长期责任领域（标准式，非身份标签）。被任务 / 项目 / 笔记 / 资料 / 日程 / 目标 / 习惯引用时不可删除；
          请先解除引用。删除会移入回收站。
        </p>
      }
      items={areas}
      fields={AREA_FIELDS}
      createInitial={{ title: '', standard: '', cadence: 'weekly', status: 'active' }}
      editInitial={(area) => ({
        title: area.title,
        standard: area.standard ?? '',
        cadence: area.cadence ?? 'weekly',
        status: area.status ?? 'active',
      })}
      renderMeta={(area) => {
        const refs = countAreaRefs(area.id)
        return (
          <>
            <span className="k-pill">{AREA_STATUS_LABEL[area.status ?? 'active']}</span>
            <span className="k-pill">{AREA_CADENCE_LABEL[area.cadence ?? 'weekly']}</span>
            <span className="k-mono k-muted" title="被引用记录数">
              用 {refs}
            </span>
          </>
        )
      }}
      guardOf={(area) => {
        const refs = countAreaRefs(area.id)
        if (refs === 0) return null
        return (
          <>
            该区域正被 <b>{refs}</b> 条记录引用，不能删除；请先解除引用（任务 / 项目 / 笔记 / 资料 / 日程 / 目标 /
            习惯）。
          </>
        )
      }}
      onCreate={async (patch) => {
        const title = typeof patch.title === 'string' ? patch.title : ''
        if (title.trim() === '') throw new Error('区域名不能为空')
        await createArea({
          title,
          standard: typeof patch.standard === 'string' ? patch.standard : undefined,
          cadence: patch.cadence as Area['cadence'] | undefined,
          status: patch.status as Area['status'] | undefined,
        })
      }}
      onUpdate={async (area, patch) => {
        await updateArea(area.id, patch)
      }}
      onRemove={async (area) => {
        await removeArea(area.id)
      }}
      toastCreated="已创建区域"
      toastUpdated="已保存区域"
      toastRemoved="区域已移入回收站"
    />
  )
}

/* ---------------------------------------------------------------------------
 * 目标
 * ------------------------------------------------------------------------- */

const GOAL_FIELDS: EditFieldSpec[] = [
  { key: 'title', label: '目标名', type: 'text', placeholder: '如：本学期全科达标' },
  {
    key: 'horizon',
    label: '时间视野',
    type: 'select',
    options: opts([
      ['term', '学期'],
      ['quarter', '季度'],
      ['year', '年度'],
    ]),
  },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    options: opts([
      ['active', '进行中'],
      ['achieved', '已达成'],
      ['dropped', '已放弃'],
      ['someday', '将来'],
    ]),
  },
  { key: 'areaId', label: '所属区域', type: 'select', clearable: true, options: [] },
  { key: 'targetDate', label: '目标日期', type: 'datetime', clearable: true },
]

/** 目标编辑弹窗追加：关键结果只读展示（v1 不开放编辑） */
function goalEditExtra(goal: Goal): ReactNode {
  const results = goal.keyResults ?? []
  if (results.length === 0) {
    return (
      <p className="k-view__intro k-muted">
        关键结果（keyResults）本期只读展示，暂不开放编辑；已有记录仍完整保留。
      </p>
    )
  }
  return (
    <div className="k-detail-block">
      <span className="k-detail-block__label u-label">关键结果 · 只读</span>
      <ul className="k-mgr__kr">
        {results.map((kr, index) => (
          <li key={`${kr.text}-${index}`}>
            <span>{kr.text}</span>
            <span className="k-mono k-muted">
              {kr.current} / {kr.target}
              {kr.unit !== undefined ? ` ${kr.unit}` : ''}
            </span>
          </li>
        ))}
      </ul>
      <p className="k-view__intro k-muted">关键结果本期只读保留，编辑能力延后（见 ADR-0019）。</p>
    </div>
  )
}

export function GoalManager({ focusId }: { focusId?: string }): ReactNode {
  const goals = getSnapshot().goals
  const areas = getSnapshot().areas
  const areaOptions = opts(areas.map((area) => [area.id, area.title]))
  const fields = GOAL_FIELDS.map((field) =>
    field.key === 'areaId' ? { ...field, options: areaOptions } : field,
  )
  return (
    <DimensionManager<Goal>
      title="目标"
      en="GOALS"
      focusId={focusId}
      intro={
        <p className="k-view__intro">
          目标是区域下的可量化追求（学期 / 季度 / 年度）。被项目（goalId）或子目标（parentGoalId）引用时不可删除。
          关键结果本期只读保留，编辑能力延后。
        </p>
      }
      items={goals}
      fields={fields}
      createInitial={{ title: '', horizon: 'term', status: 'active', areaId: '', targetDate: '' }}
      editInitial={(goal) => ({
        title: goal.title,
        horizon: goal.horizon ?? 'term',
        status: goal.status ?? 'active',
        areaId: goal.areaId ?? '',
        targetDate: goal.targetDate ?? '',
      })}
      renderMeta={(goal) => {
        const refs = countGoalRefs(goal.id)
        const area = areas.find((item) => item.id === goal.areaId)
        return (
          <>
            <span className="k-pill">{GOAL_STATUS_LABEL[goal.status ?? 'active']}</span>
            <span className="k-pill">{GOAL_HORIZON_LABEL[goal.horizon ?? 'term']}</span>
            {area !== undefined && <span className="k-pill is-ghost">{area.title}</span>}
            <span className="k-mono k-muted" title="关键结果数">
              KR {(goal.keyResults ?? []).length}
            </span>
            <span className="k-mono k-muted" title="被引用记录数">
              用 {refs}
            </span>
          </>
        )
      }}
      guardOf={(goal) => {
        const refs = countGoalRefs(goal.id)
        if (refs === 0) return null
        return (
          <>
            该目标正被 <b>{refs}</b> 条记录引用（项目 / 子目标），不能删除；请先解除引用。
          </>
        )
      }}
      editExtra={goalEditExtra}
      onCreate={async (patch) => {
        const title = typeof patch.title === 'string' ? patch.title : ''
        if (title.trim() === '') throw new Error('目标名不能为空')
        await createGoal({
          title,
          horizon: patch.horizon as Goal['horizon'] | undefined,
          status: patch.status as Goal['status'] | undefined,
          areaId: typeof patch.areaId === 'string' ? patch.areaId : undefined,
          targetDate: typeof patch.targetDate === 'string' ? patch.targetDate : undefined,
        })
      }}
      onUpdate={async (goal, patch) => {
        await updateGoal(goal.id, patch)
      }}
      onRemove={async (goal) => {
        await removeGoal(goal.id)
      }}
      toastCreated="已创建目标"
      toastUpdated="已保存目标"
      toastRemoved="目标已移入回收站"
    />
  )
}

/* ---------------------------------------------------------------------------
 * 习惯
 * ------------------------------------------------------------------------- */

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

export function HabitManager({ focusId }: { focusId?: string }): ReactNode {
  const habits = getSnapshot().habits
  const areas = getSnapshot().areas
  const areaOptions = opts(areas.map((area) => [area.id, area.title]))
  const fields = HABIT_FIELDS.map((field) =>
    field.key === 'areaId' ? { ...field, options: areaOptions } : field,
  )
  return (
    <DimensionManager<Habit>
      title="习惯"
      en="HABITS"
      focusId={focusId}
      intro={
        <p className="k-view__intro">
          习惯按「节奏 + 度量 + 目标值」定义；每日打卡在总览监视柱内完成。此处管理定义，打卡记录（log）不在本表编辑。
        </p>
      }
      items={habits}
      fields={fields}
      createInitial={{ title: '', cadence: 'daily', metric: 'count', target: '1', trigger: '', areaId: '' }}
      editInitial={(habit) => ({
        title: habit.title,
        cadence: habit.cadence ?? 'daily',
        metric: habit.metric ?? 'count',
        target: String(habit.target ?? 1),
        trigger: habit.trigger ?? '',
        areaId: habit.areaId ?? '',
      })}
      renderMeta={(habit) => {
        const area = areas.find((item) => item.id === habit.areaId)
        const streak = getHabitStreak(habit.id)
        return (
          <>
            <span className="k-pill">{HABIT_CADENCE_LABEL[habit.cadence ?? 'daily']}</span>
            <span className="k-pill">
              {HABIT_METRIC_LABEL[habit.metric ?? 'count']} · {habit.target ?? 1}
            </span>
            {area !== undefined && <span className="k-pill is-ghost">{area.title}</span>}
            <span className="k-mono k-muted" title="当前连续天数">
              连续 {streak}
            </span>
            <span className="k-mono k-muted" title="累计打卡天数">
              记 {(habit.log ?? []).length}
            </span>
          </>
        )
      }}
      onCreate={async (patch) => {
        const title = typeof patch.title === 'string' ? patch.title : ''
        if (title.trim() === '') throw new Error('习惯名不能为空')
        await createHabit({
          title,
          cadence: patch.cadence as Habit['cadence'] | undefined,
          metric: patch.metric as Habit['metric'] | undefined,
          target: typeof patch.target === 'number' ? patch.target : undefined,
          trigger: typeof patch.trigger === 'string' ? patch.trigger : undefined,
          areaId: typeof patch.areaId === 'string' ? patch.areaId : undefined,
        })
      }}
      onUpdate={async (habit, patch) => {
        await updateHabit(habit.id, patch)
      }}
      onRemove={async (habit) => {
        await removeHabit(habit.id)
      }}
      toastCreated="已创建习惯"
      toastUpdated="已保存习惯"
      toastRemoved="习惯已移入回收站"
    />
  )
}
