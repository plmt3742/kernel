// KERNEL · 资料 LIBRARY（P1）：笔记 + 资料混合流 / 类型与标签筛选 / Markdown 阅读抽屉
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { clsx } from 'clsx'
import { ArrowRight, Search, Sparkles } from 'lucide-react'
import { Modal } from '@/components/Modal'
import { PageHeader } from '@/components/shell/PageHeader'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { NoteComposeModal } from '@/components/NoteComposeModal'
import { ResourceDraftModal } from '@/components/ResourceDraftModal'
import { TagPill } from '@/components/TagPill'
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
import {
  aiNoteDistill,
  openPath,
  restoreEntity,
  revealPath,
  trashEntity,
  undoPatchOf,
  updateEntity,
} from '@/lib/mutations'
import { errorText } from '@/lib/api'
import {
  DISTILL_HELP,
  DISTILL_LEVEL_DEF,
  DISTILL_LEVEL_LABEL,
  DISTILL_LEVELS,
  NOTE_TYPE_EN,
  NOTE_TYPE_LABEL,
  nextDistillLevel,
  RESOURCE_KIND_EN,
  RESOURCE_KIND_LABEL,
  RESOURCE_STATUS_DEF,
  RESOURCE_STATUS_LABEL,
  tagLabel,
} from '@/lib/format'
import { formatRelative } from '@/lib/date'
import { useDataRevision, useNow } from '@/lib/hooks'
import { createUiStore, oneOf, oneOfOrEmpty, str, useUiStore } from '@/lib/uiState'
import type { Note, NoteType, Resource, ResourceKind, ResourceStatus, TrashKind } from '@/types'

type Tab = 'all' | 'notes' | 'resources'

const NOTE_TYPES: NoteType[] = ['fleeting', 'literature', 'permanent', 'meeting', 'memo']
const RESOURCE_KINDS: ResourceKind[] = ['article', 'course', 'book', 'tool', 'paper', 'file']
const RESOURCE_STATUSES: ResourceStatus[] = ['unread', 'reading', 'read', 'reference', 'archived']

/* ---------------------------------------------------------------------------
 * 资料页界面状态保留（Slice Z · F28，见 ADR-0022）：
 * 标签页 / 笔记类型 / 资料类型 / 资料状态 / 选中标签提升到模块级 store 并持久化，
 * 切路由或刷新后原样还原（纯界面状态，绝不落盘数据）。
 * ------------------------------------------------------------------------- */
interface LibraryUiState {
  tab: Tab
  noteType: NoteType | ''
  resourceKind: ResourceKind | ''
  resourceStatus: ResourceStatus | ''
  tag: string
  /** Slice FS：客户端搜索查询串（笔记 + 资料） */
  q: string
}

const LIBRARY_UI_KEY = 'kernel.ui.library.v1'
const LIBRARY_UI_DEFAULT: LibraryUiState = {
  tab: 'all',
  noteType: '',
  resourceKind: '',
  resourceStatus: '',
  tag: '',
  q: '',
}

function parseLibraryUi(raw: unknown): LibraryUiState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const v = raw as Record<string, unknown>
  return {
    tab: oneOf(v.tab, ['all', 'notes', 'resources'] as const, 'all'),
    noteType: oneOfOrEmpty(v.noteType, NOTE_TYPES),
    resourceKind: oneOfOrEmpty(v.resourceKind, RESOURCE_KINDS),
    resourceStatus: oneOfOrEmpty(v.resourceStatus, RESOURCE_STATUSES),
    tag: str(v.tag),
    q: str(v.q),
  }
}

const libraryUiStore = createUiStore<LibraryUiState>(LIBRARY_UI_KEY, LIBRARY_UI_DEFAULT, {
  parse: parseLibraryUi,
})

interface DrawerTarget {
  kind: 'note' | 'resource'
  id: string
}

interface LibraryRowData {
  kind: 'note' | 'resource'
  id: string
  title: string
  sub: string
  mid: string
  at: number
  time: string
}

interface RecentEntry {
  kind: 'note' | 'resource'
  title: string
  meta: string
  at: string
}

function rowTagText(tags: string[]): string {
  if (tags.length === 0) return '—'
  const head = tags
    .slice(0, 2)
    .map((item) => tagLabel(item))
    .join(' · ')
  return tags.length > 2 ? `${head} +${tags.length - 2}` : head
}

export function Library() {
  const now = useNow()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // 界面状态（Slice Z · F28）：来自模块级 store（跨路由 + 刷新保留）
  const libraryUi = useUiStore(libraryUiStore)
  const { tab, noteType, resourceKind, resourceStatus, tag, q } = libraryUi
  const setTab = (value: Tab): void => {
    libraryUiStore.set((state) => ({ ...state, tab: value }))
  }
  const setNoteType = (value: NoteType | ''): void => {
    libraryUiStore.set((state) => ({ ...state, noteType: value }))
  }
  const setResourceKind = (value: ResourceKind | ''): void => {
    libraryUiStore.set((state) => ({ ...state, resourceKind: value }))
  }
  const setResourceStatus = (value: ResourceStatus | ''): void => {
    libraryUiStore.set((state) => ({ ...state, resourceStatus: value }))
  }
  const setTag = (value: string): void => {
    libraryUiStore.set((state) => ({ ...state, tag: value }))
  }
  const setQ = (value: string): void => {
    libraryUiStore.set((state) => ({ ...state, q: value }))
  }
  const [target, setTarget] = useState<DrawerTarget | null>(null)
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  // Slice M：新建笔记撰写弹窗；Slice Y：新建资料草稿弹窗
  const [composing, setComposing] = useState(false)
  const [composingResource, setComposingResource] = useState(false)
  // Slice M：AI 蒸馏草稿（editable textarea）+ 加载 / 错误 / 应用中
  const [distill, setDistill] = useState<{ text: string; targetLevel: number } | null>(null)
  const [distillLoading, setDistillLoading] = useState(false)
  const [distillError, setDistillError] = useState('')
  const [applying, setApplying] = useState(false)

  // 切换抽屉目标时退出编辑态 + 清空 AI 蒸馏草稿
  useEffect(() => {
    setEditing(false)
    setDistill(null)
    setDistillError('')
    setDistillLoading(false)
    setApplying(false)
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

  // Slice FS：客户端搜索谓词（标题 / 正文 / 标签，大小写不敏感）。
  // 空查询短路为 true —— 与旧行为逐字节等价（不改变任何既有筛选结果）。
  const searchNeedle = q.trim().toLowerCase()
  const noteMatches = (note: Note): boolean =>
    searchNeedle === '' ||
    note.title.toLowerCase().includes(searchNeedle) ||
    note.body.toLowerCase().includes(searchNeedle) ||
    note.tags.some((item) => item.toLowerCase().includes(searchNeedle))
  const resourceMatches = (resource: Resource): boolean =>
    searchNeedle === '' ||
    resource.title.toLowerCase().includes(searchNeedle) ||
    (resource.note ?? '').toLowerCase().includes(searchNeedle) ||
    (resource.url ?? '').toLowerCase().includes(searchNeedle) ||
    resource.tags.some((item) => item.toLowerCase().includes(searchNeedle))

  const filteredNotes = notes.filter(
    (note) =>
      (noteType === '' || note.type === noteType) &&
      (tag === '' || note.tags.includes(tag)) &&
      noteMatches(note),
  )
  const filteredResources = resources.filter(
    (resource) =>
      (resourceKind === '' || resource.kind === resourceKind) &&
      (resourceStatus === '' || resource.status === resourceStatus) &&
      (tag === '' || resource.tags.includes(tag)) &&
      resourceMatches(resource),
  )

  const showNotes = tab !== 'resources'
  const showResources = tab !== 'notes'

  const selectedNote = target?.kind === 'note' ? notes.find((n) => n.id === target.id) : undefined
  const selectedResource =
    target?.kind === 'resource' ? resources.find((r) => r.id === target.id) : undefined
  const selectedNoteArea =
    selectedNote?.areaId !== undefined ? getAreaById(selectedNote.areaId) : undefined
  const selectedNoteProject =
    selectedNote?.projectId !== undefined
      ? getSnapshot().projects.find((project) => project.id === selectedNote.projectId)
      : undefined

  // 笔记字段顺序（Slice M）：标题 + 正文置顶（沉浸撰写面），其余元数据次之
  const noteFields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text' },
    { key: 'body', label: '正文（Markdown）', type: 'textarea', rows: 18 },
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
    { key: 'note', label: '简介', type: 'textarea' },
    { key: 'content', label: '原文', type: 'textarea', rows: 8 },
  ]

  const handleSave = (patch: Record<string, unknown>): void => {
    if (target === null) return
    const kind: TrashKind = target.kind === 'note' ? 'notes' : 'resources'
    const id = target.id
    // Slice Y · F36：保存前快照被改字段原值，toast「撤销」回写即往返还原
    const record = target.kind === 'note' ? selectedNote : selectedResource
    const undo =
      record !== undefined
        ? undoPatchOf(record as unknown as Record<string, unknown>, patch)
        : {}
    setSaving(true)
    void (async () => {
      try {
        await updateEntity(kind, id, patch)
        setEditing(false)
        toast('已保存', {
          action: {
            label: '撤销',
            onClick: () => {
              void updateEntity(kind, id, undo).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
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

  // 在文件管理器中定位资源文件（仅本机）：成功与失败均 toast
  const handleReveal = (): void => {
    const path = selectedResource?.path
    if (path === undefined) return
    void (async () => {
      try {
        await revealPath(path)
        toast('已在文件管理器中定位')
      } catch (err) {
        toast(`定位失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 以默认程序打开资源文件（Slice J2 · 与收件箱附件动作同姿态；仅本机）：成功与失败均 toast
  const handleOpenResource = (): void => {
    const path = selectedResource?.path
    if (path === undefined) return
    void (async () => {
      try {
        await openPath(path)
        toast('已用默认程序打开')
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

  // 新建笔记成功（Slice M）：关闭撰写弹窗 → 打开新笔记（深链）→ toast（撤销 = 移入回收站）
  const handleNoteCreated = (note: Note): void => {
    setComposing(false)
    setTarget({ kind: 'note', id: note.id })
    setSearchParams({ note: note.id }, { replace: true })
    toast('笔记已创建', {
      action: {
        label: '撤销',
        onClick: () => {
          void (async () => {
            try {
              await trashEntity('notes', note.id)
              setTarget((prev) =>
                prev !== null && prev.kind === 'note' && prev.id === note.id ? null : prev,
              )
              setSearchParams(
                (prev) => (prev.get('note') === note.id ? {} : prev),
                { replace: true },
              )
              toast('已撤销创建')
            } catch (err) {
              toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
            }
          })()
        },
      },
    })
  }

  // 新建资料成功（Slice Y · F5）：关闭草稿弹窗 → 打开新资料（深链）→ toast（撤销 = 移入回收站）
  const handleResourceCreated = (resource: Resource): void => {
    setComposingResource(false)
    setTarget({ kind: 'resource', id: resource.id })
    setSearchParams({ resource: resource.id }, { replace: true })
    toast('资料已创建', {
      action: {
        label: '撤销',
        onClick: () => {
          void (async () => {
            try {
              await trashEntity('resources', resource.id)
              setTarget((prev) =>
                prev !== null && prev.kind === 'resource' && prev.id === resource.id ? null : prev,
              )
              setSearchParams(
                (prev) => (prev.get('resource') === resource.id ? {} : prev),
                { replace: true },
              )
              toast('已撤销创建')
            } catch (err) {
              toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
            }
          })()
        },
      },
    })
  }

  // AI 蒸馏（Slice M）：请求下一层草稿（服务端 clamp 1–3）；只出建议，不自动写入
  const handleAiDistill = (): void => {
    if (selectedNote === undefined || distillLoading) return
    const id = selectedNote.id
    setDistillLoading(true)
    setDistill(null)
    setDistillError('')
    void (async () => {
      try {
        const result = await aiNoteDistill(id)
        setDistill({ text: result.text, targetLevel: result.targetLevel })
      } catch (err) {
        setDistillError(errorText(err))
      } finally {
        setDistillLoading(false)
      }
    })()
  }

  // 应用蒸馏（Slice M）：正文末尾追加「## 蒸馏 → Lx」小节 + distillLevel = 目标层级；
  // 撤销客户端记录原 body + 原层级，回写精确还原。追加不替换——原文永不丢失。
  const handleApplyDistill = (): void => {
    if (selectedNote === undefined || distill === null || applying) return
    const id = selectedNote.id
    const prevBody = selectedNote.body
    const prevLevel = selectedNote.distillLevel
    const text = distill.text.trim()
    if (text === '') return
    const { targetLevel } = distill
    const section = `## 蒸馏 → L${targetLevel} ${DISTILL_LEVEL_LABEL[targetLevel]}\n\n${text}`
    const nextBody = prevBody.trim() === '' ? section : `${prevBody.replace(/\s+$/, '')}\n\n---\n\n${section}`
    setApplying(true)
    void (async () => {
      try {
        await updateEntity('notes', id, { body: nextBody, distillLevel: targetLevel })
        setDistill(null)
        toast(`已应用 L${targetLevel} 蒸馏`, {
          action: {
            label: '撤销',
            onClick: () => {
              void updateEntity('notes', id, { body: prevBody, distillLevel: prevLevel })
                .then(() => toast('已撤销蒸馏'))
                .catch((err) => toast(`撤销失败：${errorText(err)}`, { tone: 'error' }))
            },
          },
        })
      } catch (err) {
        toast(`应用失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setApplying(false)
      }
    })()
  }

  const tagsTotal = getTags().length
  const unreadCount = resources.filter((resource) => resource.status === 'unread').length

  const handleShowUnread = (): void => {
    if (tab === 'resources' && resourceStatus === 'unread') {
      setResourceStatus('')
      return
    }
    setTab('resources')
    setResourceStatus('unread')
  }

  const rows: LibraryRowData[] = []
  if (showNotes) {
    for (const note of filteredNotes) {
      const area = note.areaId !== undefined ? getAreaById(note.areaId) : undefined
      rows.push({
        kind: 'note',
        id: note.id,
        title: note.title,
        sub: [
          NOTE_TYPE_LABEL[note.type],
          area?.title ?? '未分区',
          note.distillLevel > 0 ? `L${note.distillLevel}` : '',
        ]
          .filter((part) => part !== '')
          .join(' · '),
        mid: rowTagText(note.tags),
        at: new Date(note.updatedAt).getTime(),
        time: formatRelative(note.updatedAt, now),
      })
    }
  }
  if (showResources) {
    for (const resource of filteredResources) {
      const area = resource.areaId !== undefined ? getAreaById(resource.areaId) : undefined
      rows.push({
        kind: 'resource',
        id: resource.id,
        title: resource.title,
        sub: [
          RESOURCE_KIND_LABEL[resource.kind],
          RESOURCE_STATUS_LABEL[resource.status],
          area?.title ?? '未分区',
        ].join(' · '),
        mid: rowTagText(resource.tags),
        at: new Date(resource.addedAt).getTime(),
        time: formatRelative(resource.addedAt, now),
      })
    }
  }
  rows.sort((a, b) => b.at - a.at)

  const latestCandidates: RecentEntry[] = [
    ...notes.map((note) => {
      const area = note.areaId !== undefined ? getAreaById(note.areaId) : undefined
      return {
        kind: 'note' as const,
        title: note.title,
        meta: [NOTE_TYPE_LABEL[note.type], area?.title ?? '未分区'].join(' · '),
        at: note.updatedAt,
      }
    }),
    ...resources.map((resource) => ({
      kind: 'resource' as const,
      title: resource.title,
      meta: `${RESOURCE_KIND_LABEL[resource.kind]} · ${RESOURCE_STATUS_LABEL[resource.status]}`,
      at: resource.addedAt,
    })),
  ]
  const latest = latestCandidates.sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  )[0]

  return (
    <div className="gh-page">
      <PageHeader
        breadcrumb={[{ label: 'KERNEL', to: '/' }, { label: '资料' }]}
        title="资料"
        description="笔记与资料共用一张索引：写下来的、收进来的，都按最近更新排开。"
        meta={
          <>
            <b>
              {notes.length} 笔记 · {resources.length} 资料
            </b>
            <span>{tagsTotal} 标签</span>
          </>
        }
        actions={
          <>
            <button type="button" className="gh-btn" onClick={() => setComposing(true)}>
              新建笔记
            </button>
            <button
              type="button"
              className="gh-btn gh-btn--primary"
              onClick={() => setComposingResource(true)}
            >
              新建资料
            </button>
          </>
        }
        tabs={
          <>
            {(
              [
                ['all', '全部', notes.length + resources.length],
                ['notes', '笔记', notes.length],
                ['resources', '资料', resources.length],
              ] as const
            ).map(([value, label, count]) => (
              <button
                key={value}
                type="button"
                className={clsx('gh-tab', tab === value && 'is-active')}
                aria-pressed={tab === value}
                onClick={() => setTab(value)}
              >
                {label}
                <span className="gh-tab__count">{count}</span>
              </button>
            ))}
          </>
        }
      />

      <div className="gh-toolbar">
        <label className="gh-search-input">
          <Search size={14} strokeWidth={1.8} aria-hidden />
          <input
            type="search"
            value={q}
            onChange={(event) => setQ(event.target.value)}
            placeholder="搜索标题 / 正文 / 标签…"
            aria-label="搜索笔记与资料"
          />
        </label>
        <div className="gh-toolbar__group">
          {showNotes && (
            <label className="gh-filter-select">
              <span>笔记</span>
              <select
                value={noteType}
                aria-label="笔记类型"
                onChange={(event) => setNoteType(event.target.value as NoteType | '')}
              >
                <option value="">全部类型</option>
                {NOTE_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {NOTE_TYPE_LABEL[type]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {showResources && (
            <>
              <label className="gh-filter-select">
                <span>资料</span>
                <select
                  value={resourceKind}
                  aria-label="资料类型"
                  onChange={(event) => setResourceKind(event.target.value as ResourceKind | '')}
                >
                  <option value="">全部类型</option>
                  {RESOURCE_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {RESOURCE_KIND_LABEL[kind]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="gh-filter-select">
                <span>状态</span>
                <select
                  value={resourceStatus}
                  aria-label="资料状态"
                  onChange={(event) => setResourceStatus(event.target.value as ResourceStatus | '')}
                >
                  <option value="">全部状态</option>
                  {RESOURCE_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {RESOURCE_STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
        </div>
      </div>

      <div className="gh-tagstrip">
        <span className="gh-tagstrip__label">标签</span>
        <div className="gh-tagstrip__items">
          <button
            type="button"
            className={clsx('gh-tag', tag === '' && 'is-on')}
            onClick={() => setTag('')}
          >
            全部
          </button>
          {topicTags.map((item) => (
            <button
              key={item.id}
              type="button"
              className={clsx('gh-tag', tag === item.name && 'is-on')}
              onClick={() => setTag(tag === item.name ? '' : item.name)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="gh-lib-grid">
        <section className="gh-card">
          <div className="gh-card__head">
            <span>{tab === 'notes' ? '笔记' : tab === 'resources' ? '资料' : '全部索引'}</span>
            <span className="gh-card__muted">
              {searchNeedle !== ''
                ? `搜索「${q.trim()}」 · ${rows.length} 条`
                : tag !== ''
                  ? `标签 ${tagLabel(tag)} · ${rows.length} 条`
                  : `共 ${rows.length} 条`}
            </span>
          </div>
          {rows.length === 0 ? (
            <div className="gh-empty gh-empty--inset">
              <b>没有匹配的记录</b>
              <span>调整搜索、类型、状态或标签筛选。</span>
            </div>
          ) : (
            <div>
              {rows.map((row) => (
                <LibraryRow
                  key={`${row.kind}-${row.id}`}
                  row={row}
                  onOpen={(target) =>
                    navigate(`/library/${target.kind === 'note' ? 'notes' : 'resources'}/${target.id}`)
                  }
                />
              ))}
            </div>
          )}
        </section>

        <aside className="gh-lib-side" aria-label="资料构成">
          <section className="gh-card">
            <div className="gh-card__head">构成</div>
            <div className="gh-status-list">
              <button type="button" className="gh-status-row" onClick={() => setTab('notes')}>
                <span>笔记</span>
                <b>{notes.length}</b>
              </button>
              <button type="button" className="gh-status-row" onClick={() => setTab('resources')}>
                <span>资料</span>
                <b>{resources.length}</b>
              </button>
              <div className="gh-status-row">
                <span>标签</span>
                <b>{tagsTotal}</b>
              </div>
              <button
                type="button"
                className={clsx('gh-status-row', resourceStatus === 'unread' && 'is-active')}
                onClick={handleShowUnread}
              >
                <span>待读</span>
                <b>{unreadCount}</b>
              </button>
            </div>
          </section>

          <section className="gh-card">
            <div className="gh-card__head">最近更新</div>
            <div className="gh-card__body">
              {latest === undefined ? (
                <span className="gh-card__muted">还没有笔记或资料。</span>
              ) : (
                <>
                  <b className="gh-lib-latest__title">{latest.title}</b>
                  <p className="gh-card__muted gh-lib-latest__meta">
                    {latest.meta} · {formatRelative(latest.at, now)}
                  </p>
                </>
              )}
            </div>
          </section>
        </aside>
      </div>

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
        className={clsx('w4-modal', selectedNote !== undefined ? 'k-modal--note' : 'k-modal--detail')}
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
            <div className="k-note-edit">
              <EntityEditForm
                fields={noteFields}
                initial={selectedNote as unknown as Record<string, unknown>}
                saving={saving}
                onSubmit={handleSave}
                onCancel={() => setEditing(false)}
              />
            </div>
          ) : (
            <div className="k-note">
              {/* 安静元数据条：类型 / 层级 / 区域 / 项目 / 更新 / 标签 —— 正文才是主角 */}
              <div className="k-note__meta">
                <span className="k-note__meta-type u-label">
                  {NOTE_TYPE_LABEL[selectedNote.type]}
                  <span className="k-muted"> {NOTE_TYPE_EN[selectedNote.type]}</span>
                </span>
                <span className="k-note__meta-chip u-label">L{selectedNote.distillLevel} / 3</span>
                {selectedNoteArea !== undefined && (
                  <span className="k-mono">{selectedNoteArea.title}</span>
                )}
                {selectedNoteProject !== undefined && (
                  <span className="k-mono">{selectedNoteProject.title}</span>
                )}
                <span className="k-mono">{formatRelative(selectedNote.updatedAt, now)}</span>
                {selectedNote.tags.length > 0 && (
                  <span className="k-note__meta-tags">
                    {selectedNote.tags.map((item) => (
                      <TagPill key={item}>{tagLabel(item)}</TagPill>
                    ))}
                  </span>
                )}
              </div>

              {/* 正文 · 主角（沉浸阅读面） */}
              {selectedNote.body.trim() !== '' ? (
                <article className="k-note-read">
                  <div className="k-markdown">
                    <ReactMarkdown>{selectedNote.body}</ReactMarkdown>
                  </div>
                </article>
              ) : (
                <p className="k-note-read__empty k-muted">
                  还没有正文。点「编辑」开始撰写，或用下方「AI 蒸馏」由 AI 起草下一层草稿。
                </p>
              )}

              {/* 次级区：蒸馏设置 + AI 蒸馏 + 反向链接 + 关联 */}
              <div className="k-detail-grid k-note__secondary">
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
                  footer={
                    <div className="k-note-distill">
                      <p className="k-note-distill__hint k-muted">{DISTILL_HELP}</p>
                      <div className="k-note-distill__actions">
                        <button
                          type="button"
                          className="k-btn k-btn--sm"
                          onClick={handleAiDistill}
                          disabled={distillLoading}
                        >
                          <Sparkles size={14} strokeWidth={1.5} aria-hidden />
                          {distillLoading
                            ? 'AI 蒸馏中…'
                            : `AI 蒸馏（生成 L${nextDistillLevel(selectedNote.distillLevel)} 草稿）`}
                        </button>
                        <span className="k-muted k-note-distill__note">
                          只出草稿，确认后追加；不会自动改写
                        </span>
                      </div>
                    </div>
                  }
                />
                {distillError !== '' && (
                  <p className="k-ai-form__error" role="alert">
                    AI 蒸馏失败：{distillError}{' '}
                    <button type="button" className="k-btn k-btn--sm" onClick={handleAiDistill}>
                      重试
                    </button>
                  </p>
                )}
                {distill !== null && (
                  <div className="k-note-ai">
                    <div className="k-note-ai__head">
                      <Sparkles size={14} strokeWidth={1.5} aria-hidden />
                      <span>
                        AI 蒸馏建议 · L{distill.targetLevel}{' '}
                        {DISTILL_LEVEL_LABEL[distill.targetLevel]}
                      </span>
                      <span className="k-muted">可编辑后应用</span>
                    </div>
                    <textarea
                      className="k-textarea k-note-ai__text"
                      value={distill.text}
                      aria-label="AI 蒸馏草稿"
                      onChange={(event) =>
                        setDistill((prev) =>
                          prev === null ? prev : { ...prev, text: event.target.value },
                        )
                      }
                    />
                    <div className="k-hstack">
                      <button
                        type="button"
                        className="k-btn k-btn--sm is-solid"
                        onClick={handleApplyDistill}
                        disabled={applying || distill.text.trim() === ''}
                      >
                        {applying ? '应用中…' : '应用到笔记'}
                      </button>
                      <button
                        type="button"
                        className="k-btn k-btn--sm"
                        onClick={() => setDistill(null)}
                        disabled={applying}
                      >
                        忽略
                      </button>
                    </div>
                  </div>
                )}
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
            {selectedResource.note !== undefined && selectedResource.note !== '' && (
              <div className="k-detail-block">
                <span className="k-detail-block__label u-label">简介</span>
                <p className="k-detail-note">{selectedResource.note}</p>
              </div>
            )}
            {typeof selectedResource.content === 'string' && selectedResource.content.trim() !== '' && (
              <div className="k-detail-block">
                <span className="k-detail-block__label u-label">原文</span>
                <div className="k-detail-raw">{selectedResource.content}</div>
              </div>
            )}
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
                  /^https?:\/\//i.test(selectedResource.url) ? (
                    <a
                      href={selectedResource.url}
                      target="_blank"
                      rel="noreferrer"
                      className="k-markdown"
                    >
                      {selectedResource.url}
                    </a>
                  ) : (
                    selectedResource.url
                  )
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
            <Relations kind="resource" id={selectedResource.id} />
          </div>
          ))}
      </Modal>

      <NoteComposeModal
        open={composing}
        onClose={() => setComposing(false)}
        onCreated={handleNoteCreated}
      />

      <ResourceDraftModal
        open={composingResource}
        onClose={() => setComposingResource(false)}
        onCreated={handleResourceCreated}
      />
    </div>
  )
}

function LibraryRow({
  row,
  onOpen,
}: {
  row: LibraryRowData
  onOpen: (target: DrawerTarget) => void
}) {
  return (
    <button
      type="button"
      className="gh-lib-row"
      onClick={() => onOpen({ kind: row.kind, id: row.id })}
      title={`${row.title} · ${row.sub}`}
    >
      <span className="gh-lib-row__kind">{row.kind === 'note' ? '笔记' : '资料'}</span>
      <span className="gh-lib-row__main">
        <span className="gh-lib-row__title">{row.title}</span>
        <span className="gh-lib-row__sub">{row.sub}</span>
      </span>
      <span className="gh-lib-row__tags">{row.mid}</span>
      <span className="gh-lib-row__time">{row.time}</span>
      <ArrowRight size={13} strokeWidth={1.6} aria-hidden />
    </button>
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
  footer,
}: {
  label: string
  value: T
  options: QuickOption<T>[]
  helper: string
  onSelect: (value: T) => void
  /** 追加在 helper 之下的安静内容（如蒸馏释义 + AI 蒸馏按钮） */
  footer?: ReactNode
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
      {footer}
    </div>
  )
}
