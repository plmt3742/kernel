// KERNEL · 手机入口 /m（查阅 + 记录）
// 设计基准：桌面 W4 视觉语言（近黑 / 玻璃发丝 / Smiley Sans / 等宽索引 / 单色主按钮）。
// 功能边界：只保留最基本的查阅与记录——查今天与 7 天内的安排、搜库内记录、快速收进收件箱。
// 不提供：项目 / 资料 / 习惯 / 回顾 / 设置 / AI 解析；写入仍全部经现有数据服务。
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  BookOpen,
  Check,
  ChevronRight,
  ImagePlus,
  Moon,
  PenLine,
  Search,
  Sun,
  X,
} from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { useTheme } from '@/context/ThemeContext'
import { useDataRevision, useNow, useUndoableToggle } from '@/lib/hooks'
import { captureInbox, hydrateFromServer, removeInbox, uploadInboxFile } from '@/lib/mutations'
import {
  getEventById,
  getInbox,
  getNoteById,
  getProjectById,
  getResourceById,
  getSnapshot,
  getTaskById,
  getTodayEvents,
  searchSnapshot,
  type SearchResult,
} from '@/lib/data'
import { errorText } from '@/lib/api'
import {
  formatMonthDay,
  formatTime,
  formatWeekdayShort,
  humanizeDay,
  isSameDay,
  startOfDay,
  toDate,
  upcomingDays,
} from '@/lib/date'
import {
  NOTE_TYPE_LABEL,
  PROJECT_STATUS_LABEL,
  RESOURCE_KIND_LABEL,
  RESOURCE_STATUS_LABEL,
  tagLabel,
} from '@/lib/format'
import type { CalendarEvent, InboxItem, Note, Project, Resource, Task, Trace } from '@/types'

type Tab = 'lookup' | 'record'
type DueTask = Task & { dueAt: string }

type Selection =
  | { kind: 'task'; value: Task }
  | { kind: 'event'; value: CalendarEvent }
  | { kind: 'note'; value: Note }
  | { kind: 'resource'; value: Resource }
  | { kind: 'project'; value: Project }
  | { kind: 'trace'; value: Trace }
  | { kind: 'inbox'; value: InboxItem }

const SEARCH_KIND_LABEL: Record<SearchResult['kind'], string> = {
  task: '任务',
  note: '笔记',
  resource: '资料',
  event: '日程',
  project: '项目',
  trace: '踪迹',
}

const DETAIL_KIND_LABEL: Record<Selection['kind'], string> = {
  ...SEARCH_KIND_LABEL,
  inbox: '收件箱',
}

const hasDue = (task: Task): task is DueTask => task.dueAt !== undefined

function timeOf(iso: string): string {
  return formatTime(iso)
}

function projectTitleOf(task: Task): string | undefined {
  if (task.projectId === undefined) return undefined
  return getProjectById(task.projectId)?.title
}

function taskDueText(task: Task, now: Date): { text: string; overdue: boolean } {
  const project = projectTitleOf(task)
  if (task.dueAt === undefined) {
    return { text: project ?? '没有截止时间', overdue: false }
  }
  const overdue =
    task.status !== 'done' && task.status !== 'dropped' && toDate(task.dueAt).getTime() < now.getTime()
  const due = `${overdue ? '已逾期 · ' : ''}${humanizeDay(task.dueAt, now)} ${timeOf(task.dueAt)}`
  return { text: project !== undefined ? `${due} · ${project}` : due, overdue }
}

function eventMeta(event: CalendarEvent): string {
  const when = event.allDay
    ? '全天'
    : `${timeOf(event.startAt)}${event.endAt !== undefined ? ` – ${timeOf(event.endAt)}` : ''}`
  return [when, event.location].filter((part) => part !== undefined && part !== '').join(' · ')
}

function TagList({ tags }: { tags: string[] }): ReactNode {
  if (tags.length === 0) return null
  return (
    <div className="m-sheet__tags" aria-label="标签">
      {tags.map((tag) => (
        <span key={tag}>{tagLabel(tag)}</span>
      ))}
    </div>
  )
}

function EventRow({
  event,
  onOpen,
}: {
  event: CalendarEvent
  onOpen: (event: CalendarEvent) => void
}): ReactNode {
  return (
    <li>
      <button type="button" className="m-row m-event" onClick={() => onOpen(event)}>
        <span className="m-event__time">{event.allDay ? '全天' : timeOf(event.startAt)}</span>
        <span className="m-event__body">
          <span className="m-event__title">{event.title}</span>
          <span className="m-event__meta">{eventMeta(event)}</span>
        </span>
        <ChevronRight className="m-row__go" size={15} strokeWidth={1.7} aria-hidden />
      </button>
    </li>
  )
}

function TaskRow({
  task,
  now,
  onOpen,
  onToggle,
  showCheck = true,
}: {
  task: DueTask
  now: Date
  onOpen: (task: Task) => void
  onToggle: (task: Task) => void
  showCheck?: boolean
}): ReactNode {
  const meta = taskDueText(task, now)
  return (
    <li className={showCheck ? 'm-task' : 'm-task m-task--plain'}>
      {showCheck && (
        <button
          type="button"
          className="m-check"
          aria-label={`完成：${task.title}`}
          onClick={() => onToggle(task)}
        >
          <Check size={12} strokeWidth={2.2} aria-hidden />
        </button>
      )}
      <button type="button" className="m-task__body" onClick={() => onOpen(task)}>
        <span className="m-task__title">{task.title}</span>
        <span className={meta.overdue ? 'm-task__meta is-overdue' : 'm-task__meta'}>{meta.text}</span>
      </button>
      <ChevronRight className="m-row__go" size={15} strokeWidth={1.7} aria-hidden />
    </li>
  )
}

function SearchRow({
  result,
  onOpen,
}: {
  result: SearchResult
  onOpen: (result: SearchResult) => void
}): ReactNode {
  return (
    <li>
      <button type="button" className="m-row m-result" onClick={() => onOpen(result)}>
        <span className="m-result__kind">{SEARCH_KIND_LABEL[result.kind]}</span>
        <span className="m-result__body">
          <span className="m-result__title">{result.title}</span>
          {result.snippet !== result.title && (
            <span className="m-result__snippet">{result.snippet}</span>
          )}
        </span>
        <ChevronRight className="m-row__go" size={15} strokeWidth={1.7} aria-hidden />
      </button>
    </li>
  )
}

function InboxRow({
  item,
  now,
  onOpen,
}: {
  item: InboxItem
  now: Date
  onOpen: (item: InboxItem) => void
}): ReactNode {
  const title = item.file !== undefined ? item.file.name : item.content
  return (
    <li>
      <button type="button" className="m-row m-inbox" onClick={() => onOpen(item)}>
        <span className="m-inbox__body">
          <span className="m-inbox__title">{title}</span>
          <span className="m-inbox__meta">
            {item.file !== undefined ? '文件 · ' : ''}
            {humanizeDay(item.capturedAt, now)} {timeOf(item.capturedAt)}
          </span>
        </span>
        <ChevronRight className="m-row__go" size={15} strokeWidth={1.7} aria-hidden />
      </button>
    </li>
  )
}

function EmptyBlock({
  title,
  hint,
  action,
}: {
  title: string
  hint: string
  action?: ReactNode
}): ReactNode {
  return (
    <div className="m-empty">
      <b>{title}</b>
      <span>{hint}</span>
      {action}
    </div>
  )
}

function DetailSheet({
  selection,
  now,
  reduce,
  closeRef,
  onClose,
  onToggleTask,
}: {
  selection: Selection
  now: Date
  reduce: boolean
  closeRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onToggleTask: (task: Task) => void
}): ReactNode {
  const body = (() => {
    switch (selection.kind) {
      case 'task': {
        const task = selection.value
        const meta = taskDueText(task, now)
        const done = task.status === 'done'
        return (
          <>
            <h2 className="m-sheet__title" id="m-sheet-title">
              {task.title}
            </h2>
            <p className={meta.overdue ? 'm-sheet__meta is-overdue' : 'm-sheet__meta'}>
              {done ? '已完成 · ' : ''}
              {meta.text}
            </p>
            {task.notes !== undefined && task.notes !== '' && (
              <div className="m-sheet__body">{task.notes}</div>
            )}
            <TagList tags={task.tags} />
            <button
              type="button"
              className={done ? 'm-sheet__secondary' : 'm-sheet__primary'}
              onClick={() => {
                onToggleTask(task)
                onClose()
              }}
            >
              <Check size={15} strokeWidth={2.1} aria-hidden />
              {done ? '重新打开' : '标记完成'}
            </button>
          </>
        )
      }
      case 'event': {
        const event = selection.value
        return (
          <>
            <h2 className="m-sheet__title" id="m-sheet-title">
              {event.title}
            </h2>
            <p className="m-sheet__meta">
              {formatMonthDay(event.startAt)} · {eventMeta(event)}
              {event.status === 'tentative' ? ' · 待定' : ''}
            </p>
            {event.notes !== undefined && event.notes !== '' && (
              <div className="m-sheet__body">{event.notes}</div>
            )}
            <TagList tags={event.tags} />
          </>
        )
      }
      case 'note': {
        const note = selection.value
        return (
          <>
            <h2 className="m-sheet__title" id="m-sheet-title">
              {note.title}
            </h2>
            <p className="m-sheet__meta">
              {NOTE_TYPE_LABEL[note.type]} · {formatMonthDay(note.updatedAt)} 更新
            </p>
            <div className="m-sheet__body m-sheet__body--md m-sheet__body--long">
              <div className="m-sheet__md">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown>
              </div>
            </div>
            <TagList tags={note.tags} />
          </>
        )
      }
      case 'resource': {
        const resource = selection.value
        return (
          <>
            <h2 className="m-sheet__title" id="m-sheet-title">
              {resource.title}
            </h2>
            <p className="m-sheet__meta">
              {RESOURCE_KIND_LABEL[resource.kind]} · {RESOURCE_STATUS_LABEL[resource.status]} ·{' '}
              {formatMonthDay(resource.addedAt)} 加入
            </p>
            {resource.note !== undefined && resource.note !== '' && (
              <div className="m-sheet__body">{resource.note}</div>
            )}
            {resource.content !== undefined && resource.content !== '' && (
              <>
                <p className="m-sheet__label">原文</p>
                <div className="m-sheet__body m-sheet__body--long">{resource.content}</div>
              </>
            )}
            {resource.url !== undefined && resource.url !== '' && (
              <a className="m-sheet__link" href={resource.url} target="_blank" rel="noreferrer">
                {resource.url}
              </a>
            )}
            <TagList tags={resource.tags} />
          </>
        )
      }
      case 'project': {
        const project = selection.value
        return (
          <>
            <h2 className="m-sheet__title" id="m-sheet-title">
              {project.title}
            </h2>
            <p className="m-sheet__meta">
              {PROJECT_STATUS_LABEL[project.status]}
              {project.dueAt !== undefined ? ` · ${formatMonthDay(project.dueAt)} 截止` : ''}
            </p>
            <p className="m-sheet__label">完成定义</p>
            <div className="m-sheet__body">{project.outcome}</div>
            <TagList tags={project.tags} />
          </>
        )
      }
      case 'trace': {
        const trace = selection.value
        return (
          <>
            <h2 className="m-sheet__title" id="m-sheet-title">
              {trace.title}
            </h2>
            <p className="m-sheet__meta">
              {formatMonthDay(trace.at)} · {timeOf(trace.at)}
            </p>
            {trace.note !== undefined && trace.note !== '' && (
              <div className="m-sheet__body">{trace.note}</div>
            )}
            <TagList tags={trace.tags} />
          </>
        )
      }
      case 'inbox': {
        const item = selection.value
        return (
          <>
            <h2 className="m-sheet__title" id="m-sheet-title">
              {item.file !== undefined ? item.file.name : item.content}
            </h2>
            <p className="m-sheet__meta">
              待整理 · {formatMonthDay(item.capturedAt)} {timeOf(item.capturedAt)}
            </p>
            {item.file !== undefined ? (
              <div className="m-sheet__body">
                文件：{item.file.name}
                {item.content.trim() !== '' ? `\n\n${item.content}` : ''}
              </div>
            ) : (
              <div className="m-sheet__body">{item.content}</div>
            )}
            {item.summary !== undefined && item.summary !== '' && (
              <>
                <p className="m-sheet__label">摘要</p>
                <div className="m-sheet__body">{item.summary}</div>
              </>
            )}
          </>
        )
      }
    }
  })()

  const sheetMotion =
    reduce
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
      : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }

  return (
    <motion.section
      className="m-sheet"
      role="dialog"
      aria-modal="true"
      aria-labelledby="m-sheet-title"
      {...sheetMotion}
      transition={{ duration: reduce ? 0.01 : 0.28, ease: [0.16, 1, 0.3, 1] }}
    >
      <span className="m-sheet__handle" aria-hidden />
      <div className="m-sheet__head">
        <span className="m-sheet__kicker">{DETAIL_KIND_LABEL[selection.kind]}</span>
        <button
          ref={closeRef}
          type="button"
          className="m-sheet__close"
          onClick={onClose}
          aria-label="关闭详情"
        >
          <X size={18} strokeWidth={1.9} aria-hidden />
        </button>
      </div>
      {body}
    </motion.section>
  )
}

export function MobileHome() {
  useDataRevision()
  const now = useNow(30_000)
  const reduce = useReducedMotion()
  const { theme, toggle } = useTheme()
  const { toast } = useToast()
  const toggleTask = useUndoableToggle()
  const [tab, setTab] = useState<Tab>('lookup')
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [focusDraft, setFocusDraft] = useState(false)
  const [showAllToday, setShowAllToday] = useState(false)
  const [showAllUpcoming, setShowAllUpcoming] = useState(false)
  const [showAllInbox, setShowAllInbox] = useState(false)
  const [expandedDays, setExpandedDays] = useState<Record<string, boolean>>({})
  const [selection, setSelection] = useState<Selection | null>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const lastFocusedRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    void hydrateFromServer()
    const onFocus = (): void => {
      void hydrateFromServer()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void hydrateFromServer()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    document.title = 'KERNEL · 手机版'
    return () => {
      document.title = 'KERNEL'
    }
  }, [])

  useEffect(() => {
    if (tab === 'record' && focusDraft) {
      draftRef.current?.focus()
      setFocusDraft(false)
    }
  }, [tab, focusDraft])

  const sheetOpen = selection !== null
  useEffect(() => {
    if (!sheetOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => closeRef.current?.focus(), 30)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelection(null)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKey)
      const target = lastFocusedRef.current
      if (target !== null && target.isConnected) target.focus({ preventScroll: true })
    }
  }, [sheetOpen])

  const switchTab = (next: Tab): void => {
    setTab(next)
    window.scrollTo({ top: 0, behavior: reduce === true ? 'auto' : 'smooth' })
  }

  const openRecord = (): void => {
    setTab('record')
    setFocusDraft(true)
  }

  const closeSheet = (): void => {
    setSelection(null)
  }

  const openSelection = (next: Selection): void => {
    lastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelection(next)
  }

  const snapshot = getSnapshot()
  const openTasks = snapshot.tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped')
  const dueToday = openTasks
    .filter(hasDue)
    .filter((task) => isSameDay(task.dueAt, now))
    .sort((a, b) => toDate(a.dueAt).getTime() - toDate(b.dueAt).getTime())
  const overdue = openTasks
    .filter(hasDue)
    .filter((task) => toDate(task.dueAt) < startOfDay(now))
    .sort((a, b) => toDate(b.dueAt).getTime() - toDate(a.dueAt).getTime())
  const overdueCount = openTasks
    .filter(hasDue)
    .filter((task) => toDate(task.dueAt).getTime() < now.getTime()).length
  const todayTasks = [...dueToday, ...overdue]
  const todayHiddenCount = Math.max(0, todayTasks.length - 6)
  const visibleTodayTasks = showAllToday ? todayTasks : todayTasks.slice(0, 6)
  const todayEvents = getTodayEvents(now)
  const todayCount = todayTasks.length + todayEvents.length
  const upcoming = upcomingDays(7, now)
    .slice(1)
    .map((day) => ({
      day,
      tasks: openTasks.filter(hasDue).filter((task) => isSameDay(task.dueAt, day)),
      events: snapshot.events.filter(
        (event) => event.status !== 'cancelled' && isSameDay(event.startAt, day),
      ),
    }))
    .filter((group) => group.tasks.length > 0 || group.events.length > 0)
  const upcomingHiddenCount = Math.max(0, upcoming.length - 4)
  const visibleUpcoming = showAllUpcoming ? upcoming : upcoming.slice(0, 4)

  const unprocessed = getInbox()
    .filter((item) => item.status === 'unprocessed')
    .sort((a, b) => toDate(b.capturedAt).getTime() - toDate(a.capturedAt).getTime())
  const inboxHiddenCount = Math.max(0, unprocessed.length - 8)
  const recent = showAllInbox ? unprocessed : unprocessed.slice(0, 8)

  const results = query.trim() === '' ? [] : searchSnapshot(query, 12)

  const openResult = (result: SearchResult): void => {
    switch (result.kind) {
      case 'task': {
        const value = getTaskById(result.id)
        if (value !== undefined) openSelection({ kind: 'task', value })
        return
      }
      case 'event': {
        const value = getEventById(result.id)
        if (value !== undefined) openSelection({ kind: 'event', value })
        return
      }
      case 'note': {
        const value = getNoteById(result.id)
        if (value !== undefined) openSelection({ kind: 'note', value })
        return
      }
      case 'resource': {
        const value = getResourceById(result.id)
        if (value !== undefined) openSelection({ kind: 'resource', value })
        return
      }
      case 'project': {
        const value = getProjectById(result.id)
        if (value !== undefined) openSelection({ kind: 'project', value })
        return
      }
      case 'trace': {
        const value = snapshot.traces.find((trace) => trace.id === result.id)
        if (value !== undefined) openSelection({ kind: 'trace', value })
        return
      }
    }
  }

  const submitText = (): void => {
    const content = draft.trim()
    if (content === '' || busy) return
    setBusy(true)
    void (async () => {
      try {
        const item = await captureInbox(content)
        setDraft('')
        toast('已收进收件箱', {
          action: {
            label: '撤销',
            onClick: () => {
              void removeInbox(item.id).catch((error) => {
                toast(`撤销失败：${errorText(error)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (error) {
        toast(`收不进去：${errorText(error)}`, { tone: 'error' })
      } finally {
        setBusy(false)
      }
    })()
  }

  const submitFile = (file: File | undefined): void => {
    if (file === undefined || fileBusy) return
    const caption = draft.trim()
    setFileBusy(true)
    void (async () => {
      try {
        const item = await uploadInboxFile(file, caption === '' ? undefined : caption)
        setDraft('')
        toast('已收进收件箱', {
          action: {
            label: '撤销',
            onClick: () => {
              void removeInbox(item.id).catch((error) => {
                toast(`撤销失败：${errorText(error)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (error) {
        toast(`收不进去：${errorText(error)}`, { tone: 'error' })
      } finally {
        setFileBusy(false)
        if (fileRef.current !== null) fileRef.current.value = ''
      }
    })()
  }

  const tabMotion =
    reduce === true
      ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
      : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -5 } }
  return (
    <div className="m-app">
      <header className="m-topbar">
        <Link to="/m" className="m-brand" aria-label="KERNEL 手机版">
          <span className="m-brand__mark" aria-hidden>
            K
          </span>
          <span className="m-brand__text">
            <b>KERNEL</b>
            <em>MOBILE / 手机</em>
          </span>
        </Link>
        <div className="m-topbar__actions">
          <button
            type="button"
            className="m-iconbtn"
            onClick={toggle}
            aria-label={theme === 'dark' ? '切换到亮色' : '切换到暗色'}
            title={theme === 'dark' ? '亮色' : '暗色'}
          >
            {theme === 'dark' ? (
              <Sun size={17} strokeWidth={1.8} aria-hidden />
            ) : (
              <Moon size={17} strokeWidth={1.8} aria-hidden />
            )}
          </button>
        </div>
      </header>

      <main className="m-main">
        <AnimatePresence mode="wait" initial={false}>
          {tab === 'lookup' ? (
            <motion.div
              key="lookup"
              {...tabMotion}
              transition={{ duration: reduce === true ? 0.01 : 0.2 }}
            >
              <header className="m-pagehead">
                <p className="m-crumbs">KERNEL / 查阅 / LOOKUP</p>
                <div className="m-pagehead__row">
                  <div className="m-pagehead__main">
                    <h1 className="m-title">今天</h1>
                    <p className="m-lede">先看今天，或者搜一条记录。</p>
                  </div>
                  <div className="m-pagehead__meta">
                    <b>{todayCount} 项今天</b>
                    <span>
                      {overdueCount} 逾期 · {unprocessed.length} 待整理
                    </span>
                  </div>
                </div>
              </header>

              <div className="m-search">
                <Search size={15} strokeWidth={1.8} aria-hidden />
                <input
                  type="text"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="查任务、笔记、资料、日程…"
                  aria-label="查阅内容"
                  autoComplete="off"
                  inputMode="search"
                  enterKeyHint="search"
                />
                {query !== '' && (
                  <button
                    type="button"
                    className="m-search__clear"
                    onClick={() => setQuery('')}
                    aria-label="清空查阅"
                  >
                    <X size={14} strokeWidth={1.9} aria-hidden />
                  </button>
                )}
              </div>

              {query.trim() !== '' ? (
                <section className="m-panel m-panel--search" aria-labelledby="m-results-title">
                  <div className="m-panel__head">
                    <h2 id="m-results-title">查阅结果</h2>
                    <span>{results.length}</span>
                  </div>
                  {results.length === 0 ? (
                    <EmptyBlock title="没有找到。" hint="换个关键词试试，或者去完整版搜索。" />
                  ) : (
                    <ul className="m-list">
                      {results.map((result) => (
                        <SearchRow key={`${result.kind}-${result.id}`} result={result} onOpen={openResult} />
                      ))}
                    </ul>
                  )}
                </section>
              ) : (
                <>
                  <section className="m-panel" aria-labelledby="m-today-title">
                    <div className="m-panel__head">
                      <h2 id="m-today-title">今天</h2>
                      <span>{todayCount}</span>
                    </div>
                    {todayCount === 0 ? (
                      <EmptyBlock
                        title="今天空着。"
                        hint="先记一件事，稍后再整理。"
                        action={
                          <button type="button" className="m-empty__action" onClick={openRecord}>
                            去记录
                          </button>
                        }
                      />
                    ) : (
                      <ul className="m-list">
                        {todayEvents.map((event) => (
                          <EventRow
                            key={event.id}
                            event={event}
                            onOpen={(value) => openSelection({ kind: 'event', value })}
                          />
                        ))}
                        {visibleTodayTasks.map((task) => (
                          <TaskRow
                            key={task.id}
                            task={task}
                            now={now}
                            onOpen={(value) => openSelection({ kind: 'task', value })}
                            onToggle={toggleTask}
                          />
                        ))}
                      </ul>
                    )}
                    {todayHiddenCount > 0 && (
                      <button
                        type="button"
                        className="m-panel__more"
                        onClick={() => setShowAllToday((value) => !value)}
                        aria-expanded={showAllToday}
                      >
                        {showAllToday ? '收起' : `展开全部 ${todayTasks.length} 项`}
                      </button>
                    )}
                  </section>

                  {upcoming.length > 0 && (
                    <section className="m-panel" aria-labelledby="m-upcoming-title">
                      <div className="m-panel__head">
                        <h2 id="m-upcoming-title">接下来</h2>
                        <span>7 天</span>
                      </div>
                      {visibleUpcoming.map((group) => {
                        const dayKey = group.day.toISOString()
                        const expanded = expandedDays[dayKey] === true
                        const dayHiddenCount = Math.max(
                          0,
                          group.events.length - 2 + group.tasks.length - 2,
                        )
                        const events = expanded ? group.events : group.events.slice(0, 2)
                        const tasks = expanded ? group.tasks : group.tasks.slice(0, 2)
                        return (
                          <div className="m-daygroup" key={dayKey}>
                            <div className="m-daygroup__head">
                              <span>{humanizeDay(group.day, now)}</span>
                              <span>
                                {formatMonthDay(group.day)} · {formatWeekdayShort(group.day)}
                              </span>
                            </div>
                            <ul className="m-list">
                              {events.map((event) => (
                                <EventRow
                                  key={event.id}
                                  event={event}
                                  onOpen={(value) => openSelection({ kind: 'event', value })}
                                />
                              ))}
                              {tasks.map((task) => (
                                <TaskRow
                                  key={task.id}
                                  task={task}
                                  now={now}
                                  showCheck={false}
                                  onOpen={(value) => openSelection({ kind: 'task', value })}
                                  onToggle={toggleTask}
                                />
                              ))}
                            </ul>
                            {dayHiddenCount > 0 && (
                              <button
                                type="button"
                                className="m-panel__more"
                                onClick={() =>
                                  setExpandedDays((previous) => ({
                                    ...previous,
                                    [dayKey]: !expanded,
                                  }))
                                }
                                aria-expanded={expanded}
                              >
                                {expanded ? '收起' : `展开当天 ${dayHiddenCount} 项`}
                              </button>
                            )}
                          </div>
                        )
                      })}
                      {upcomingHiddenCount > 0 && (
                        <button
                          type="button"
                          className="m-panel__more"
                          onClick={() => setShowAllUpcoming((value) => !value)}
                          aria-expanded={showAllUpcoming}
                        >
                          {showAllUpcoming ? '收起' : `展开全部 ${upcoming.length} 天`}
                        </button>
                      )}
                    </section>
                  )}
                </>
              )}
            </motion.div>
          ) : (
            <motion.div
              key="record"
              {...tabMotion}
              transition={{ duration: reduce === true ? 0.01 : 0.2 }}
            >
              <header className="m-pagehead">
                <p className="m-crumbs">KERNEL / 记录 / CAPTURE</p>
                <div className="m-pagehead__row">
                  <div className="m-pagehead__main">
                    <h1 className="m-title">记录</h1>
                    <p className="m-lede">先收进来，整理可以晚点做。</p>
                  </div>
                  <div className="m-pagehead__meta">
                    <b>{unprocessed.length} 条待整理</b>
                    <span>本机保存</span>
                  </div>
                </div>
              </header>

              <section className="m-capture" aria-label="记录一件事">
                <textarea
                  ref={draftRef}
                  rows={3}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="记一件事…"
                  aria-label="记录内容"
                />
                <div className="m-capture__actions">
                  <button
                    type="button"
                    className="m-iconbtn m-iconbtn--file"
                    onClick={() => fileRef.current?.click()}
                    aria-label="添加图片或文件"
                    disabled={fileBusy}
                  >
                    <ImagePlus size={18} strokeWidth={1.8} aria-hidden />
                  </button>
                  <span className="m-capture__hint">
                    {fileBusy ? '正在收…' : '文字、截图、文件都可以'}
                  </span>
                  <button
                    type="button"
                    className="m-submit"
                    onClick={submitText}
                    disabled={busy || fileBusy || draft.trim() === ''}
                  >
                    {busy ? '收…' : '收下'}
                  </button>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  accept="image/*,application/pdf,text/plain,.doc,.docx,.xls,.xlsx,.ppt,.pptx"
                  onChange={(event) => submitFile(event.target.files?.[0])}
                />
              </section>

              <section className="m-panel" aria-labelledby="m-inbox-title">
                <div className="m-panel__head">
                  <h2 id="m-inbox-title">待整理</h2>
                  <span>{unprocessed.length}</span>
                </div>
                {recent.length === 0 ? (
                  <EmptyBlock title="收件箱是空的。" hint="刚记下的东西会出现在这里。" />
                ) : (
                  <ul className="m-list">
                    {recent.map((item) => (
                      <InboxRow
                        key={item.id}
                        item={item}
                        now={now}
                        onOpen={(value) => openSelection({ kind: 'inbox', value })}
                      />
                    ))}
                  </ul>
                )}
                {inboxHiddenCount > 0 && (
                  <button
                    type="button"
                    className="m-panel__more"
                    onClick={() => setShowAllInbox((value) => !value)}
                    aria-expanded={showAllInbox}
                  >
                    {showAllInbox ? '收起' : `展开全部 ${unprocessed.length} 条`}
                  </button>
                )}
              </section>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <nav className="m-tabbar" aria-label="手机导航">
        <button
          type="button"
          className={tab === 'lookup' ? 'm-tab is-active' : 'm-tab'}
          onClick={() => switchTab('lookup')}
          aria-current={tab === 'lookup' ? 'page' : undefined}
        >
          <BookOpen size={17} strokeWidth={1.8} aria-hidden />
          <span>查阅</span>
        </button>
        <button
          type="button"
          className={tab === 'record' ? 'm-tab is-active' : 'm-tab'}
          onClick={() => switchTab('record')}
          aria-current={tab === 'record' ? 'page' : undefined}
        >
          <PenLine size={17} strokeWidth={1.8} aria-hidden />
          <span>记录</span>
        </button>
      </nav>

      <AnimatePresence>
        {selection !== null && (
          <motion.button
            key="sheet-scrim"
            type="button"
            className="m-sheet-scrim"
            aria-label="关闭"
            onClick={closeSheet}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce === true ? 0.01 : 0.2 }}
          />
        )}
        {selection !== null && (
          <DetailSheet
            key="sheet"
            selection={selection}
            now={now}
            reduce={reduce === true}
            closeRef={closeRef}
            onClose={closeSheet}
            onToggleTask={toggleTask}
          />
        )}
      </AnimatePresence>

      {selection !== null && (
        <span className="m-sr-only" aria-live="polite">
          已打开 {DETAIL_KIND_LABEL[selection.kind]}详情
        </span>
      )}
    </div>
  )
}
