// KERNEL · 收件箱 INBOX（P0）：快速捕捉 + 按捕捉日期分组浏览 + 多选批量澄清（v0.4：直写数据服务）
import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Bell, ChevronRight, FileText, Mic, PenLine, Sparkles } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { MeterBar } from '@/components/MeterBar'
import { TagPill } from '@/components/TagPill'
import { Checkbox } from '@/components/Checkbox'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { getAreaById, getInbox, getProjectById, getTaskById } from '@/lib/data'
import {
  aiParseInboxStream,
  captureInbox,
  clarifyInbox,
  revertInbox,
  type AiParseResult,
  type AiSuggestion,
  type ClarifyDetails,
  type ClarifyTarget,
} from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision, useNow } from '@/lib/hooks'
import { ENERGY_LABEL, INBOX_SOURCE_LABEL, tagLabel } from '@/lib/format'
import {
  addDays,
  daysFromToday,
  formatMonthDay,
  formatRelative,
  formatTime,
  formatWeekdayShort,
  humanizeDay,
} from '@/lib/date'
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

// AI 建议目标展示名（AI 不产出 project）
const AI_TARGET_LABEL: Record<AiSuggestion['target'], string> = {
  task: '任务',
  note: '笔记',
  resource: '资料',
  discard: '丢弃',
}

// 解析过程阶段（由 SSE 事件驱动；文案安静、不夸大）
type AiStage = 'connecting' | 'thinking' | 'generating' | 'retry' | 'validating'
const AI_STAGE_TEXT: Record<AiStage, string> = {
  connecting: '已连接，等待模型…',
  thinking: '思考中…',
  generating: '生成中…',
  retry: '输出未通过校验，重试中…',
  validating: '校验通过',
}
// 实时预览保留的尾部字符数
const AI_PREVIEW_MAX = 240

/** 由 AI 建议构造澄清覆盖字段（discard 无需 details；仅取已定义字段） */
function toClarifyDetails(suggestion: AiSuggestion): ClarifyDetails | undefined {
  if (suggestion.target === 'discard') return undefined
  const details: ClarifyDetails = {
    title: suggestion.title,
    energy: suggestion.energy,
    importance: suggestion.importance,
  }
  if (suggestion.contexts.length > 0) details.contexts = suggestion.contexts
  if (suggestion.estimateMin !== undefined) details.estimateMin = suggestion.estimateMin
  if (suggestion.dueAt !== undefined) details.dueAt = suggestion.dueAt
  // 关联建议仅对任务目标生效（服务端对非 task 忽略 projectId / areaId）
  if (suggestion.target === 'task') {
    if (suggestion.projectId !== undefined) details.projectId = suggestion.projectId
    if (suggestion.areaId !== undefined) details.areaId = suggestion.areaId
  }
  return details
}

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
  // AI 解析：同一时刻仅一条活跃流（aiReqRef 防止旧请求迟到覆盖）
  const [aiFor, setAiFor] = useState<string | null>(null)
  const [aiPhase, setAiPhase] = useState<'parsing' | 'ready' | 'error'>('parsing')
  const [aiResult, setAiResult] = useState<AiParseResult | null>(null)
  const [aiError, setAiError] = useState('')
  // 过程可视：阶段 + 流式增量（text / reasoning 分开累积，保留尾部）
  const [aiStage, setAiStage] = useState<AiStage>('connecting')
  const [aiText, setAiText] = useState('')
  const [aiReasoning, setAiReasoning] = useState('')
  const aiReqRef = useRef(0)

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

  // 条目离开未澄清列表（应用建议 / 撤销 / 水合）后收起 AI 流，避免残留脏状态
  useEffect(() => {
    if (aiFor === null) return
    const stillUnprocessed = getInbox().some(
      (item) => item.id === aiFor && item.status === 'unprocessed',
    )
    if (!stillUnprocessed) {
      aiReqRef.current += 1
      setAiFor(null)
      setAiResult(null)
      setAiError('')
      setAiStage('connecting')
      setAiText('')
      setAiReasoning('')
    }
  }, [revision, aiFor])

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

  // AI 建议的关联展示（按 id 查快照；仅提示，绝不自动合并 / 落盘）
  const aiSuggestion = aiResult?.suggestion ?? null
  const aiProject =
    aiSuggestion?.projectId !== undefined ? getProjectById(aiSuggestion.projectId) : undefined
  const aiArea =
    aiSuggestion?.areaId !== undefined ? getAreaById(aiSuggestion.areaId) : undefined
  const aiDuplicate =
    aiSuggestion?.duplicateOf !== undefined ? getTaskById(aiSuggestion.duplicateOf) : undefined
  const aiHasLinks =
    aiProject !== undefined ||
    aiArea !== undefined ||
    aiDuplicate !== undefined ||
    (aiSuggestion?.tags.length ?? 0) > 0

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

  // 清空 AI 流并作废在途请求（旧响应迟到不再落状态）
  const clearAi = (): void => {
    aiReqRef.current += 1
    setAiFor(null)
    setAiResult(null)
    setAiError('')
    setAiStage('connecting')
    setAiText('')
    setAiReasoning('')
  }

  // 展开 / 收起：收起或切换到另一条时清空 AI 流
  const toggleExpand = (id: string): void => {
    const next = expandedId === id ? null : id
    if (next === null || aiFor !== null) clearAi()
    setExpandedId(next)
  }

  // 运行 AI 解析（流式；同一时刻仅一条活跃流）
  const runParse = (item: InboxItem): void => {
    const req = (aiReqRef.current += 1)
    setAiFor(item.id)
    setAiPhase('parsing')
    setAiResult(null)
    setAiError('')
    setAiStage('connecting')
    setAiText('')
    setAiReasoning('')
    void (async () => {
      try {
        const result = await aiParseInboxStream(item.id, (event) => {
          if (aiReqRef.current !== req) return
          if (event.kind === 'status') {
            if (event.status === 'busy') {
              setAiStage((prev) => (prev === 'connecting' ? 'thinking' : prev))
            }
          } else if (event.kind === 'delta') {
            if (event.field === 'reasoning') {
              setAiReasoning((prev) => (prev + event.delta).slice(-AI_PREVIEW_MAX))
              setAiStage((prev) => (prev === 'generating' ? prev : 'thinking'))
            } else if (event.field === 'text') {
              setAiText((prev) => (prev + event.delta).slice(-AI_PREVIEW_MAX))
              setAiStage('generating')
            }
          } else if (event.kind === 'retry') {
            setAiStage('retry')
          } else if (event.kind === 'suggestion') {
            setAiStage('validating')
          }
        })
        if (aiReqRef.current !== req) return
        setAiResult(result)
        setAiPhase('ready')
      } catch (err) {
        if (aiReqRef.current !== req) return
        setAiError(errorText(err))
        setAiPhase('error')
      }
    })()
  }

  // 应用 AI 建议：复用单条澄清的 toast + 撤销路径（ai 审计标记 + details 覆盖）
  const applyAi = (item: InboxItem, suggestion: AiSuggestion): void => {
    const details = toClarifyDetails(suggestion)
    const label = suggestion.target === 'discard' ? '已按 AI 建议丢弃' : '已按 AI 建议创建'
    void (async () => {
      try {
        await clarifyInbox(
          item.id,
          suggestion.target,
          details === undefined ? { ai: true } : { ai: true, details },
        )
        clearAi()
        toast(label, {
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
        toast(`应用失败：${errorText(err)}`, { tone: 'error' })
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
                                onClick={() => toggleExpand(item.id)}
                              >
                                {isExpanded ? '收起' : '澄清'}
                              </button>
                            </span>
                          </div>
                          {isExpanded && (
                            <div className="ic-subrow">
                              <div className="k-clarify">
                                <button
                                  type="button"
                                  className="k-pill is-ghost"
                                  onClick={() => runParse(item)}
                                  disabled={aiFor === item.id && aiPhase === 'parsing'}
                                  aria-busy={aiFor === item.id && aiPhase === 'parsing'}
                                  title="让本地 AI 解析为结构化建议（仅建议，确认后写入）"
                                >
                                  <Sparkles size={12} strokeWidth={1.5} aria-hidden />
                                  AI 解析
                                </button>
                                {CLARIFY_TARGETS.map((target) => (
                                  <TagPill
                                    key={target.key}
                                    onClick={() => clarify(item, target.key, target.label)}
                                  >
                                    {target.label}
                                  </TagPill>
                                ))}
                              </div>
                              {aiFor === item.id && (
                                <div
                                  className={aiPhase === 'error' ? 'ic-ai is-error' : 'ic-ai'}
                                  aria-live="polite"
                                >
                                  {aiPhase === 'parsing' && (
                                    <div className="ic-ai__process">
                                      <span className="ic-ai__stage">{AI_STAGE_TEXT[aiStage]}</span>
                                      {aiText !== '' ? (
                                        <p className="ic-ai__stream">{aiText}</p>
                                      ) : aiReasoning !== '' ? (
                                        <p className="ic-ai__stream is-dim">{aiReasoning}</p>
                                      ) : null}
                                    </div>
                                  )}
                                  {aiPhase === 'error' && (
                                    <>
                                      <div className="ic-ai__head">
                                        <span className="ic-ai__title">解析失败</span>
                                      </div>
                                      <p className="ic-ai__reason">{aiError}</p>
                                      <div className="ic-ai__actions">
                                        <button
                                          type="button"
                                          className="k-pill is-ghost"
                                          onClick={() => runParse(item)}
                                        >
                                          重试
                                        </button>
                                        <button
                                          type="button"
                                          className="k-pill is-ghost"
                                          onClick={clearAi}
                                        >
                                          忽略
                                        </button>
                                      </div>
                                    </>
                                  )}
                                  {aiPhase === 'ready' && aiResult !== null && (
                                    <>
                                      <div className="ic-ai__head">
                                        <span className="k-pill">
                                          {AI_TARGET_LABEL[aiResult.suggestion.target]}
                                        </span>
                                        <span className="ic-ai__title">{aiResult.suggestion.title}</span>
                                      </div>
                                      <div className="ic-ai__meta">
                                        {aiResult.suggestion.contexts.map((ctx) => (
                                          <TagPill key={ctx}>{ctx}</TagPill>
                                        ))}
                                        <span className="k-pill">
                                          {ENERGY_LABEL[aiResult.suggestion.energy]}能
                                        </span>
                                        <span className="k-pill">
                                          重要性 {aiResult.suggestion.importance}/3
                                        </span>
                                        {aiResult.suggestion.estimateMin !== undefined && (
                                          <span className="k-pill">
                                            ≈{aiResult.suggestion.estimateMin} 分钟
                                          </span>
                                        )}
                                        {aiResult.suggestion.dueAt !== undefined && (
                                          <span className="k-pill">
                                            截止 {humanizeDay(aiResult.suggestion.dueAt, now)}{' '}
                                            {formatTime(aiResult.suggestion.dueAt)}
                                          </span>
                                        )}
                                      </div>
                                      <p className="ic-ai__reason">{aiResult.suggestion.reason}</p>
                                      {aiHasLinks && (
                                        <div className="ic-ai__links">
                                          {aiProject !== undefined && (
                                            <span className="k-pill">建议挂到 {aiProject.title}</span>
                                          )}
                                          {aiArea !== undefined && (
                                            <span className="k-pill">建议归入 {aiArea.title}</span>
                                          )}
                                          {(aiSuggestion?.tags ?? []).map((tag) => (
                                            <TagPill key={tag}>{tagLabel(tag)}</TagPill>
                                          ))}
                                          {aiDuplicate !== undefined && (
                                            <span className="ic-ai__dup">
                                              疑似与「{aiDuplicate.title}」重复
                                            </span>
                                          )}
                                        </div>
                                      )}
                                      <div className="ic-ai__actions">
                                        <button
                                          type="button"
                                          className="k-btn is-solid"
                                          onClick={() => applyAi(item, aiResult.suggestion)}
                                        >
                                          应用建议
                                        </button>
                                        <button type="button" className="k-btn" onClick={clearAi}>
                                          忽略
                                        </button>
                                      </div>
                                    </>
                                  )}
                                </div>
                              )}
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
