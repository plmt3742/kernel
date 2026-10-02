// KERNEL · 资料 LIBRARY（P1）：笔记 + 资料混合流 / 类型与标签筛选 / Markdown 阅读抽屉
import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { clsx } from 'clsx'
import { Panel } from '@/components/Panel'
import { Drawer } from '@/components/Drawer'
import { TagPill } from '@/components/TagPill'
import { EmptyState } from '@/components/EmptyState'
import { getAreaById, getBacklinks, getNotes, getResources, getTags } from '@/lib/data'
import {
  NOTE_TYPE_EN,
  NOTE_TYPE_LABEL,
  RESOURCE_KIND_EN,
  RESOURCE_KIND_LABEL,
  RESOURCE_STATUS_LABEL,
  tagLabel,
} from '@/lib/format'
import { formatRelative } from '@/lib/date'
import { useNow } from '@/lib/hooks'
import type { NoteType, ResourceKind, ResourceStatus } from '@/types'

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
  const [tab, setTab] = useState<Tab>('all')
  const [noteType, setNoteType] = useState<NoteType | ''>('')
  const [resourceKind, setResourceKind] = useState<ResourceKind | ''>('')
  const [resourceStatus, setResourceStatus] = useState<ResourceStatus | ''>('')
  const [tag, setTag] = useState('')
  const [target, setTarget] = useState<DrawerTarget | null>(null)

  const notes = getNotes()
  const resources = getResources()

  const topicTags = useMemo(
    () => getTags().filter((item) => item.namespace === 'topic').slice(0, 12),
    [],
  )

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

      <Drawer
        open={selectedNote !== undefined || selectedResource !== undefined}
        onClose={() => setTarget(null)}
        kicker={
          selectedNote !== undefined
            ? `笔记 · ${selectedNote.id}`
            : selectedResource !== undefined
              ? `资料 · ${selectedResource.id}`
              : ''
        }
        title={selectedNote?.title ?? selectedResource?.title ?? ''}
      >
        {selectedNote !== undefined && (
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
          </div>
        )}
        {selectedResource !== undefined && (
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
          </div>
        )}
      </Drawer>
    </div>
  )
}
