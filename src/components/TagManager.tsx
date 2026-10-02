// KERNEL · 标签管理面板（v0.5 · Slice T，见 ADR-0014）
// 设置页「标签管理」区：列出注册表全部标签（label / name / 命名空间 / 来源 / 使用计数 / 登记时间），
// 支持 重命名（级联）/ 合并（级联）/ 删除（使用中阻止）/ 扫描登记未注册标签。
// 纪律：quiet token-only 视觉，与设置其它区一致；破坏性操作均带确认；管理成功即整体水合刷新。
import { useMemo, useState, type ReactNode } from 'react'
import { Panel } from '@/components/Panel'
import { Modal } from '@/components/Modal'
import { useToast } from '@/context/ToastContext'
import { useDataRevision } from '@/lib/hooks'
import { getSnapshot, getTagUsage } from '@/lib/data'
import { backfillTags, mergeTag, removeTag, renameTag } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { TAG_ORIGIN_LABEL, tagOriginOf } from '@/lib/format'
import type { TagItem } from '@/types'

const NAMESPACE_LABEL: Record<TagItem['namespace'], string> = {
  role: '身份',
  context: '情境',
  topic: '主题',
}

export function TagManager(): ReactNode {
  useDataRevision()
  const { toast } = useToast()
  const [query, setQuery] = useState('')
  const [renaming, setRenaming] = useState<TagItem | null>(null)
  const [merging, setMerging] = useState<TagItem | null>(null)
  const [deleting, setDeleting] = useState<TagItem | null>(null)
  const [backfilling, setBackfilling] = useState(false)

  const tags = getSnapshot().tags
  const usage = useMemo(() => {
    const map = new Map<string, number>()
    for (const item of getTagUsage()) map.set(item.tag, item.count)
    return map
  }, [tags])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return tags
      .filter(
        (tag) =>
          q === '' || tag.name.toLowerCase().includes(q) || tag.label.toLowerCase().includes(q),
      )
      .slice()
      .sort((a, b) => {
        const diff = (usage.get(b.name) ?? 0) - (usage.get(a.name) ?? 0)
        if (diff !== 0) return diff
        if (a.namespace !== b.namespace) return a.namespace.localeCompare(b.namespace)
        return a.label.localeCompare(b.label)
      })
  }, [tags, query, usage])

  const handleBackfill = (): void => {
    if (backfilling) return
    setBackfilling(true)
    void (async () => {
      try {
        const result = await backfillTags()
        toast(
          result.created.length === 0
            ? '没有发现未注册标签'
            : `已登记 ${result.created.length} 个未注册标签`,
        )
      } catch (err) {
        toast(`扫描失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setBackfilling(false)
      }
    })()
  }

  return (
    <Panel
      title="标签管理"
      en="TAGS"
      actions={
        <div className="k-tagmgr__actions">
          <span className="u-label k-muted">共 {tags.length}</span>
          <button
            type="button"
            className="k-btn k-btn--sm"
            onClick={handleBackfill}
            disabled={backfilling}
          >
            {backfilling ? '扫描中…' : '扫描并登记现有未注册标签'}
          </button>
        </div>
      }
    >
      <p className="k-view__intro">
        录入任务 / 项目 / 笔记 / 资料时写入的新标签会自动登记到注册表（<code>data/meta/tags.json</code>），
        AI 建议的新标签在应用后登记；此处可统一重命名 / 合并 / 删除。重命名与合并会级联重写所有实体上的标签。
      </p>

      <div className="k-tagmgr__search">
        <label className="k-field__label u-label" htmlFor="k-tag-search">
          搜索
        </label>
        <input
          id="k-tag-search"
          className="k-input"
          type="search"
          value={query}
          placeholder="按名称 / 中文标签筛选"
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>

      {rows.length === 0 ? (
        <p className="k-settings__empty">没有匹配的标签</p>
      ) : (
        <div className="k-tagmgr__list" role="list">
          {rows.map((tag) => (
            <div className="k-tagmgr__row" role="listitem" key={tag.id}>
              <div className="k-tagmgr__main">
                <span className="k-tagmgr__label">{tag.label}</span>
                <span className="k-mono k-muted k-tagmgr__name">{tag.name}</span>
              </div>
              <div className="k-tagmgr__meta">
                <span className="k-pill">{NAMESPACE_LABEL[tag.namespace]}</span>
                <span className={`k-pill k-tagmgr__origin is-${tagOriginOf(tag.origin)}`}>
                  {TAG_ORIGIN_LABEL[tagOriginOf(tag.origin)]}
                </span>
                <span className="k-mono k-muted" title="使用该标签的记录数">
                  用 {usage.get(tag.name) ?? 0}
                </span>
                <span className="k-mono k-muted" title="登记时间">
                  {tag.createdAt !== undefined ? tag.createdAt.slice(0, 10) : '—'}
                </span>
              </div>
              <div className="k-tagmgr__ops">
                <button type="button" className="k-btn k-btn--sm" onClick={() => setRenaming(tag)}>
                  重命名
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  onClick={() => setMerging(tag)}
                  disabled={tags.length < 2}
                >
                  合并
                </button>
                <button
                  type="button"
                  className="k-btn k-btn--sm is-danger"
                  onClick={() => setDeleting(tag)}
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {renaming !== null && <RenameDialog tag={renaming} onClose={() => setRenaming(null)} />}
      {merging !== null && (
        <MergeDialog tag={merging} tags={tags} onClose={() => setMerging(null)} />
      )}
      {deleting !== null && (
        <DeleteDialog
          tag={deleting}
          usageCount={usage.get(deleting.name) ?? 0}
          onClose={() => setDeleting(null)}
        />
      )}
    </Panel>
  )
}

/** 重命名对话框：改 name（+ 可选 label）；确认后级联重写全部实体 */
function RenameDialog({ tag, onClose }: { tag: TagItem; onClose: () => void }): ReactNode {
  const { toast } = useToast()
  const [name, setName] = useState(tag.name)
  const [label, setLabel] = useState(tag.label)
  const [busy, setBusy] = useState(false)

  const submit = (): void => {
    const nextName = name.trim()
    if (nextName === '' || busy) return
    setBusy(true)
    void (async () => {
      try {
        const result = await renameTag(tag.id, nextName, label.trim())
        toast(`已重命名 · 影响 ${result.affected} 条记录`)
        onClose()
      } catch (err) {
        toast(`重命名失败：${errorText(err)}`, { tone: 'error' })
        setBusy(false)
      }
    })()
  }

  return (
    <Modal
      open
      onClose={onClose}
      kicker={`标签 · ${tag.id}`}
      title="重命名标签"
      className="k-modal--detail"
      footer={
        <div className="k-modal__foot-actions">
          <button type="button" className="k-btn is-solid" disabled={busy} onClick={submit}>
            {busy ? '保存中…' : '确认重命名'}
          </button>
          <button type="button" className="k-btn" disabled={busy} onClick={onClose}>
            取消
          </button>
        </div>
      }
    >
      <div className="k-field">
        <label className="k-field__label u-label" htmlFor="k-tag-rename-name">
          标签名（规格化：裸名将加 topic: 前缀）
        </label>
        <input
          id="k-tag-rename-name"
          className="k-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </div>
      <div className="k-field">
        <label className="k-field__label u-label" htmlFor="k-tag-rename-label">
          中文标签（留空则自动取后缀）
        </label>
        <input
          id="k-tag-rename-label"
          className="k-input"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
        />
      </div>
      <p className="k-view__intro k-muted">
        所有实体上名为 <code>{tag.name}</code> 的标签将一并改为新名（不改变实体更新时间）。
      </p>
    </Modal>
  )
}

/** 合并对话框：把 source 名替换为所选 target 名（级联），source 从注册表移除 */
function MergeDialog({
  tag,
  tags,
  onClose,
}: {
  tag: TagItem
  tags: TagItem[]
  onClose: () => void
}): ReactNode {
  const { toast } = useToast()
  const candidates = tags.filter((item) => item.id !== tag.id)
  const [targetId, setTargetId] = useState(candidates[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const submit = (): void => {
    if (targetId === '' || busy) return
    setBusy(true)
    void (async () => {
      try {
        const result = await mergeTag(tag.id, targetId)
        toast(`已合并到「${result.tag.label}」· 影响 ${result.affected} 条记录`)
        onClose()
      } catch (err) {
        toast(`合并失败：${errorText(err)}`, { tone: 'error' })
        setBusy(false)
      }
    })()
  }

  return (
    <Modal
      open
      onClose={onClose}
      kicker={`标签 · ${tag.id}`}
      title="合并标签"
      className="k-modal--detail"
      footer={
        <div className="k-modal__foot-actions">
          <button
            type="button"
            className="k-btn is-solid"
            disabled={busy || targetId === ''}
            onClick={submit}
          >
            {busy ? '合并中…' : '确认合并'}
          </button>
          <button type="button" className="k-btn" disabled={busy} onClick={onClose}>
            取消
          </button>
        </div>
      }
    >
      <div className="k-field">
        <label className="k-field__label u-label" htmlFor="k-tag-merge-target">
          合并到目标标签
        </label>
        <select
          id="k-tag-merge-target"
          className="k-select"
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
        >
          {candidates.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}（{item.name}）
            </option>
          ))}
        </select>
      </div>
      <p className="k-view__intro k-muted">
        所有使用「{tag.label}」（<code>{tag.name}</code>）的记录将改用目标标签；
        源标签随后从注册表移除。
      </p>
    </Modal>
  )
}

/** 删除对话框：使用中（usage &gt; 0）阻止删除并给出计数；未使用才可确认移除 */
function DeleteDialog({
  tag,
  usageCount,
  onClose,
}: {
  tag: TagItem
  usageCount: number
  onClose: () => void
}): ReactNode {
  const { toast } = useToast()
  const [busy, setBusy] = useState(false)
  const blocked = usageCount > 0

  const submit = (): void => {
    if (blocked || busy) return
    setBusy(true)
    void (async () => {
      try {
        await removeTag(tag.id)
        toast('已删除标签')
        onClose()
      } catch (err) {
        toast(`删除失败：${errorText(err)}`, { tone: 'error' })
        setBusy(false)
      }
    })()
  }

  return (
    <Modal
      open
      onClose={onClose}
      kicker={`标签 · ${tag.id}`}
      title="删除标签"
      className="k-modal--detail"
      footer={
        <div className="k-modal__foot-actions">
          <button
            type="button"
            className="k-btn is-solid is-danger"
            disabled={blocked || busy}
            onClick={submit}
          >
            {busy ? '删除中…' : '确认删除'}
          </button>
          <button type="button" className="k-btn" disabled={busy} onClick={onClose}>
            取消
          </button>
        </div>
      }
    >
      {blocked ? (
        <p className="k-view__intro" role="alert">
          该标签正被 <b>{usageCount}</b> 条记录使用，不能删除。请先<strong>合并</strong>到其他标签，
          或到相应实体上移除该标签后再试。
        </p>
      ) : (
        <p className="k-view__intro k-muted">
          「{tag.label}」（<code>{tag.name}</code>）当前没有任何记录使用，可安全删除其注册项。
        </p>
      )}
    </Modal>
  )
}
