// KERNEL · 总览 AI 对话盒（v0.5 · Slice G；Slice Z 状态保留）
// 位置：状态条之下、工作台之上；视觉与收件箱捕捉编辑器（.ic-composer）一致。
// 能力：读库多轮对话（经数据服务 → 本地 opencode）；「清空」先归档为笔记（time-named）再清空。
// 纪律：纯文本渲染（无 dangerouslySetInnerHTML）。
// Slice Z（见 ADR-0022）状态保留：
//   · draft / busy / error 全部提升到模块级 store（切路由中途打字 / 思考不再丢）；
//   · 对话（turns）+ 草稿经 localStorage 持久化（安全解析、上限最近 60 轮、静默失败）→ 刷新还原；
//   · 「清空」仍先归档为笔记，归档成功即清空内存 + 持久化副本（刷新后保持已清空）。
import { useEffect, useRef } from 'react'
import { ArrowUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@/context/ToastContext'
import { errorText } from '@/lib/api'
import { createUiStore, useUiStore } from '@/lib/uiState'
import { chatWithAi, createNote, type AiChatMessage } from '@/lib/mutations'

interface ChatTurn extends AiChatMessage {
  id: string
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

/** 安全解析持久化对话；非法 / 缺字段丢弃（busy / error 刻意不还原：刷新后无在途请求） */
function parseChat(raw: unknown): ChatState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  const turns = Array.isArray(v.turns) ? v.turns.filter(isTurn).slice(-CHAT_MAX_TURNS) : []
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
      patchChat({
        turns: [...history, { id: `c-${seq++}`, role: 'assistant', content: result.reply }],
        busy: false,
        error: '',
      })
    } catch (err) {
      if (chatToken !== token) return
      patchChat({ error: errorText(err), busy: false })
    }
  })()
}

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

  // 新消息 / 思考中：线程滚到底部
  useEffect(() => {
    const node = threadRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [turns, busy])

  const send = (): void => {
    const text = draft.trim()
    if (text === '' || busy) return
    const history = [...turns, { id: `c-${seq++}`, role: 'user' as const, content: text }]
    patchChat({ turns: history, draft: '', busy: true, error: '' })
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
              <p className="k-chat__text">{turn.content}</p>
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
              读库回答 · Enter 发送 · Shift+Enter 换行
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
