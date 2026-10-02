// KERNEL · 新建资料「草稿」弹窗（v0.5 · Slice Y，见 ADR-0021）
// 镜像 Slice M 的「新建笔记」撰写流：标题 + 类型 + 链接 + 简介 + 标签；
// 点「创建资料」才经 POST /api/resources 落盘；ESC / 取消零写入。
// 成功后由调用方 toast（撤销 = 移入回收站）并打开新资料（?resource=<id> 深链）。
import { useEffect, useRef, useState } from 'react'
import { Modal } from '@/components/Modal'
import { getTags } from '@/lib/data'
import { splitList } from '@/lib/aiForm'
import { RESOURCE_KIND_LABEL } from '@/lib/format'
import { createResource, type ResourceCreateInput } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import type { Resource, ResourceKind } from '@/types'

/** 可手工新建的类型（不含 file：文件类资料经收件箱投递产生，避免无附件空壳） */
const KIND_OPTIONS: ResourceKind[] = ['article', 'course', 'book', 'tool', 'paper']

interface ResourceDraftModalProps {
  open: boolean
  onClose: () => void
  onCreated: (resource: Resource) => void
}

export function ResourceDraftModal({ open, onClose, onCreated }: ResourceDraftModalProps) {
  const [title, setTitle] = useState('')
  const [kind, setKind] = useState<ResourceKind>('article')
  const [url, setUrl] = useState('')
  const [note, setNote] = useState('')
  const [tags, setTags] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const titleRef = useRef<HTMLInputElement>(null)
  // 提交中禁用重复提交（state 异步，用 ref 兜住同一事件循环内的连点 / 回车）
  const submittingRef = useRef(false)
  submittingRef.current = submitting
  const tagNames = getTags().map((tag) => tag.name)

  useEffect(() => {
    if (!open) return
    setTitle('')
    setKind('article')
    setUrl('')
    setNote('')
    setTags('')
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
        const input: ResourceCreateInput = { title: value, kind }
        const trimmedUrl = url.trim()
        if (trimmedUrl !== '') input.url = trimmedUrl
        const trimmedNote = note.trim()
        if (trimmedNote !== '') input.note = trimmedNote
        const tagList = splitList(tags)
        if (tagList.length > 0) input.tags = tagList
        const resource = await createResource(input)
        onCreated(resource)
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
      kicker="新建 · 资料"
      title="新建资料"
      className="k-modal--detail"
      footer={
        <>
          <button type="button" className="k-btn is-solid" disabled={!canCreate} onClick={submit}>
            {submitting ? '创建中…' : '创建资料'}
          </button>
          <button type="button" className="k-btn" disabled={submitting} onClick={onClose}>
            取消
          </button>
        </>
      }
    >
      <form
        className="k-form"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor="k-resource-title">
            标题
          </label>
          <input
            id="k-resource-title"
            ref={titleRef}
            className="k-input"
            value={title}
            placeholder="资料名（文章 / 课程 / 书 / 工具 / 论文）"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor="k-resource-kind">
            类型
          </label>
          <select
            id="k-resource-kind"
            className="k-select"
            value={kind}
            onChange={(event) => setKind(event.target.value as ResourceKind)}
          >
            {KIND_OPTIONS.map((value) => (
              <option key={value} value={value}>
                {RESOURCE_KIND_LABEL[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor="k-resource-url">
            链接
          </label>
          <input
            id="k-resource-url"
            className="k-input"
            type="url"
            value={url}
            placeholder="https://…（可选）"
            onChange={(event) => setUrl(event.target.value)}
          />
        </div>
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor="k-resource-note">
            简介
          </label>
          <textarea
            id="k-resource-note"
            className="k-textarea"
            rows={3}
            value={note}
            placeholder="1–3 句小结：这是什么、讲了什么、有什么用（可选）"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor="k-resource-tags">
            标签（逗号分隔）
          </label>
          <input
            id="k-resource-tags"
            className="k-input"
            value={tags}
            list="k-resource-tags-list"
            placeholder="topic:…, role:…"
            onChange={(event) => setTags(event.target.value)}
          />
          <datalist id="k-resource-tags-list">
            {tagNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        </div>
      </form>
      <p className="k-note-compose__hint k-muted">
        资料进入资料库后可在详情页设置状态（未读 / 在读 / 读完…）与区域归属。
      </p>
      {error !== '' && (
        <p className="k-ai-form__error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}
