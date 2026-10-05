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
import { useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { ArrowUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@/context/ToastContext'
import { errorText } from '@/lib/api'
import { createUiStore, useUiStore } from '@/lib/uiState'
import { formatDateTime } from '@/lib/date'
import {
  chatNoteFromChat,
  chatWithAi,
  createNote,
  updateEntity,
  type AiChatMessage,
  type ChatEditProposal,
} from '@/lib/mutations'

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
function requestChat(history: ChatTurn[]): void {
  const token = (chatToken += 1)
  void (async () => {
    try {
      const result = await chatWithAi(history.map(({ role, content }) => ({ role, content })))
      if (chatToken !== token) return
      const reply: ChatTurn = { id: `c-${seq++}`, role: 'assistant', content: result.reply }
      if (result.searched !== undefined && result.searched.length > 0) reply.searched = result.searched
      if (result.focused !== undefined && result.focused.length > 0) reply.focused = result.focused
      if (result.edits !== undefined && result.edits.length > 0) {
        reply.edits = result.edits
        reply.editState = 'pending'
      }
      patchChat({ turns: [...history, reply], busy: false, error: '' })
    } catch (err) {
      if (chatToken !== token) return
      patchChat({ error: errorText(err), busy: false })
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
  const { turns, draft, busy, error } = chat
  const threadRef = useRef<HTMLDivElement>(null)
  /** 修改提案应用中的互斥锁（防重复提交） */
  const [applying, setApplying] = useState(false)

  // 新消息 / 思考中：线程滚到底部
  useEffect(() => {
    const node = threadRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [turns, busy])

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

  const send = (): void => {
    const text = draft.trim()
    if (text === '' || busy) return
    // 对话式整理：命中意图且有上一条 AI 回答 → 走整理流程而非普通问答
    const lastAssistant = [...turns].reverse().find((turn) => turn.role === 'assistant')
    const history = [...turns, { id: `c-${seq++}`, role: 'user' as const, content: text }]
    patchChat({ turns: history, draft: '', busy: true, error: '' })
    if (NOTE_INTENT.test(text) && lastAssistant !== undefined) {
      runNote(text, lastAssistant.content, history)
      return
    }
    requestChat(history)
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
              <p className="k-chat__text k-chat__text--thinking">思考中…</p>
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

      <div className="ic-composer k-chat__composer">
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
            <span className="ic-composer__hint u-label k-muted">
              读库 · 联网 · 自由回答 · Enter 发送 · Shift+Enter 换行
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
              disabled={draft.trim() === '' || busy}
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
