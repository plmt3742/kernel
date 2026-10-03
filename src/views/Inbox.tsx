// KERNEL · 收件箱 INBOX（P0）：快速捕捉 + 按捕捉日期分组浏览 + 多选批量澄清（v0.4：直写数据服务）
// Slice J：AI 解析状态提升至模块级 store（src/lib/inboxAi.ts）——批量任务跨路由切换存活，
//   切页再回来仍见真实进度 / 「解析中…」/「AI 建议就绪」标记；批量动作据 running 禁用防重复启动。
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type DragEvent as ReactDragEvent,
} from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowUp,
  Bell,
  ChevronRight,
  ExternalLink,
  FileText,
  FolderOpen,
  Mic,
  Paperclip,
  PenLine,
  Sparkles,
} from 'lucide-react'
import { Panel } from '@/components/Panel'
import { MeterBar } from '@/components/MeterBar'
import { TagPill } from '@/components/TagPill'
import { Checkbox } from '@/components/Checkbox'
import { EmptyState } from '@/components/EmptyState'
import { AiActionsCard } from '@/components/AiActionsCard'
import { ClusterProposalCard } from '@/components/ClusterProposalCard'
import { TimetableDraftCard } from '@/components/TimetableDraftCard'
import { useToast } from '@/context/ToastContext'
import { getConfig, getInbox, getSnapshot } from '@/lib/data'
import {
  aiClusterDraft,
  applyCluster,
  applyInbox,
  captureInbox,
  clarifyInbox,
  createNote,
  importCourses,
  openInboxFile,
  removeCourse,
  removeInbox,
  revealInboxFile,
  revertInbox,
  trashEntity,
  unapplyCluster,
  unapplyInbox,
  uploadInboxFile,
  type AiAction,
  type AiParseResult,
  type ClarifyTarget,
  type ClusterProposal,
  type CourseCreateInput,
} from '@/lib/mutations'
import {
  clearCachedSuggestion,
  clearFactsNote,
  clearInboxAiActive,
  getCachedSuggestion,
  getInboxAiSnapshot,
  reconcileInboxAiCache,
  runSingleAi,
  setFactsNote,
  startBatchAi,
  subscribeInboxAi,
  takeInboxAiCompletion,
  takeInboxAiFailures,
  type AiStage,
} from '@/lib/inboxAi'
import {
  clearTimetableDraft,
  getTimetableAiSnapshot,
  looksLikeTimetable,
  runTimetableDraft,
  subscribeTimetableAi,
} from '@/lib/timetableAi'
import { deepLinkOfId } from '@/lib/relations'
import { api, errorText } from '@/lib/api'
import { createUiStore, str, useUiStore } from '@/lib/uiState'
import { useDataRevision, useNow } from '@/lib/hooks'
import { humanSize, INBOX_SOURCE_LABEL } from '@/lib/format'
import {
  addDays,
  daysFromToday,
  formatMonthDay,
  formatRelative,
  formatWeekdayShort,
} from '@/lib/date'
import { DUR, EASE_ENTER, EASE_EXIT } from '@/lib/motion'
import type { InboxItem } from '@/types'

const WATER_MAX = 12
const WATER_THRESHOLD = 8

/** 多文件上传的受限并发上限（Slice Y · F33）：文件上传可并行，AI 解析仍严格顺序 */
const UPLOAD_CONCURRENCY = 3

/**
 * 受限并发映射（保持结果顺序，Slice Y · F33）：
 * 至多 limit 个 worker 同时消费队列，结果按原始下标回填，避免读写成乱序。
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** 参与聚类的未完成任务状态（与 server ai.mjs OPEN_TASK_STATUS 同口径） */
const CLUSTER_OPEN_STATUS = new Set(['next', 'waiting', 'scheduled', 'someday'])
/** 自动模式可自动应用的动作类型（构造上不含 discard；discard 表现为空动作 → 保留建议） */
const AUTO_APPLY_KINDS: ReadonlySet<string> = new Set(['task', 'note', 'resource', 'project'])

/* ---------------------------------------------------------------------------
 * 聚类分析缓存（v0.5 · Slice R2，模块级：跨路由切换存活于本会话）
 * - 自动运行每会话一次（clusterRequested），命中缓存不重跑（保持低成本）；
 * - 手动「发现项目」总是重跑并刷新；「创建并归入」后从列表移除该提案。
 * ------------------------------------------------------------------------- */
let clusterCache: ClusterProposal[] | null = null
let clusterRequested = false

/** 聚类候选数（无归属未完成任务 + 未澄清条目；仅用于触发阈值判定） */
function countClusterCandidates(): number {
  const snapshot = getSnapshot()
  const tasks = snapshot.tasks.filter(
    (task) => task.projectId === undefined && CLUSTER_OPEN_STATUS.has(task.status),
  ).length
  const inbox = snapshot.inbox.filter((item) => item.status === 'unprocessed').length
  return tasks + inbox
}

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

// 解析过程阶段文案（由 SSE 事件驱动；安静、不夸大）
const AI_STAGE_TEXT: Record<AiStage, string> = {
  connecting: '已连接，等待模型…',
  thinking: '思考中…',
  generating: '生成中…',
  retry: '输出未通过校验，重试中…',
  validating: '校验通过',
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

/* ---------------------------------------------------------------------------
 * 收件箱界面状态保留（Slice Z · F27，见 ADR-0022）：
 * 选中项 / 内联展开项 / 捕捉草稿提升到模块级 store 并持久化——切路由或刷新后保留；
 * 数据版本变化时对账，剔除已不在未澄清列表的脏 id（安全回退）。
 * `pendingFiles`（File 对象）刻意不持久化：二进制句柄不可序列化，且刷新后不可复得（见 ADR-0022）。
 * ------------------------------------------------------------------------- */
interface InboxUiState {
  selected: string[]
  expandedId: string | null
  draft: string
}

const INBOX_UI_KEY = 'kernel.ui.inbox.v1'
const INBOX_UI_DEFAULT: InboxUiState = { selected: [], expandedId: null, draft: '' }

function parseInboxUi(raw: unknown): InboxUiState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const selected = Array.isArray(v.selected)
    ? v.selected.filter((value): value is string => typeof value === 'string')
    : []
  const expandedId = typeof v.expandedId === 'string' ? v.expandedId : null
  return { selected, expandedId, draft: str(v.draft) }
}

const inboxUiStore = createUiStore<InboxUiState>(INBOX_UI_KEY, INBOX_UI_DEFAULT, {
  parse: parseInboxUi,
})

export function Inbox() {
  const revision = useDataRevision()
  const { toast } = useToast()
  const navigate = useNavigate()
  const now = useNow()
  const reduce = useReducedMotion()
  const inputRef = useRef<HTMLInputElement>(null)
  const [showClarified, setShowClarified] = useState(false)
  const [showDiscarded, setShowDiscarded] = useState(false)
  // 界面状态（Slice Z · F27）：选中 / 展开 / 捕捉草稿来自模块级 store（跨路由 + 刷新保留）
  const inboxUi = useUiStore(inboxUiStore)
  const draft = inboxUi.draft
  const expandedId = inboxUi.expandedId
  const selected = useMemo(() => new Set(inboxUi.selected), [inboxUi.selected])
  const setDraft = (value: string): void => {
    inboxUiStore.set((state) => ({ ...state, draft: value }))
  }
  const setExpandedId = (
    next: string | null | ((prev: string | null) => string | null),
  ): void => {
    inboxUiStore.set((state) => ({
      ...state,
      expandedId: typeof next === 'function' ? next(state.expandedId) : next,
    }))
  }
  const setSelected = (
    next: Set<string> | ((prev: Set<string>) => Set<string>),
  ): void => {
    inboxUiStore.set((state) => {
      const prev = new Set(state.selected)
      const value = typeof next === 'function' ? next(prev) : next
      return { ...state, selected: [...value] }
    })
  }
  // AI 解析状态：模块级 store（跨路由切换存活）——只读快照 + 派发展开 / 滚动 / 播报
  const ai = useSyncExternalStore(subscribeInboxAi, getInboxAiSnapshot)
  const { running, current, total, activeId, phase, stage, text, reasoning, result, error } = ai
  // 课表导入状态：模块级 store（跨路由切换存活）——与 AI 解析面板并列、互不干扰
  const tt = useSyncExternalStore(subscribeTimetableAi, getTimetableAiSnapshot)
  // 导入课程在途（本地态；成功后清空面板，失败保留选择卡）
  const [importingCourses, setImportingCourses] = useState(false)
  // 文件投递（Slice D）：待上传队列 + 拖拽态 + 上传/解析状态播报
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepth = useRef(0)
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [busyLabel, setBusyLabel] = useState('')
  // 批量条侧挂 dock（Slice E2.5）：内联批量条滚出视口时为 true；dock 镜像其状态与动作
  const batchBarRef = useRef<HTMLDivElement>(null)
  const [barVisible, setBarVisible] = useState(true)
  // 生命周期二次确认（Slice V · F34/F37）：删除 / 撤回走内联确认，避免原生对话框打断与误操作
  const [pendingConfirm, setPendingConfirm] = useState<{
    id: string
    action: 'remove' | 'revert'
  } | null>(null)
  // 聚类立项（Slice R2）：AI 归纳提案（模块级缓存恢复）+ 应用在途 / 归纳在途
  const [clusterProposals, setClusterProposals] = useState<ClusterProposal[]>(() => clusterCache ?? [])
  const [clusterBusy, setClusterBusy] = useState(false)
  const [clusterApplying, setClusterApplying] = useState(false)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const focus = (): void => inputRef.current?.focus()
    window.addEventListener('kernel:focus-capture', focus)
    return () => window.removeEventListener('kernel:focus-capture', focus)
  }, [])

  // 数据变化（澄清 / 撤销 / 水合）后对账：选中项与展开项剔除已不在未澄清列表的脏 id
  useEffect(() => {
    inboxUiStore.set((state) => {
      const valid = new Set(
        getInbox()
          .filter((item) => item.status === 'unprocessed')
          .map((item) => item.id),
      )
      const nextSelected = state.selected.filter((id) => valid.has(id))
      const nextExpanded =
        state.expandedId !== null && valid.has(state.expandedId) ? state.expandedId : null
      if (nextSelected.length === state.selected.length && nextExpanded === state.expandedId) {
        return state
      }
      return { ...state, selected: nextSelected, expandedId: nextExpanded }
    })
  }, [revision])

  // 活跃条目离开未澄清列表（应用建议 / 撤销 / 水合）→ 收起面板，避免残留脏状态
  useEffect(() => {
    if (activeId === null) return
    const stillUnprocessed = getInbox().some(
      (item) => item.id === activeId && item.status === 'unprocessed',
    )
    if (!stillUnprocessed) clearInboxAiActive()
  }, [revision, activeId])

  // 课表面板条目离开未澄清列表（澄清 / 删除 / 水合）→ 清空，避免残留脏状态
  useEffect(() => {
    if (tt.itemId === null) return
    const stillUnprocessed = getInbox().some(
      (item) => item.id === tt.itemId && item.status === 'unprocessed',
    )
    if (!stillUnprocessed) clearTimetableDraft()
  }, [revision, tt.itemId])

  // 建议缓存对账：条目一旦离开未澄清列表即删除其缓存（应用 / 撤销 / 水合）
  useEffect(() => {
    const unprocessedIds = new Set(
      getInbox()
        .filter((item) => item.status === 'unprocessed')
        .map((item) => item.id),
    )
    reconcileInboxAiCache(unprocessedIds)
  }, [revision])

  // 批量运行中自动展开当前条目（切页回来亦据真实 store 恢复现场）
  useEffect(() => {
    if (running && activeId !== null) setExpandedId(activeId)
  }, [running, activeId])

  // 批量解析过程可视：当前解析条目若不在视口内，轻柔滚入（尊重 reduced-motion → 瞬时）
  useEffect(() => {
    if (!running || activeId === null) return
    const node = document.querySelector(`.ic-item[data-inbox-id="${CSS.escape(activeId)}"]`)
    if (node instanceof HTMLElement) {
      node.scrollIntoView({
        behavior: reduce === true ? 'auto' : 'smooth',
        block: 'nearest',
      })
    }
  }, [running, activeId, reduce])

  // 完成 / 失败播报（各消费一次，绝不刷屏）：切页期间也会在回到收件箱时补播
  useEffect(() => {
    if (ai.pendingCompletion > 0) {
      const done = takeInboxAiCompletion()
      if (done > 0) toast(`AI 解析完成 · ${done} 条建议已就绪`)
    }
    if (ai.pendingFailures > 0) {
      const failed = takeInboxAiFailures()
      if (failed > 0) toast(`AI 解析：${failed} 条失败，已跳过`, { tone: 'error' })
    }
  }, [ai.pendingCompletion, ai.pendingFailures, toast])

  // 聚类自动运行（Slice R2）：本会话一次，候选 ≥3 且无缓存时静默归纳（只出建议，绝不自动建项）。
  // 失败静默（保持低成本）；手动「发现项目」可随时重试。
  useEffect(() => {
    if (clusterRequested || clusterCache !== null) return
    if (countClusterCandidates() < 3) return
    clusterRequested = true
    void (async () => {
      try {
        const result = await aiClusterDraft()
        clusterCache = result.proposals
        setClusterProposals(result.proposals)
      } catch {
        /* 自动归纳失败：静默（保持低成本） */
      }
    })()
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

  const captureText = (): void => {
    const value = draft.trim()
    if (value === '') return
    void (async () => {
      try {
        const item = await captureInbox(value)
        setDraft('')
        toast('已捕捉 · 待澄清')
        // Slice V（F2）：文本捕捉成功后自动跑一次 AI 解析，与文件投递后的自动解析节奏一致。
        // 绝不自动应用（仍只出建议，落盘经 clarify）；AI 离线 / 失败静默跳过（不产生错误 toast），
        // 手动「AI 解析」入口保留。后台执行，不阻塞捕捉。
        runParseSilent(item)
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

  // 附件本机动作（Slice J2）：以默认程序打开 / 在文件管理器中定位；成功与失败均 toast，绝不触发浏览器下载
  const openFile = (item: InboxItem): void => {
    void openInboxFile(item.id)
      .then(() => {
        toast('已用默认程序打开')
      })
      .catch((err) => {
        toast(`打开失败：${errorText(err)}`, { tone: 'error' })
      })
  }

  const revealFile = (item: InboxItem): void => {
    void revealInboxFile(item.id)
      .then(() => {
        toast('已在文件管理器中定位')
      })
      .catch((err) => {
        toast(`定位失败：${errorText(err)}`, { tone: 'error' })
      })
  }

  // 展开 / 收起：收起时清空面板（保留缓存）。批量运行中不打断活跃批次的解析，仅切换显示
  const toggleExpand = (id: string): void => {
    const next = expandedId === id ? null : id
    if (!(running && activeId === id)) clearInboxAiActive()
    setExpandedId(next)
  }

  // 忽略 AI 建议（Slice N0.6 · 交互反馈修复）：先清该条建议缓存——否则面板派生按缓存回退原地重渲染，
  // 卡片与行尾「AI 建议就绪」标记都不变 = 无反馈；再清活跃面板，最后 toast。覆盖就绪卡与
  // 「无需创建」空态卡（同一 onClear 通路），以及解析失败面板的忽略（同样可被缓存回退抵消）。
  const dismissAiSuggestion = (item: InboxItem): void => {
    clearCachedSuggestion(item.id)
    clearInboxAiActive()
    toast('已忽略 AI 建议')
  }

  // 忽略课表草稿（Slice N0.6 · 反馈修复）：清面板 + toast，与 AI 建议忽略保持一致的可见反馈。
  const dismissTimetableDraft = (): void => {
    clearTimetableDraft()
    toast('已忽略课表解析')
  }

  // 运行 AI 解析：缓存命中则直接展开就绪卡（不重解析）；无缓存才发起流式解析。
  // 强制重新解析走 forceParse（「重新解析」/「重试」）。失败抛出由调用方提示。
  /**
   * 自动模式（Slice R2）：解析完成后自动应用低风险动作（仅 task/note/resource/project 的创建 +
   * 标签 + 关联；构造上不含 discard，空动作保留建议）。confirm 模式不做任何事。
   * 失败静默：条目保持 unprocessed、建议卡照常可见（绝不崩溃）。撤销走 unapplyInbox。
   */
  const maybeAutoApply = (item: InboxItem, result: AiParseResult): void => {
    if (getConfig().aiAutomation !== 'auto') return
    const actions = result.actions.filter((action) => AUTO_APPLY_KINDS.has(action.kind))
    if (actions.length === 0) return
    void (async () => {
      try {
        const applied = await applyInbox(item.id, actions)
        clearInboxAiActive()
        toast(`AI 已自动整理 ${applied.created.length} 项`, {
          action: {
            label: '撤销',
            onClick: () => {
              void unapplyInbox(item.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch {
        /* 自动应用失败：保留建议卡（条目不改变），绝不崩溃 */
      }
    })()
  }

  // 运行 AI 解析：缓存命中则直接展开就绪卡（不重解析）；无缓存才发起流式解析。返回结果供自动模式应用。
  const runParse = async (item: InboxItem): Promise<AiParseResult | null> => {
    setExpandedId(item.id)
    const cached = getCachedSuggestion(item.id)
    if (cached !== undefined && !(activeId === item.id && phase === 'parsing')) return cached
    return runSingleAi(item)
  }

  // 强制重新解析（丢弃展示缓存，重新请求一次；失败静默，错误态由面板承载）
  const forceParse = (item: InboxItem): void => {
    setExpandedId(item.id)
    void runSingleAi(item).catch(() => {})
  }

  // 捕捉后自动解析（Slice V · F2）：先探活，AI 离线 / 探活失败即静默跳过（不展开面板、不 toast）；
  // 在线则走与手动 / 文件投递同一流式路径（runParse）。任何失败都不冒泡成错误 toast。
  // Slice R2：解析完成后若为自动模式，顺带自动应用低风险动作。
  const runParseSilent = (item: InboxItem): void => {
    void api
      .get<{ available: boolean }>('/api/ai/health')
      .then((health) => {
        if (!health.available) return
        void (async () => {
          try {
            const result = await runParse(item)
            if (result !== null) maybeAutoApply(item, result)
          } catch {
            /* AI 解析失败静默（错误态由面板承载，不产生错误 toast） */
          }
        })()
      })
      .catch(() => {})
  }

  // 到达条目自动路由（Slice H1.7）：疑似课表的文件条目 → 自动展开 + 课表草稿（SSE 流式，跳过通用解析）；
  // 其余条目 → 既有通用 AI 解析（runParseSilent，先探活、失败静默）。文本条目不经此处
  // （captureText 仍走 runParseSilent）。与批量条自动展开 / 滚入互不干扰（各自条件独立）。
  const routeArrivedItem = async (item: InboxItem): Promise<void> => {
    if (looksLikeTimetable(item)) {
      const stillUnprocessed = getInbox().some(
        (entry) => entry.id === item.id && entry.status === 'unprocessed',
      )
      if (stillUnprocessed) setExpandedId(item.id)
      await runTimetableDraft(item)
      return
    }
    runParseSilent(item)
  }

  // 删除条目（F34）：二次确认后经 removeInbox（服务端一并清理附件）；已澄清由服务端 409 保护，UI 不提供。
  const removeEntry = (item: InboxItem): void => {
    setPendingConfirm(null)
    void (async () => {
      try {
        await removeInbox(item.id)
        if (expandedId === item.id) setExpandedId(null)
        clearInboxAiActive()
        toast('已删除条目')
      } catch (err) {
        toast(`删除失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 恢复已丢弃条目（F15/F37）：复用 revert（discarded 无产物，仅重置回 unprocessed）。
  // 恢复是安全操作，无需二次确认。
  const restoreEntry = (item: InboxItem): void => {
    void (async () => {
      try {
        await revertInbox(item.id)
        toast('已恢复到未澄清')
      } catch (err) {
        toast(`恢复失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 撤回已澄清条目（F37）：二次确认后 revert（删除联动产物并回到 unprocessed）。
  const revertEntry = (item: InboxItem): void => {
    setPendingConfirm(null)
    void (async () => {
      try {
        await revertInbox(item.id)
        toast('已撤回澄清')
      } catch (err) {
        toast(`撤回失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 批量 AI 解析（Slice E1 + E2.6 + J）：模块级顺序解析、进度可见、失败续跑；绝不自动应用。
  const runBatchAi = (): void => {
    const ids = [...selected]
    if (ids.length === 0) return
    void startBatchAi(ids)
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
      // Slice Y · F33：上传受限并发（≤3，保持结果顺序）；失败逐条 toast、不阻断其余文件。
      // 解析仍严格顺序（AI 更重且共享 opencode 会话，顺序可给出稳定的进度与自动应用次序）。
      const results = await mapLimit(files, UPLOAD_CONCURRENCY, async (file, i) => {
        setBusyLabel(`上传中 ${i + 1}/${files.length}…`)
        try {
          return await uploadInboxFile(file, caption)
        } catch (err) {
          toast(`上传失败：${errorText(err)}`, { tone: 'error' })
          return null
        }
      })
      const uploaded = results.filter((item): item is InboxItem => item !== null)
      if (uploaded.length === 0) {
        setBusyLabel('')
        return
      }
      toast(`已投递 ${uploaded.length} 个文件 · AI 先读一遍`)
      for (let i = 0; i < uploaded.length; i += 1) {
        setBusyLabel(`AI 读取中 ${i + 1}/${uploaded.length}…`)
        // Slice H1.7：课表类文件自动路由到课表草稿，其余走通用解析（保持顺序处理节奏）
        await routeArrivedItem(uploaded[i])
      }
      setBusyLabel('')
    })()
  }

  // 一揽子应用（Slice R1）：一次写入创建全部动作；成功 toast「已应用 N 项 · 撤销」。
  // 撤销经 unapplyInbox（删除全部产物 + 恢复标签注册表基线），确保回到应用前状态。
  const applyActions = (item: InboxItem, actions: AiAction[]): void => {
    void (async () => {
      try {
        const result = await applyInbox(item.id, actions)
        clearInboxAiActive()
        toast(`已应用 ${result.created.length} 项`, {
          action: {
            label: '撤销',
            onClick: () => {
              void unapplyInbox(item.id).catch((err) => {
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

  // 课表导入（Slice H1）：勾选确认后一次写入全部课程；成功清空面板 + toast「已导入 N 门课程 · 撤销」。
  // 撤销逐条 removeCourse（移入回收站），任一失败 toast error（照 applyActions 的写法）。
  const importSelectedCourses = (selected: CourseCreateInput[]): void => {
    void (async () => {
      setImportingCourses(true)
      try {
        const created = await importCourses(selected)
        clearTimetableDraft()
        toast(`已导入 ${created.length} 门课程`, {
          action: {
            label: '撤销',
            onClick: () => {
              void (async () => {
                for (const course of created) {
                  try {
                    await removeCourse(course.id)
                  } catch (err) {
                    toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
                  }
                }
              })()
            },
          },
        })
      } catch (err) {
        toast(`导入失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setImportingCourses(false)
      }
    })()
  }

  // 把公告要点存为一条笔记（Slice N0）：一次 createNote 落盘；成功后关闭该条 AI 面板
  // （与 applyActions 一致：clearInboxAiActive），toast 撤销 = trashEntity('notes')（同 NoteComposeModal）。
  // Slice N0.5（反馈修复）：接收 itemId 并登记 factsNoteCache（→ 卡片显示「已存为要点笔记 · 查看」）；
  //   撤销成功后 clearFactsNote(itemId)，恢复可再存；promise 不抛出（卡片 finally 自行收尾）。
  const saveFactsAsNote = async (facts: string[], itemId?: string): Promise<void> => {
    if (facts.length === 0) return
    try {
      const note = await createNote({
        title: `通知要点 · ${formatMonthDay(new Date())}`,
        body: facts.map((fact) => `- ${fact}`).join('\n'),
      })
      if (itemId !== undefined) setFactsNote(itemId, note.id)
      clearInboxAiActive()
      toast('已存为笔记', {
        action: {
          label: '撤销',
          onClick: () => {
            void trashEntity('notes', note.id)
              .catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
              .then(() => {
                if (itemId !== undefined) clearFactsNote(itemId)
              })
          },
        },
      })
    } catch (err) {
      toast(`保存失败：${errorText(err)}`, { tone: 'error' })
    }
  }

  // 聚类归纳（Slice R2）：手动触发总是重跑；自动触发每会话一次（见上方 effect）。
  const loadClusters = (manual: boolean): void => {
    if (clusterBusy) return
    setClusterBusy(true)
    void (async () => {
      try {
        const result = await aiClusterDraft()
        clusterCache = result.proposals
        clusterRequested = true
        setClusterProposals(result.proposals)
        if (manual && result.proposals.length === 0) toast('暂无可归纳的相似任务')
      } catch (err) {
        if (manual) toast(`发现项目失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setClusterBusy(false)
      }
    })()
  }

  // 应用一条聚类提案：建项 + 归入任务；成功后从列表移除该提案，toast 撤销（unapplyCluster 精确复原）。
  const applyClusterProposal = (proposal: ClusterProposal): void => {
    void (async () => {
      setClusterApplying(true)
      try {
        const result = await applyCluster({
          title: proposal.title,
          outcome: proposal.outcome,
          areaId: proposal.areaId,
          tags: proposal.tags,
          taskIds: proposal.taskIds,
        })
        const remaining = clusterProposals.filter((entry) => entry !== proposal)
        clusterCache = remaining
        setClusterProposals(remaining)
        toast(`已创建项目「${result.project.title}」· 归入 ${result.assigned.length} 项任务`, {
          action: {
            label: '撤销',
            onClick: () => {
              void unapplyCluster(result.project.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`建项失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setClusterApplying(false)
      }
    })()
  }

  // 忽略一条提案（仅从本次列表移除；不改数据，手动「发现项目」可再次归纳）
  const ignoreClusterProposal = (proposal: ClusterProposal): void => {
    const remaining = clusterProposals.filter((entry) => entry !== proposal)
    clusterCache = remaining
    setClusterProposals(remaining)
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
        <div className="ic-head__discover">
          <span className="u-label k-muted">按捕捉日期分组浏览 · 勾选多项后可批量澄清或丢弃</span>
          <button
            type="button"
            className="k-pill is-ghost"
            disabled={clusterBusy}
            onClick={() => loadClusters(true)}
            title="让 AI 归纳无归属的相似任务，建议一个新项目（只出建议，不自动建项）"
          >
            <Sparkles size={12} strokeWidth={1.5} aria-hidden />
            {clusterBusy ? '归纳中…' : '发现项目'}
          </button>
        </div>
      </Panel>

      {/* AI 归纳建议卡（Slice R2）：确认后建项并归入；绝不自动建项 */}
      <ClusterProposalCard
        proposals={clusterProposals}
        applying={clusterApplying}
        onApply={applyClusterProposal}
        onIgnore={ignoreClusterProposal}
      />

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
              {running && (
                <span className="ic-batchbar__progress u-label" role="status" aria-live="polite">
                  AI 解析中 {current}/{total}…
                </span>
              )}
              <button
                type="button"
                className="k-btn"
                disabled={selected.size === 0 || running}
                onClick={runBatchAi}
              >
                批量 AI 解析
              </button>
              <button
                type="button"
                className="k-btn is-solid"
                disabled={selected.size === 0 || running}
                onClick={() => runBatch('task', '澄清', (n) => `已批量创建 ${n} 条任务`)}
              >
                批量 → 任务
              </button>
              <button
                type="button"
                className="k-btn"
                disabled={selected.size === 0 || running}
                onClick={() => runBatch('discard', '丢弃', (n) => `已批量丢弃 ${n} 条`)}
              >
                批量丢弃
              </button>
              <button
                type="button"
                className="k-btn"
                disabled={selected.size === 0 || running}
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
                      const cached = getCachedSuggestion(item.id)
                      const isParsingThis = activeId === item.id && phase === 'parsing'
                      const ttThis = tt.itemId === item.id
                      const panelActive = activeId === item.id && phase !== 'idle'
                      const panelPhase = panelActive
                        ? phase
                        : cached !== undefined
                          ? 'ready'
                          : 'idle'
                      const panelResult = panelActive ? result : (cached ?? null)
                      const panelError = panelActive ? error : ''
                      const panelStage = panelActive ? stage : 'connecting'
                      const panelText = panelActive ? text : ''
                      const panelReasoning = panelActive ? reasoning : ''
                      const showPanel = panelActive || cached !== undefined
                      const showMarker = cached !== undefined && !isParsingThis
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
                              {isParsingThis && (
                                <span
                                  className="ic-row__ai is-running u-label"
                                  role="status"
                                  aria-live="polite"
                                >
                                  解析中…
                                </span>
                              )}
                              {showMarker && (
                                <span className="k-pill is-ghost ic-row__ai-marker">
                                  AI 建议就绪
                                </span>
                              )}
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
                              <div className="ic-subrow__row">
                              <div className="k-clarify">
                                {item.file !== undefined && (
                                  <>
                                    <button
                                      type="button"
                                      className="k-pill is-ghost"
                                      onClick={() => openFile(item)}
                                      title="用系统默认程序打开该文件"
                                    >
                                      <FileText size={12} strokeWidth={1.5} aria-hidden />
                                      打开文件
                                    </button>
                                    <button
                                      type="button"
                                      className="k-pill is-ghost"
                                      onClick={() => revealFile(item)}
                                      title="在文件管理器中定位该文件"
                                    >
                                      <FolderOpen size={12} strokeWidth={1.5} aria-hidden />
                                      位置
                                    </button>
                                  </>
                                )}
                                <button
                                  type="button"
                                  className="k-pill is-ghost"
                                  onClick={() => {
                                    void runParse(item).catch(() => {})
                                  }}
                                  disabled={isParsingThis || running}
                                  aria-busy={isParsingThis}
                                  title="让本地 AI 解析为结构化建议（仅建议，确认后写入）"
                                >
                                  <Sparkles size={12} strokeWidth={1.5} aria-hidden />
                                  AI 解析
                                </button>
                                <button
                                  type="button"
                                  className="k-pill is-ghost"
                                  onClick={() => {
                                    void runTimetableDraft(item)
                                  }}
                                  disabled={tt.busy && ttThis}
                                  aria-busy={tt.busy && ttThis}
                                  title="从该条目（表格 / 截图 / 文本）提取课程，确认后导入课表"
                                >
                                  {tt.busy && ttThis ? '课表解析中…' : '导入为课表'}
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
                              {/* 生命周期（Slice V · F34）：删除条目（含附件清理），二次确认 */}
                              <div className="ic-lifecycle">
                                {pendingConfirm !== null &&
                                pendingConfirm.id === item.id &&
                                pendingConfirm.action === 'remove' ? (
                                  <span className="ic-confirm">
                                    <span className="ic-confirm__text u-label">
                                      确认删除该条目？附件将一并清理。
                                    </span>
                                    <button
                                      type="button"
                                      className="k-pill is-danger"
                                      onClick={() => removeEntry(item)}
                                    >
                                      删除
                                    </button>
                                    <button
                                      type="button"
                                      className="k-pill is-ghost"
                                      onClick={() => setPendingConfirm(null)}
                                    >
                                      取消
                                    </button>
                                  </span>
                                ) : (
                                  <button
                                    type="button"
                                    className="k-pill is-ghost is-danger"
                                    onClick={() => setPendingConfirm({ id: item.id, action: 'remove' })}
                                    title="永久删除该收件箱条目（附件一并清理）"
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                              </div>
                              {showPanel && (
                                <div
                                  key={panelPhase}
                                  className={panelPhase === 'error' ? 'ic-ai is-error' : 'ic-ai'}
                                  aria-live="polite"
                                >
                                  {panelPhase === 'parsing' && (
                                    <div className="ic-ai__process">
                                      <span className="ic-ai__stage" title={AI_STAGE_TEXT[panelStage]}>
                                        {AI_STAGE_TEXT[panelStage]}
                                      </span>
                                      <p
                                        className={
                                          panelText === '' && panelReasoning !== ''
                                            ? 'ic-ai__stream is-dim'
                                            : 'ic-ai__stream'
                                        }
                                      >
                                        {panelText !== '' ? panelText : panelReasoning}
                                      </p>
                                    </div>
                                  )}
                                  {panelPhase === 'error' && (
                                    <>
                                      <div className="ic-ai__head">
                                        <span className="ic-ai__title">解析失败</span>
                                      </div>
                                      <p className="ic-ai__reason">{panelError}</p>
                                      <div className="ic-ai__actions">
                                        <button
                                          type="button"
                                          className="k-pill is-ghost"
                                          onClick={() => forceParse(item)}
                                        >
                                          重试
                                        </button>
                                         <button
                                           type="button"
                                           className="k-pill is-ghost"
                                           onClick={() => dismissAiSuggestion(item)}
                                         >
                                           忽略
                                         </button>
                                      </div>
                                    </>
                                  )}
                                  {panelPhase === 'ready' && panelResult !== null && (
                                    <AiActionsCard
                                      actions={panelResult.actions}
                                      facts={panelResult.facts}
                                      onSaveFacts={saveFactsAsNote}
                                      itemId={item.id}
                                      onApply={(next) => applyActions(item, next)}
                                       onRetry={() => forceParse(item)}
                                       retryDisabled={running}
                                       onClear={() => dismissAiSuggestion(item)}
                                     />
                                  )}
                                </div>
                              )}
                              {/* 课表导入（Slice H1）：与上方 AI 解析面板并列的独立区块，二者可共存 */}
                              {ttThis && (
                                <>
                                  {tt.busy && (
                                    <>
                                      <p className="ic-tt__status u-label" role="status" aria-live="polite">
                                        {tt.stage || '正在提取课程…'}
                                      </p>
                                      {tt.preview !== '' && (
                                        <p className="ic-tt__preview" aria-hidden="true">
                                          {tt.preview}
                                        </p>
                                      )}
                                    </>
                                  )}
                                  {!tt.busy && tt.error !== '' && (
                                    <div className="ic-tt__error">
                                      <p className="ic-tt__error-text" role="alert">
                                        {tt.error}
                                      </p>
                                      <div className="ic-tt__error-actions">
                                        <button
                                          type="button"
                                          className="k-pill is-ghost"
                                          onClick={() => {
                                            void runTimetableDraft(item)
                                          }}
                                        >
                                          重试
                                        </button>
                                        <button
                                          type="button"
                                          className="k-pill is-ghost"
                                          onClick={clearTimetableDraft}
                                        >
                                          关闭
                                        </button>
                                      </div>
                                    </div>
                                  )}
                                  {!tt.busy && tt.error === '' && tt.courses !== null && (
                                    <TimetableDraftCard
                                       courses={tt.courses}
                                       onImport={importSelectedCourses}
                                       onClear={dismissTimetableDraft}
                                       importing={importingCourses}
                                     />
                                  )}
                                </>
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
              {/* 生命周期闭合（Slice V · F37）：查看产物深链 + 撤回（删除产物并回到未澄清，二次确认） */}
              {clarified.map((item) => {
                const link = item.linkedId !== undefined ? deepLinkOfId(item.linkedId) : null
                return (
                  <div className="k-inbox-item" key={item.id}>
                    <span className="k-inbox-item__content k-muted">{item.content}</span>
                    <span className="k-inbox-item__meta">
                      <span className="k-mono">{formatRelative(item.capturedAt, now)}</span>
                      <span className="k-mono">{item.linkedId ?? item.id}</span>
                    </span>
                    <span className="k-inbox-item__actions">
                      <button
                        type="button"
                        className="k-pill is-ghost"
                        disabled={link === null}
                        onClick={() => {
                          if (link !== null) navigate(link, { viewTransition: true })
                        }}
                        title={link === null ? '该条目没有可跳转的产物' : '跳转查看澄清产物'}
                      >
                        <ExternalLink size={12} strokeWidth={1.5} aria-hidden />
                        查看产物
                      </button>
                      {pendingConfirm !== null &&
                      pendingConfirm.id === item.id &&
                      pendingConfirm.action === 'revert' ? (
                        <span className="ic-confirm">
                          <span className="ic-confirm__text u-label">
                            确认撤回？将删除已创建的产物。
                          </span>
                          <button
                            type="button"
                            className="k-pill is-danger"
                            onClick={() => revertEntry(item)}
                          >
                            撤回
                          </button>
                          <button
                            type="button"
                            className="k-pill is-ghost"
                            onClick={() => setPendingConfirm(null)}
                          >
                            取消
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          className="k-pill is-ghost is-danger"
                          onClick={() => setPendingConfirm({ id: item.id, action: 'revert' })}
                          title="撤回澄清：删除已创建的产物并回到未澄清"
                        >
                          撤回
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
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
              {/* 生命周期闭合（Slice V · F15）：恢复（回到未澄清，安全操作）+ 删除（二次确认） */}
              {discarded.map((item) => (
                <div className="k-inbox-item" key={item.id}>
                  <span className="k-inbox-item__content k-muted">{item.content}</span>
                  <span className="k-inbox-item__meta">
                    <span className="k-mono">{formatRelative(item.capturedAt, now)}</span>
                    <span className="k-mono">{item.id}</span>
                  </span>
                  <span className="k-inbox-item__actions">
                    <button
                      type="button"
                      className="k-pill is-ghost"
                      onClick={() => restoreEntry(item)}
                      title="恢复到未澄清"
                    >
                      恢复
                    </button>
                    {pendingConfirm !== null &&
                    pendingConfirm.id === item.id &&
                    pendingConfirm.action === 'remove' ? (
                      <span className="ic-confirm">
                        <span className="ic-confirm__text u-label">确认删除该条目？</span>
                        <button
                          type="button"
                          className="k-pill is-danger"
                          onClick={() => removeEntry(item)}
                        >
                          删除
                        </button>
                        <button
                          type="button"
                          className="k-pill is-ghost"
                          onClick={() => setPendingConfirm(null)}
                        >
                          取消
                        </button>
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="k-pill is-ghost is-danger"
                        onClick={() => setPendingConfirm({ id: item.id, action: 'remove' })}
                      >
                        删除
                      </button>
                    )}
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
                {running && (
                  <span className="ic-dock__progress u-label" role="status" aria-live="polite">
                    AI 解析中 {current}/{total}…
                  </span>
                )}
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  disabled={selected.size === 0 || running}
                  onClick={runBatchAi}
                >
                  批量 AI 解析
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm is-solid"
                  disabled={selected.size === 0 || running}
                  onClick={() => runBatch('task', '澄清', (n) => `已批量创建 ${n} 条任务`)}
                >
                  批量 → 任务
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  disabled={selected.size === 0 || running}
                  onClick={() => runBatch('discard', '丢弃', (n) => `已批量丢弃 ${n} 条`)}
                >
                  批量丢弃
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  disabled={selected.size === 0 || running}
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
