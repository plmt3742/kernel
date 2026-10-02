// KERNEL · 收件箱 INBOX（P0）：快速捕捉 + 按捕捉日期分组浏览 + 多选批量澄清（v0.4：直写数据服务）
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, ChevronRight, FileText, Mic, PenLine } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { MeterBar } from '@/components/MeterBar'
import { TagPill } from '@/components/TagPill'
import { Checkbox } from '@/components/Checkbox'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { getInbox } from '@/lib/data'
import { captureInbox, clarifyInbox, revertInbox, type ClarifyTarget } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision, useNow } from '@/lib/hooks'
import { INBOX_SOURCE_LABEL } from '@/lib/format'
import { addDays, daysFromToday, formatMonthDay, formatRelative, formatWeekdayShort } from '@/lib/date'
import { DUR, EASE_ENTER, EASE_EXIT } from '@/lib/motion'
import type { InboxItem } from '@/types'

const WATER_MAX = 12
const WATER_THRESHOLD = 8

const SOURCE_ICON = {
  manual: PenLine,
  file: FileText,
  notification: Bell,
  voice: Mic,
} as const

const CLARIFY_TARGETS: Array<{ key: ClarifyTarget; label: string }> = [
  { key: 'task', label: '→ 任务' },
  { key: 'project', label: '→ 项目' },
  { key: 'note', label: '→ 笔记' },
  { key: 'resource', label: '→ 资源' },
  { key: 'discard', label: '丢弃' },
]

// 日期分组：今天 / 昨天 / 更早（按 capturedAt 的日历日相对今天）
type GroupKey = 'today' | 'yesterday' | 'earlier'
const GROUP_ORDER: GroupKey[] = ['today', 'yesterday', 'earlier']
const GROUP_LABEL: Record<GroupKey, string> = { today: '今天', yesterday: '昨天', earlier: '更早' }

function groupOf(item: InboxItem, now: Date): GroupKey {
  const diff = daysFromToday(item.capturedAt, now)
  if (diff === 0) return 'today'
  if (diff === -1) return 'yesterday'
  return 'earlier'
}

export function Inbox() {
  const revision = useDataRevision()
  const { toast } = useToast()
  const now = useNow()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [showClarified, setShowClarified] = useState(false)
  const [showDiscarded, setShowDiscarded] = useState(false)
  // 多选：未澄清项 id 集合；展开：当前内联展开的单条 id
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const focus = (): void => inputRef.current?.focus()
    window.addEventListener('kernel:focus-capture', focus)
    return () => window.removeEventListener('kernel:focus-capture', focus)
  }, [])

  // 数据变化（澄清 / 撤销 / 水合）后剔除已不在未澄清列表中的选中项，避免残留脏 id
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev
      const valid = new Set(
        getInbox()
          .filter((item) => item.status === 'unprocessed')
          .map((item) => item.id),
      )
      let changed = false
      const next = new Set<string>()
      prev.forEach((id) => {
        if (valid.has(id)) next.add(id)
        else changed = true
      })
      return changed ? next : prev
    })
  }, [revision])

  const merged = [...getInbox()].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  )
  const unprocessed = merged.filter((item) => item.status === 'unprocessed')
  const clarified = merged.filter((item) => item.status === 'clarified')
  const discarded = merged.filter((item) => item.status === 'discarded')

  // 行序号（全局顺序，仅展示层派生，不落盘）
  const ordinal = new Map<string, number>()
  unprocessed.forEach((item, index) => ordinal.set(item.id, index + 1))

  // 分组（保持 overall 降序：今天 → 昨天 → 更早）
  const buckets: Record<GroupKey, InboxItem[]> = { today: [], yesterday: [], earlier: [] }
  for (const item of unprocessed) buckets[groupOf(item, now)].push(item)
  const groups = GROUP_ORDER.filter((key) => buckets[key].length > 0).map((key) => ({
    key,
    items: buckets[key],
  }))

  const groupMeta = (key: GroupKey, count: number): string => {
    if (key === 'today') return `${formatMonthDay(now)} · ${formatWeekdayShort(now)} · ${count} 项`
    if (key === 'yesterday') {
      const yesterday = addDays(now, -1)
      return `${formatMonthDay(yesterday)} · ${formatWeekdayShort(yesterday)} · ${count} 项`
    }
    return `${count} 项`
  }

  const allSelected = unprocessed.length > 0 && unprocessed.every((item) => selected.has(item.id))

  const capture = (): void => {
    const value = draft.trim()
    if (value === '') return
    void (async () => {
      try {
        await captureInbox(value)
        setDraft('')
        toast('已捕捉 · 待澄清')
      } catch (err) {
        toast(`捕捉失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  const clarify = (item: InboxItem, target: ClarifyTarget, label: string): void => {
    const preview = item.content.length > 18 ? `${item.content.slice(0, 18)}…` : item.content
    void (async () => {
      try {
        await clarifyInbox(item.id, target)
        toast(`「${preview}」${label}`, {
          action: {
            label: '撤销',
            onClick: () => {
              void revertInbox(item.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`澄清失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  const toggleOne = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = (): void => {
    setSelected((prev) => {
      if (unprocessed.length > 0 && unprocessed.every((item) => prev.has(item.id))) {
        return new Set()
      }
      return new Set(unprocessed.map((item) => item.id))
    })
  }

  // 批量动作：逐条澄清；成功条目汇总为一个「撤销」toast；失败即中止并保留剩余未处理项
  const runBatch = (target: ClarifyTarget, verb: string): void => {
    const ids = [...selected]
    if (ids.length === 0) return
    void (async () => {
      const done: string[] = []
      for (const id of ids) {
        try {
          await clarifyInbox(id, target)
          done.push(id)
        } catch (err) {
          // 失败即中止，剩余未处理项保持原状
          toast(`批量${verb}失败：${errorText(err)}`, { tone: 'error' })
          break
        }
      }
      setSelected(new Set())
      if (done.length > 0) {
        toast(`已处理 ${done.length} 条`, {
          action: {
            label: '撤销',
            onClick: () => {
              void (async () => {
                for (const id of done) {
                  try {
                    await revertInbox(id)
                  } catch (err) {
                    toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
                  }
                }
              })()
            },
          },
        })
      }
    })()
  }

  return (
    <div className="k-view">
      <div className="k-capture">
        <PenLine size={16} strokeWidth={1.5} className="k-muted" aria-hidden />
        <input
          ref={inputRef}
          className="k-capture__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') capture()
          }}
          placeholder="捕捉任何事… 回车写入收件箱（快捷键 c 聚焦）"
          aria-label="快速捕捉"
        />
        <kbd className="k-kbd">C</kbd>
      </div>

      <Panel className="ic-head">
        <MeterBar
          value={unprocessed.length}
          max={WATER_MAX}
          threshold={WATER_THRESHOLD}
          label="水位 · 收件箱存量"
          caption={`${unprocessed.length} / ${WATER_MAX}`}
          suffix={unprocessed.length > WATER_THRESHOLD ? '· 超阈' : '· 健康'}
        />
        <span className="u-label k-muted">按捕捉日期分组浏览 · 勾选多项后可批量澄清或丢弃</span>
      </Panel>

      {unprocessed.length === 0 ? (
        <Panel index="02" title="未澄清" en="UNPROCESSED">
          <EmptyState
            index="02"
            title="收件箱已清空"
            hint="非常好 —— 捕捉 → 澄清 的循环处于健康状态。"
          />
        </Panel>
      ) : (
        <>
          {/* 批量操作条 */}
          <Panel className="ic-batchbar">
            <Checkbox
              checked={allSelected}
              onToggle={toggleAll}
              label={allSelected ? '取消全选' : '全选'}
            />
            <span className="ic-batchbar__count">
              <b>{selected.size}</b> 项已选
            </span>
            <span className="u-label k-muted">共 {unprocessed.length} 项未澄清</span>
            <div className="ic-batchbar__actions">
              <button
                type="button"
                className="k-btn is-solid"
                disabled={selected.size === 0}
                onClick={() => runBatch('task', '澄清')}
              >
                批量 → 任务
              </button>
              <button
                type="button"
                className="k-btn"
                disabled={selected.size === 0}
                onClick={() => runBatch('discard', '丢弃')}
              >
                批量丢弃
              </button>
              <button
                type="button"
                className="k-btn"
                disabled={selected.size === 0}
                onClick={() => setSelected(new Set())}
              >
                取消选择
              </button>
            </div>
          </Panel>

          {/* 日期分组 */}
          <div className="ic-groups">
            {groups.map((group) => (
              <section className="k-group" key={group.key}>
                <div className="k-group__head">
                  <span className="k-group__title">{GROUP_LABEL[group.key]}</span>
                  <span className="u-label">{groupMeta(group.key, group.items.length)}</span>
                </div>
                <div>
                  <AnimatePresence initial={false}>
                    {group.items.map((item) => {
                      const Icon = SOURCE_ICON[item.source]
                      const isSelected = selected.has(item.id)
                      const isExpanded = expandedId === item.id
                      return (
                        <motion.div
                          className="ic-item"
                          key={item.id}
                          layout
                          initial={{ opacity: 0, y: 6 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{
                            opacity: 0,
                            height: 0,
                            overflow: 'hidden',
                            transition: { duration: DUR.base, ease: EASE_EXIT },
                          }}
                          transition={{ duration: DUR.base, ease: EASE_ENTER }}
                        >
                          <div className={isSelected ? 'ic-row is-selected' : 'ic-row'}>
                            <Checkbox
                              checked={isSelected}
                              onToggle={() => toggleOne(item.id)}
                              label={`选择：${item.content}`}
                            />
                            <span className="ic-row__no k-mono">
                              {String(ordinal.get(item.id) ?? 0).padStart(2, '0')}
                            </span>
                            <span className="k-source-icon" title={INBOX_SOURCE_LABEL[item.source]}>
                              <Icon size={13} strokeWidth={1.5} aria-hidden />
                            </span>
                            <span className="ic-row__body">
                              <span className="ic-row__title">{item.content}</span>
                              <span className="ic-row__meta">
                                <span className="u-label">{INBOX_SOURCE_LABEL[item.source]}</span>
                                <span className="k-mono">{formatRelative(item.capturedAt, now)}</span>
                                <span className="k-mono">{item.id}</span>
                              </span>
                            </span>
                            <span className="ic-row__tail">
                              <button
                                type="button"
                                className={isExpanded ? 'k-pill' : 'k-pill is-ghost'}
                                aria-expanded={isExpanded}
                                onClick={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
                              >
                                {isExpanded ? '收起' : '澄清'}
                              </button>
                            </span>
                          </div>
                          {isExpanded && (
                            <div className="ic-subrow">
                              <div className="k-clarify">
                                {CLARIFY_TARGETS.map((target) => (
                                  <TagPill
                                    key={target.key}
                                    onClick={() => clarify(item, target.key, target.label)}
                                  >
                                    {target.label}
                                  </TagPill>
                                ))}
                              </div>
                            </div>
                          )}
                        </motion.div>
                      )
                    })}
                  </AnimatePresence>
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      {clarified.length > 0 && (
        <div>
          <button
            type="button"
            className="k-collapse-head"
            aria-expanded={showClarified}
            onClick={() => setShowClarified((prev) => !prev)}
          >
            <ChevronRight size={14} strokeWidth={1.5} className="k-collapse-head__caret" aria-hidden />
            <span className="u-label">已澄清 CLARIFIED · {clarified.length}</span>
          </button>
          {showClarified && (
            <div>
              {clarified.map((item) => (
                <div className="k-inbox-item" key={item.id}>
                  <span className="k-inbox-item__content k-muted">{item.content}</span>
                  <span className="k-inbox-item__meta">
                    <span className="k-mono">{formatRelative(item.capturedAt, now)}</span>
                    <span className="k-mono">{item.linkedId ?? item.id}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {discarded.length > 0 && (
        <div>
          <button
            type="button"
            className="k-collapse-head"
            aria-expanded={showDiscarded}
            onClick={() => setShowDiscarded((prev) => !prev)}
          >
            <ChevronRight size={14} strokeWidth={1.5} className="k-collapse-head__caret" aria-hidden />
            <span className="u-label">已丢弃 DISCARDED · {discarded.length}</span>
          </button>
          {showDiscarded && (
            <div>
              {discarded.map((item) => (
                <div className="k-inbox-item" key={item.id}>
                  <span className="k-inbox-item__content k-muted">{item.content}</span>
                  <span className="k-inbox-item__meta">
                    <span className="k-mono">{formatRelative(item.capturedAt, now)}</span>
                    <span className="k-mono">{item.id}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
