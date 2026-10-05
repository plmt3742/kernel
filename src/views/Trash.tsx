// KERNEL · 回收站 TRASH（Slice E2）：按类型分组；恢复（可撤销的删除）与彻底删除（双击确认）
import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Panel } from '@/components/Panel'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { errorText } from '@/lib/api'
import { fetchTrash, purgeEntity, restoreEntity } from '@/lib/mutations'
import { formatRelative } from '@/lib/date'
import { useNow } from '@/lib/hooks'
import { DUR, EASE_ENTER } from '@/lib/motion'
import type { TrashItem, TrashKind } from '@/types'

interface TrashGroupSpec {
  kind: TrashKind
  cn: string
  en: string
}

const GROUPS: TrashGroupSpec[] = [
  { kind: 'tasks', cn: '任务', en: 'TASKS' },
  { kind: 'projects', cn: '项目', en: 'PROJECTS' },
  { kind: 'notes', cn: '笔记', en: 'NOTES' },
  { kind: 'resources', cn: '资料', en: 'RESOURCES' },
  { kind: 'events', cn: '日程', en: 'EVENTS' },
  { kind: 'traces', cn: '踪迹', en: 'TRACES' },
  { kind: 'areas', cn: '区域', en: 'AREAS' },
  { kind: 'goals', cn: '目标', en: 'GOALS' },
  { kind: 'habits', cn: '习惯', en: 'HABITS' },
  { kind: 'courses', cn: '课程', en: 'COURSES' },
]

const itemKey = (item: TrashItem): string => `${item.kind}:${item.record.id}`

/** 移入时间（trashedAt 优先，回退记录的时间字段） */
function movedAt(record: TrashItem['record']): string {
  const r = record as {
    trashedAt?: string
    updatedAt?: string
    addedAt?: string
    createdAt?: string
  }
  return r.trashedAt ?? r.updatedAt ?? r.addedAt ?? r.createdAt ?? ''
}

/**
 * 回收站面板：按类型分组的列表 + 恢复 / 彻底删除（二次点击确认）。
 * 供 /trash 路由页与设置页「回收站」分区共用（ADR-0041 Phase 3）——所有行为 / 类名不变。
 */
export function TrashPanel() {
  const now = useNow()
  const { toast } = useToast()
  const reduce = useReducedMotion()
  const [items, setItems] = useState<TrashItem[]>([])
  const [loading, setLoading] = useState(true)
  // 彻底删除的二次确认：按下后标签切换，5s 内未再点则复位
  const [confirmKey, setConfirmKey] = useState<string | null>(null)

  const reload = useCallback(async () => {
    try {
      setItems(await fetchTrash())
    } catch (err) {
      toast(`回收站加载失败：${errorText(err)}`, { tone: 'error' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void reload()
  }, [reload])

  useEffect(() => {
    if (confirmKey === null) return
    const timer = window.setTimeout(() => setConfirmKey(null), 5000)
    return () => window.clearTimeout(timer)
  }, [confirmKey])

  const handleRestore = (item: TrashItem): void => {
    void (async () => {
      try {
        await restoreEntity(item.kind, item.record.id)
        setItems((prev) => prev.filter((entry) => itemKey(entry) !== itemKey(item)))
        toast('已恢复')
      } catch (err) {
        toast(`恢复失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  const handlePurge = (item: TrashItem): void => {
    const key = itemKey(item)
    if (confirmKey !== key) {
      setConfirmKey(key)
      return
    }
    void (async () => {
      try {
        await purgeEntity(item.kind, item.record.id)
        setConfirmKey(null)
        setItems((prev) => prev.filter((entry) => itemKey(entry) !== key))
        toast('已彻底删除')
      } catch (err) {
        setConfirmKey(null)
        toast(`删除失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  const isEmpty = !loading && items.length === 0

  if (loading) return <p className="k-muted">回收站加载中…</p>
  if (isEmpty) {
    return <EmptyState title="回收站为空" hint="删除的条目会出现在这里，可恢复或彻底删除。" />
  }
  return (
    <div className="k-trash">
      {GROUPS.map((group) => {
        const groupItems = items.filter((item) => item.kind === group.kind)
        if (groupItems.length === 0) return null
        return (
          <Panel
            key={group.kind}
            title={group.cn}
            en={group.en}
            actions={<span className="u-label k-muted">{groupItems.length}</span>}
          >
            <div className="k-trash__list">
              <AnimatePresence initial={false}>
                {groupItems.map((item) => {
                  const key = itemKey(item)
                  const confirming = confirmKey === key
                  return (
                    <motion.div
                      key={key}
                      layout
                      className="k-trash-row"
                      initial={reduce === true ? { opacity: 0 } : { opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: DUR.base, ease: EASE_ENTER }}
                    >
                      <span className="k-trash-row__main">
                        <span className="k-trash-row__title">{item.record.title}</span>
                        <span className="k-trash-row__meta u-mono">
                          {item.record.id} · 移入 {formatRelative(movedAt(item.record), now)}
                        </span>
                      </span>
                      <span className="k-trash-row__actions">
                        <button
                          type="button"
                          className="k-btn k-btn--sm"
                          onClick={() => handleRestore(item)}
                        >
                          恢复
                        </button>
                        <button
                          type="button"
                          className={confirming ? 'k-btn k-btn--sm is-danger' : 'k-btn k-btn--sm'}
                          onClick={() => handlePurge(item)}
                        >
                          {confirming ? '再点一次确认' : '彻底删除'}
                        </button>
                      </span>
                    </motion.div>
                  )
                })}
              </AnimatePresence>
            </div>
          </Panel>
        )
      })}
    </div>
  )
}

/** /trash 路由页：页首说明 + 回收站面板（深层链接与标题仍由路由解析保留）。 */
export function Trash() {
  return (
    <div className="k-view">
      <p className="k-view__intro">
        删除不会立即消失：任务、项目、笔记、资料、日程、课程、区域、目标与习惯会先移入回收站。可随时恢复；「彻底删除」不可撤销，需点两次确认。
      </p>
      <TrashPanel />
    </div>
  )
}
