// KERNEL · 收件箱 INBOX（P0）：快速捕捉 + 按捕捉日期分组浏览 + 多选批量澄清（v0.4：直写数据服务）
import { useEffect, useRef, useState, type DragEvent as ReactDragEvent } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { ArrowUp, Bell, ChevronRight, FileText, Mic, Paperclip, PenLine, Sparkles } from 'lucide-react'
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
  uploadInboxFile,
  type AiParseResult,
  type AiSuggestion,
  type ClarifyDetails,
  type ClarifyTarget,
} from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision, useNow } from '@/lib/hooks'
import { ENERGY_LABEL, humanSize, INBOX_SOURCE_LABEL, tagLabel } from '@/lib/format'
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

/**
 * 单条 AI 建议缓存（Slice E1）：模块级 Map，跨路由切换存活于本会话。
 * - 收起 / 切换条目后再次展开：直接命中缓存 → 就绪卡（不重解析、无阶段文案）。
 * - 条目离开未澄清列表（应用 / 撤销 / 水合对账）：删除其缓存。
 * - 「重新解析」：强制覆盖该条缓存。
 */
const aiSuggestionCache = new Map<string, AiParseResult>()

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
  const reduce = useReducedMotion()
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
  // 流式增量节流（Slice E2.6）：delta 先入 ref 缓冲，~100ms 节流 flush 到 React state，
  // 避免逐 delta 重渲染导致过程面板与下方元素频繁抖动；尾部字符上限沿用 AI_PREVIEW_MAX。
  const deltaBufRef = useRef<{ text: string; reasoning: string }>({ text: '', reasoning: '' })
  const deltaTimerRef = useRef<number | null>(null)
  // 文件投递（Slice D）：待上传队列 + 拖拽态 + 上传/解析状态播报
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  // 批量 AI 解析进度（Slice E1）：非空即运行中，期间禁用批量动作防重叠
  const [batchAi, setBatchAi] = useState<{ current: number; total: number } | null>(null)
  // 批量条侧挂 dock（Slice E2.5）：内联批量条滚出视口时为 true；dock 镜像其状态与动作
  const batchBarRef = useRef<HTMLDivElement>(null)
  const [barVisible, setBarVisible] = useState(true)

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

  // AI 建议缓存对账（Slice E1）：条目一旦离开未澄清列表即删除其缓存（应用 / 撤销 / 水合）
  useEffect(() => {
    if (aiSuggestionCache.size === 0) return
    const unprocessedIds = new Set(
      getInbox()
        .filter((item) => item.status === 'unprocessed')
        .map((item) => item.id),
    )
    for (const id of [...aiSuggestionCache.keys()]) {
      if (!unprocessedIds.has(id)) aiSuggestionCache.delete(id)
    }
  }, [revision])

  const merged = [...getInbox()].sort(
    (a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime(),
  )
  const unprocessed = merged.filter((item) => item.status === 'unprocessed')
  const clarified = merged.filter((item) => item.status === 'clarified')
  const discarded = merged.filter((item) => item.status === 'discarded')

  // 观察内联批量条可见性；滚出视口 → 显示右侧浮动 dock，回到视口 → 隐藏（Slice E2.5）
  useEffect(() => {
    const node = batchBarRef.current
    if (node === null) return
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry !== undefined) setBarVisible(entry.isIntersecting)
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [unprocessed.length])

  // 批量解析过程可视（Slice E2.6）：当前解析条目若不在视口内，轻柔滚入（尊重 reduced-motion → 瞬时）
  useEffect(() => {
    if (batchAi === null || aiFor === null) return
    const node = document.querySelector(`.ic-item[data-inbox-id="${CSS.escape(aiFor)}"]`)
    if (node instanceof HTMLElement) {
      node.scrollIntoView({
        behavior: reduce === true ? 'auto' : 'smooth',
        block: 'nearest',
      })
    }
  }, [batchAi, aiFor, reduce])

  // 流式增量定时器卸载清理（避免离开页面后仍触发 setState）
  useEffect(
    () => () => {
      if (deltaTimerRef.current !== null) window.clearTimeout(deltaTimerRef.current)
    },
    [],
  )

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
  const aiNewProjectHint = aiSuggestion?.newProjectHint
  const aiHasLinks =
    aiProject !== undefined ||
    aiArea !== undefined ||
    aiDuplicate !== undefined ||
    aiNewProjectHint !== undefined ||
    (aiSuggestion?.tags.length ?? 0) > 0

  const captureText = (): void => {
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

  // 待上传文件队列（点击选择 / 拖拽落入共用）
  const addFiles = (files: File[]): void => {
    if (files.length === 0) return
    setPendingFiles((prev) => [...prev, ...files])
  }

  const removePending = (index: number): void => {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index))
  }

  // 拖拽投递（document 内深度计数，避免子元素 dragleave 抖动）
  const onDragEnter = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    const types = event.dataTransfer === null ? [] : Array.from(event.dataTransfer.types)
    if (types.includes('Files')) {
      dragDepth.current += 1
      setDragOver(true)
    }
  }

  const onDragLeave = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragDepth.current -= 1
    if (dragDepth.current <= 0) {
      dragDepth.current = 0
      setDragOver(false)
    }
  }

  const onDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    dragDepth.current = 0
    setDragOver(false)
    if (event.dataTransfer !== null) addFiles(Array.from(event.dataTransfer.files))
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

  // 清空流式增量缓冲并取消待 flush（切换条目 / 清空 / 出错时调用）
  const resetDeltas = (): void => {
    if (deltaTimerRef.current !== null) {
      window.clearTimeout(deltaTimerRef.current)
      deltaTimerRef.current = null
    }
    deltaBufRef.current.text = ''
    deltaBufRef.current.reasoning = ''
  }

  // 把缓冲的增量一次性写入 state（保留尾部）；成功 / 重试 / 出错前做最终 flush
  const flushDeltas = (): void => {
    if (deltaTimerRef.current !== null) {
      window.clearTimeout(deltaTimerRef.current)
      deltaTimerRef.current = null
    }
    const text = deltaBufRef.current.text
    const reasoning = deltaBufRef.current.reasoning
    deltaBufRef.current.text = ''
    deltaBufRef.current.reasoning = ''
    if (text !== '') setAiText(text.slice(-AI_PREVIEW_MAX))
    if (reasoning !== '') setAiReasoning(reasoning.slice(-AI_PREVIEW_MAX))
  }

  // 增量入缓冲（尾部截断）；首个增量触发一次 ~100ms 节流窗口
  const pushDelta = (field: string, delta: string): void => {
    const buf = deltaBufRef.current
    if (field === 'reasoning') buf.reasoning = (buf.reasoning + delta).slice(-AI_PREVIEW_MAX)
    else if (field === 'text') buf.text = (buf.text + delta).slice(-AI_PREVIEW_MAX)
    else return
    if (deltaTimerRef.current === null) {
      deltaTimerRef.current = window.setTimeout(flushDeltas, 100)
    }
  }

  // 清空 AI 流并作废在途请求（旧响应迟到不再落状态）
  const clearAi = (): void => {
    aiReqRef.current += 1
    resetDeltas()
    setAiFor(null)
    setAiResult(null)
    setAiError('')
    setAiStage('connecting')
    setAiText('')
    setAiReasoning('')
  }

  // 展开 / 收起：收起时停止 AI 流（保留缓存）；展开时命中缓存直接显示就绪卡（不重解析）
  const toggleExpand = (id: string): void => {
    const next = expandedId === id ? null : id
    clearAi()
    if (next !== null) {
      const cached = aiSuggestionCache.get(next)
      if (cached !== undefined) {
        setAiFor(next)
        setAiPhase('ready')
        setAiResult(cached)
      }
    }
    setExpandedId(next)
  }

  // 运行 AI 解析（流式；同一时刻仅一条活跃流）；失败置错误态并抛出（自动流程据此 toast 后继续）
  const runParse = async (item: InboxItem): Promise<void> => {
    const req = (aiReqRef.current += 1)
    resetDeltas()
    setExpandedId(item.id)
    setAiFor(item.id)
    setAiPhase('parsing')
    setAiResult(null)
    setAiError('')
    setAiStage('connecting')
    setAiText('')
    setAiReasoning('')
    try {
      const result = await aiParseInboxStream(item.id, (event) => {
        if (aiReqRef.current !== req) return
        if (event.kind === 'status') {
          if (event.status === 'busy') {
            setAiStage((prev) => (prev === 'connecting' ? 'thinking' : prev))
          }
        } else if (event.kind === 'delta') {
          pushDelta(event.field, event.delta)
          if (event.field === 'reasoning') {
            setAiStage((prev) => (prev === 'generating' ? prev : 'thinking'))
          } else if (event.field === 'text') {
            setAiStage('generating')
          }
        } else if (event.kind === 'retry') {
          flushDeltas()
          setAiStage('retry')
        } else if (event.kind === 'suggestion') {
          flushDeltas()
          setAiStage('validating')
        }
      })
      if (aiReqRef.current !== req) return
      flushDeltas()
      aiSuggestionCache.set(item.id, result)
      setAiResult(result)
      setAiPhase('ready')
    } catch (err) {
      if (aiReqRef.current !== req) return
      flushDeltas()
      setAiError(errorText(err))
      setAiPhase('error')
      throw err
    }
  }

  // 批量 AI 解析（Slice E1 + E2.6）：顺序解析选中项、进度可见、失败续跑；绝不自动应用。
  // E2.6：复用单条流式路径 runParse —— 当前条目自动展开并显示实时过程面板（阶段 + 增量预览），
  // 上一条随之收起；完成后其建议入缓存（再次展开命中缓存瞬时呈现）。末尾条目保持展开显示就绪卡。
  const runBatchAi = (): void => {
    const ids = [...selected]
    if (ids.length === 0) return
    void (async () => {
      let succeeded = 0
      for (let i = 0; i < ids.length; i += 1) {
        setBatchAi({ current: i + 1, total: ids.length })
        const item = getInbox().find((candidate) => candidate.id === ids[i])
        if (item === undefined || item.status !== 'unprocessed') continue
        try {
          await runParse(item)
          succeeded += 1
        } catch (err) {
          toast(`AI 解析失败：${errorText(err)}`, { tone: 'error' })
        }
      }
      setBatchAi(null)
      if (succeeded > 0) toast(`AI 解析完成 · ${succeeded} 条建议已就绪`)
    })()
  }

  // 发送（DeepSeek 式）：无文件 → 文本捕捉；有文件 → 逐个上传（caption = 当前输入）→ 逐个自动 AI 先读
  const send = (): void => {
    const caption = draft.trim()
    if (pendingFiles.length === 0) {
      if (caption === '') return
      captureText()
      return
    }
    const files = pendingFiles
    setPendingFiles([])
    setDraft('')
    void (async () => {
      const uploaded: InboxItem[] = []
      for (let i = 0; i < files.length; i += 1) {
        setBusyLabel(`上传中 ${i + 1}/${files.length}…`)
        try {
          uploaded.push(await uploadInboxFile(files[i], caption))
        } catch (err) {
          toast(`上传失败：${errorText(err)}`, { tone: 'error' })
        }
      }
      if (uploaded.length === 0) {
        setBusyLabel('')
        return
      }
      toast(`已投递 ${uploaded.length} 个文件 · AI 先读一遍`)
      for (let i = 0; i < uploaded.length; i += 1) {
        setBusyLabel(`AI 读取中 ${i + 1}/${uploaded.length}…`)
        try {
          await runParse(uploaded[i])
        } catch (err) {
          toast(`AI 解析失败：${errorText(err)}`, { tone: 'error' })
        }
      }
      setBusyLabel('')
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
        aiSuggestionCache.delete(item.id)
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

  // 批量动作：逐条澄清；仅成功后移除已处理选中项（中止时保留剩余）；汇总为明确的「撤销」toast
  const runBatch = (
    target: ClarifyTarget,
    verb: string,
    successMessage: (count: number) => string,
  ): void => {
    const ids = [...selected]
    if (ids.length === 0) return
    void (async () => {
      const done: string[] = []
      for (const id of ids) {
        try {
          await clarifyInbox(id, target)
          done.push(id)
        } catch (err) {
          // 失败即中止，剩余未处理项与选中态保持原状
          toast(`批量${verb}失败：${errorText(err)}`, { tone: 'error' })
          break
        }
      }
      if (done.length === 0) return
      // 选中态在成功后收敛（绝不提前清空）
      setSelected((prev) => {
        const next = new Set(prev)
        done.forEach((id) => next.delete(id))
        return next
      })
      toast(successMessage(done.length), {
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
    })()
  }

  return (
    <div className="k-view">
      <div
        className={dragOver ? 'ic-composer is-dragover' : 'ic-composer'}
        onDragEnter={onDragEnter}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="ic-composer__file"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []))
            event.target.value = ''
          }}
          aria-hidden
          tabIndex={-1}
        />
        {pendingFiles.length > 0 && (
          <div className="ic-chips">
            {pendingFiles.map((file, index) => (
              <span className="ic-chip" key={`${file.name}-${file.size}-${index}`}>
                <FileText size={12} strokeWidth={1.5} aria-hidden />
                <span className="ic-chip__name">{file.name}</span>
                <span className="ic-chip__size k-mono">{humanSize(file.size)}</span>
                <button
                  type="button"
                  className="ic-chip__remove"
                  aria-label={`移除 ${file.name}`}
                  onClick={() => removePending(index)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          ref={inputRef}
          className="ic-composer__input"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') send()
          }}
          placeholder="捕捉任何事…或拖入一个文件，AI 会先读一遍"
          aria-label="快速捕捉"
        />
        <div className="ic-composer__foot">
          <div className="ic-composer__actions">
            <button
              type="button"
              className="ic-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              aria-label="添加文件"
              title="添加文件（可多选）"
            >
              <Paperclip size={16} strokeWidth={1.5} aria-hidden />
            </button>
            <span className="ic-composer__hint u-label k-muted">拖拽文件到此处</span>
            <span className="ic-composer__busy u-label" role="status" aria-live="polite">
              {busyLabel}
            </span>
            <kbd className="k-kbd">C</kbd>
          </div>
          <button
            type="button"
            className="ic-send"
            onClick={send}
            disabled={draft.trim() === '' && pendingFiles.length === 0}
            aria-label="发送"
          >
            <ArrowUp size={16} strokeWidth={2} aria-hidden />
          </button>
        </div>
        {dragOver && (
          <div className="ic-composer__veil" aria-hidden>
            <span className="ic-composer__veil-text">松开：放入收件箱</span>
          </div>
        )}
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
          {/* 批量操作条（观察其可见性 → 侧挂 dock） */}
          <div ref={batchBarRef}>
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
              {batchAi !== null && (
                <span className="ic-batchbar__progress u-label" role="status" aria-live="polite">
                  AI 解析中 {batchAi.current}/{batchAi.total}…
                </span>
              )}
              <button
                type="button"
                className="k-btn"
                disabled={selected.size === 0 || batchAi !== null}
                onClick={runBatchAi}
              >
                批量 AI 解析
              </button>
              <button
                type="button"
                className="k-btn is-solid"
                disabled={selected.size === 0 || batchAi !== null}
                onClick={() => runBatch('task', '澄清', (n) => `已批量创建 ${n} 条任务`)}
              >
                批量 → 任务
              </button>
              <button
                type="button"
                className="k-btn"
                disabled={selected.size === 0 || batchAi !== null}
                onClick={() => runBatch('discard', '丢弃', (n) => `已批量丢弃 ${n} 条`)}
              >
                批量丢弃
              </button>
              <button
                type="button"
                className="k-btn"
                disabled={selected.size === 0 || batchAi !== null}
                onClick={() => setSelected(new Set())}
              >
                取消选择
              </button>
            </div>
          </Panel>
          </div>

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
                      const Icon = item.file !== undefined ? FileText : SOURCE_ICON[item.source]
                      const isSelected = selected.has(item.id)
                      const isExpanded = expandedId === item.id
                      return (
                        <motion.div
                          className="ic-item"
                          key={item.id}
                          data-inbox-id={item.id}
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
                                {item.file !== undefined && (
                                  <span className="k-mono ic-row__file">
                                    {item.file.name} · {humanSize(item.file.size)}
                                  </span>
                                )}
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
                                {item.file !== undefined && (
                                  <a
                                    className="k-pill is-ghost ic-file-link"
                                    href={`/api/files/${item.id}`}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                  >
                                    <FileText size={12} strokeWidth={1.5} aria-hidden />
                                    查看文件
                                  </a>
                                )}
                                <button
                                  type="button"
                                  className="k-pill is-ghost"
                                  onClick={() => {
                                    void runParse(item).catch(() => {})
                                  }}
                                  disabled={
                                    (aiFor === item.id && aiPhase === 'parsing') || batchAi !== null
                                  }
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
                                  key={aiPhase}
                                  className={aiPhase === 'error' ? 'ic-ai is-error' : 'ic-ai'}
                                  aria-live="polite"
                                >
                                  {aiPhase === 'parsing' && (
                                    <div className="ic-ai__process">
                                      <span className="ic-ai__stage" title={AI_STAGE_TEXT[aiStage]}>
                                        {AI_STAGE_TEXT[aiStage]}
                                      </span>
                                      <p
                                        className={
                                          aiText === '' && aiReasoning !== ''
                                            ? 'ic-ai__stream is-dim'
                                            : 'ic-ai__stream'
                                        }
                                      >
                                        {aiText !== '' ? aiText : aiReasoning}
                                      </p>
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
                                          onClick={() => {
                                            void runParse(item).catch(() => {})
                                          }}
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
                                          {aiNewProjectHint !== undefined && (
                                            <>
                                              <span className="k-pill">
                                                建议新项目：{aiNewProjectHint}
                                              </span>
                                              <span className="ic-ai__dup">可到项目页新建</span>
                                            </>
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
                                        <button
                                          type="button"
                                          className="k-pill is-ghost"
                                          disabled={batchAi !== null}
                                          onClick={() => {
                                            void runParse(item).catch(() => {})
                                          }}
                                          title="丢弃本条缓存，重新请求一次解析"
                                        >
                                          重新解析
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

      {/* 批量条侧挂 dock（Slice E2.5）：内联批量条滚出视口时的右侧浮动镜像 */}
      {unprocessed.length > 0 && (
        <div className="ic-dock">
          <AnimatePresence>
            {!barVisible && (
              <motion.aside
                className="ic-dock__panel"
                role="region"
                aria-label="批量操作"
                initial={reduce === true ? { opacity: 0 } : { opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduce === true ? { opacity: 0 } : { opacity: 0, x: 18 }}
                transition={{ duration: DUR.base, ease: EASE_ENTER }}
              >
                <span className="ic-dock__count">
                  <b>{selected.size}</b> 项已选
                </span>
                {batchAi !== null && (
                  <span className="ic-dock__progress u-label" role="status" aria-live="polite">
                    AI 解析中 {batchAi.current}/{batchAi.total}…
                  </span>
                )}
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  disabled={selected.size === 0 || batchAi !== null}
                  onClick={runBatchAi}
                >
                  批量 AI 解析
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm is-solid"
                  disabled={selected.size === 0 || batchAi !== null}
                  onClick={() => runBatch('task', '澄清', (n) => `已批量创建 ${n} 条任务`)}
                >
                  批量 → 任务
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  disabled={selected.size === 0 || batchAi !== null}
                  onClick={() => runBatch('discard', '丢弃', (n) => `已批量丢弃 ${n} 条`)}
                >
                  批量丢弃
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  disabled={selected.size === 0 || batchAi !== null}
                  onClick={() => setSelected(new Set())}
                >
                  取消选择
                </button>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  )
}
