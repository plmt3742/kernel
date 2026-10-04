// KERNEL · 「AI 动态」幕后日志（v0.5 · Slice R2，见 ADR-0016）
// 只读：读审计日志尾部，筛选 AI / 自动条目，时间倒序，动作摘要 + 实体深链。
// 撤销在动作发生时由 toast 承载；本 feed 是事后记录（刷新随数据版本）。
import { useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { formatTime } from '@/lib/date'
import { deepLinkOfId } from '@/lib/relations'
import { useDataRevision } from '@/lib/hooks'
import type { ActivityEntry } from '@/lib/mutations'

/** 展示上限（有界渲染） */
const FEED_CAP = 50

/** 是否属于「AI 动态」：AI 解析 / 应用 / 撤销、档位更新、聚类立项与其撤销 */
function isAiEntry(entry: ActivityEntry): boolean {
  const action = entry.action ?? ''
  if (entry.detail?.ai === true) return true
  if (action.startsWith('ai.')) return true
  if (action === 'inbox.apply' || action === 'inbox.unapply') return true
  if (action === 'config.update') return true
  if (action === 'project.create' && entry.detail?.via === 'cluster') return true
  if (action === 'project.trash' && entry.detail?.via === 'cluster-unapply') return true
  if (action === 'task.update' && (entry.detail?.via === 'cluster' || entry.detail?.via === 'cluster-unapply')) {
    return true
  }
  // AI 整理（Slice N8）：归并 / 新项目 / 撤销整理（含撤销时的标签清理）
  if (
    (action === 'project.create' || action === 'project.trash' || action === 'task.update') &&
    (entry.detail?.via === 'organize' || entry.detail?.via === 'organize-unapply')
  ) {
    return true
  }
  if (action === 'tag.remove' && entry.detail?.via === 'organize-unapply') return true
  return false
}

/** 动作 → 中文摘要（安静小灰字；未知动作回退原始 action） */
const ACTION_TEXT: Record<string, string> = {
  'inbox.parse': 'AI 解析收件箱',
  'inbox.parse-stream': 'AI 解析收件箱',
  'inbox.apply': 'AI 一揽子应用',
  'inbox.unapply': 'AI 撤销应用',
  'inbox.clarify': 'AI 澄清条目',
  'inbox.clarify.task': 'AI 澄清为任务',
  'inbox.clarify.note': 'AI 澄清为笔记',
  'inbox.clarify.resource': 'AI 澄清为资料',
  'inbox.clarify.project': 'AI 澄清为项目',
  'inbox.discard': 'AI 丢弃条目',
  'task.create': 'AI 创建任务',
  'task.update': 'AI 归入项目',
  'note.create': 'AI 创建笔记',
  'resource.create': 'AI 创建资料',
  'project.create': 'AI 归纳建项',
  'project.trash': '撤销归纳（项目入回收站）',
  'config.update': 'AI 自动化档位更新',
  'tag.create': 'AI 登记标签',
}

function describe(entry: ActivityEntry): string {
  const action = entry.action ?? ''
  const via = entry.detail?.via
  // 整理（organize）与其撤销使用更贴合语境的中文摘要；其余沿用通用映射
  if (via === 'organize') {
    if (action === 'project.create') return 'AI 整理建项'
    if (action === 'task.update') return 'AI 整理归入项目'
  }
  if (via === 'organize-unapply') {
    if (action === 'project.trash') return '撤销整理（项目入回收站）'
    if (action === 'task.update') return '撤销整理（任务移出项目）'
    if (action === 'tag.remove') return '撤销整理（清理标签）'
  }
  return ACTION_TEXT[action] ?? action
}

export function AiActivityFeed(): ReactNode {
  const revision = useDataRevision()
  const navigate = useNavigate()
  const [items, setItems] = useState<ActivityEntry[]>([])
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    api
      .get<{ items: ActivityEntry[] }>('/api/activity?limit=200')
      .then((res) => {
        if (cancelled) return
        setItems(res.items.filter(isAiEntry).slice(0, FEED_CAP))
        setError(false)
      })
      .catch(() => {
        if (!cancelled) {
          setItems([])
          setError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  if (error) return <p className="k-settings__empty">数据服务离线：AI 动态暂不可用。</p>
  if (items.length === 0) return <p className="k-settings__empty">暂无 AI 动态</p>

  return (
    <div className="k-ai-feed">
      {items.map((entry, index) => {
        const link = deepLinkOfId(entry.id)
        return (
          // 审计条目无唯一 id，且同一秒可能有多条同动作记录：以索引兜底保证 key 唯一
          <div className="k-ai-feed__row" key={`${entry.ts}-${entry.action}-${entry.id}-${index}`}>
            <span className="k-mono k-muted k-ai-feed__time">{formatTime(entry.ts)}</span>
            <span className="k-ai-feed__desc">{describe(entry)}</span>
            {link !== null ? (
              <button
                type="button"
                className="k-ai-feed__link k-mono"
                onClick={() => navigate(link, { viewTransition: true })}
                title="跳转查看该实体"
              >
                {entry.id}
              </button>
            ) : (
              <span className="k-mono k-muted">{entry.id}</span>
            )}
          </div>
        )
      })}
    </div>
  )
}
