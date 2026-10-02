// KERNEL · 总览 AI 对话盒（v0.5 · Slice G）
// 位置：状态条之下、工作台之上；视觉与收件箱捕捉编辑器（.ic-composer）一致。
// 能力：读库多轮对话（经数据服务 → 本地 opencode）；「清空」先归档为笔记（time-named）再清空。
// 纪律：纯文本渲染（无 dangerouslySetInnerHTML）；会话级持久（模块级 store，跨路由存活，刷新丢失）。
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ArrowUp } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '@/context/ToastContext'
import { errorText } from '@/lib/api'
import { chatWithAi, createNote, type AiChatMessage } from '@/lib/mutations'

interface ChatTurn extends AiChatMessage {
  id: string
}

/* 会话级 store：模块级数组 + 订阅；切换路由后重新挂载仍读回同一段对话 */
let moduleTurns: ChatTurn[] = []
const turnListeners = new Set<() => void>()
let turnSeq = 0

function subscribeTurns(listener: () => void): () => void {
  turnListeners.add(listener)
  return () => {
    turnListeners.delete(listener)
  }
}

function getTurns(): ChatTurn[] {
  return moduleTurns
}

function setTurns(next: ChatTurn[]): void {
  moduleTurns = next
  for (const listener of turnListeners) listener()
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
  const turns = useSyncExternalStore(subscribeTurns, getTurns, getTurns)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const threadRef = useRef<HTMLDivElement>(null)
  const reqRef = useRef(0)

  // 新消息 / 思考中：线程滚到底部
  useEffect(() => {
    const node = threadRef.current
    if (node !== null) node.scrollTop = node.scrollHeight
  }, [turns, busy])

  const request = (history: ChatTurn[]): void => {
    const req = (reqRef.current += 1)
    void (async () => {
      try {
        const result = await chatWithAi(history.map(({ role, content }) => ({ role, content })))
        if (reqRef.current !== req) return
        setTurns([...history, { id: `c-${turnSeq++}`, role: 'assistant', content: result.reply }])
      } catch (err) {
        if (reqRef.current !== req) return
        setError(errorText(err))
      } finally {
        if (reqRef.current === req) setBusy(false)
      }
    })()
  }

  const send = (): void => {
    const text = draft.trim()
    if (text === '' || busy) return
    const history = [...turns, { id: `c-${turnSeq++}`, role: 'user' as const, content: text }]
    setTurns(history)
    setDraft('')
    setError('')
    setBusy(true)
    request(history)
  }

  // 失败重试：保留已发出的用户消息，重新请求（不重复追加用户轮）
  const retry = (): void => {
    if (busy || turns.length === 0) return
    setError('')
    setBusy(true)
    request(turns)
  }

  // 清空：非空对话先归档为笔记；归档失败则不清空（对话保留）
  const clear = (): void => {
    if (turns.length === 0 || busy) return
    const now = new Date()
    const title = `AI 对话归档 · ${stamp(now)}`
    const body = buildTranscript(title, turns)
    void (async () => {
      try {
        const note = await createNote({ title, body, type: 'memo' })
        reqRef.current += 1
        setTurns([])
        setError('')
        setBusy(false)
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
          onChange={(event) => setDraft(event.target.value)}
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
