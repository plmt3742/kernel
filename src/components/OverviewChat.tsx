// KERNEL · 总览 AI 对话盒（v0.5 · Slice G；Slice Z 状态保留）
// 位置：状态条之下、工作台之上；视觉与收件箱捕捉编辑器（.ic-composer）一致。
// 能力：读库多轮对话（经数据服务 → 本地 opencode）；「清空」先归档为笔记（time-named）再清空。
// Slice G.1：助手回复用 react-markdown 渲染；可联网检索（显示「已联网检索」行）；
//   对话式「整理进笔记」+ 每轮「存为笔记」→ 经 /api/ai/chat/note 落盘。
// 纪律：markdown 经 react-markdown 渲染为 React 元素（无 dangerouslySetInnerHTML）。
// Slice Z（见 ADR-0022）状态保留：
//   · draft / busy / error 全部提升到模块级 store（切路由中途打字 / 思考不再丢）；
//   · 对话（turns）+ 草稿经 localStorage 持久化（安全解析、上限最近 60 轮、静默失败）→ 刷新还原；
//   · 「清空」仍先归档为笔记，归档成功即清空内存 + 持久化副本（刷新后保持已清空）。
import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
} from 'react'
import ReactMarkdown from 'react-markdown'
import { ArrowUp, FileText, Paperclip } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@/context/ToastContext'
import { errorText } from '@/lib/api'
import { createUiStore, useUiStore } from '@/lib/uiState'
import { formatDateTime } from '@/lib/date'
import { humanSize } from '@/lib/format'
import {
  aiChatStream,
  chatNoteFromChat,
  completeTask,
  createEvent,
  createNote,
  createProject,
  createTask,
  createTrace,
  reopenTask,
  restoreEntity,
  trashEntity,
  updateEntity,
  uploadChatAttachment,
  type AiChatMessage,
  type AiChatResult,
  type ChatActionKind,
  type ChatActionOp,
  type ChatActionProposal,
  type ChatAttachment,
  type ChatEditProposal,
  type ChatEventProposal,
  type ChatNoteProposal,
  type ChatProjectProposal,
  type ChatTaskProposal,
  type ChatTraceProposal,
} from '@/lib/mutations'

/** 多附件上传的受限并发上限（与 Inbox 同款 mapLimit 模式，Slice Y · F33） */
const UPLOAD_CONCURRENCY = 3

/**
 * 受限并发映射（保持结果顺序）：至多 limit 个 worker 同时消费队列，结果按原始下标回填。
 * 与 Inbox.tsx / Traces.tsx 同实现（本组件不跨文件复用，避免改动他处）。
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

/** 图片 MIME → 扩展名（粘贴截图命名用；未知类型回退 png） */
const IMAGE_EXT: Partial<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
  'image/tiff': 'tiff',
}

/** 由 MIME 推断扩展名（未知 image/* 取子类型；再兜底 png） */
function imageExtension(mime: string): string {
  const subtype = mime.startsWith('image/') ? mime.slice('image/'.length).split('+')[0] : ''
  return IMAGE_EXT[mime] ?? (subtype !== '' ? subtype : 'png')
}

/** 粘贴截图的时间戳文件名：粘贴截图-YYYYMMDD-HHmmss.<ext> */
function timestampedImageName(mime: string): string {
  const d = new Date()
  const pad = (n: number): string => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `粘贴截图-${stamp}.${imageExtension(mime)}`
}

/** 从剪贴板 DataTransfer 收集图片文件（items 优先；无 items 时回退 files） */
function clipboardImageFiles(data: DataTransfer): File[] {
  const out: File[] = []
  for (let i = 0; i < data.items.length; i += 1) {
    const item = data.items[i]
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file !== null) out.push(file)
    }
  }
  if (out.length === 0 && data.files.length > 0) {
    for (let i = 0; i < data.files.length; i += 1) {
      const file = data.files[i]
      if (file.type.startsWith('image/')) out.push(file)
    }
  }
  return out
}

interface ChatTurn extends AiChatMessage {
  id: string
  /** Slice G.1：本轮实际执行的联网检索问题（≤2、每条 ≤60） */
  searched?: string[]
  /** Slice G.1：对话式整理产出的笔记 id（用于「打开笔记」链接） */
  noteId?: string
  /** 本切片：本轮为作答查阅过的实体标题（≤6、每条 ≤80） */
  focused?: string[]
  /** 本切片：实体修改提案（确认前零写入；≤3、还原时逐条校验） */
  edits?: ChatEditProposal[]
  /** 修改提案的本地状态：待确认 / 已应用 / 已忽略（缺省按待确认处理） */
  editState?: 'pending' | 'applied' | 'dismissed'
  /** 「踪迹」提案（AI 识别「我做了 X」；**1–6 条**，同段可拆分；确认前零写入） */
  traces?: ChatTraceProposal[]
  traceState?: 'pending' | 'applied' | 'dismissed'
  /** 「新建日程」提案（AI 识别定点安排；**1–6 条**；可与 traces/tasks 同时存在；确认前零写入） */
  events?: ChatEventProposal[]
  eventState?: 'pending' | 'applied' | 'dismissed'
  /** 「新建任务」提案（AI 识别建任务意图；**1–6 条**；可与 traces/events 同时存在；确认前零写入） */
  tasks?: ChatTaskProposal[]
  taskState?: 'pending' | 'applied' | 'dismissed'
  /** 「新建项目」提案（AI 识别立项意图；**1–6 条**；确认前零写入） */
  projects?: ChatProjectProposal[]
  projectState?: 'pending' | 'applied' | 'dismissed'
  /** 「新建笔记」提案（AI 把对话整理成独立笔记；**1–6 条**；确认前零写入） */
  notes?: ChatNoteProposal[]
  noteState?: 'pending' | 'applied' | 'dismissed'
  /** 「操作既有实体」提案（标记完成 / 重新打开 / 删除 / 归档；**1–6 条**；确认前零写入） */
  actions?: ChatActionProposal[]
  actionState?: 'pending' | 'applied' | 'dismissed'
}

/** 修改卡片字段名 → 中文标签（缺失时回退原键名） */
const FIELD_LABEL: Record<string, string> = {
  title: '标题',
  startAt: '开始',
  endAt: '结束',
  dueAt: '截止',
  location: '地点',
  status: '状态',
  notes: '备注',
  body: '正文',
  tags: '标签',
  importance: '重要性',
  energy: '能量',
  contexts: '情境',
  estimateMin: '预计(分钟)',
  projectId: '项目',
  areaId: '区域',
  deferUntil: '推迟至',
  parentTaskId: '父任务',
  outcome: '完成定义',
  note: '简介',
  url: '链接',
  kind: '类型',
  teacher: '教师',
  trigger: '触发',
  cadence: '节奏',
  metric: '指标',
  target: '目标',
  standard: '标准',
  horizon: '时间尺度',
  targetDate: '目标日期',
  sessions: '时段',
  allDay: '全天',
}

/** 操作提案种类 → 中文动作短语（操作卡行文案：如「标记完成「X」」） */
const ACTION_LABEL: Record<ChatActionOp, string> = {
  complete: '标记完成',
  reopen: '重新打开',
  delete: '删除',
  archive: '归档',
}

/** 操作提案执行器：op → 正向写入（全部复用既有单写者动作） */
const ACTION_RUN: Record<ChatActionOp, (action: ChatActionProposal) => Promise<void>> = {
  complete: async (action) => {
    await completeTask(action.id)
  },
  reopen: async (action) => {
    await reopenTask(action.id)
  },
  delete: (action) => trashEntity(action.kind, action.id),
  archive: async (action) => {
    await updateEntity(action.kind, action.id, { status: 'archived' })
  },
}

/** 操作提案撤销器：与 ACTION_RUN 一一对应的反向动作（归档回 before ?? 'active'） */
const ACTION_UNDO: Record<ChatActionOp, (action: ChatActionProposal) => Promise<void>> = {
  complete: async (action) => {
    await reopenTask(action.id)
  },
  reopen: async (action) => {
    await completeTask(action.id)
  },
  delete: (action) => restoreEntity(action.kind, action.id).then(() => undefined),
  archive: async (action) => {
    const status =
      typeof action.before === 'string' && action.before !== '' ? action.before : 'active'
    await updateEntity(action.kind, action.id, { status })
  },
}

/** ISO 日期时间前缀（用于将字符串值渲染为可读时间） */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** 超长文本截断（按字符数计，末位加省略号） */
function truncate(value: string): string {
  const chars = Array.from(value)
  return chars.length > 60 ? `${chars.slice(0, 60).join('')}…` : value
}

/** 将修改字段值格式化为单行展示文本（空 / 布尔 / 时间 / 数组 / 其它） */
function fmtValue(value: unknown): string {
  if (value === null || value === undefined) return '（空）'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (typeof value === 'string') return ISO_DATETIME.test(value) ? formatDateTime(value) : truncate(value)
  if (Array.isArray(value)) {
    return truncate(value.map((item) => (item === null || item === undefined ? '（空）' : String(item))).join('、'))
  }
  return truncate(String(value))
}

/** 还原时清洗数组：仅保留非空字符串、每项截断、限制数量 */
function cleanStringList(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim() !== '')
    .map((item) => Array.from(item).slice(0, maxChars).join(''))
    .slice(0, maxItems)
}

/** 还原时清洗修改提案：逐条校验形状（≤3），非法条目丢弃 */
function normalizeEdits(value: unknown): ChatEditProposal[] {
  if (!Array.isArray(value)) return []
  const out: ChatEditProposal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.kind !== 'string' || typeof v.id !== 'string' || typeof v.title !== 'string') continue
    if (typeof v.fields !== 'object' || v.fields === null) continue
    if (typeof v.before !== 'object' || v.before === null) continue
    const edit: ChatEditProposal = {
      kind: v.kind as ChatEditProposal['kind'],
      id: v.id,
      title: v.title,
      fields: v.fields as Record<string, unknown>,
      before: v.before as Record<string, unknown>,
    }
    if (typeof v.label === 'string') edit.label = Array.from(v.label).slice(0, 120).join('')
    out.push(edit)
    if (out.length >= 3) break
  }
  return out
}

/** 还原时清洗项目提案：title 必填（≤200），outcome 可选（≤200），≤6 条 */
function normalizeProjects(value: unknown): ChatProjectProposal[] {
  if (!Array.isArray(value)) return []
  const out: ChatProjectProposal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.title !== 'string' || v.title.trim() === '') continue
    const proposal: ChatProjectProposal = { title: Array.from(v.title).slice(0, 200).join('') }
    if (typeof v.outcome === 'string' && v.outcome.trim() !== '') {
      proposal.outcome = Array.from(v.outcome).slice(0, 200).join('')
    }
    out.push(proposal)
    if (out.length >= 6) break
  }
  return out
}

/** 还原时清洗笔记提案：title / body 必填，≤6 条 */
function normalizeNotes(value: unknown): ChatNoteProposal[] {
  if (!Array.isArray(value)) return []
  const out: ChatNoteProposal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.title !== 'string' || typeof v.body !== 'string') continue
    out.push({
      title: Array.from(v.title).slice(0, 200).join(''),
      body: Array.from(v.body).slice(0, 20000).join(''),
    })
    if (out.length >= 6) break
  }
  return out
}

/** 操作提案合法 op（用于还原校验） */
const ACTION_OPS: readonly ChatActionOp[] = ['complete', 'reopen', 'delete', 'archive']
/** 操作提案合法 kind（回收站同族子集） */
const ACTION_KINDS: readonly ChatActionKind[] = [
  'tasks',
  'projects',
  'notes',
  'resources',
  'events',
  'traces',
]

/** 还原时清洗操作提案：op / kind / id / title 必填，≤6 条 */
function normalizeActions(value: unknown): ChatActionProposal[] {
  if (!Array.isArray(value)) return []
  const out: ChatActionProposal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.op !== 'string' || !(ACTION_OPS as readonly string[]).includes(v.op)) continue
    if (typeof v.kind !== 'string' || !(ACTION_KINDS as readonly string[]).includes(v.kind)) continue
    if (typeof v.id !== 'string' || typeof v.title !== 'string') continue
    const action: ChatActionProposal = {
      op: v.op as ChatActionOp,
      kind: v.kind as ChatActionKind,
      id: v.id,
      title: Array.from(v.title).slice(0, 200).join(''),
    }
    if (v.before !== undefined) action.before = v.before
    if (typeof v.label === 'string' && v.label !== '') {
      action.label = Array.from(v.label).slice(0, 120).join('')
    }
    out.push(action)
    if (out.length >= 6) break
  }
  return out
}

/** 逆序写回 before（撤销 / 部分失败回滚共用）；返回未能还原的条目数（0 = 全部还原成功） */
async function restoreEdits(edits: ChatEditProposal[]): Promise<number> {
  let failed = 0
  for (const edit of [...edits].reverse()) {
    try {
      await updateEntity(edit.kind, edit.id, edit.before)
    } catch {
      failed += 1
    }
  }
  return failed
}

interface ChatState {
  turns: ChatTurn[]
  draft: string
  busy: boolean
  error: string
}

const CHAT_KEY = 'kernel.ui.chat.v1'
/** 持久化 / 内存上限（ADR-0022）：最多保留最近 60 轮，避免无界增长 */
const CHAT_MAX_TURNS = 60
const EMPTY_CHAT: ChatState = { turns: [], draft: '', busy: false, error: '' }

function isTurn(value: unknown): value is ChatTurn {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    (v.role === 'user' || v.role === 'assistant') &&
    typeof v.content === 'string'
  )
}

/** 清洗还原轮次的可选字段（Slice G.1）：searched 仅保留字符串、每条 ≤60、最多 2；noteId 仅非空字符串；
 *  本切片追加 focused（≤6 · 每条 ≤80）与 edits（≤3 · 逐条校验，有提案则恢复 editState，缺省待确认） */
function normalizeTurn(turn: ChatTurn): ChatTurn {
  const next: ChatTurn = { id: turn.id, role: turn.role, content: turn.content }
  const searched = cleanStringList(turn.searched, 2, 60)
  if (searched.length > 0) next.searched = searched
  if (typeof turn.noteId === 'string' && turn.noteId !== '') next.noteId = turn.noteId
  const focused = cleanStringList(turn.focused, 6, 80)
  if (focused.length > 0) next.focused = focused
  const edits = normalizeEdits(turn.edits)
  if (edits.length > 0) {
    next.edits = edits
    next.editState =
      turn.editState === 'applied' || turn.editState === 'dismissed' ? turn.editState : 'pending'
  }
  const projects = normalizeProjects(turn.projects)
  if (projects.length > 0) {
    next.projects = projects
    next.projectState =
      turn.projectState === 'applied' || turn.projectState === 'dismissed'
        ? turn.projectState
        : 'pending'
  }
  const notes = normalizeNotes(turn.notes)
  if (notes.length > 0) {
    next.notes = notes
    next.noteState =
      turn.noteState === 'applied' || turn.noteState === 'dismissed' ? turn.noteState : 'pending'
  }
  const actions = normalizeActions(turn.actions)
  if (actions.length > 0) {
    next.actions = actions
    next.actionState =
      turn.actionState === 'applied' || turn.actionState === 'dismissed'
        ? turn.actionState
        : 'pending'
  }
  return next
}

/** 安全解析持久化对话；非法 / 缺字段丢弃（busy / error 刻意不还原：刷新后无在途请求） */
function parseChat(raw: unknown): ChatState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const turns = Array.isArray(v.turns)
    ? v.turns.filter(isTurn).map(normalizeTurn).slice(-CHAT_MAX_TURNS)
    : []
  const draft = typeof v.draft === 'string' ? v.draft : ''
  return { turns, draft, busy: false, error: '' }
}

/** 由已还原轮次推导 id 序号起点，避免刷新后 id 复用（React key 冲突） */
function maxTurnSeq(turns: ChatTurn[]): number {
  let max = -1
  for (const turn of turns) {
    const match = /^c-(\d+)$/.exec(turn.id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return max
}

const chatStore = createUiStore<ChatState>(CHAT_KEY, EMPTY_CHAT, {
  parse: parseChat,
  prune: (state) => ({ ...state, turns: state.turns.slice(-CHAT_MAX_TURNS) }),
})

/**
 * 流式气泡状态（本切片）：assistant 正在生成时的正文增量与阶段标签。
 * 刻意用独立 store 且 `persist:false`——流式内容体量大、生命周期短，绝不进 localStorage（ADR-0022 精神）。
 */
interface ChatStreamState {
  text: string
  label: string
}

const EMPTY_STREAM: ChatStreamState = { text: '', label: '正在思考…' }

const chatStreamStore = createUiStore<ChatStreamState>('kernel.ui.chat.stream.v1', EMPTY_STREAM, {
  persist: false,
})

/** 服务端 status 帧 → 中文阶段标签（未知状态回退「正在思考…」） */
const CHAT_STATUS_TEXT: Record<string, string> = {
  thinking: '正在思考…',
  searching: '正在联网检索…',
  lookup: '正在查阅记录…',
}

let seq = maxTurnSeq(chatStore.get().turns) + 1

/** 在途请求令牌（模块级）：清空 / 新请求令旧的迟到响应失效（跨挂载有效） */
let chatToken = 0

function patchChat(patch: Partial<ChatState>): void {
  chatStore.set((prev) => ({ ...prev, ...patch }))
}

/** 按 id 就地更新单轮（模块级）：用于标记修改提案「已应用 / 已忽略」 */
function patchTurn(id: string, patch: Partial<ChatTurn>): void {
  patchChat({ turns: chatStore.get().turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) })
}

/**
 * 发起一轮请求（模块级）：切路由卸载后仍能把回复写回 store，故「思考中」状态可跨页面保留。
 * 请求令牌保证：清空后迟到的回复直接丢弃。
 */
/** 由服务端结果构造一条 assistant 轮次（含全部提案；有提案则置「待确认」态） */
function buildReplyTurn(result: AiChatResult): ChatTurn {
  const reply: ChatTurn = { id: `c-${seq++}`, role: 'assistant', content: result.reply }
  if (result.searched !== undefined && result.searched.length > 0) reply.searched = result.searched
  if (result.focused !== undefined && result.focused.length > 0) reply.focused = result.focused
  if (result.edits !== undefined && result.edits.length > 0) {
    reply.edits = result.edits
    reply.editState = 'pending'
  }
  if (result.traces !== undefined && result.traces.length > 0) {
    reply.traces = result.traces
    reply.traceState = 'pending'
  }
  if (result.tasks !== undefined && result.tasks.length > 0) {
    reply.tasks = result.tasks
    reply.taskState = 'pending'
  }
  if (result.events !== undefined && result.events.length > 0) {
    reply.events = result.events
    reply.eventState = 'pending'
  }
  if (result.projects !== undefined && result.projects.length > 0) {
    reply.projects = result.projects
    reply.projectState = 'pending'
  }
  if (result.notes !== undefined && result.notes.length > 0) {
    reply.notes = result.notes
    reply.noteState = 'pending'
  }
  if (result.actions !== undefined && result.actions.length > 0) {
    reply.actions = result.actions
    reply.actionState = 'pending'
  }
  return reply
}

/**
 * 发起一轮流式请求（模块级）：切路由卸载后仍能把回复写回 store，故「思考中」状态可跨页面保留。
 * 流式增量（delta.text）节流 ~80ms 写入流式气泡；status 帧驱动阶段标签。
 * 请求令牌保证：清空 / 新请求后迟到的帧与回复直接丢弃。
 */
function requestChat(history: ChatTurn[], attachments?: ChatAttachment[]): void {
  const token = (chatToken += 1)
  patchChat({ busy: true, error: '' })
  chatStreamStore.set({ ...EMPTY_STREAM })
  void (async () => {
    // 流式正文增量缓冲：约 80ms 合并一次，避免 token 级重渲染
    let buffered = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const flush = (): void => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (buffered === '' || chatToken !== token) return
      const chunk = buffered
      buffered = ''
      const prev = chatStreamStore.get()
      chatStreamStore.set({ ...prev, text: prev.text + chunk })
    }
    const scheduleFlush = (): void => {
      if (flushTimer === null) flushTimer = setTimeout(flush, 80)
    }
    try {
      const result = await aiChatStream(
        history.map(({ role, content }) => ({ role, content })),
        attachments,
        (event) => {
          if (chatToken !== token) return
          if (event.kind === 'status') {
            chatStreamStore.set({
              ...chatStreamStore.get(),
              label: CHAT_STATUS_TEXT[event.status] ?? '正在思考…',
            })
          } else if (event.kind === 'delta' && event.field === 'text') {
            buffered += event.delta
            scheduleFlush()
          }
        },
      )
      flush()
      if (chatToken !== token) return
      patchChat({ turns: [...history, buildReplyTurn(result)], busy: false, error: '' })
      chatStreamStore.set({ ...EMPTY_STREAM })
    } catch (err) {
      if (flushTimer !== null) clearTimeout(flushTimer)
      if (chatToken !== token) return
      patchChat({ error: errorText(err), busy: false })
      chatStreamStore.set({ ...EMPTY_STREAM })
    }
  })()
}

/** 对话式整理意图（Slice G.1）：如「把这条整理进笔记」「存成笔记」→ 由 AI 整理上一条回答为独立笔记 */
const NOTE_INTENT = /(整理|保存|存|归档)(进|到|为|成|入)[^。！？\n]{0,6}笔记/

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** 归档标题 / 时间戳：YYYY-MM-DD HH:mm（按时间命名） */
function stamp(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

/** 由对话生成 markdown 文本（我 / KERNEL 依次成段） */
function buildTranscript(title: string, turns: ChatTurn[]): string {
  const lines = [`# ${title}`, '']
  for (const turn of turns) {
    lines.push(turn.role === 'user' ? '**我**' : '**KERNEL**')
    lines.push('')
    lines.push(turn.content)
    lines.push('')
  }
  return lines.join('\n').trim()
}

export function OverviewChat() {
  const { toast } = useToast()
  const navigate = useNavigate()
  const chat = useUiStore(chatStore)
  const stream = useUiStore(chatStreamStore)
  const { turns, draft, busy, error } = chat
  const threadRef = useRef<HTMLDivElement>(null)
  /** 修改提案应用中的互斥锁（防重复提交） */
  const [applying, setApplying] = useState(false)
  /** 待发送附件（File 对象，刻意组件级、不持久化——二进制句柄不可序列化，见 ADR-0022） */
  const [files, setFiles] = useState<File[]>([])
  /** 拖拽悬停态（深度计数避免子元素 dragleave 抖动） */
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 新消息 / 思考中 / 流式增量：线程滚到底部
  useEffect(() => {
    const node = threadRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [turns, busy, stream.text])

  // 待发送附件队列（点击选择 / 拖拽落入 / 粘贴共用）
  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) return
    setFiles((prev) => [...prev, ...incoming])
  }

  const removeFile = (index: number): void => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
  }

  // 剪贴板粘贴截图（与 Inbox 同通路）：window 级 paste —— 仅 Overview 挂载期存活。
  // 有图片：preventDefault 后入队，无文件名的图片按时间戳命名；纯文本不拦截（照常进输入框）。
  useEffect(() => {
    const onPaste = (event: ClipboardEvent): void => {
      const data = event.clipboardData
      if (data === null || data === undefined) return
      const images = clipboardImageFiles(data)
      if (images.length === 0) return
      event.preventDefault()
      addFiles(
        images.map((file) =>
          file.name.trim() === ''
            ? new File([file], timestampedImageName(file.type), { type: file.type })
            : file,
        ),
      )
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
    // addFiles 只依赖稳定的 setFiles；一次性注册，避免每次渲染重绑监听
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // 对话式整理（Slice G.1）：把上一条回答整理为独立笔记并追加一条确认轮（token 纪律同 requestChat）
  const runNote = (instruction: string, answer: string, base: ChatTurn[]): void => {
    const token = (chatToken += 1)
    void (async () => {
      try {
        const result = await chatNoteFromChat({ instruction, answer })
        if (chatToken !== token) return
        patchChat({
          turns: [
            ...base,
            {
              id: `c-${seq++}`,
              role: 'assistant',
              content: `已整理为笔记：**「${result.note.title}」**`,
              noteId: result.note.id,
            },
          ],
          busy: false,
          error: '',
        })
        toast('已整理为笔记', {
          action: { label: '查看', onClick: () => navigate(`/library?note=${result.note.id}`) },
        })
      } catch (err) {
        if (chatToken !== token) return
        patchChat({ error: `整理失败：${errorText(err)}`, busy: false })
      }
    })()
  }

  // 每轮 AI 回复的「存为笔记」按钮：只整理、不追加对话轮（安静反馈）
  const saveTurnAsNote = (turn: ChatTurn): void => {
    void (async () => {
      try {
        const result = await chatNoteFromChat({
          instruction: '把这条回答整理成一条完整笔记',
          answer: turn.content,
        })
        toast('已整理为笔记', {
          action: { label: '查看', onClick: () => navigate(`/library?note=${result.note.id}`) },
        })
      } catch (err) {
        toast(`整理失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 应用修改提案（本切片）：逐条经单写者更新；成功后标记「已应用」并提供撤销（逆序写回 before）。
  // 批量原子性：任一条失败时，回滚此前已写入的条目（逆序写回 before），不留半套修改。
  const applyEdits = (turn: ChatTurn): void => {
    const edits = turn.edits
    if (edits === undefined || edits.length === 0 || applying) return
    setApplying(true)
    void (async () => {
      const applied: ChatEditProposal[] = []
      try {
        for (const edit of edits) {
          await updateEntity(edit.kind, edit.id, edit.fields)
          applied.push(edit)
        }
        patchTurn(turn.id, { editState: 'applied' })
        const only = edits.length === 1 ? edits[0] : undefined
        const message = only !== undefined ? `已修改「${only.title}」` : `已修改 ${edits.length} 项`
        toast(message, {
          action: {
            label: '撤销',
            onClick: () => {
              void (async () => {
                const failed = await restoreEdits(edits)
                if (failed > 0) toast(`撤销未完成：有 ${failed} 项未能还原`, { tone: 'error' })
              })()
            },
          },
        })
      } catch (err) {
        // 部分失败：回滚已写入的条目，避免留下半套修改；失败项保留「待确认」供重试
        let note = ''
        if (applied.length > 0) {
          const failed = await restoreEdits(applied)
          note = failed === 0 ? '，已回滚' : `；回滚未完全成功：有 ${failed} 项未还原`
        }
        toast(`修改失败${note}：${errorText(err)}`, { tone: 'error' })
      } finally {
        setApplying(false)
      }
    })()
  }

  // 应用「踪迹」提案（「踪迹」功能）：逐条经 /api/traces 落盘（支持 1–N 条拆分）；
  // 成功后标记已应用并提供撤销（回收站，逐条）。
  const applyTrace = (turn: ChatTurn): void => {
    const rows = (turn.traces ?? []).filter((trace) => trace.title.trim() !== '')
    if (rows.length === 0 || applying) return
    setApplying(true)
    void (async () => {
      const created: Array<{ id: string }> = []
      try {
        for (const row of rows) {
          created.push(await createTrace({ title: row.title.trim(), note: row.note, at: row.at }))
        }
        patchTurn(turn.id, { traceState: 'applied' })
        toast(created.length > 1 ? `已记入 ${created.length} 条踪迹` : '已记入踪迹', {
          action: {
            label: '撤销',
            onClick: () => {
              void (async () => {
                for (const one of created) {
                  await trashEntity('traces', one.id).catch(() => undefined)
                }
              })()
            },
          },
        })
      } catch (err) {
        toast(`记录失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setApplying(false)
      }
    })()
  }

  // 应用「新建任务」提案：逐条经既有 /api/tasks 落盘（支持 1–N 条；ai:true → 新标签 origin:'ai'）；
  // 成功后标记「已应用」并提供撤销（回收站，逐条）。
  const applyTask = (turn: ChatTurn): void => {
    const rows = (turn.tasks ?? []).filter((task) => task.title.trim() !== '')
    if (rows.length === 0 || applying) return
    setApplying(true)
    void (async () => {
      const created: Array<{ id: string }> = []
      try {
        for (const row of rows) {
          created.push(
            await createTask({
              title: row.title.trim(),
              dueAt: row.dueAt,
              importance: row.importance,
              ai: true,
            }),
          )
        }
        patchTurn(turn.id, { taskState: 'applied' })
        toast(created.length > 1 ? `已建立 ${created.length} 条任务` : '已建立任务', {
          action: {
            label: '撤销',
            onClick: () => {
              void (async () => {
                for (const one of created) await trashEntity('tasks', one.id).catch(() => undefined)
              })()
            },
          },
        })
      } catch (err) {
        toast(`建立失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setApplying(false)
      }
    })()
  }

  // 应用「新建日程」提案：逐条经既有 /api/events 落盘（支持 1–N 条）；成功后标记「已应用」并提供撤销（回收站，逐条）。
  const applyEvent = (turn: ChatTurn): void => {
    const rows = (turn.events ?? []).filter((event) => event.title.trim() !== '' && event.startAt.trim() !== '')
    if (rows.length === 0 || applying) return
    setApplying(true)
    void (async () => {
      const created: Array<{ id: string }> = []
      try {
        for (const row of rows) {
          created.push(
            await createEvent({
              title: row.title.trim(),
              startAt: row.startAt,
              endAt: row.endAt,
              allDay: row.allDay,
              location: row.location,
            }),
          )
        }
        patchTurn(turn.id, { eventState: 'applied' })
        toast(created.length > 1 ? `已建立 ${created.length} 条日程` : '已建立日程', {
          action: {
            label: '撤销',
            onClick: () => {
              void (async () => {
                for (const one of created) await trashEntity('events', one.id).catch(() => undefined)
              })()
            },
          },
        })
      } catch (err) {
        toast(`建立失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setApplying(false)
      }
    })()
  }

  // 应用「新建项目」提案：逐条经既有 /api/projects 落盘（支持 1–N 条；ai:true → 新标签 origin:'ai'）；
  // 成功后标记「已应用」并提供撤销（回收站，逐条）。
  const applyProject = (turn: ChatTurn): void => {
    const rows = (turn.projects ?? []).filter((project) => project.title.trim() !== '')
    if (rows.length === 0 || applying) return
    setApplying(true)
    void (async () => {
      const created: Array<{ id: string }> = []
      try {
        for (const row of rows) {
          const project = await createProject({
            title: row.title.trim(),
            outcome: row.outcome,
            ai: true,
          })
          created.push({ id: project.id })
        }
        patchTurn(turn.id, { projectState: 'applied' })
        toast(created.length > 1 ? `已建立 ${created.length} 个项目` : '已建立项目', {
          action: {
            label: '撤销',
            onClick: () => {
              void (async () => {
                for (const one of created) await trashEntity('projects', one.id).catch(() => undefined)
              })()
            },
          },
        })
      } catch (err) {
        toast(`建立失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setApplying(false)
      }
    })()
  }

  // 应用「新建笔记」提案：逐条经既有 /api/notes 落盘（支持 1–N 条）；成功后标记「已应用」并提供撤销（回收站，逐条）。
  const applyNote = (turn: ChatTurn): void => {
    const rows = (turn.notes ?? []).filter((note) => note.title.trim() !== '')
    if (rows.length === 0 || applying) return
    setApplying(true)
    void (async () => {
      const created: Array<{ id: string }> = []
      try {
        for (const row of rows) {
          const note = await createNote({ title: row.title.trim(), body: row.body })
          created.push({ id: note.id })
        }
        patchTurn(turn.id, { noteState: 'applied' })
        toast(created.length > 1 ? `已存 ${created.length} 条笔记` : '已存为笔记', {
          action: {
            label: '撤销',
            onClick: () => {
              void (async () => {
                for (const one of created) await trashEntity('notes', one.id).catch(() => undefined)
              })()
            },
          },
        })
      } catch (err) {
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setApplying(false)
      }
    })()
  }

  // 应用「操作既有实体」提案：按 op 分派（完成 / 重开 / 删除入回收站 / 归档）；
  // 成功后标记「已应用」并提供撤销（反向动作，逆序）；部分失败逆序回滚已执行项，不留半套。
  const applyAction = (turn: ChatTurn): void => {
    const rows = turn.actions ?? []
    if (rows.length === 0 || applying) return
    setApplying(true)
    void (async () => {
      const done: ChatActionProposal[] = []
      try {
        for (const row of rows) {
          await ACTION_RUN[row.op](row)
          done.push(row)
        }
        patchTurn(turn.id, { actionState: 'applied' })
        toast(`已处理 ${done.length} 项`, {
          action: {
            label: '撤销',
            onClick: () => {
              void (async () => {
                for (const one of [...done].reverse()) {
                  await ACTION_UNDO[one.op](one).catch(() => undefined)
                }
              })()
            },
          },
        })
      } catch (err) {
        let note = ''
        if (done.length > 0) {
          let failed = 0
          for (const one of [...done].reverse()) {
            try {
              await ACTION_UNDO[one.op](one)
            } catch {
              failed += 1
            }
          }
          note = failed === 0 ? '，已回滚' : `；回滚未完全成功：有 ${failed} 项未还原`
        }
        toast(`操作失败${note}：${errorText(err)}`, { tone: 'error' })
      } finally {
        setApplying(false)
      }
    })()
  }

  const send = (): void => {
    const text = draft.trim()
    if ((text === '' && files.length === 0) || busy) return
    const pending = files
    // 用户轮正文：纯附件时给出占位，避免空气泡
    const content = text !== '' ? text : '（见附件）'
    // 对话式整理：命中意图且有上一条 AI 回答 → 走整理流程而非普通问答
    const lastAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant')
    const history = [...turns, { id: `c-${seq++}`, role: 'user' as const, content }]
    patchChat({ turns: history, draft: '', busy: true, error: '' })
    if (NOTE_INTENT.test(text) && lastAssistant !== undefined) {
      setFiles([])
      runNote(text, lastAssistant.content, history)
      return
    }
    setFiles([])
    if (pending.length === 0) {
      requestChat(history)
      return
    }
    // 先受限并发上传附件（≤3），再携引用发起流式对话；上传失败以可读错误结束本轮
    void (async () => {
      try {
        const refs = await mapLimit(pending, UPLOAD_CONCURRENCY, uploadChatAttachment)
        requestChat(history, refs)
      } catch (err) {
        patchChat({ error: `附件上传失败：${errorText(err)}`, busy: false })
      }
    })()
  }

  // 失败重试：保留已发出的用户消息，重新请求（不重复追加用户轮）
  const retry = (): void => {
    if (busy || turns.length === 0) return
    patchChat({ busy: true, error: '' })
    requestChat(turns)
  }

  // 清空：非空对话先归档为笔记；归档失败则不清空（对话保留）。
  // 归档成功即清空内存 + 持久化副本，刷新后仍为已清空。
  const clear = (): void => {
    if (turns.length === 0 || busy) return
    const now = new Date()
    const title = `AI 对话归档 · ${stamp(now)}`
    const body = buildTranscript(title, turns)
    void (async () => {
      try {
        const note = await createNote({ title, body, type: 'memo' })
        chatToken += 1 // 作废在途请求（迟到响应不再落状态）
        chatStreamStore.set({ ...EMPTY_STREAM })
        patchChat({ turns: [], busy: false, error: '' })
        toast('已归档为笔记', {
          action: { label: '查看', onClick: () => navigate(`/library?note=${note.id}`) },
        })
      } catch (err) {
        toast(`归档失败，对话未清空：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  return (
    <section className="k-chat" aria-label="AI 对话">
      {turns.length > 0 && (
        <div className="k-chat__thread" ref={threadRef} role="log" aria-live="polite">
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={turn.role === 'user' ? 'k-chat__msg k-chat__msg--me' : 'k-chat__msg k-chat__msg--ai'}
            >
              <span className="k-chat__who u-label">{turn.role === 'user' ? '我' : 'KERNEL'}</span>
              {turn.role === 'assistant' ? (
                <>
                  <div className="k-chat__text k-chat__md">
                    <ReactMarkdown>{turn.content}</ReactMarkdown>
                  </div>
                  {turn.searched !== undefined && turn.searched.length > 0 && (
                    <span className="k-chat__searched u-label k-muted">
                      已联网检索 · {turn.searched.join(' · ')}
                    </span>
                  )}
                  {turn.focused !== undefined && turn.focused.length > 0 && (
                    <span className="k-chat__searched u-label k-muted">
                      已查阅 · {turn.focused.join(' · ')}
                    </span>
                  )}
                  {turn.edits !== undefined && turn.edits.length > 0 && turn.editState !== 'dismissed' && (
                    <div className="k-chat__edit">
                      {turn.editState === 'applied' ? (
                        <span className="k-chat__searched u-label k-muted">已应用修改</span>
                      ) : (
                        <>
                          {turn.edits.map((edit, index) => (
                            <div className="k-chat__edit-item" key={`${edit.kind}-${edit.id}-${index}`}>
                              <span className="k-chat__edit-title">将修改「{edit.title}」</span>
                              {Object.keys(edit.fields).map((key) => (
                                <div className="k-chat__edit-diff" key={key}>
                                  {FIELD_LABEL[key] ?? key}：
                                  <span className="k-chat__edit-old">{fmtValue(edit.before[key])}</span> →{' '}
                                  {fmtValue(edit.fields[key])}
                                </div>
                              ))}
                            </div>
                          ))}
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyEdits(turn)}
                              disabled={applying}
                            >
                              应用
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { editState: 'dismissed' })}
                              disabled={applying}
                            >
                              忽略
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {turn.traces !== undefined && turn.traces.length > 0 && turn.traceState !== 'dismissed' && (
                    <div className="k-chat__edit">
                      {turn.traceState === 'applied' ? (
                        <span className="k-chat__searched u-label k-muted">
                          已记入 {turn.traces.filter((trace) => trace.title.trim() !== '').length} 条踪迹
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">记入踪迹（可拆分）</span>
                          <div className="k-chat__rows">
                            {turn.traces.map((trace, index) => (
                              <div className="k-chat__row" key={index}>
                                <input
                                  className="k-input"
                                  value={trace.title}
                                  placeholder="我做了什么…"
                                  aria-label={`踪迹 ${index + 1} 标题`}
                                  onChange={(event) =>
                                    patchTurn(turn.id, {
                                      traces: (turn.traces ?? []).map((row, i) =>
                                        i === index ? { ...row, title: event.target.value } : row,
                                      ),
                                    })
                                  }
                                />
                                {trace.at !== undefined && (
                                  <span className="k-chat__row-meta">{formatDateTime(trace.at)}</span>
                                )}
                                {(turn.traces?.length ?? 0) > 1 && (
                                  <button
                                    type="button"
                                    className="k-chat__row-del"
                                    aria-label={`删除第 ${index + 1} 条`}
                                    onClick={() =>
                                      patchTurn(turn.id, {
                                        traces: (turn.traces ?? []).filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyTrace(turn)}
                              disabled={applying || !turn.traces.some((trace) => trace.title.trim() !== '')}
                            >
                              记录
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() =>
                                patchTurn(turn.id, { traces: [...(turn.traces ?? []), { title: '' }] })
                              }
                              disabled={applying || turn.traces.length >= 6}
                            >
                              拆分
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { traceState: 'dismissed' })}
                              disabled={applying}
                            >
                              忽略
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {turn.events !== undefined && turn.events.length > 0 && turn.eventState !== 'dismissed' && (
                    <div className="k-chat__edit">
                      {turn.eventState === 'applied' ? (
                        <span className="k-chat__searched u-label k-muted">
                          已建立 {turn.events.filter((event) => event.title.trim() !== '').length} 条日程
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">建立日程（{turn.events.length} 条）</span>
                          <div className="k-chat__rows">
                            {turn.events.map((event, index) => (
                              <div className="k-chat__row" key={index}>
                                <input
                                  className="k-input"
                                  value={event.title}
                                  placeholder="日程标题…"
                                  aria-label={`日程 ${index + 1} 标题`}
                                  onChange={(e) =>
                                    patchTurn(turn.id, {
                                      events: (turn.events ?? []).map((row, i) =>
                                        i === index ? { ...row, title: e.target.value } : row,
                                      ),
                                    })
                                  }
                                />
                                <span className="k-chat__row-meta">{formatDateTime(event.startAt)}</span>
                                {event.location !== undefined && event.location !== '' && (
                                  <span className="k-chat__row-meta">{event.location}</span>
                                )}
                                {(turn.events?.length ?? 0) > 1 && (
                                  <button
                                    type="button"
                                    className="k-chat__row-del"
                                    aria-label={`删除第 ${index + 1} 条`}
                                    onClick={() =>
                                      patchTurn(turn.id, {
                                        events: (turn.events ?? []).filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyEvent(turn)}
                              disabled={applying || !turn.events.some((event) => event.title.trim() !== '')}
                            >
                              建立
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { eventState: 'dismissed' })}
                              disabled={applying}
                            >
                              忽略
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {turn.tasks !== undefined && turn.tasks.length > 0 && turn.taskState !== 'dismissed' && (
                    <div className="k-chat__edit">
                      {turn.taskState === 'applied' ? (
                        <span className="k-chat__searched u-label k-muted">
                          已建立 {turn.tasks.filter((task) => task.title.trim() !== '').length} 条任务
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">建立任务（可拆分）</span>
                          <div className="k-chat__rows">
                            {turn.tasks.map((task, index) => (
                              <div className="k-chat__row" key={index}>
                                <input
                                  className="k-input"
                                  value={task.title}
                                  placeholder="任务标题…"
                                  aria-label={`任务 ${index + 1} 标题`}
                                  onChange={(e) =>
                                    patchTurn(turn.id, {
                                      tasks: (turn.tasks ?? []).map((row, i) =>
                                        i === index ? { ...row, title: e.target.value } : row,
                                      ),
                                    })
                                  }
                                />
                                {task.dueAt !== undefined && (
                                  <span className="k-chat__row-meta">{formatDateTime(task.dueAt)}</span>
                                )}
                                {(turn.tasks?.length ?? 0) > 1 && (
                                  <button
                                    type="button"
                                    className="k-chat__row-del"
                                    aria-label={`删除第 ${index + 1} 条`}
                                    onClick={() =>
                                      patchTurn(turn.id, {
                                        tasks: (turn.tasks ?? []).filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyTask(turn)}
                              disabled={applying || !turn.tasks.some((task) => task.title.trim() !== '')}
                            >
                              建立
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() =>
                                patchTurn(turn.id, { tasks: [...(turn.tasks ?? []), { title: '' }] })
                              }
                              disabled={applying || turn.tasks.length >= 6}
                            >
                              拆分
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { taskState: 'dismissed' })}
                              disabled={applying}
                            >
                              忽略
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {turn.projects !== undefined && turn.projects.length > 0 && turn.projectState !== 'dismissed' && (
                    <div className="k-chat__edit">
                      {turn.projectState === 'applied' ? (
                        <span className="k-chat__searched u-label k-muted">
                          已建立 {turn.projects.filter((project) => project.title.trim() !== '').length} 个项目
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">建立项目（{turn.projects.length} 条）</span>
                          <div className="k-chat__rows">
                            {turn.projects.map((project, index) => (
                              <div className="k-chat__row" key={index}>
                                <input
                                  className="k-input"
                                  value={project.title}
                                  placeholder="项目标题…"
                                  aria-label={`项目 ${index + 1} 标题`}
                                  onChange={(event) =>
                                    patchTurn(turn.id, {
                                      projects: (turn.projects ?? []).map((row, i) =>
                                        i === index ? { ...row, title: event.target.value } : row,
                                      ),
                                    })
                                  }
                                />
                                {project.outcome !== undefined && project.outcome !== '' && (
                                  <span className="k-chat__row-meta" title={project.outcome}>
                                    完成定义：{truncate(project.outcome)}
                                  </span>
                                )}
                                {(turn.projects?.length ?? 0) > 1 && (
                                  <button
                                    type="button"
                                    className="k-chat__row-del"
                                    aria-label={`删除第 ${index + 1} 条`}
                                    onClick={() =>
                                      patchTurn(turn.id, {
                                        projects: (turn.projects ?? []).filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyProject(turn)}
                              disabled={applying || !turn.projects.some((project) => project.title.trim() !== '')}
                            >
                              建立
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { projectState: 'dismissed' })}
                              disabled={applying}
                            >
                              忽略
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {turn.notes !== undefined && turn.notes.length > 0 && turn.noteState !== 'dismissed' && (
                    <div className="k-chat__edit">
                      {turn.noteState === 'applied' ? (
                        <span className="k-chat__searched u-label k-muted">
                          已存 {turn.notes.filter((note) => note.title.trim() !== '').length} 条笔记
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">存为笔记（{turn.notes.length} 条）</span>
                          <div className="k-chat__rows">
                            {turn.notes.map((note, index) => (
                              <div className="k-chat__row" key={index}>
                                <input
                                  className="k-input"
                                  value={note.title}
                                  placeholder="笔记标题…"
                                  aria-label={`笔记 ${index + 1} 标题`}
                                  onChange={(event) =>
                                    patchTurn(turn.id, {
                                      notes: (turn.notes ?? []).map((row, i) =>
                                        i === index ? { ...row, title: event.target.value } : row,
                                      ),
                                    })
                                  }
                                />
                                {note.body !== '' && (
                                  <span className="k-chat__row-meta" title={note.body}>
                                    {truncate(note.body)}
                                  </span>
                                )}
                                {(turn.notes?.length ?? 0) > 1 && (
                                  <button
                                    type="button"
                                    className="k-chat__row-del"
                                    aria-label={`删除第 ${index + 1} 条`}
                                    onClick={() =>
                                      patchTurn(turn.id, {
                                        notes: (turn.notes ?? []).filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyNote(turn)}
                              disabled={applying || !turn.notes.some((note) => note.title.trim() !== '')}
                            >
                              存为笔记
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { noteState: 'dismissed' })}
                              disabled={applying}
                            >
                              忽略
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {turn.actions !== undefined && turn.actions.length > 0 && turn.actionState !== 'dismissed' && (
                    <div className="k-chat__edit">
                      {turn.actionState === 'applied' ? (
                        <span className="k-chat__searched u-label k-muted">
                          已处理 {turn.actions.length} 项
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">操作（{turn.actions.length} 项）</span>
                          <div className="k-chat__rows">
                            {turn.actions.map((action, index) => (
                              <div className="k-chat__row" key={`${action.op}-${action.id}-${index}`}>
                                <span className="k-chat__edit-title">
                                  {ACTION_LABEL[action.op]}「{action.title}」
                                </span>
                                {action.label !== undefined && action.label !== '' && (
                                  <span className="k-chat__row-meta" title={action.label}>
                                    {truncate(action.label)}
                                  </span>
                                )}
                                {(turn.actions?.length ?? 0) > 1 && (
                                  <button
                                    type="button"
                                    className="k-chat__row-del"
                                    aria-label={`移除第 ${index + 1} 项`}
                                    onClick={() =>
                                      patchTurn(turn.id, {
                                        actions: (turn.actions ?? []).filter((_, i) => i !== index),
                                      })
                                    }
                                  >
                                    删除
                                  </button>
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyAction(turn)}
                              disabled={applying || turn.actions.length === 0}
                            >
                              应用
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { actionState: 'dismissed' })}
                              disabled={applying}
                            >
                              忽略
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {typeof turn.noteId === 'string' && turn.noteId !== '' && (
                    <button
                      type="button"
                      className="k-chat__notelink"
                      onClick={() => navigate(`/library?note=${turn.noteId}`)}
                    >
                      打开笔记
                    </button>
                  )}
                  <button
                    type="button"
                    className="k-chat__save"
                    onClick={() => saveTurnAsNote(turn)}
                  >
                    存为笔记
                  </button>
                </>
              ) : (
                <p className="k-chat__text">{turn.content}</p>
              )}
            </div>
          ))}
          {busy && (
            <div className="k-chat__msg k-chat__msg--ai">
              <span className="k-chat__who u-label">KERNEL</span>
              {stream.text.trim() !== '' ? (
                <div className="k-chat__text k-chat__md">
                  <ReactMarkdown>{stream.text}</ReactMarkdown>
                </div>
              ) : (
                <p className="k-chat__text k-chat__text--thinking" role="status" aria-live="polite">
                  {stream.label}
                </p>
              )}
            </div>
          )}
          {error !== '' && !busy && (
            <div className="k-chat__error" role="alert">
              <span className="k-chat__error-text">{error}</span>
              <button type="button" className="k-pill is-ghost" onClick={retry}>
                重试
              </button>
            </div>
          )}
        </div>
      )}

      <div
        className={dragOver ? 'ic-composer k-chat__composer is-dragover' : 'ic-composer k-chat__composer'}
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
        {files.length > 0 && (
          <div className="ic-chips k-chat__files">
            {files.map((file, index) => (
              <span className="ic-chip" key={`${file.name}-${file.size}-${index}`}>
                <FileText size={12} strokeWidth={1.5} aria-hidden />
                <span className="ic-chip__name">{file.name}</span>
                <span className="ic-chip__size k-mono">{humanSize(file.size)}</span>
                <button
                  type="button"
                  className="ic-chip__remove"
                  aria-label={`移除 ${file.name}`}
                  onClick={() => removeFile(index)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          className="ic-composer__input k-chat__input"
          value={draft}
          rows={1}
          onChange={(event) => patchChat({ draft: event.target.value })}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          placeholder="问 AI：我今天有什么特别紧急需要去做的事情？"
          aria-label="AI 对话输入"
        />
        <div className="ic-composer__foot">
          <div className="ic-composer__actions">
            <button
              type="button"
              className="ic-icon-btn"
              onClick={() => fileInputRef.current?.click()}
              aria-label="添加附件"
              title="添加附件（可多选）"
            >
              <Paperclip size={16} strokeWidth={1.5} aria-hidden />
            </button>
            <span className="ic-composer__hint u-label k-muted">
              读库 · 联网 · 自由回答 · 可附文件 · Enter 发送 · Shift+Enter 换行
            </span>
          </div>
          <div className="k-chat__actions">
            <button
              type="button"
              className="k-chat__clear"
              onClick={clear}
              disabled={turns.length === 0 || busy}
              title="清空对话前会先归档为笔记"
            >
              清空对话
            </button>
            <button
              type="button"
              className="ic-send"
              onClick={send}
              disabled={busy || (draft.trim() === '' && files.length === 0)}
              aria-label="发送"
            >
              <ArrowUp size={16} strokeWidth={2} aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
