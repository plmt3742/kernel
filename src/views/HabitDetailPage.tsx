// KERNEL · 习惯详情页（热力图 / 统计 / 打卡记录 / 编辑）
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Check, Pencil, Trash2 } from 'lucide-react'
import { clsx } from 'clsx'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { HabitHeatmap } from '@/components/HabitHeatmap'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/shell/PageHeader'
import { useToast } from '@/context/ToastContext'
import { getAreaById, getAreas, getHabitLog, getHabits } from '@/lib/data'
import {
  checkinHabit,
  removeHabit,
  restoreEntity,
  uncheckinHabit,
  updateHabit,
} from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { getHabitStats, isHabitHitToday } from '@/lib/derive'
import { useDataRevision, useNow } from '@/lib/hooks'
import { opts } from '@/components/DimensionManagers'
import type { Habit } from '@/types'

const CADENCE_LABEL: Record<NonNullable<Habit['cadence']>, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
}
const METRIC_LABEL: Record<NonNullable<Habit['metric']>, string> = {
  count: '次数',
  minutes: '分钟',
  bool: '是否',
}

const FIELDS: EditFieldSpec[] = [
  { key: 'title', label: '习惯名', type: 'text' },
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
  { key: 'target', label: '目标值', type: 'number' },
  { key: 'trigger', label: '触发条件', type: 'text', clearable: true },
  { key: 'areaId', label: '所属区域', type: 'select', clearable: true, options: [] },
]

export function HabitDetailPage() {
  useDataRevision()
  const { id } = useParams()
  const navigate = useNavigate()
  const now = useNow()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const habit = id !== undefined ? getHabits().find((item) => item.id === id) : undefined

  if (habit === undefined) {
    return (
      <div className="gh-page">
        <PageHeader
          breadcrumb={[{ label: 'KERNEL', to: '/' }, { label: '习惯', to: '/habits' }, { label: '未找到' }]}
          title="习惯不存在"
          description="它可能已被删除，或链接已失效。"
        />
        <Link to="/habits" className="gh-btn">
          返回习惯
        </Link>
      </div>
    )
  }

  const stats = getHabitStats(habit.id, now)
  const hit = isHabitHitToday(habit.id, now)
  const area = habit.areaId !== undefined ? getAreaById(habit.areaId) : undefined
  const log = getHabitLog(habit.id)
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 30)

  const toggleToday = (): void => {
    void (async () => {
      try {
        if (hit) await uncheckinHabit(habit.id)
        else await checkinHabit(habit.id)
        toast(hit ? '已取消今日打卡' : '今日已打卡', {
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
      }
    })()
  }

  const setStatus = (): void => {
    void (async () => {
      try {
        await removeHabit(habit.id)
        navigate('/habits')
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
      }
    })()
  }

  const fields = FIELDS.map((field) =>
    field.key === 'areaId'
      ? { ...field, options: opts(getAreas().map((area) => [area.id, area.title])) }
      : field,
  )

  return (
    <div className="gh-page">
      <PageHeader
        breadcrumb={[
          { label: 'KERNEL', to: '/' },
          { label: '习惯', to: '/habits' },
          { label: habit.title },
        ]}
        title={habit.title}
        description={`${CADENCE_LABEL[habit.cadence ?? 'daily']} · ${METRIC_LABEL[habit.metric ?? 'count']} · 目标 ${habit.target ?? 1}`}
        meta={
          <>
            <b>{stats.current} 天连续</b>
            <span>
              最长 {stats.longest} · 累计 {stats.total}
            </span>
          </>
        }
        actions={
          <>
            <button
              type="button"
              className={clsx('gh-btn', hit && 'gh-btn--primary')}
              onClick={toggleToday}
            >
              <Check size={14} strokeWidth={1.8} aria-hidden />
              {hit ? '已打卡' : '今日打卡'}
            </button>
            <button type="button" className="gh-btn" onClick={() => setEditing(true)}>
              <Pencil size={14} strokeWidth={1.8} aria-hidden />
              编辑
            </button>
            <button type="button" className="gh-btn gh-btn--danger" onClick={setStatus}>
              <Trash2 size={14} strokeWidth={1.8} aria-hidden />
              删除
            </button>
          </>
        }
      />

      <div className="gh-detail-grid">
        <div className="gh-detail-main">
          <section className="gh-card">
            <div className="gh-card__head">
              <span>近 16 周</span>
              <span className="gh-card__muted">{stats.total} 次累计</span>
            </div>
            <div className="gh-card__body">
              <HabitHeatmap habitId={habit.id} />
            </div>
          </section>

          <section className="gh-card">
            <div className="gh-card__head">打卡记录 · 最近 30 次</div>
            <div>
              {log.length === 0 ? (
                <div className="gh-empty gh-empty--inset">
                  <b>还没有打卡记录</b>
                  <span>从今天开始。</span>
                </div>
              ) : (
                log.map((entry) => (
                  <div key={entry.date} className="gh-row">
                    <span className="gh-row__main">
                      <span className="gh-row__title">{entry.date}</span>
                    </span>
                    <span className="gh-row__side">{entry.value}</span>
                  </div>
                ))
              )}
            </div>
          </section>
        </div>

        <aside className="gh-detail-side">
          <section className="gh-card">
            <div className="gh-card__head">习惯信息</div>
            <div className="gh-about">
              <div className="gh-about__row">
                <span>节奏</span>
                <b>{CADENCE_LABEL[habit.cadence ?? 'daily']}</b>
              </div>
              <div className="gh-about__row">
                <span>度量</span>
                <b>{METRIC_LABEL[habit.metric ?? 'count']}</b>
              </div>
              <div className="gh-about__row">
                <span>目标</span>
                <b>{habit.target ?? 1}</b>
              </div>
              <div className="gh-about__row">
                <span>区域</span>
                <b>{area?.title ?? '—'}</b>
              </div>
              <div className="gh-about__row">
                <span>触发</span>
                <b>{habit.trigger ?? '—'}</b>
              </div>
              <div className="gh-about__row">
                <span>当前连续</span>
                <b>{stats.current} 天</b>
              </div>
              <div className="gh-about__row">
                <span>最长连续</span>
                <b>{stats.longest} 天</b>
              </div>
              <div className="gh-about__row">
                <span>累计</span>
                <b>{stats.total} 次</b>
              </div>
            </div>
          </section>
        </aside>
      </div>

      {editing && (
        <Modal open onClose={() => setEditing(false)} kicker={habit.id} title="编辑习惯" className="k-modal--detail">
          <EntityEditForm
            key={habit.id}
            fields={fields}
            initial={habit as unknown as Record<string, unknown>}
            saving={saving}
            submitLabel="保存"
            onSubmit={(patch) => {
              setSaving(true)
              void (async () => {
                try {
                  await updateHabit(habit.id, patch)
                  setEditing(false)
                  toast('习惯已保存')
                } catch (err) {
                  toast(`保存失败：${errorText(err)}`, { tone: 'error' })
                } finally {
                  setSaving(false)
                }
              })()
            }}
            onCancel={() => setEditing(false)}
          />
        </Modal>
      )}
    </div>
  )
}
