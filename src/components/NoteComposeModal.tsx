// KERNEL · 新建笔记「撰写」弹窗（v0.5 · Slice M，见 ADR-0020）
// 沉浸式撰写面：醒目标题输入 + 高行数正文（Markdown，阅读友好行高）。
// 纪律：点「创建笔记」才经 POST /api/notes 落盘；ESC / 取消零写入；
//   成功后由调用方 toast（可撤销）并打开新笔记（?note=<id> 深链）。
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/Modal'
import { createNote } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import type { Note } from '@/types'

interface NoteComposeModalProps {
  open: boolean
  onClose: () => void
  onCreated: (note: Note) => void
}

export function NoteComposeModal({ open, onClose, onCreated }: NoteComposeModalProps) {
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  // 提交中禁用重复提交（state 异步，用 ref 兜住同一事件循环内的连点 / 回车）
  const submittingRef = useRef(false)
  submittingRef.current = submitting

  useEffect(() => {
    if (!open) return
    setTitle('')
    setBody('')
    setSubmitting(false)
    setError('')
    // Modal 在挂载 ~80ms 后把焦点送入关闭按钮；此处延后一档，让焦点落在标题输入
    const timer = window.setTimeout(() => titleRef.current?.focus(), 140)
    return () => window.clearTimeout(timer)
  }, [open])

  const canCreate = title.trim() !== '' && !submitting

  const submit = (): void => {
    const value = title.trim()
    if (value === '' || submittingRef.current) return
    setSubmitting(true)
    setError('')
    void (async () => {
      try {
        const note = await createNote({ title: value, body })
        onCreated(note)
      } catch (err) {
        setError(`创建失败：${errorText(err)}`)
        setSubmitting(false)
      }
    })()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="撰写"
      title="新建笔记"
      className="k-modal--note"
      footer={
        <>
          <button type="button" className="k-btn is-solid" disabled={!canCreate} onClick={submit}>
            {submitting ? '创建中…' : '创建笔记'}
          </button>
          <button type="button" className="k-btn" disabled={submitting} onClick={onClose}>
            取消
          </button>
        </>
      }
    >
      <form
        className="k-note-compose"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <label className="k-note-compose__label u-label" htmlFor="k-note-compose-title">
          标题
        </label>
        <input
          id="k-note-compose-title"
          ref={titleRef}
          className="k-note-compose__title"
          value={title}
          placeholder="一句话标题"
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <label className="k-note-compose__label u-label" htmlFor="k-note-compose-body">
          正文 · Markdown
        </label>
        <textarea
          id="k-note-compose-body"
          className="k-textarea k-note-compose__body"
          value={body}
          placeholder={'# 标题\n\n- 要点\n- 要点\n\n> 引用 / `代码` 均可'}
          onChange={(event) => setBody(event.target.value)}
        />
      </form>
      <p className="k-note-compose__hint k-muted">
        正文以 Markdown 存储；创建后可在详情页直接「AI 蒸馏」生成下一层草稿。
      </p>
      {error !== '' && (
        <p className="k-ai-form__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
