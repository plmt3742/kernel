// KERNEL · 收件箱 INBOX（P0）：快速捕捉 + 未澄清列表 + 澄清操作条（原型态）
import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, ChevronRight, FileText, Mic, PenLine } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { MeterBar } from '@/components/MeterBar'
import { TagPill } from '@/components/TagPill'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { getInbox } from '@/lib/data'
import { addProtoInbox, useProtoInbox } from '@/lib/proto'
import { INBOX_SOURCE_LABEL } from '@/lib/format'
import { formatRelative } from '@/lib/date'
import { DUR, EASE_ENTER, EASE_EXIT } from '@/lib/motion'
import type { InboxSource } from '@/types'

type LocalStatus = 'clarified' | 'discarded'

interface DisplayItem {
  id: string
  content: string
  source: InboxSource
  capturedAt: string
  status: 'unprocessed' | 'clarified' | 'discarded'
  proto?: boolean
}

const WATER_MAX = 12
const WATER_THRESHOLD = 8

const SOURCE_ICON = {
  manual: PenLine,
  file: FileText,
  notification: Bell,
  voice: Mic,
} as const

const CLARIFY_TARGETS: Array<{ key: string; label: string }> = [
  { key: 'task', label: '→ 任务' },
  { key: 'project', label: '→ 项目' },
  { key: 'note', label: '→ 笔记' },
  { key: 'resource', label: '→ 资源' },
  { key: 'discard', label: '丢弃' },
]

export function Inbox() {
  const protoInbox = useProtoInbox()
  const { toast } = useToast()
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState('')
  const [localStatus, setLocalStatus] = useState<Record<string, LocalStatus>>({})
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

  const merged = useMemo<DisplayItem[]>(() => {
    const proto: DisplayItem[] = protoInbox.map((item) => ({
      id: item.id,
      content: item.content,
      source: item.source,
      capturedAt: item.capturedAt,
      status: 'unprocessed',
      proto: true,
    }))
    const real: DisplayItem[] = getInbox().map((item) => ({
      id: item.id,
      content: item.content,
      source: item.source,
      capturedAt: item.capturedAt,
      status: item.status,
    }))
    return [...proto, ...real].sort(
      (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
    )
  }, [protoInbox])

  const effective = (item: DisplayItem): DisplayItem['status'] => localStatus[item.id] ?? item.status
  const unprocessed = merged.filter((item) => effective(item) === 'unprocessed')
  const clarified = merged.filter((item) => effective(item) === 'clarified')
  const discarded = merged.filter((item) => effective(item) === 'discarded')

  const capture = (): void => {
    const value = draft.trim()
    if (value === '') return
    addProtoInbox(value)
    setDraft('')
    toast('原型态：已捕捉到本地收件箱，v0.4 起持久化写入 data/')
  }

  const clarify = (item: DisplayItem, target: string, label: string): void => {
    setLocalStatus((prev) => ({
      ...prev,
      [item.id]: target === 'discard' ? 'discarded' : 'clarified',
    }))
    const preview = item.content.length > 18 ? `${item.content.slice(0, 18)}…` : item.content
    toast(`原型态：「${preview}」${label}，v0.4 起持久化写入 data/`)
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
                      {item.proto === true && <TagPill accent>原型</TagPill>}
                    </div>
                    <div className="k-inbox-item__meta">
                      <span className="u-label">{INBOX_SOURCE_LABEL[item.source]}</span>
                      <span className="k-mono">{formatRelative(item.capturedAt)}</span>
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
                    <span className="k-mono">{formatRelative(item.capturedAt)}</span>
                    <span className="k-mono">{item.id}</span>
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
                    <span className="k-mono">{formatRelative(item.capturedAt)}</span>
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
