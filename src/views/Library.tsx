// KERNEL · 资料 LIBRARY（P1）：笔记 + 资料混合流 / 类型与标签筛选 / Markdown 阅读抽屉
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { clsx } from 'clsx'
import { Panel } from '@/components/Panel'
import { Modal } from '@/components/Modal'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { TagPill } from '@/components/TagPill'
import { EmptyState } from '@/components/EmptyState'
import { Relations } from '@/components/Relations'
import { useToast } from '@/context/ToastContext'
import {
  getAreaById,
  getAreas,
  getBacklinks,
  getNotes,
  getResources,
  getSnapshot,
  getTags,
  getTagUsage,
} from '@/lib/data'
import { openPath, restoreEntity, revealPath, trashEntity, updateEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import {
  DISTILL_LEVEL_DEF,
  DISTILL_LEVEL_LABEL,
  DISTILL_LEVELS,
  NOTE_TYPE_EN,
  NOTE_TYPE_LABEL,
  RESOURCE_KIND_EN,
  RESOURCE_KIND_LABEL,
  RESOURCE_STATUS_DEF,
  RESOURCE_STATUS_LABEL,
  tagLabel,
} from '@/lib/format'
import { formatRelative } from '@/lib/date'
import { useDataRevision, useNow } from '@/lib/hooks'
import type { NoteType, ResourceKind, ResourceStatus, TrashKind } from '@/types'

type Tab = 'all' | 'notes' | 'resources'

const NOTE_TYPES: NoteType[] = ['fleeting', 'literature', 'permanent', 'meeting', 'memo']
const RESOURCE_KINDS: ResourceKind[] = ['article', 'course', 'book', 'tool', 'paper', 'file']
const RESOURCE_STATUSES: ResourceStatus[] = ['unread', 'reading', 'read', 'reference', 'archived']

interface DrawerTarget {
  kind: 'note' | 'resource'
  id: string
}

export function Library() {
  const now = useNow()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<Tab>('all')
  const [noteType, setNoteType] = useState<NoteType | ''>('')
  const [resourceKind, setResourceKind] = useState<ResourceKind | ''>('')
  const [resourceStatus, setResourceStatus] = useState<ResourceStatus | ''>('')
  const [tag, setTag] = useState('')
  const [target, setTarget] = useState<DrawerTarget | null>(null)
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  // 切换抽屉目标时退出编辑态
  useEffect(() => {
    setEditing(false)
  }, [target])

  const notes = getNotes()
  const resources = getResources()

  // 深链直达阅读抽屉：/library?note=n-0001 或 /library?resource=r-0001
  useEffect(() => {
    const noteId = searchParams.get('note')
    if (noteId !== null && notes.some((note) => note.id === noteId)) {
      setTarget({ kind: 'note', id: noteId })
      return
    }
    const resourceId = searchParams.get('resource')
    if (resourceId !== null && resources.some((resource) => resource.id === resourceId)) {
      setTarget({ kind: 'resource', id: resourceId })
    }
  }, [searchParams, notes, resources])

  const closeDrawer = (): void => {
    setTarget(null)
    if (searchParams.get('note') !== null || searchParams.get('resource') !== null) {
      setSearchParams({}, { replace: true })
    }
  }

  // Slice T：标签条不再截断前 12 个；按使用计数降序渲染全部主题标签（bar 已自然换行）。
  // 依赖数据版本 revision，使新登记 / 改名 / 合并后即时刷新。
  const revision = useDataRevision()
  const topicTags = useMemo(() => {
    const usage = new Map(getTagUsage().map((item) => [item.tag, item.count]))
    return getTags()
      .filter((item) => item.namespace === 'topic')
      .slice()
      .sort(
        (a, b) =>
          (usage.get(b.name) ?? 0) - (usage.get(a.name) ?? 0) ||
          a.label.localeCompare(b.label),
      )
  }, [revision])

  const filteredNotes = notes.filter(
    (note) =>
      (noteType === '' || note.type === noteType) &&
      (tag === '' || note.tags.includes(tag)),
  )
  const filteredResources = resources.filter(
    (resource) =>
      (resourceKind === '' || resource.kind === resourceKind) &&
      (resourceStatus === '' || resource.status === resourceStatus) &&
      (tag === '' || resource.tags.includes(tag)),
  )

  const showNotes = tab !== 'resources'
  const showResources = tab !== 'notes'

  const selectedNote = target?.kind === 'note' ? notes.find((n) => n.id === target.id) : undefined
  const selectedResource =
    target?.kind === 'resource' ? resources.find((r) => r.id === target.id) : undefined

  const noteFields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text' },
    {
      key: 'type',
      label: '类型',
      type: 'select',
      options: NOTE_TYPES.map((type) => ({ value: type, label: NOTE_TYPE_LABEL[type] })),
    },
    {
      key: 'areaId',
      label: '区域',
      type: 'select',
      clearable: true,
      options: getAreas().map((area) => ({ value: area.id, label: area.title })),
    },
    {
      key: 'projectId',
      label: '项目',
      type: 'select',
      clearable: true,
      options: getSnapshot().projects.map((project) => ({
        value: project.id,
        label: project.title,
      })),
    },
    { key: 'body', label: '正文', type: 'textarea' },
    { key: 'tags', label: '标签（逗号分隔）', type: 'list' },
  ]

  const resourceFields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text' },
    {
      key: 'kind',
      label: '类型',
      type: 'select',
      options: RESOURCE_KINDS.map((kind) => ({ value: kind, label: RESOURCE_KIND_LABEL[kind] })),
    },
    {
      key: 'status',
      label: '状态',
      type: 'select',
      options: RESOURCE_STATUSES.map((status) => ({
        value: status,
        label: RESOURCE_STATUS_LABEL[status],
      })),
    },
    {
      key: 'areaId',
      label: '区域',
      type: 'select',
      clearable: true,
      options: getAreas().map((area) => ({ value: area.id, label: area.title })),
    },
    { key: 'url', label: '链接', type: 'text', clearable: true },
    { key: 'path', label: '文件位置', type: 'text', clearable: true, placeholder: '如 G:\\…\\file.pdf' },
    { key: 'tags', label: '标签（逗号分隔）', type: 'list' },
    { key: 'note', label: '备注', type: 'textarea' },
  ]

  const handleSave = (patch: Record<string, unknown>): void => {
    if (target === null) return
    const kind: TrashKind = target.kind === 'note' ? 'notes' : 'resources'
    const id = target.id
    setSaving(true)
    void (async () => {
      try {
        await updateEntity(kind, id, patch)
        setEditing(false)
        toast('已保存')
      } catch (err) {
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setSaving(false)
      }
    })()
  }

  const handleDelete = (): void => {
    if (target === null) return
    const kind: TrashKind = target.kind === 'note' ? 'notes' : 'resources'
    const id = target.id
    void (async () => {
      try {
        await trashEntity(kind, id)
        closeDrawer()
        toast('已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity(kind, id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`删除失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  const handleReveal = (): void => {
    const path = selectedResource?.path
    if (path === undefined) return
    void (async () => {
      try {
        await revealPath(path)
      } catch (err) {
        toast(`打开失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 以默认程序打开资源文件（Slice J2 · 与收件箱附件动作同姿态；仅本机）
  const handleOpenResource = (): void => {
    const path = selectedResource?.path
    if (path === undefined) return
    void (async () => {
      try {
        await openPath(path)
      } catch (err) {
        toast(`打开失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 资料状态快捷设置（Slice H）：静默写入 → toast + 撤销回原状态
  const handleSetResourceStatus = (status: ResourceStatus): void => {
    if (selectedResource === undefined || selectedResource.status === status) return
    const id = selectedResource.id
    const prev = selectedResource.status
    void (async () => {
      try {
        await updateEntity('resources', id, { status })
        toast(`状态已设为「${RESOURCE_STATUS_LABEL[status]}」`, {
          action: {
            label: '撤销',
            onClick: () => {
              void updateEntity('resources', id, { status: prev }).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`设置失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 笔记蒸馏层级快捷设置（Slice H）：静默写入 → toast + 撤销回原层级
  const handleSetDistillLevel = (level: number): void => {
    if (selectedNote === undefined || selectedNote.distillLevel === level) return
    const id = selectedNote.id
    const prev = selectedNote.distillLevel
    void (async () => {
      try {
        await updateEntity('notes', id, { distillLevel: level })
        toast(`蒸馏层级已设为 L${level}`, {
          action: {
            label: '撤销',
            onClick: () => {
              void updateEntity('notes', id, { distillLevel: prev }).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`设置失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  return (
    <div className="k-view">
      <div className="k-tabs k-lib__tabs">
        {(
          [
            ['all', '全部 ALL'],
            ['notes', '笔记 NOTES'],
            ['resources', '资料 RESOURCES'],
          ] as const
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            className={tab === value ? 'k-tab is-active' : 'k-tab'}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
        <span className="u-label k-muted k-lib__tabs-count">
          笔记 {notes.length} · 资料 {resources.length}
        </span>
      </div>

      <div className="k-lib__filters">
        {showNotes && (
          <div className="k-lib__fgroup" role="group" aria-label="笔记类型">
            <span className="k-lib__flabel u-label">笔记类型</span>
            <div className="k-lib__seg">
              <TagPill selected={noteType === ''} onClick={() => setNoteType('')}>
                全部
              </TagPill>
              {NOTE_TYPES.map((type) => (
                <TagPill
                  key={type}
                  selected={noteType === type}
                  onClick={() => setNoteType(noteType === type ? '' : type)}
                >
                  {NOTE_TYPE_LABEL[type]}
                </TagPill>
              ))}
            </div>
          </div>
        )}
        {showResources && (
          <>
            <div className="k-lib__fgroup" role="group" aria-label="资料类型">
              <span className="k-lib__flabel u-label">资料类型</span>
              <div className="k-lib__seg">
                <TagPill selected={resourceKind === ''} onClick={() => setResourceKind('')}>
                  全部
                </TagPill>
                {RESOURCE_KINDS.map((kind) => (
                  <TagPill
                    key={kind}
                    selected={resourceKind === kind}
                    onClick={() => setResourceKind(resourceKind === kind ? '' : kind)}
                  >
                    {RESOURCE_KIND_LABEL[kind]}
                  </TagPill>
                ))}
              </div>
            </div>
            <div className="k-lib__fgroup" role="group" aria-label="状态">
              <span className="k-lib__flabel u-label">状态</span>
              <div className="k-lib__seg">
                <TagPill selected={resourceStatus === ''} onClick={() => setResourceStatus('')}>
                  全部
                </TagPill>
                {RESOURCE_STATUSES.map((status) => (
                  <TagPill
                    key={status}
                    selected={resourceStatus === status}
                    onClick={() => setResourceStatus(resourceStatus === status ? '' : status)}
                  >
                    {RESOURCE_STATUS_LABEL[status]}
                  </TagPill>
                ))}
              </div>
            </div>
          </>
        )}
        <div className="k-lib__fgroup" role="group" aria-label="标签">
          <span className="k-lib__flabel u-label">标签</span>
          <div className="k-lib__seg">
            <TagPill selected={tag === ''} onClick={() => setTag('')}>
              全部
            </TagPill>
            {topicTags.map((item) => (
              <TagPill
                key={item.id}
                selected={tag === item.name}
                onClick={() => setTag(tag === item.name ? '' : item.name)}
              >
                {item.label}
              </TagPill>
            ))}
          </div>
        </div>
      </div>

      {showNotes && (
        <Panel index="01" title="笔记" en="NOTES" actions={<span className="u-label k-muted">{filteredNotes.length}</span>}>
          {filteredNotes.length === 0 ? (
            <EmptyState index="01" title="没有匹配的笔记" hint="调整类型或标签筛选。" />
          ) : (
            filteredNotes.map((note) => (
              <button
                type="button"
                className="k-lib-row"
                key={note.id}
                onClick={() => setTarget({ kind: 'note', id: note.id })}
              >
                <span className="k-lib-row__kind u-label">
                  {NOTE_TYPE_LABEL[note.type]}
                  <span className="k-muted"> {NOTE_TYPE_EN[note.type]}</span>
                </span>
                <span className="k-lib-row__title">{note.title}</span>
                <span className="k-lib-row__meta">
                  <span className="k-distill" aria-label={`蒸馏层级 ${note.distillLevel}`}>
                    <span className="k-distill__label u-label">D</span>
                    {[0, 1, 2, 3].map((level) => (
                      <span
                        key={level}
                        className={clsx('k-distill__cell', level < note.distillLevel && 'is-on')}
                      />
                    ))}
                  </span>
                  <span className="k-mono k-lib__time">{formatRelative(note.updatedAt, now)}</span>
                </span>
              </button>
            ))
          )}
        </Panel>
      )}

      {showResources && (
        <Panel index="02" title="资料" en="RESOURCES" actions={<span className="u-label k-muted">{filteredResources.length}</span>}>
          {filteredResources.length === 0 ? (
            <EmptyState index="02" title="没有匹配的资料" hint="调整类型、状态或标签筛选。" />
          ) : (
            filteredResources.map((resource) => {
              const area = resource.areaId !== undefined ? getAreaById(resource.areaId) : undefined
              return (
                <button
                  type="button"
                  className="k-lib-row"
                  key={resource.id}
                  onClick={() => setTarget({ kind: 'resource', id: resource.id })}
                >
                  <span className="k-lib-row__kind u-label">
                    {RESOURCE_KIND_LABEL[resource.kind]}
                    <span className="k-muted"> {RESOURCE_KIND_EN[resource.kind]}</span>
                  </span>
                  <span className="k-lib-row__title">{resource.title}</span>
                  <span className="k-lib-row__meta">
                    <span>{RESOURCE_STATUS_LABEL[resource.status]}</span>
                    {area !== undefined && <span className="k-mono">{area.title}</span>}
                    <span className="k-mono k-lib__time">
                      {formatRelative(resource.addedAt, now)}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </Panel>
      )}

      <Modal
        open={selectedNote !== undefined || selectedResource !== undefined}
        onClose={closeDrawer}
        kicker={
          selectedNote !== undefined
            ? `笔记 · ${selectedNote.id}`
            : selectedResource !== undefined
              ? `资料 · ${selectedResource.id}`
              : ''
        }
        title={selectedNote?.title ?? selectedResource?.title ?? ''}
        className="k-modal--detail"
        footer={
          (selectedNote !== undefined || selectedResource !== undefined) && !editing ? (
            <div className="k-modal__foot-actions">
              <button type="button" className="k-btn k-btn--sm" onClick={() => setEditing(true)}>
                编辑
              </button>
              <button type="button" className="k-btn k-btn--sm is-danger" onClick={handleDelete}>
                删除
              </button>
            </div>
          ) : undefined
        }
      >
        {selectedNote !== undefined &&
          (editing ? (
            <EntityEditForm
              fields={noteFields}
              initial={selectedNote as unknown as Record<string, unknown>}
              saving={saving}
              onSubmit={handleSave}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <div className="k-detail-grid">
            <dl className="k-dl">
              <dt>类型</dt>
              <dd>
                {NOTE_TYPE_LABEL[selectedNote.type]} · {NOTE_TYPE_EN[selectedNote.type]}
              </dd>
              <dt>蒸馏</dt>
              <dd>L{selectedNote.distillLevel} / 3</dd>
              <dt>更新</dt>
              <dd>{formatRelative(selectedNote.updatedAt, now)}</dd>
            </dl>
            <QuickSegmented
              label="蒸馏层级 · 判断标准"
              value={selectedNote.distillLevel}
              options={DISTILL_LEVELS.map((level) => ({
                value: level,
                label: `L${level} ${DISTILL_LEVEL_LABEL[level]}`,
                def: DISTILL_LEVEL_DEF[level],
              }))}
              helper={DISTILL_LEVEL_DEF[selectedNote.distillLevel]}
              onSelect={handleSetDistillLevel}
            />
            {selectedNote.tags.length > 0 && (
              <div className="k-hstack">
                {selectedNote.tags.map((item) => (
                  <TagPill key={item}>{tagLabel(item)}</TagPill>
                ))}
              </div>
            )}
            <div className="k-markdown">
              <ReactMarkdown>{selectedNote.body}</ReactMarkdown>
            </div>
            <div className="k-detail-block">
              <span className="k-detail-block__label u-label">反向链接 · BACKLINKS</span>
              {getBacklinks(selectedNote.id).length === 0 ? (
                <p className="k-muted">暂无其他笔记指向本篇。</p>
              ) : (
                <div className="k-backlink">
                  {getBacklinks(selectedNote.id).map((note) => (
                    <button
                      type="button"
                      className="k-lib-row"
                      key={note.id}
                      onClick={() => setTarget({ kind: 'note', id: note.id })}
                    >
                      <span className="k-lib-row__title">{note.title}</span>
                      <span className="k-lib-row__meta k-mono">{note.id}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Relations kind="note" id={selectedNote.id} />
          </div>
          ))}
        {selectedResource !== undefined &&
          (editing ? (
            <EntityEditForm
              fields={resourceFields}
              initial={selectedResource as unknown as Record<string, unknown>}
              saving={saving}
              onSubmit={handleSave}
              onCancel={() => setEditing(false)}
            />
          ) : (
          <div className="k-detail-grid">
            <dl className="k-dl">
              <dt>类型</dt>
              <dd>
                {RESOURCE_KIND_LABEL[selectedResource.kind]} ·{' '}
                {RESOURCE_KIND_EN[selectedResource.kind]}
              </dd>
              <dt>状态</dt>
              <dd>{RESOURCE_STATUS_LABEL[selectedResource.status]}</dd>
              <dt>链接</dt>
              <dd className="k-dl__wide">
                {selectedResource.url !== undefined ? (
                  <a
                    href={selectedResource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="k-markdown"
                  >
                    {selectedResource.url}
                  </a>
                ) : (
                  '—'
                )}
              </dd>
              <dt>添加</dt>
              <dd>{formatRelative(selectedResource.addedAt, now)}</dd>
            </dl>
            <QuickSegmented
              label="状态 · 判断标准"
              value={selectedResource.status}
              options={RESOURCE_STATUSES.map((status) => ({
                value: status,
                label: RESOURCE_STATUS_LABEL[status],
                def: RESOURCE_STATUS_DEF[status],
              }))}
              helper={RESOURCE_STATUS_DEF[selectedResource.status]}
              onSelect={handleSetResourceStatus}
            />
            <div className="k-detail-block">
              <span className="k-detail-block__label u-label">文件位置</span>
              {selectedResource.path !== undefined ? (
                <>
                  <span className="k-file-path u-mono" title={selectedResource.path}>
                    {selectedResource.path}
                  </span>
                  <div className="k-hstack">
                    <button type="button" className="k-btn k-btn--sm" onClick={handleOpenResource}>
                      打开文件
                    </button>
                    <button type="button" className="k-btn k-btn--sm" onClick={handleReveal}>
                      在文件管理器中显示
                    </button>
                  </div>
                </>
              ) : (
                <p className="k-muted k-file-path__hint">未记录文件位置 · 可通过编辑补充</p>
              )}
            </div>
            {selectedResource.tags.length > 0 && (
              <div className="k-hstack">
                {selectedResource.tags.map((item) => (
                  <TagPill key={item}>{tagLabel(item)}</TagPill>
                ))}
              </div>
            )}
            {selectedResource.note !== undefined && (
              <div className="k-detail-block">
                <span className="k-detail-block__label u-label">备注</span>
                <p className="k-detail-note">{selectedResource.note}</p>
              </div>
            )}
            <Relations kind="resource" id={selectedResource.id} />
          </div>
          ))}
      </Modal>
    </div>
  )
}

/* ---------------------------------------------------------------------------
 * 快捷设置（Slice H）：安静的 segmented 选择器 + 判断标准 helper 文本。
 * 复用 `.k-lib__seg` 轨道 + `TagPill` 选中反转，与资料筛选条视觉一致。
 * ------------------------------------------------------------------------- */

interface QuickOption<T extends string | number> {
  value: T
  label: string
  /** 该选项的判断标准（按钮 title + 当前项 helper） */
  def: string
}

function QuickSegmented<T extends string | number>({
  label,
  value,
  options,
  helper,
  onSelect,
}: {
  label: string
  value: T
  options: QuickOption<T>[]
  helper: string
  onSelect: (value: T) => void
}) {
  return (
    <div className="k-detail-block k-quickset">
      <span className="k-detail-block__label u-label">{label}</span>
      <div className="k-lib__seg k-quickset__seg" role="group" aria-label={label}>
        {options.map((option) => (
          <TagPill
            key={String(option.value)}
            selected={option.value === value}
            title={option.def}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </TagPill>
        ))}
      </div>
      <p className="k-quickset__hint k-muted">{helper}</p>
    </div>
  )
}
