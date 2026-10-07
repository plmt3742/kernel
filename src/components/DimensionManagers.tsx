// KERNEL · 区域 / 目标 / 习惯管理（v0.5 · Slice X，见 ADR-0019）
// 设置页三个管理区：关闭此前只读的 areas / goals / habits 结构——列表 + 新建 + 编辑 + 删除。
// 删除一律入回收站可恢复；被引用记录数仅作信息展示，不再阻止删除（服务端不再 409）。
// 前端按快照对缺失引用降级显示（不打印原始 id）；所有操作成功后经 useDataRevision 刷新。
import { useState, type ReactNode } from 'react'
import { Panel } from '@/components/Panel'
import { Modal } from '@/components/Modal'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { useToast } from '@/context/ToastContext'
import { useDataRevision } from '@/lib/hooks'
import { getSnapshot } from '@/lib/data'
import {
  createArea,
  createGoal,
  removeArea,
  removeGoal,
  updateArea,
  updateGoal,
} from '@/lib/mutations'
import { errorText } from '@/lib/api'
import type { Area, Goal } from '@/types'

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
/** 选项构造（label 中文 + value） */
export function opts(pairs: Array<[string, string]>): EditFieldSpec['options'] {
  return pairs.map(([value, label]) => ({ value, label }))
}

/** 创建提交：剔除空串 / null（服务端补缺省；编辑则保留 null 语义 = 清除） */
export function cleanPatch(patch: Record<string, unknown>): Record<string, unknown> {
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

      {deleting !== null && (
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
          区域是长期责任领域（标准式，非身份标签）。删除会移入回收站，可随时恢复；
          被引用的记录数仅供参考，不阻止删除（缺失引用在界面上降级显示）。
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
          目标是区域下的可量化追求（学期 / 季度 / 年度）。删除会移入回收站，可随时恢复；
          被引用记录数仅供参考，不阻止删除。
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


