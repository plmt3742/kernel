// KERNEL · 任务快速新建「草稿确认」弹窗（v0.5 · Slice O）
// 流程：回车 → 本弹窗（居中）→ 打开即请求 AI 补全 → 全部字段可编辑 → 用户点「创建任务」才写入。
// 纪律（owner 强制）：确认前绝不落盘；AI 失败 / 离线时表单仍可用，创建不被阻断；
//   AI 补全绝不覆盖用户已改动的字段，也绝不改写标题。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { AiSuggestionForm } from '@/components/AiSuggestionForm'
import { aiTaskDraft, createTask } from '@/lib/mutations'
import {
  EMPTY_AI_FORM,
  draftToForm,
  formToTaskCreate,
  type AiSuggestionFormValues,
} from '@/lib/aiForm'
import { errorText } from '@/lib/api'
import type { Task } from '@/types'

type AiState = 'loading' | 'ready' | 'error'

/** AI 可补全的字段（刻意不含 title：标题永远由用户掌控，AI 绝不改写） */
const AI_FIELD_KEYS = [
  'contexts',
  'energy',
  'importance',
  'estimateMin',
  'dueAt',
  'projectId',
  'areaId',
  'tags',
] as const

interface TaskDraftModalProps {
  open: boolean
  initialTitle: string
  onClose: () => void
  onCreated: (task: Task) => void
}

export function TaskDraftModal({
  open,
  initialTitle,
  onClose,
  onCreated,
}: TaskDraftModalProps): ReactNode {
  const [fields, setFields] = useState<AiSuggestionFormValues>({
    ...EMPTY_AI_FORM,
    title: initialTitle,
  })
  const [aiState, setAiState] = useState<AiState>('loading')
  const [aiNote, setAiNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  // 记录用户已手动改动的字段：AI 返回时跳过它们，避免覆盖用户编辑
  const touchedRef = useRef<Set<keyof AiSuggestionFormValues>>(new Set())
  // 请求令牌：关闭 / 重开 / 重新补全时忽略过期响应
  const runRef = useRef(0)

  const runAi = (rawTitle: string): void => {
    const value = rawTitle.trim()
    if (value === '') {
      setAiState('error')
      setAiNote('请先填写标题')
      return
    }
    const token = runRef.current + 1
    runRef.current = token
    setAiState('loading')
    setAiNote('')
    void (async () => {
      try {
        const result = await aiTaskDraft(value)
        if (runRef.current !== token) return
        const next = draftToForm(value, result.suggestion)
        setFields((prev) => {
          const out = { ...prev }
          for (const key of AI_FIELD_KEYS) {
            if (!touchedRef.current.has(key)) out[key] = next[key]
          }
          return out
        })
        setAiState('ready')
      } catch (err) {
        if (runRef.current !== token) return
        setAiState('error')
        setAiNote(errorText(err))
      }
    })()
  }

  // 打开时重置为「标题 + 空字段」并请求一次补全；关闭（open=false）不写任何数据
  useEffect(() => {
    if (!open) return
    setFields({ ...EMPTY_AI_FORM, title: initialTitle })
    setAiState('loading')
    setAiNote('')
    setSubmitError('')
    setSubmitting(false)
    touchedRef.current = new Set()
    runAi(initialTitle)
    // runAi 为组件内稳定逻辑，仅随 open / initialTitle 触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTitle])

  const patchFields = (patch: Partial<AiSuggestionFormValues>): void => {
    setFields((prev) => ({ ...prev, ...patch }))
    for (const key of Object.keys(patch) as Array<keyof AiSuggestionFormValues>) {
      touchedRef.current.add(key)
    }
  }

  const canCreate = fields.title.trim() !== '' && !submitting

  const submit = (): void => {
    const value = fields.title.trim()
    if (value === '' || submitting) return
    setSubmitting(true)
    setSubmitError('')
    void (async () => {
      try {
        // ai:true —— 本次创建经 AI 草稿确认；新标签登记 origin:'ai'（Slice T）
        const task = await createTask({ ...formToTaskCreate({ ...fields, title: value }), ai: true })
        onCreated(task)
      } catch (err) {
        setSubmitError(`创建失败：${errorText(err)}`)
        setSubmitting(false)
      }
    })()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="快速新建 · 先确认后写入"
      title="确认并创建任务"
      className="k-modal--compose"
      footer={
        <>
          <button type="button" className="k-btn is-solid" disabled={!canCreate} onClick={submit}>
            {submitting ? '创建中…' : '创建任务'}
          </button>
          <button type="button" className="k-btn" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="k-btn k-ai-form__refill"
            disabled={submitting || aiState === 'loading' || fields.title.trim() === ''}
            onClick={() => runAi(fields.title)}
          >
            重新补全
          </button>
        </>
      }
    >
      <p className="k-ai-form__status" role="status" aria-live="polite">
        <Sparkles size={14} strokeWidth={1.5} className="k-muted" aria-hidden />
        {aiState === 'loading' && <span className="k-muted">AI 正在补全…（可先填写，AI 不会覆盖你已改动的字段）</span>}
        {aiState === 'ready' && <span className="k-muted">AI 补全就绪 · 请确认或修改后创建</span>}
        {aiState === 'error' && (
          <span className="k-muted">
            AI 暂不可用{aiNote !== '' ? `（${aiNote}）` : ''} · 仍可直接创建
          </span>
        )}
      </p>
      <AiSuggestionForm
        values={fields}
        onChange={patchFields}
        autoFocusTitle
        disabled={submitting}
      />
      {submitError !== '' && (
        <p className="k-ai-form__error" role="alert">
          {submitError}
        </p>
      )}
    </Modal>
  )
}
