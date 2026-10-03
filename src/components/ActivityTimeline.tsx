// KERNEL · 「动作记录」时间线（v0.5 · Slice S，回顾页）
//
// 只读：读审计日志尾部（GET /api/activity?limit=200），把每一条动作翻译成
// 中文可读标签，按天分组，并提供「全部 / 完成 / 新增 / 打卡 / 其他」过滤。
// 取数与深链做法参考 `AiActivityFeed`，但时间线为独立实现（分组 / 过滤 / 持久化）。
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Panel } from '@/components/Panel'
import { api } from '@/lib/api'
import { formatTime } from '@/lib/date'
import { deepLinkOfId } from '@/lib/relations'
import { useDataRevision } from '@/lib/hooks'
import { createUiStore, oneOf, useUiStore } from '@/lib/uiState'
import {
  ACTIVITY_FILTERS,
  describeActivity,
  filterByBucket,
  groupByDay,
  type ActivityEntry,
  type ActivityFilter,
} from '@/lib/activity'

/** 取数上限（与服务端 audit 尾部上限一致） */
const ACTIVITY_LIMIT = 200
/** 满额小注阈值 */
const ACTIVITY_CAPPED = 200

/** 过滤档位 → chips 文案 */
const FILTER_LABEL: Record<ActivityFilter, string> = {
  all: '全部',
  done: '完成',
  created: '新增',
  checkin: '打卡',
  other: '其他',
}

/* ---------------------------------------------------------------------------
 * 界面状态保留（Slice Z 精神）：过滤档位经模块级 store 跨路由存活并持久化。
 * key `kernel.ui.review.v1` 与 Review.tsx 的运行态 store（`kernel.ui.review`，
 * persist:false）互不干扰；解析用 `oneOf` 保证非法值回退 `'all'`。
 * ------------------------------------------------------------------------- */
interface ReviewActivityUiState {
  activityFilter: ActivityFilter
}

const ACTIVITY_UI_KEY = 'kernel.ui.review.v1'

function parseActivityUi(raw: unknown): ReviewActivityUiState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  return { activityFilter: oneOf(value.activityFilter, ACTIVITY_FILTERS, 'all') }
}

const activityUiStore = createUiStore<ReviewActivityUiState>(
  ACTIVITY_UI_KEY,
  { activityFilter: 'all' },
  { parse: parseActivityUi },
)

type LoadPhase = 'loading' | 'ready' | 'error'

export function ActivityTimeline(): ReactNode {
  const navigate = useNavigate()
  const revision = useDataRevision()
  const ui = useUiStore(activityUiStore)
  const filter = ui.activityFilter
  const [items, setItems] = useState<ActivityEntry[]>([])
  const [phase, setPhase] = useState<LoadPhase>('loading')
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ items: ActivityEntry[] }>(`/api/activity?limit=${ACTIVITY_LIMIT}`)
      .then((res) => {
        if (cancelled) return
        setItems(res.items)
        setPhase('ready')
      })
      .catch(() => {
        if (cancelled) return
        setItems([])
        setPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [revision, reloadToken])

  const filtered = filterByBucket(items, filter)
  const groups = groupByDay(filtered)
  const capped = items.length >= ACTIVITY_CAPPED
  const countNote = capped ? `共 ${filtered.length} 条 · 最近 ${ACTIVITY_CAPPED} 条` : `共 ${filtered.length} 条`

  const retry = (): void => {
    setPhase('loading')
    setReloadToken((token) => token + 1)
  }

  return (
    <Panel
      title="动作记录"
      en="ACTIVITY"
      actions={<span className="u-label k-muted">{countNote}</span>}
    >
      <div className="k-act__chips" role="group" aria-label="动作记录筛选">
        {ACTIVITY_FILTERS.map((key) => (
          <button
            key={key}
            type="button"
            className={key === filter ? 'k-pill is-selected' : 'k-pill'}
            aria-pressed={key === filter}
            onClick={() => {
              activityUiStore.set((prev) => ({ ...prev, activityFilter: key }))
            }}
          >
            {FILTER_LABEL[key]}
          </button>
        ))}
      </div>

      {phase === 'loading' && items.length === 0 ? (
        <p className="k-act__empty">正在读取动作记录…</p>
      ) : phase === 'error' ? (
        <p className="k-act__empty">
          数据服务离线 ·{' '}
          <button type="button" className="k-act__retry" onClick={retry}>
            重试
          </button>
        </p>
      ) : filtered.length === 0 ? (
        <p className="k-act__empty">暂无记录 · 从今天开始，你的每一步都会写在这里</p>
      ) : (
        <div className="k-act__list">
          {groups.map((group) => (
            <div className="k-act__day" key={group.dayLabel}>
              <div className="k-act__daylabel u-label">{group.dayLabel}</div>
              {group.items.map((entry, index) => {
                const { label } = describeActivity(entry)
                const link = deepLinkOfId(entry.id)
                return (
                  // 审计条目无唯一 id，且同一秒可能有多条同动作记录：以索引兜底保证 key 唯一
                  <div className="k-act__row" key={`${entry.ts}-${entry.action}-${entry.id}-${index}`}>
                    <span className="k-act__time k-mono">{formatTime(entry.ts)}</span>
                    <span className="k-act__label">{label}</span>
                    {link !== null ? (
                      <button
                        type="button"
                        className="k-act__link"
                        onClick={() => navigate(link, { viewTransition: true })}
                        title="跳转查看该实体"
                      >
                        查看
                      </button>
                    ) : (
                      // 保持网格第三列占位，令无深链行与有深链行对齐
                      <span className="k-act__link k-act__link--ghost" aria-hidden="true" />
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </Panel>
  )
}
