// KERNEL · 项目快速新建「草稿确认」弹窗（v0.5 · Slice R1）
// 流程：回车 → 本弹窗（居中）→ 打开即请求 AI 补全 → 完成定义 / 区域 / 标签可编辑 → 点「创建项目」才写入。
// 纪律（owner 强制）：确认前绝不落盘；AI 失败 / 离线时表单仍可用，创建不被阻断；
//   AI 补全绝不覆盖用户已改动的字段，也绝不改写标题。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { aiProjectDraft, createProject } from '@/lib/mutations'
import { splitList } from '@/lib/aiForm'
import { getAreas } from '@/lib/data'
import { errorText } from '@/lib/api'
import type { Project } from '@/types'

type AiState = 'loading' | 'ready' | 'error'
type TouchedField = 'outcome' | 'areaId' | 'tags'

interface ProjectDraftModalProps {
  open: boolean
  initialTitle: string
  onClose: () => void
  onCreated: (project: Project) => void
}

export function ProjectDraftModal({
  open,
  initialTitle,
  onClose,
  onCreated,
}: ProjectDraftModalProps): ReactNode {
  const [title, setTitle] = useState(initialTitle)
  const [outcome, setOutcome] = useState('')
  const [areaId, setAreaId] = useState('')
  const [tags, setTags] = useState('')
  const [aiState, setAiState] = useState<AiState>('loading')
  const [aiNote, setAiNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const touchedRef = useRef<Set<TouchedField>>(new Set())
  const runRef = useRef(0)
  const areas = getAreas()

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
        const result = await aiProjectDraft(value)
        if (runRef.current !== token) return
        const sug = result.suggestion
        if (!touchedRef.current.has('outcome') && sug.outcome !== undefined) setOutcome(sug.outcome)
        if (!touchedRef.current.has('areaId') && sug.areaId !== undefined) setAreaId(sug.areaId)
        if (!touchedRef.current.has('tags') && sug.tags.length > 0) setTags(sug.tags.join(', '))
        setAiState('ready')
      } catch (err) {
        if (runRef.current !== token) return
        setAiState('error')
        setAiNote(errorText(err))
      }
    })()
  }

  // 打开时重置并请求一次补全；关闭（open=false）不写任何数据
  useEffect(() => {
    if (!open) return
    setTitle(initialTitle)
    setOutcome('')
    setAreaId('')
    setTags('')
    setAiState('loading')
    setAiNote('')
    setSubmitError('')
    setSubmitting(false)
    touchedRef.current = new Set()
    runAi(initialTitle)
    // runAi 为组件内稳定逻辑，仅随 open / initialTitle 触发
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialTitle])

  const canCreate = title.trim() !== '' && !submitting

  const submit = (): void => {
    const value = title.trim()
    if (value === '' || submitting) return
    setSubmitting(true)
    setSubmitError('')
    void (async () => {
      try {
        const project = await createProject({
          title: value,
          ...(outcome.trim() !== '' ? { outcome: outcome.trim() } : {}),
          ...(areaId !== '' ? { areaId } : {}),
          ...(splitList(tags).length > 0 ? { tags: splitList(tags) } : {}),
          ai: true,
        })
        onCreated(project)
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
      title="确认并创建项目"
      className="k-modal--compose"
      footer={
        <>
          <button type="button" className="k-btn is-solid" disabled={!canCreate} onClick={submit}>
            {submitting ? '创建中…' : '创建项目'}
          </button>
          <button type="button" className="k-btn" disabled={submitting} onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className="k-btn k-ai-form__refill"
            disabled={submitting || aiState === 'loading' || title.trim() === ''}
            onClick={() => runAi(title)}
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
      <div className="k-ai-form k-project-form">
        <div className="k-field k-ai-form__full">
          <label className="k-field__label u-label" htmlFor="k-project-title">
            标题
          </label>
          <input
            id="k-project-title"
            className="k-input"
            type="text"
            value={title}
            autoFocus
            disabled={submitting}
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="k-field k-ai-form__full">
          <label className="k-field__label u-label" htmlFor="k-project-outcome">
            完成定义
          </label>
          <input
            id="k-project-outcome"
            className="k-input"
            type="text"
            value={outcome}
            placeholder="怎样算完成（如：决赛名单与分工落定）"
            disabled={submitting}
            onChange={(event) => {
              touchedRef.current.add('outcome')
              setOutcome(event.target.value)
            }}
          />
        </div>
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor="k-project-area">
            区域
          </label>
          <select
            id="k-project-area"
            className="k-select"
            value={areaId}
            disabled={submitting}
            onChange={(event) => {
              touchedRef.current.add('areaId')
              setAreaId(event.target.value)
            }}
          >
            <option value="">—</option>
            {areas.map((area) => (
              <option key={area.id} value={area.id}>
                {area.title}
              </option>
            ))}
          </select>
        </div>
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor="k-project-tags">
            标签（逗号分隔）
          </label>
          <input
            id="k-project-tags"
            className="k-input"
            type="text"
            value={tags}
            disabled={submitting}
            onChange={(event) => {
              touchedRef.current.add('tags')
              setTags(event.target.value)
            }}
          />
        </div>
      </div>
      {submitError !== '' && (
        <p className="k-ai-form__error" role="alert">
          {submitError}
        </p>
      )}
    </Modal>
  )
}
