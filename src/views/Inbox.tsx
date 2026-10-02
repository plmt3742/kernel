// KERNEL · 收件箱 INBOX（P0）：快速捕捉 + 未澄清列表 + 澄清操作条（v0.4：直写数据服务）
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, ChevronRight, FileText, Mic, PenLine } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { MeterBar } from '@/components/MeterBar'
import { TagPill } from '@/components/TagPill'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { getInbox } from '@/lib/data'
import { captureInbox, clarifyInbox, revertInbox, type ClarifyTarget } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision, useNow } from '@/lib/hooks'
import { INBOX_SOURCE_LABEL } from '@/lib/format'
import { formatRelative } from '@/lib/date'
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

export function Inbox() {
  useDataRevision()
  const { toast } = useToast()
  const now = useNow()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [showClarified, setShowClarified] = useState(false)
  const [showDiscarded, setShowDiscarded] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const focus = (): void => inputRef.current?.focus()
    window.addEventListener('kernel:focus-capture', focus)
    return () => window.removeEventListener('kernel:focus-capture', focus)
  }, [])

  const merged = [...getInbox()].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  )
  const unprocessed = merged.filter((item) => item.status === 'unprocessed')
  const clarified = merged.filter((item) => item.status === 'clarified')
  const discarded = merged.filter((item) => item.status === 'discarded')

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

      <Panel
        index="01"
        title="水位"
        en="WATER LEVEL"
        actions={<span className="u-label k-muted">未澄清 {unprocessed.length}</span>}
      >
        <MeterBar
          value={unprocessed.length}
          max={WATER_MAX}
          threshold={WATER_THRESHOLD}
          label="收件箱存量"
          caption={`${unprocessed.length} / ${WATER_MAX}`}
          suffix={unprocessed.length > WATER_THRESHOLD ? '· 超阈' : '· 健康'}
        />
      </Panel>

      <Panel index="02" title="未澄清" en="UNPROCESSED">
        {unprocessed.length === 0 ? (
          <EmptyState
            index="02"
            title="收件箱已清空"
            hint="非常好 —— 捕捉 → 澄清 的循环处于健康状态。"
          />
        ) : (
          <div>
            <AnimatePresence initial={false}>
              {unprocessed.map((item) => {
                const Icon = SOURCE_ICON[item.source]
                return (
                  <motion.div
                    className="k-inbox-item"
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
                    <div className="k-inbox-item__top">
                      <span className="k-source-icon" title={INBOX_SOURCE_LABEL[item.source]}>
                        <Icon size={13} strokeWidth={1.5} aria-hidden />
                      </span>
                      <span className="k-inbox-item__content">{item.content}</span>
                    </div>
                    <div className="k-inbox-item__meta">
                      <span className="u-label">{INBOX_SOURCE_LABEL[item.source]}</span>
                      <span className="k-mono">{formatRelative(item.capturedAt, now)}</span>
                      <span className="k-mono">{item.id}</span>
                    </div>
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
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>
        )}
      </Panel>

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
