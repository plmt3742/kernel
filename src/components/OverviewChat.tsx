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
  type ReactNode,
} from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ArrowUp, FileText, Paperclip, Square } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@/context/ToastContext'
import { errorText } from '@/lib/api'
import { createUiStore, useUiStore } from '@/lib/uiState'
import { formatDateTime } from '@/lib/date'
import { humanSize } from '@/lib/format'
import { deepLinkOfId } from '@/lib/relations'
import {
  aiChatStream,
  chatNoteFromChat,
  checkinHabit,
  completeTask,
  createEvent,
  createNote,
  createProject,
  createResource,
  createTask,
  createTrace,
  reopenTask,
  restoreEntity,
  trashEntity,
  uncheckinHabit,
  updateEntity,
  uploadChatAttachment,
  type AiChatMessage,
  type AiChatResult,
  type ChatActionKind,
  type ChatActionOp,
  type ChatActionProposal,
  type ChatAskRequest,
  type ChatAttachment,
  type ChatEditProposal,
  type ChatEventProposal,
  type ChatNoteProposal,
  type ChatProjectProposal,
  type ChatResourceProposal,
  type ChatTaskProposal,
  type ChatTraceProposal,
} from '@/lib/mutations'

/** 多附件上传的受限并发上限（与 Inbox 同款 mapLimit 模式，Slice Y · F33） */
const UPLOAD_CONCURRENCY = 3

/** 对话附件单文件上限（与服务端 MAX_UPLOAD_BYTES 对齐）：超出在客户端即拦截 */
const MAX_ATTACH_BYTES = 25 * 1024 * 1024

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
  /** 上传成功后的对话附件引用（用于气泡展示与聊天失败重试复用；确认前零写入） */
  attachments?: ChatAttachment[]
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
  /** 「操作既有实体」提案（标记完成 / 重新打开 / 删除 / 归档 / 习惯打卡；**1–6 条**；确认前零写入） */
  actions?: ChatActionProposal[]
  actionState?: 'pending' | 'applied' | 'dismissed'
  /** 「新建资料」提案（P2-3；**1–3 条**；确认前零写入） */
  resources?: ChatResourceProposal[]
  resourceState?: 'pending' | 'applied' | 'dismissed'
  /** P1-2：查阅命中的实体引用（kind/id/title；「已查阅」渲染为可点深链） */
  focusedRefs?: Array<{ kind: string; id: string; title: string }>
  /** P1-2：联网检索来源（title/url ≤6；附在「已联网检索」行后供核验） */
  searchSources?: Array<{ title: string; url: string }>
  /** P1-2：应用成功后落盘的实体 id（kind → ids；「已应用」行给「查看」深链） */
  createdRefs?: Partial<Record<CreatePropKey, string[]>>
  /** P2-1：轮次时间戳（ms；消息时间显示；旧轮次缺省不显示） */
  at?: number
  /** 模型思考过程（reasoning 流）；「思考过程」折叠块展示，默认折叠 */
  reasoning?: string
  /** 反问（AI 判断必要信息缺失时先追问）；用户回答后进入下一轮；仅最新轮可答 */
  ask?: ChatAskRequest
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
  checkin: '打卡',
  uncheckin: '取消打卡',
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
  checkin: async (action) => {
    await checkinHabit(action.id)
  },
  uncheckin: async (action) => {
    await uncheckinHabit(action.id)
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
  checkin: async (action) => {
    await uncheckinHabit(action.id)
  },
  uncheckin: async (action) => {
    await checkinHabit(action.id)
  },
}

/** ISO 日期时间前缀（用于将字符串值渲染为可读时间） */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/

/** 超长文本截断（按字符数计，末位加省略号） */
function truncate(value: string): string {
  const chars = Array.from(value)
  return chars.length > 60 ? `${chars.slice(0, 60).join('')}…` : value
}

/** 轮次时间显示（P2-1）：当天只显示 HH:mm，跨天显示 M/D HH:mm */
function chatTime(at: number): string {
  const d = new Date(at)
  const now = new Date()
  const hm = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  return sameDay ? hm : `${d.getMonth() + 1}/${d.getDate()} ${hm}`
}

/** ISO8601 → datetime-local 输入值（本地时区；无效 / 空返回空串） */
function isoToLocalInput(iso: string | undefined): string {
  if (iso === undefined || iso === '') return ''
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return ''
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** datetime-local 输入值 → 带本地偏移的 ISO8601（空 / 无效返回 undefined） */
function localInputToIso(local: string): string | undefined {
  if (local === '') return undefined
  const d = new Date(local)
  if (!Number.isFinite(d.getTime())) return undefined
  const off = -d.getTimezoneOffset()
  const sign = off >= 0 ? '+' : '-'
  const oh = pad2(Math.floor(Math.abs(off) / 60))
  const om = pad2(Math.abs(off) % 60)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:00${sign}${oh}:${om}`
}

/** tags → 输入框文本（逗号分隔） */
function tagsToText(tags: string[] | undefined): string {
  return (tags ?? []).join(', ')
}

/** 输入框文本 → tags（逗号 / 顿号 / 空格分隔；空返回 undefined） */
function textToTags(text: string): string[] | undefined {
  const list = text
    .split(/[,，、\s]+/)
    .map((t) => t.trim())
    .filter((t) => t !== '')
  return list.length > 0 ? list : undefined
}

type RowFieldKind = 'trace' | 'task' | 'event' | 'project' | 'note' | 'resource'

/** 创建卡行的可编辑字段区（B-2）：按实体给出时间 / 地点 / 重要性 / 标签 / 备注 / 简介；token-only */
function createRowFields(
  kind: RowFieldKind,
  row: Record<string, unknown>,
  patch: (next: Record<string, unknown>) => void,
  disabled: boolean,
): ReactNode {
  const text = (key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '')
  const optText = (key: string): string | undefined => {
    const v = row[key]
    return typeof v === 'string' && v !== '' ? v : undefined
  }
  const fields: ReactNode[] = []
  if (kind === 'task') {
    fields.push(
      <input
        key="dueAt"
        type="datetime-local"
        className="k-input k-chat__field"
        value={isoToLocalInput(text('dueAt'))}
        disabled={disabled}
        aria-label="截止时间"
        onChange={(e) => patch({ dueAt: localInputToIso(e.target.value) })}
      />,
      <select
        key="importance"
        className="k-input k-chat__field"
        value={typeof row.importance === 'number' ? String(row.importance) : ''}
        disabled={disabled}
        aria-label="重要性"
        onChange={(e) =>
          patch({ importance: e.target.value === '' ? undefined : Number(e.target.value) })
        }
      >
        <option value="">重要性</option>
        <option value="0">0</option>
        <option value="1">1</option>
        <option value="2">2</option>
        <option value="3">3</option>
      </select>,
    )
  } else if (kind === 'event') {
    fields.push(
      <input
        key="startAt"
        type="datetime-local"
        className="k-input k-chat__field"
        value={isoToLocalInput(text('startAt'))}
        disabled={disabled}
        aria-label="开始时间"
        onChange={(e) => patch({ startAt: localInputToIso(e.target.value) })}
      />,
      <input
        key="endAt"
        type="datetime-local"
        className="k-input k-chat__field"
        value={isoToLocalInput(text('endAt'))}
        disabled={disabled}
        aria-label="结束时间"
        onChange={(e) => patch({ endAt: localInputToIso(e.target.value) })}
      />,
      <label key="allDay" className="k-chat__field-check">
        <input
          type="checkbox"
          checked={row.allDay === true}
          disabled={disabled}
          onChange={(e) => patch({ allDay: e.target.checked ? true : undefined })}
        />
        全天
      </label>,
      <input
        key="location"
        className="k-input k-chat__field"
        value={text('location')}
        disabled={disabled}
        placeholder="地点"
        aria-label="地点"
        onChange={(e) => patch({ location: optText('location') === undefined ? undefined : e.target.value || undefined })}
      />,
    )
  } else if (kind === 'trace') {
    fields.push(
      <input
        key="at"
        type="datetime-local"
        className="k-input k-chat__field"
        value={isoToLocalInput(text('at'))}
        disabled={disabled}
        aria-label="发生时间"
        onChange={(e) => patch({ at: localInputToIso(e.target.value) })}
      />,
      <input
        key="note"
        className="k-input k-chat__field"
        value={text('note')}
        disabled={disabled}
        placeholder="备注"
        aria-label="备注"
        onChange={(e) => patch({ note: e.target.value === '' ? undefined : e.target.value })}
      />,
    )
  } else if (kind === 'project') {
    fields.push(
      <input
        key="outcome"
        className="k-input k-chat__field"
        value={text('outcome')}
        disabled={disabled}
        placeholder="完成定义"
        aria-label="完成定义"
        onChange={(e) => patch({ outcome: e.target.value === '' ? undefined : e.target.value })}
      />,
    )
  } else if (kind === 'resource') {
    fields.push(
      <input
        key="url"
        className="k-input k-chat__field"
        value={text('url')}
        disabled={disabled}
        placeholder="链接"
        aria-label="链接"
        onChange={(e) => patch({ url: e.target.value === '' ? undefined : e.target.value })}
      />,
      <input
        key="note"
        className="k-input k-chat__field"
        value={text('note')}
        disabled={disabled}
        placeholder="简介"
        aria-label="简介"
        onChange={(e) => patch({ note: e.target.value === '' ? undefined : e.target.value })}
      />,
    )
  }
  if (kind !== 'note') {
    fields.push(
      <input
        key="tags"
        className="k-input k-chat__field"
        value={tagsToText(Array.isArray(row.tags) ? (row.tags as string[]) : undefined)}
        disabled={disabled}
        placeholder="标签（逗号分隔）"
        aria-label="标签"
        onChange={(e) => patch({ tags: textToTags(e.target.value) })}
      />,
    )
  }
  return <div className="k-chat__row-fields">{fields}</div>
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
/** 操作提案合法 kind（回收站同族子集；含 habits 供打卡，P1-5） */
const ACTION_KINDS: readonly ChatActionKind[] = [
  'tasks',
  'projects',
  'notes',
  'resources',
  'events',
  'traces',
  'habits',
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

/** 还原时清洗踪迹提案：title 必填（≤200），note / at / projectId 可选，≤6 条 */
function normalizeTraces(value: unknown): ChatTraceProposal[] {
  if (!Array.isArray(value)) return []
  const out: ChatTraceProposal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.title !== 'string') continue
    const trace: ChatTraceProposal = { title: Array.from(v.title).slice(0, 200).join('') }
    if (typeof v.note === 'string' && v.note !== '') trace.note = Array.from(v.note).slice(0, 2000).join('')
    if (typeof v.at === 'string' && v.at !== '') trace.at = v.at
    if (typeof v.projectId === 'string' && v.projectId !== '') trace.projectId = v.projectId
    out.push(trace)
    if (out.length >= 6) break
  }
  return out
}

/** 还原时清洗任务提案：title 必填（≤200），dueAt / importance / projectId 可选，≤6 条 */
function normalizeTasks(value: unknown): ChatTaskProposal[] {
  if (!Array.isArray(value)) return []
  const out: ChatTaskProposal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.title !== 'string') continue
    const task: ChatTaskProposal = { title: Array.from(v.title).slice(0, 200).join('') }
    if (typeof v.dueAt === 'string' && v.dueAt !== '') task.dueAt = v.dueAt
    if (typeof v.importance === 'number' && Number.isInteger(v.importance)) task.importance = v.importance
    if (typeof v.projectId === 'string' && v.projectId !== '') task.projectId = v.projectId
    if (typeof v.parentTaskId === 'string' && v.parentTaskId !== '') task.parentTaskId = v.parentTaskId
    out.push(task)
    if (out.length >= 6) break
  }
  return out
}

/** 还原时清洗日程提案：title / startAt 必填，endAt / allDay / location / projectId 可选，≤6 条 */
function normalizeEvents(value: unknown): ChatEventProposal[] {
  if (!Array.isArray(value)) return []
  const out: ChatEventProposal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.title !== 'string' || typeof v.startAt !== 'string') continue
    const event: ChatEventProposal = {
      title: Array.from(v.title).slice(0, 200).join(''),
      startAt: v.startAt,
    }
    if (typeof v.endAt === 'string' && v.endAt !== '') event.endAt = v.endAt
    if (v.allDay === true) event.allDay = true
    if (typeof v.location === 'string' && v.location !== '') {
      event.location = Array.from(v.location).slice(0, 200).join('')
    }
    if (typeof v.projectId === 'string' && v.projectId !== '') event.projectId = v.projectId
    out.push(event)
    if (out.length >= 6) break
  }
  return out
}

/** 还原时清洗资料提案：title 必填（≤200），url / note 可选，≤6 条 */
function normalizeResources(value: unknown): ChatResourceProposal[] {
  if (!Array.isArray(value)) return []
  const out: ChatResourceProposal[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.title !== 'string') continue
    const resource: ChatResourceProposal = { title: Array.from(v.title).slice(0, 200).join('') }
    if (typeof v.url === 'string' && v.url !== '') resource.url = v.url
    if (typeof v.note === 'string' && v.note !== '') {
      resource.note = Array.from(v.note).slice(0, 200).join('')
    }
    out.push(resource)
    if (out.length >= 6) break
  }
  return out
}

/** 还原时清洗实体引用（P1-2）：kind / id / title 均字符串，≤6 条 */
function normalizeFocusedRefs(value: unknown): Array<{ kind: string; id: string; title: string }> {
  if (!Array.isArray(value)) return []
  const out: Array<{ kind: string; id: string; title: string }> = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.kind !== 'string' || typeof v.id !== 'string') continue
    out.push({
      kind: v.kind,
      id: v.id,
      title: typeof v.title === 'string' ? Array.from(v.title).slice(0, 200).join('') : '',
    })
    if (out.length >= 6) break
  }
  return out
}

/** 还原时清洗检索来源（P1-2）：title / url 字符串，≤6 条 */
function normalizeSearchSources(value: unknown): Array<{ title: string; url: string }> {
  if (!Array.isArray(value)) return []
  const out: Array<{ title: string; url: string }> = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.url !== 'string' || v.url === '') continue
    out.push({
      title: typeof v.title === 'string' ? Array.from(v.title).slice(0, 200).join('') : '',
      url: v.url,
    })
    if (out.length >= 6) break
  }
  return out
}

/** 还原时清洗反问提案（B-1）：text 必填，options / fields 字符串数组 */
function normalizeAsk(value: unknown): ChatAskRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.text !== 'string' || v.text.trim() === '') return null
  return {
    text: Array.from(v.text).slice(0, 200).join(''),
    options: cleanStringList(v.options, 4, 30),
    fields: cleanStringList(v.fields, 6, 20),
  }
}

/** 还原时清洗「已应用产物 id」（P1-2）：每类 ≤6 个字符串 id */
function normalizeCreatedRefs(value: unknown): Partial<Record<CreatePropKey, string[]>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {}
  const out: Partial<Record<CreatePropKey, string[]>> = {}
  const keys: readonly CreatePropKey[] = [
    'traces',
    'tasks',
    'events',
    'projects',
    'notes',
    'resources',
  ]
  for (const key of keys) {
    const raw = (value as Record<string, unknown>)[key]
    if (!Array.isArray(raw)) continue
    const ids = raw.filter((id): id is string => typeof id === 'string' && id !== '').slice(0, 6)
    if (ids.length > 0) out[key] = ids
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

/** 创建类提案卡可写的轮次字段键（traces / tasks / events / projects / notes / resources） */
type CreatePropKey = 'traces' | 'tasks' | 'events' | 'projects' | 'notes' | 'resources'

/**
 * 通用创建卡应用规格：逐行创建、失败行保留待重试、成功行移出卡片（防重复创建）。
 * 五个创建卡（踪迹 / 任务 / 日程 / 项目 / 笔记）共用同一个 applyCreate 实现。
 */
interface CreateSpec<T> {
  rows: T[]
  /** 保留（非空）判定 */
  keep: (row: T) => boolean
  create: (row: T) => Promise<{ id: string }>
  /** 全部成功后的状态补丁（如 { traceState: 'applied' }） */
  appliedPatch: Partial<ChatTurn>
  /** 部分失败时把剩余失败行写回轮次（如 (rows) => ({ traces: rows })） */
  rowsPatch: (rows: T[]) => Partial<ChatTurn>
  /** 回收站族键（撤销用） */
  kind: CreatePropKey
  /** 成功文案（按条数） */
  successText: (n: number) => string
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

/** 还原时清洗附件引用：stored / name / mime 均为字符串，≤6 条 */
function normalizeAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return []
  const out: ChatAttachment[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const v = item as Record<string, unknown>
    if (typeof v.stored !== 'string' || typeof v.name !== 'string' || typeof v.mime !== 'string') {
      continue
    }
    out.push({ stored: v.stored, name: v.name, mime: v.mime })
    if (out.length >= 6) break
  }
  return out
}

/** 清洗还原轮次的可选字段（Slice G.1）：searched 仅保留字符串、每条 ≤60、最多 2；noteId 仅非空字符串；
 *  本切片追加 focused（≤6 · 每条 ≤80）与 edits（≤3 · 逐条校验，有提案则恢复 editState，缺省待确认） */
function normalizeTurn(turn: ChatTurn): ChatTurn {
  const next: ChatTurn = { id: turn.id, role: turn.role, content: turn.content }
  const searched = cleanStringList(turn.searched, 2, 60)
  if (searched.length > 0) next.searched = searched
  if (typeof turn.noteId === 'string' && turn.noteId !== '') next.noteId = turn.noteId
  const attachments = normalizeAttachments(turn.attachments)
  if (attachments.length > 0) next.attachments = attachments
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
  const traces = normalizeTraces(turn.traces)
  if (traces.length > 0) {
    next.traces = traces
    next.traceState =
      turn.traceState === 'applied' || turn.traceState === 'dismissed'
        ? turn.traceState
        : 'pending'
  }
  const tasks = normalizeTasks(turn.tasks)
  if (tasks.length > 0) {
    next.tasks = tasks
    next.taskState =
      turn.taskState === 'applied' || turn.taskState === 'dismissed' ? turn.taskState : 'pending'
  }
  const events = normalizeEvents(turn.events)
  if (events.length > 0) {
    next.events = events
    next.eventState =
      turn.eventState === 'applied' || turn.eventState === 'dismissed' ? turn.eventState : 'pending'
  }
  const resources = normalizeResources(turn.resources)
  if (resources.length > 0) {
    next.resources = resources
    next.resourceState =
      turn.resourceState === 'applied' || turn.resourceState === 'dismissed'
        ? turn.resourceState
        : 'pending'
  }
  const focusedRefs = normalizeFocusedRefs(turn.focusedRefs)
  if (focusedRefs.length > 0) next.focusedRefs = focusedRefs
  const searchSources = normalizeSearchSources(turn.searchSources)
  if (searchSources.length > 0) next.searchSources = searchSources
  const createdRefs = normalizeCreatedRefs(turn.createdRefs)
  if (Object.keys(createdRefs).length > 0) next.createdRefs = createdRefs
  if (typeof turn.at === 'number' && Number.isFinite(turn.at)) next.at = turn.at
  if (typeof turn.reasoning === 'string' && turn.reasoning !== '') {
    next.reasoning = Array.from(turn.reasoning).slice(0, 8000).join('')
  }
  const ask = normalizeAsk(turn.ask)
  if (ask !== null) next.ask = ask
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
  reasoning: string
  label: string
}

const EMPTY_STREAM: ChatStreamState = { text: '', reasoning: '', label: '正在思考…' }

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

/** 在途流式请求的中止控制器（模块级）：停止按钮中止；切路由卸载不影响（请求本身跨挂载存活） */
let chatAbort: AbortController | null = null

/** 停止生成（模块级）：中止在途流式请求；已流出的文本由 requestChat 的中止分支保留为一条助手轮次 */
function stopChat(): void {
  const controller = chatAbort
  if (controller === null) return
  chatAbort = null
  controller.abort()
}

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
function buildReplyTurn(result: AiChatResult, reasoning = ''): ChatTurn {
  const reply: ChatTurn = { id: `c-${seq++}`, role: 'assistant', content: result.reply, at: Date.now() }
  if (reasoning !== '') reply.reasoning = reasoning
  if (result.ask !== undefined && result.ask !== null) reply.ask = result.ask
  if (result.searched !== undefined && result.searched.length > 0) reply.searched = result.searched
  if (result.focused !== undefined && result.focused.length > 0) reply.focused = result.focused
  if (result.focusedRefs !== undefined && result.focusedRefs.length > 0) {
    reply.focusedRefs = result.focusedRefs
  }
  if (result.searchSources !== undefined && result.searchSources.length > 0) {
    reply.searchSources = result.searchSources
  }
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
  if (result.resources !== undefined && result.resources.length > 0) {
    reply.resources = result.resources
    reply.resourceState = 'pending'
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
  const controller = new AbortController()
  chatAbort = controller
  void (async () => {
    // 流式增量缓冲：正文（text）与思考（reasoning）各自累积，约 80ms 合并一次，避免 token 级重渲染
    let buffered = ''
    let bufferedReasoning = ''
    let flushTimer: ReturnType<typeof setTimeout> | null = null
    const flush = (): void => {
      if (flushTimer !== null) {
        clearTimeout(flushTimer)
        flushTimer = null
      }
      if (chatToken !== token) return
      if (buffered === '' && bufferedReasoning === '') return
      const textChunk = buffered
      const reasonChunk = bufferedReasoning
      buffered = ''
      bufferedReasoning = ''
      const prev = chatStreamStore.get()
      chatStreamStore.set({
        ...prev,
        text: prev.text + textChunk,
        reasoning: prev.reasoning + reasonChunk,
      })
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
          } else if (event.kind === 'delta' && event.field === 'reasoning') {
            bufferedReasoning += event.delta
            scheduleFlush()
          }
        },
        controller.signal,
      )
      flush()
      if (chatToken !== token) return
      if (chatAbort === controller) chatAbort = null
      const reasoning = chatStreamStore.get().reasoning.trim()
      // 以 store 当前轮次为基准追加回复：保留 send 时对用户轮补写的附件引用
      patchChat({
        turns: [...chatStore.get().turns, buildReplyTurn(result, reasoning)],
        busy: false,
        error: '',
      })
      chatStreamStore.set({ ...EMPTY_STREAM })
    } catch (err) {
      if (flushTimer !== null) clearTimeout(flushTimer)
      if (chatAbort === controller) chatAbort = null
      if (chatToken !== token) return
      // 用户主动停止（AbortError）：把已流出文本保留为一条助手轮次（可继续追问），不报错
      if (err instanceof DOMException && err.name === 'AbortError') {
        flush()
        const partial = chatStreamStore.get().text.trim()
        const base = chatStore.get().turns
        patchChat({
          turns:
            partial !== ''
              ? [
                  ...base,
                  { id: `c-${seq++}`, role: 'assistant', content: `${partial}\n\n_（已停止生成）_` },
                ]
              : base,
          busy: false,
          error: '',
        })
        chatStreamStore.set({ ...EMPTY_STREAM })
        return
      }
      patchChat({ error: errorText(err), busy: false })
      chatStreamStore.set({ ...EMPTY_STREAM })
    }
  })()
}

/** 对话式整理意图（Slice G.1）：如「把这条整理进笔记」「存成笔记」→ 由 AI 整理上一条回答为独立笔记。
 *  P1-4 收紧：以问号结尾的疑问句（如「怎么保存进笔记？」）不再命中，避免劫持正常提问。 */
const NOTE_INTENT = /(整理|保存|存|归档)(进|到|为|成|入)[^。！？\n]{0,6}笔记[^？?\n]*$/

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
  /** 最新一轮 id（反问面板只对最新一轮开放作答；一旦出现新轮次即收起） */
  const lastTurnId = turns.length > 0 ? turns[turns.length - 1].id : ''
  const threadRef = useRef<HTMLDivElement>(null)
  /** 应用中的卡片键集合（`turnId:kind`）：按卡互斥、卡间互不阻塞（P1-3）；ref 同步判重、state 驱动渲染 */
  const applyingRef = useRef<Set<string>>(new Set())
  const [applyingKeys, setApplyingKeys] = useState<string[]>([])
  const beginApply = (key: string): boolean => {
    if (applyingRef.current.has(key)) return false
    applyingRef.current.add(key)
    setApplyingKeys([...applyingRef.current])
    return true
  }
  const endApply = (key: string): void => {
    applyingRef.current.delete(key)
    setApplyingKeys([...applyingRef.current])
  }
  const isApplying = (key: string): boolean => applyingKeys.includes(key)
  /** 待发送附件（File 对象，刻意组件级、不持久化——二进制句柄不可序列化，见 ADR-0022） */
  const [files, setFiles] = useState<File[]>([])
  /** 「存为笔记」进行中（P1-4 防连点） */
  const [savingNote, setSavingNote] = useState(false)
  /** 吸底滚动（P1-4）：用户上滑回看时不再强制拉到底；「回到底部」恢复 */
  const stickBottomRef = useRef(true)
  const [atBottom, setAtBottom] = useState(true)
  /** 拖拽悬停态（深度计数避免子元素 dragleave 抖动） */
  const [dragOver, setDragOver] = useState(false)
  const dragDepth = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // 新消息 / 思考中 / 流式增量：仅在「吸底」时滚到底部（用户上滑回看时不打扰，P1-4）
  useEffect(() => {
    const node = threadRef.current
    if (node !== null && stickBottomRef.current) node.scrollTop = node.scrollHeight
  }, [turns, busy, stream.text])

  /** 线程滚动（P1-4）：距底 < 48px 视为吸底 */
  const onThreadScroll = (): void => {
    const node = threadRef.current
    if (node === null) return
    const nearBottom = node.scrollHeight - node.scrollTop - node.clientHeight < 48
    stickBottomRef.current = nearBottom
    setAtBottom(nearBottom)
  }

  /** 回到底部（P1-4）：恢复吸底并立即滚底 */
  const scrollToBottom = (): void => {
    const node = threadRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
    stickBottomRef.current = true
    setAtBottom(true)
  }

  // 待发送附件队列（点击选择 / 拖拽落入 / 粘贴共用）；超过 25MB 在客户端即拦截并提示
  const addFiles = (incoming: File[]): void => {
    if (incoming.length === 0) return
    const ok: File[] = []
    let oversized = 0
    for (const file of incoming) {
      if (file.size > MAX_ATTACH_BYTES) oversized += 1
      else ok.push(file)
    }
    if (oversized > 0) toast(`已忽略 ${oversized} 个超过 25MB 的文件`, { tone: 'error' })
    if (ok.length === 0) return
    setFiles((prev) => [...prev, ...ok])
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

  // 每轮 AI 回复的「存为笔记」按钮：只整理、不追加对话轮（安静反馈）；防连点（P1-4）
  const saveTurnAsNote = (turn: ChatTurn): void => {
    if (savingNote) return
    setSavingNote(true)
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
      } finally {
        setSavingNote(false)
      }
    })()
  }

  // 复制回答正文（P2-1）：剪贴板 API；不可用 / 未授权时给可读提示
  const copyTurn = (turn: ChatTurn): void => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(turn.content)
        toast('已复制回答')
      } catch {
        toast('复制失败（浏览器未授权剪贴板）', { tone: 'error' })
      }
    })()
  }

  /** 「已应用」行的「查看」入口（P1-2）：单条 → 实体详情深链，多条 → 实体列表页 */
  const viewLinkFor = (turn: ChatTurn, kind: CreatePropKey): ReactNode => {
    const ids = turn.createdRefs?.[kind]
    if (ids === undefined || ids.length === 0) return null
    if (ids.length === 1) {
      const link = deepLinkOfId(ids[0])
      if (link === null) return null
      return (
        <>
          {' · '}
          <button type="button" className="k-chat__ref" onClick={() => navigate(link)}>
            查看
          </button>
        </>
      )
    }
    const listLink: Record<CreatePropKey, string> = {
      traces: '/traces',
      tasks: '/tasks',
      events: '/calendar',
      projects: '/projects',
      notes: '/library',
      resources: '/library',
    }
    return (
      <>
        {' · '}
        <button type="button" className="k-chat__ref" onClick={() => navigate(listLink[kind])}>
          查看全部
        </button>
      </>
    )
  }

  // 应用修改提案（本切片）：逐条经单写者更新；成功后标记「已应用」并提供撤销（逆序写回 before）。
  // 批量原子性：任一条失败时，回滚此前已写入的条目（逆序写回 before），不留半套修改。
  const applyEdits = (turn: ChatTurn): void => {
    const edits = turn.edits
    if (edits === undefined || edits.length === 0) return
    const key = `${turn.id}:edit`
    if (!beginApply(key)) return
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
        endApply(key)
      }
    })()
  }

  // 通用「创建卡」应用：逐行创建；成功行移出卡片、失败行保留待重试（避免重复创建）；
  // 成功即提供撤销（回收站）。五个创建卡（踪迹 / 任务 / 日程 / 项目 / 笔记）共用本实现。
  const undoCreated = (
    kind: CreatePropKey,
    ids: string[],
  ): { label: string; onClick: () => void } => ({
    label: '撤销',
    onClick: () => {
      void (async () => {
        for (const id of ids) await trashEntity(kind, id).catch(() => undefined)
      })()
    },
  })

  const applyCreate = <T,>(turn: ChatTurn, spec: CreateSpec<T>): void => {
    const rows = spec.rows.filter(spec.keep)
    if (rows.length === 0) return
    const key = `${turn.id}:${spec.kind}`
    if (!beginApply(key)) return
    void (async () => {
      const created: string[] = []
      const failed: T[] = []
      for (const row of rows) {
        try {
          created.push((await spec.create(row)).id)
        } catch {
          failed.push(row)
        }
      }
      // 已应用产物 id 累积（「已应用」行的「查看」深链用；部分失败也记录已成功项）
      const prevIds = turn.createdRefs?.[spec.kind] ?? []
      const createdRefs = { ...(turn.createdRefs ?? {}), [spec.kind]: [...prevIds, ...created] }
      if (failed.length === 0) {
        patchTurn(turn.id, { ...spec.appliedPatch, createdRefs })
        toast(spec.successText(created.length), { action: undoCreated(spec.kind, created) })
      } else {
        // 已成功行移出卡片（避免重试重复创建），仅保留失败行待重试
        patchTurn(turn.id, { ...spec.rowsPatch(failed), createdRefs })
        const done = created.length > 0 ? `${spec.successText(created.length)}；` : ''
        toast(`${done}${failed.length} 条未完成，可重试`, {
          tone: 'error',
          action: undoCreated(spec.kind, created),
        })
      }
      endApply(key)
    })()
  }

  // 应用「踪迹」提案（「踪迹」功能）：逐条经 /api/traces 落盘（支持 1–N 条拆分）。
  const applyTrace = (turn: ChatTurn): void =>
    applyCreate(turn, {
      rows: turn.traces ?? [],
      keep: (trace) => trace.title.trim() !== '',
      create: (trace) =>
        createTrace({
          title: trace.title.trim(),
          note: trace.note,
          at: trace.at,
          tags: trace.tags,
          projectId: trace.projectId,
        }),
      appliedPatch: { traceState: 'applied' },
      rowsPatch: (rows) => ({ traces: rows }),
      kind: 'traces',
      successText: (n) => (n > 1 ? `已记入 ${n} 条踪迹` : '已记入踪迹'),
    })

  // 应用「新建任务」提案：逐条经既有 /api/tasks 落盘（支持 1–N 条；ai:true → 新标签 origin:'ai'）。
  const applyTask = (turn: ChatTurn): void =>
    applyCreate(turn, {
      rows: turn.tasks ?? [],
      keep: (task) => task.title.trim() !== '',
      create: (task) =>
        createTask({
          title: task.title.trim(),
          dueAt: task.dueAt,
          importance: task.importance,
          tags: task.tags,
          projectId: task.projectId,
          parentTaskId: task.parentTaskId,
          ai: true,
        }),
      appliedPatch: { taskState: 'applied' },
      rowsPatch: (rows) => ({ tasks: rows }),
      kind: 'tasks',
      successText: (n) => (n > 1 ? `已建立 ${n} 条任务` : '已建立任务'),
    })

  // 应用「新建日程」提案：逐条经既有 /api/events 落盘（支持 1–N 条）。
  const applyEvent = (turn: ChatTurn): void =>
    applyCreate(turn, {
      rows: turn.events ?? [],
      keep: (event) => event.title.trim() !== '' && event.startAt.trim() !== '',
      create: (event) =>
        createEvent({
          title: event.title.trim(),
          startAt: event.startAt,
          endAt: event.endAt,
          allDay: event.allDay,
          location: event.location,
          tags: event.tags,
          projectId: event.projectId,
        }),
      appliedPatch: { eventState: 'applied' },
      rowsPatch: (rows) => ({ events: rows }),
      kind: 'events',
      successText: (n) => (n > 1 ? `已建立 ${n} 条日程` : '已建立日程'),
    })

  // 应用「新建项目」提案：逐条经既有 /api/projects 落盘（支持 1–N 条；ai:true → 新标签 origin:'ai'）。
  const applyProject = (turn: ChatTurn): void =>
    applyCreate(turn, {
      rows: turn.projects ?? [],
      keep: (project) => project.title.trim() !== '',
      create: (project) =>
        createProject({
          title: project.title.trim(),
          outcome: project.outcome,
          tags: project.tags,
          ai: true,
        }),
      appliedPatch: { projectState: 'applied' },
      rowsPatch: (rows) => ({ projects: rows }),
      kind: 'projects',
      successText: (n) => (n > 1 ? `已建立 ${n} 个项目` : '已建立项目'),
    })

  // 应用「新建笔记」提案：逐条经既有 /api/notes 落盘（支持 1–N 条）。
  const applyNote = (turn: ChatTurn): void =>
    applyCreate(turn, {
      rows: turn.notes ?? [],
      keep: (note) => note.title.trim() !== '',
      create: (note) => createNote({ title: note.title.trim(), body: note.body }),
      appliedPatch: { noteState: 'applied' },
      rowsPatch: (rows) => ({ notes: rows }),
      kind: 'notes',
      successText: (n) => (n > 1 ? `已存 ${n} 条笔记` : '已存为笔记'),
    })

  // 应用「新建资料」提案：逐条经既有 /api/resources 落盘（支持 1–N 条；P2-3）。
  const applyResource = (turn: ChatTurn): void =>
    applyCreate(turn, {
      rows: turn.resources ?? [],
      keep: (resource) => resource.title.trim() !== '',
      create: (resource) =>
        createResource({
          title: resource.title.trim(),
          url: resource.url,
          note: resource.note,
          tags: resource.tags,
        }),
      appliedPatch: { resourceState: 'applied' },
      rowsPatch: (rows) => ({ resources: rows }),
      kind: 'resources',
      successText: (n) => (n > 1 ? `已收录 ${n} 条资料` : '已收录资料'),
    })

  // 应用「操作既有实体」提案：按 op 分派（完成 / 重开 / 删除入回收站 / 归档）；
  // 成功后标记「已应用」并提供撤销（反向动作，逆序）；部分失败逆序回滚已执行项，不留半套。
  const applyAction = (turn: ChatTurn): void => {
    const rows = turn.actions ?? []
    if (rows.length === 0) return
    const key = `${turn.id}:action`
    if (!beginApply(key)) return
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
        endApply(key)
      }
    })()
  }

  // 统一提交（草稿发送 / 反问选项点击共用）：追加用户轮 → 命中整理意图则整理，否则（带附件先上传）发起对话
  const submit = (rawText: string, pending: File[]): void => {
    if (busy) return
    const text = rawText.trim()
    if (text === '' && pending.length === 0) return
    // 用户轮正文：纯附件时给出占位，避免空气泡
    const content = text !== '' ? text : '（见附件）'
    // 对话式整理：命中意图且有上一条 AI 回答 → 走整理流程而非普通问答
    const lastAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant')
    const userTurn: ChatTurn = { id: `c-${seq++}`, role: 'user', content, at: Date.now() }
    const history = [...turns, userTurn]
    patchChat({ turns: history, draft: '', busy: true, error: '' })
    if (NOTE_INTENT.test(text) && lastAssistant !== undefined) {
      setFiles([])
      runNote(text, lastAssistant.content, history)
      return
    }
    if (pending.length === 0) {
      requestChat(history)
      return
    }
    // 先受限并发上传附件（≤3），成功后才清空待发送队列（失败保留文件供重发）；随后携引用发起流式对话
    chatStreamStore.set({ text: '', reasoning: '', label: '正在上传附件…' })
    void (async () => {
      try {
        const refs = await mapLimit(pending, UPLOAD_CONCURRENCY, uploadChatAttachment)
        setFiles([])
        patchTurn(userTurn.id, { attachments: refs })
        requestChat(history, refs)
      } catch (err) {
        patchChat({ error: `附件上传失败：${errorText(err)}`, busy: false })
        chatStreamStore.set({ ...EMPTY_STREAM })
      }
    })()
  }

  const send = (): void => submit(draft, files)

  // 反问面板的选项点击：把该选项直接作为用户消息发回（不经过草稿）
  const sendOption = (option: string): void => submit(option, [])

  // 失败重试：保留已发出的用户消息，重新请求（不重复追加用户轮；复用其附件引用）
  const retry = (): void => {
    if (busy || turns.length === 0) return
    const lastUser = [...turns].reverse().find((turn) => turn.role === 'user')
    patchChat({ busy: true, error: '' })
    requestChat(turns, lastUser?.attachments)
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
        <div
          className="k-chat__thread"
          ref={threadRef}
          role="log"
          aria-live="polite"
          onScroll={onThreadScroll}
        >
          {turns.map((turn) => (
            <div
              key={turn.id}
              className={turn.role === 'user' ? 'k-chat__msg k-chat__msg--me' : 'k-chat__msg k-chat__msg--ai'}
            >
              <span className="k-chat__head">
                <span className="k-chat__who u-label">{turn.role === 'user' ? '我' : 'KERNEL'}</span>
                {turn.at !== undefined && (
                  <span className="k-chat__time u-label k-muted">{chatTime(turn.at)}</span>
                )}
              </span>
              {turn.role === 'assistant' ? (
                <>
                  <div className="k-chat__text k-chat__md">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown>
                  </div>
                  {turn.ask !== undefined && turn.id === lastTurnId && (
                    <div className="k-chat__ask">
                      {turn.ask.options.length > 0 && (
                        <div className="k-chat__ask-options">
                          {turn.ask.options.map((option) => (
                            <button
                              key={option}
                              type="button"
                              className="k-pill"
                              onClick={() => sendOption(option)}
                              disabled={busy}
                            >
                              {option}
                            </button>
                          ))}
                        </div>
                      )}
                      <span className="k-chat__ask-hint u-label k-muted">
                        可直接在下方输入答案，或点上方的选项
                      </span>
                    </div>
                  )}
                  {(turn.reasoning !== undefined ||
                    (turn.searched !== undefined && turn.searched.length > 0) ||
                    (turn.focused !== undefined && turn.focused.length > 0) ||
                    (turn.focusedRefs !== undefined && turn.focusedRefs.length > 0)) && (
                    <details className="k-chat__think">
                      <summary className="k-chat__think-summary u-label k-muted">思考过程</summary>
                      <div className="k-chat__think-body">
                        {turn.reasoning !== undefined && (
                          <p className="k-chat__think-reason">{turn.reasoning}</p>
                        )}
                        {turn.searched !== undefined && turn.searched.length > 0 && (
                          <span className="k-chat__searched u-label k-muted">
                            已联网检索 · {turn.searched.join(' · ')}
                            {turn.searchSources !== undefined && turn.searchSources.length > 0 && (
                              <>
                                {' · 来源：'}
                                {turn.searchSources.map((source, index) => (
                                  <span key={source.url}>
                                    {index > 0 && ' · '}
                                    <a href={source.url} target="_blank" rel="noreferrer">
                                      {source.title !== '' ? source.title : source.url}
                                    </a>
                                  </span>
                                ))}
                              </>
                            )}
                          </span>
                        )}
                        {turn.focusedRefs !== undefined && turn.focusedRefs.length > 0 ? (
                          <span className="k-chat__searched u-label k-muted">
                            已查阅 ·{' '}
                            {turn.focusedRefs.map((ref, index) => {
                              const link = deepLinkOfId(ref.id)
                              const label = ref.title !== '' ? ref.title : ref.id
                              return (
                                <span key={ref.id}>
                                  {index > 0 && ' · '}
                                  {link !== null ? (
                                    <button
                                      type="button"
                                      className="k-chat__ref"
                                      onClick={() => navigate(link)}
                                    >
                                      {label}
                                    </button>
                                  ) : (
                                    label
                                  )}
                                </span>
                              )
                            })}
                          </span>
                        ) : turn.focused !== undefined && turn.focused.length > 0 ? (
                          <span className="k-chat__searched u-label k-muted">
                            已查阅 · {turn.focused.join(' · ')}
                          </span>
                        ) : null}
                      </div>
                    </details>
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
                              disabled={isApplying(`${turn.id}:edit`)}
                            >
                              应用
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { editState: 'dismissed' })}
                              disabled={isApplying(`${turn.id}:edit`)}
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
                          {viewLinkFor(turn, 'traces')}
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">记入踪迹（可拆分）</span>
                          <div className="k-chat__rows">
                            {turn.traces.map((trace, index) => (
                              <div className="k-chat__row" key={index}>
                                <div className="k-chat__row-line">
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
                                {createRowFields(
                                  'trace',
                                  trace as unknown as Record<string, unknown>,
                                  (next) =>
                                    patchTurn(turn.id, {
                                      traces: (turn.traces ?? []).map((row, i) =>
                                        i === index
                                          ? ({ ...row, ...next } as ChatTraceProposal)
                                          : row,
                                      ),
                                    }),
                                  isApplying(`${turn.id}:traces`),
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyTrace(turn)}
                              disabled={
                                isApplying(`${turn.id}:traces`) ||
                                !turn.traces.some((trace) => trace.title.trim() !== '')
                              }
                            >
                              记录
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() =>
                                patchTurn(turn.id, { traces: [...(turn.traces ?? []), { title: '' }] })
                              }
                              disabled={isApplying(`${turn.id}:traces`) || turn.traces.length >= 6}
                            >
                              拆分
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { traceState: 'dismissed' })}
                              disabled={isApplying(`${turn.id}:traces`)}
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
                          {viewLinkFor(turn, 'events')}
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">建立日程（{turn.events.length} 条）</span>
                          <div className="k-chat__rows">
                            {turn.events.map((event, index) => (
                              <div className="k-chat__row" key={index}>
                                <div className="k-chat__row-line">
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
                                {createRowFields(
                                  'event',
                                  event as unknown as Record<string, unknown>,
                                  (next) =>
                                    patchTurn(turn.id, {
                                      events: (turn.events ?? []).map((row, i) =>
                                        i === index
                                          ? ({ ...row, ...next } as ChatEventProposal)
                                          : row,
                                      ),
                                    }),
                                  isApplying(`${turn.id}:events`),
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyEvent(turn)}
                              disabled={
                                isApplying(`${turn.id}:events`) ||
                                !turn.events.some((event) => event.title.trim() !== '')
                              }
                            >
                              建立
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { eventState: 'dismissed' })}
                              disabled={isApplying(`${turn.id}:events`)}
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
                          {viewLinkFor(turn, 'tasks')}
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">建立任务（可拆分）</span>
                          <div className="k-chat__rows">
                            {turn.tasks.map((task, index) => (
                              <div className="k-chat__row" key={index}>
                                <div className="k-chat__row-line">
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
                                {createRowFields(
                                  'task',
                                  task as unknown as Record<string, unknown>,
                                  (next) =>
                                    patchTurn(turn.id, {
                                      tasks: (turn.tasks ?? []).map((row, i) =>
                                        i === index
                                          ? ({ ...row, ...next } as ChatTaskProposal)
                                          : row,
                                      ),
                                    }),
                                  isApplying(`${turn.id}:tasks`),
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyTask(turn)}
                              disabled={
                                isApplying(`${turn.id}:tasks`) ||
                                !turn.tasks.some((task) => task.title.trim() !== '')
                              }
                            >
                              建立
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() =>
                                patchTurn(turn.id, { tasks: [...(turn.tasks ?? []), { title: '' }] })
                              }
                              disabled={isApplying(`${turn.id}:tasks`) || turn.tasks.length >= 6}
                            >
                              拆分
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { taskState: 'dismissed' })}
                              disabled={isApplying(`${turn.id}:tasks`)}
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
                          {viewLinkFor(turn, 'projects')}
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">建立项目（{turn.projects.length} 条）</span>
                          <div className="k-chat__rows">
                            {turn.projects.map((project, index) => (
                              <div className="k-chat__row" key={index}>
                                <div className="k-chat__row-line">
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
                                {createRowFields(
                                  'project',
                                  project as unknown as Record<string, unknown>,
                                  (next) =>
                                    patchTurn(turn.id, {
                                      projects: (turn.projects ?? []).map((row, i) =>
                                        i === index
                                          ? ({ ...row, ...next } as ChatProjectProposal)
                                          : row,
                                      ),
                                    }),
                                  isApplying(`${turn.id}:projects`),
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyProject(turn)}
                              disabled={
                                isApplying(`${turn.id}:projects`) ||
                                !turn.projects.some((project) => project.title.trim() !== '')
                              }
                            >
                              建立
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { projectState: 'dismissed' })}
                              disabled={isApplying(`${turn.id}:projects`)}
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
                          {viewLinkFor(turn, 'notes')}
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
                              disabled={
                                isApplying(`${turn.id}:notes`) ||
                                !turn.notes.some((note) => note.title.trim() !== '')
                              }
                            >
                              存为笔记
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { noteState: 'dismissed' })}
                              disabled={isApplying(`${turn.id}:notes`)}
                            >
                              忽略
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {turn.resources !== undefined && turn.resources.length > 0 && turn.resourceState !== 'dismissed' && (
                    <div className="k-chat__edit">
                      {turn.resourceState === 'applied' ? (
                        <span className="k-chat__searched u-label k-muted">
                          已收录 {turn.resources.filter((resource) => resource.title.trim() !== '').length} 条资料
                          {viewLinkFor(turn, 'resources')}
                        </span>
                      ) : (
                        <>
                          <span className="k-chat__edit-title">收录资料（{turn.resources.length} 条）</span>
                          <div className="k-chat__rows">
                            {turn.resources.map((resource, index) => (
                              <div className="k-chat__row" key={index}>
                                <div className="k-chat__row-line">
                                  <input
                                    className="k-input"
                                    value={resource.title}
                                    placeholder="资料标题…"
                                    aria-label={`资料 ${index + 1} 标题`}
                                    onChange={(event) =>
                                      patchTurn(turn.id, {
                                        resources: (turn.resources ?? []).map((row, i) =>
                                          i === index ? { ...row, title: event.target.value } : row,
                                        ),
                                      })
                                    }
                                  />
                                  {(turn.resources?.length ?? 0) > 1 && (
                                    <button
                                      type="button"
                                      className="k-chat__row-del"
                                      aria-label={`删除第 ${index + 1} 条`}
                                      onClick={() =>
                                        patchTurn(turn.id, {
                                          resources: (turn.resources ?? []).filter((_, i) => i !== index),
                                        })
                                      }
                                    >
                                      删除
                                    </button>
                                  )}
                                </div>
                                {createRowFields(
                                  'resource',
                                  resource as unknown as Record<string, unknown>,
                                  (next) =>
                                    patchTurn(turn.id, {
                                      resources: (turn.resources ?? []).map((row, i) =>
                                        i === index
                                          ? ({ ...row, ...next } as ChatResourceProposal)
                                          : row,
                                      ),
                                    }),
                                  isApplying(`${turn.id}:resources`),
                                )}
                              </div>
                            ))}
                          </div>
                          <div className="k-chat__edit-actions">
                            <button
                              type="button"
                              className="k-btn k-btn--sm is-solid"
                              onClick={() => applyResource(turn)}
                              disabled={
                                isApplying(`${turn.id}:resources`) ||
                                !turn.resources.some((resource) => resource.title.trim() !== '')
                              }
                            >
                              收录
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { resourceState: 'dismissed' })}
                              disabled={isApplying(`${turn.id}:resources`)}
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
                              disabled={isApplying(`${turn.id}:action`) || turn.actions.length === 0}
                            >
                              应用
                            </button>
                            <button
                              type="button"
                              className="k-btn k-btn--sm"
                              onClick={() => patchTurn(turn.id, { actionState: 'dismissed' })}
                              disabled={isApplying(`${turn.id}:action`)}
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
                    disabled={savingNote}
                  >
                    存为笔记
                  </button>
                  <button type="button" className="k-chat__save" onClick={() => copyTurn(turn)}>
                    复制
                  </button>
                </>
              ) : (
                <>
                  <p className="k-chat__text">{turn.content}</p>
                  {turn.attachments !== undefined && turn.attachments.length > 0 && (
                    <span className="k-chat__searched u-label k-muted">
                      附件 · {turn.attachments.map((file) => file.name).join(' · ')}
                    </span>
                  )}
                </>
              )}
            </div>
          ))}
          {busy && (
            <div className="k-chat__msg k-chat__msg--ai">
              <span className="k-chat__who u-label">KERNEL</span>
              {stream.reasoning.trim() !== '' && (
                <details className="k-chat__think">
                  <summary className="k-chat__think-summary u-label k-muted">
                    思考过程（生成中…）
                  </summary>
                  <div className="k-chat__think-body">
                    <p className="k-chat__think-reason">{stream.reasoning}</p>
                  </div>
                </details>
              )}
              {stream.text.trim() !== '' ? (
                <div className="k-chat__text k-chat__md">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{stream.text}</ReactMarkdown>
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

      {turns.length === 0 && (
        <div className="k-chat__suggest" aria-label="示例问题">
          {[
            '我今天有什么特别紧急需要去做的事情？',
            '今天有什么课？',
            '我今天做了什么？',
            '帮我记一条任务：…',
          ].map((example) => (
            <button
              key={example}
              type="button"
              className="k-pill is-ghost"
              onClick={() => patchChat({ draft: example })}
            >
              {example}
            </button>
          ))}
        </div>
      )}

      {turns.length > 20 && (
        <p className="k-chat__note u-label k-muted">
          上下文上限：仅最近 20 条消息会发送给 AI（更早的仍保留显示，但模型看不到）。
        </p>
      )}

      {turns.length > 0 && !atBottom && (
        <div className="k-chat__tobottomrow">
          <button type="button" className="k-pill is-ghost" onClick={scrollToBottom}>
            ↓ 回到底部
          </button>
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
          accept="image/*,.pdf,.txt,.md,.csv,.json,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
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
            // 中文输入法组合期：Enter 用于确认候选词，不触发发送（与 Traces 同守卫）
            if (event.nativeEvent.isComposing) return
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
            {busy ? (
              <button
                type="button"
                className="ic-send"
                onClick={stopChat}
                title="停止生成"
                aria-label="停止生成"
              >
                <Square size={14} strokeWidth={2} aria-hidden />
              </button>
            ) : (
              <button
                type="button"
                className="ic-send"
                onClick={send}
                disabled={draft.trim() === '' && files.length === 0}
                aria-label="发送"
              >
                <ArrowUp size={16} strokeWidth={2} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
