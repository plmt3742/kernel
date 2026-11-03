import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Check,
  ChevronRight,
  ImagePlus,
  Inbox,
  LayoutGrid,
  Plus,
  Sun,
  X,
} from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { useDataRevision, useNow, useUndoableToggle } from '@/lib/hooks'
import { captureInbox, hydrateFromServer, removeInbox, uploadInboxFile } from '@/lib/mutations'
import { getInbox, getProjectById, getSnapshot, getTodayEvents } from '@/lib/data'
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
import type { CalendarEvent, InboxItem, Task } from '@/types'

type Tab = 'today' | 'record'
type DueTask = Task & { dueAt: string }

const hasDue = (task: Task): task is DueTask => task.dueAt !== undefined

function timeOf(iso: string): string {
  return formatTime(iso)
}

function InboxLine({ item, now }: { item: InboxItem; now: Date }) {
  const title = item.file !== undefined ? item.file.name : item.content
  return (
    <li className="m-inbox-item">
      <span className="m-inbox-item__dot" aria-hidden />
      <div className="m-inbox-item__body">
        <p className="m-inbox-item__title">{title}</p>
        <p className="m-inbox-item__meta">
          待整理 · {humanizeDay(item.capturedAt, now)} {timeOf(item.capturedAt)}
        </p>
      </div>
    </li>
  )
}

export function MobileHome() {
  useDataRevision()
  const now = useNow(30_000)
  const reduce = useReducedMotion()
  const { toast } = useToast()
  const toggleTask = useUndoableToggle()
  const [tab, setTab] = useState<Tab>('today')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [fileBusy, setFileBusy] = useState(false)
  const [focusDraft, setFocusDraft] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null)
  const draftRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    void hydrateFromServer()
  }, [])

  useEffect(() => {
    document.title = 'KERNEL · 今天'
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

  const sheetOpen = selectedTask !== null || selectedEvent !== null
  useEffect(() => {
    if (!sheetOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timer = window.setTimeout(() => closeRef.current?.focus(), 30)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setSelectedTask(null)
        setSelectedEvent(null)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.clearTimeout(timer)
      document.removeEventListener('keydown', onKey)
    }
  }, [sheetOpen])

  const openRecord = (): void => {
    setTab('record')
    setFocusDraft(true)
  }

  const closeSheet = (): void => {
    setSelectedTask(null)
    setSelectedEvent(null)
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
  const todayTasks = [...dueToday, ...overdue]
  const visibleTodayTasks = todayTasks.slice(0, 5)
  const hiddenTodayTasks = Math.max(0, todayTasks.length - visibleTodayTasks.length)
  const todayEvents = getTodayEvents(now)
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
  const visibleUpcoming = upcoming.slice(0, 4)
  const hiddenUpcoming = Math.max(0, upcoming.length - visibleUpcoming.length)
  const recent = getInbox()
    .filter((item) => item.status === 'unprocessed')
    .sort((a, b) => toDate(b.capturedAt).getTime() - toDate(a.capturedAt).getTime())
    .slice(0, 6)
  const todayCount = todayTasks.length + todayEvents.length

  const taskDue = (task: DueTask): string => {
    const overdue = toDate(task.dueAt).getTime() < now.getTime()
    return `${overdue ? '已逾期 · ' : ''}${humanizeDay(task.dueAt, now)} ${timeOf(task.dueAt)}`
  }

  const projectTitle = (task: Task): string | undefined => {
    if (task.projectId === undefined) return undefined
    return getProjectById(task.projectId)?.title
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

  const tabMotion = reduce === true
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 } }
  const sheetMotion = reduce === true
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }

  return (
    <div className="m-app">
      <header className="m-header">
        <Link to="/?desktop=1" className="m-brand" aria-label="KERNEL 完整版">
          <span className="m-brand__mark" aria-hidden>
            K
          </span>
          <span className="m-brand__name">KERNEL</span>
        </Link>
        <Link to="/?desktop=1" className="m-header__desktop">
          <LayoutGrid size={16} strokeWidth={1.8} aria-hidden />
          完整版
        </Link>
      </header>

      <main className="m-main">
        <AnimatePresence mode="wait" initial={false}>
          {tab === 'today' ? (
            <motion.div key="today" {...tabMotion} transition={{ duration: reduce === true ? 0.01 : 0.2 }}>
              <div className="m-pagehead">
                <p className="m-kicker">
                  {formatMonthDay(now)} · {formatWeekdayShort(now)}
                </p>
                <h1 className="m-title">今天</h1>
                <p className="m-sub">
                  {todayCount === 0
                    ? '今天还没有安排。'
                    : todayCount > 8
                      ? '先看最靠前的几件。'
                      : `${todayCount} 件要处理的事。`}
                </p>
              </div>

              <button type="button" className="m-quickadd" onClick={openRecord}>
                <Plus size={17} strokeWidth={1.9} aria-hidden />
                记一件事
                <span>放进收件箱</span>
              </button>

              {todayCount === 0 ? (
                <div className="m-empty">
                  <b>今天空着。</b>
                  <span>先记一件事，或去完整版看看项目。</span>
                </div>
              ) : (
                <>
                  {todayEvents.length > 0 && (
                    <section className="m-section" aria-labelledby="m-events-title">
                      <div className="m-section__head">
                        <h2 id="m-events-title">日程</h2>
                        <span>{todayEvents.length}</span>
                      </div>
                      <ul className="m-list">
                        {todayEvents.map((event) => (
                          <li key={event.id}>
                            <button
                              type="button"
                              className="m-event"
                              onClick={() => setSelectedEvent(event)}
                            >
                              <span className="m-event__time">
                                {event.allDay ? '全天' : timeOf(event.startAt)}
                              </span>
                              <span className="m-event__body">
                                <span className="m-event__title">{event.title}</span>
                                <span className="m-event__meta">
                                  {[event.location, event.endAt !== undefined ? `至 ${timeOf(event.endAt)}` : '']
                                    .filter(Boolean)
                                    .join(' · ') || '日程'}
                                </span>
                              </span>
                              <ChevronRight size={15} strokeWidth={1.7} aria-hidden />
                            </button>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {todayTasks.length > 0 && (
                    <section className="m-section" aria-labelledby="m-tasks-title">
                      <div className="m-section__head">
                        <h2 id="m-tasks-title">任务</h2>
                        <span>{todayTasks.length}</span>
                      </div>
                      <ul className="m-list">
                        {visibleTodayTasks.map((task) => (
                          <li key={task.id} className="m-task">
                            <button
                              type="button"
                              className="m-check"
                              aria-label={`完成：${task.title}`}
                              onClick={() => toggleTask(task)}
                            >
                              <Check size={13} strokeWidth={2.2} aria-hidden />
                            </button>
                            <button
                              type="button"
                              className="m-task__body"
                              onClick={() => setSelectedTask(task)}
                            >
                              <span className="m-task__title">{task.title}</span>
                              <span
                                className={
                                  toDate(task.dueAt).getTime() < now.getTime()
                                    ? 'm-task__meta is-overdue'
                                    : 'm-task__meta'
                                }
                              >
                                {taskDue(task)}
                                {projectTitle(task) !== undefined ? ` · ${projectTitle(task)}` : ''}
                              </span>
                            </button>
                            <ChevronRight size={15} strokeWidth={1.7} aria-hidden />
                          </li>
                        ))}
                      </ul>
                      {hiddenTodayTasks > 0 && (
                        <p className="m-more">
                          还有 {hiddenTodayTasks} 项 · <Link to="/tasks">完整版查看</Link>
                        </p>
                      )}
                    </section>
                  )}
                </>
              )}

              {upcoming.length > 0 && (
                <section className="m-section" aria-labelledby="m-upcoming-title">
                  <div className="m-section__head">
                    <h2 id="m-upcoming-title">接下来</h2>
                    <span>7 天</span>
                  </div>
                  {visibleUpcoming.map((group) => {
                    const events = group.events.slice(0, 2)
                    const tasks = group.tasks.slice(0, 2)
                    const hidden = group.events.length - events.length + group.tasks.length - tasks.length
                    return (
                      <div className="m-day" key={group.day.toISOString()}>
                        <div className="m-day__head">
                          <span>{humanizeDay(group.day, now)}</span>
                          <span>
                            {formatMonthDay(group.day)} · {formatWeekdayShort(group.day)}
                          </span>
                        </div>
                        <ul className="m-list">
                          {events.map((event) => (
                            <li key={event.id}>
                              <button
                                type="button"
                                className="m-event"
                                onClick={() => setSelectedEvent(event)}
                              >
                                <span className="m-event__time">
                                  {event.allDay ? '全天' : timeOf(event.startAt)}
                                </span>
                                <span className="m-event__body">
                                  <span className="m-event__title">{event.title}</span>
                                  <span className="m-event__meta">{event.location ?? '日程'}</span>
                                </span>
                                <ChevronRight size={15} strokeWidth={1.7} aria-hidden />
                              </button>
                            </li>
                          ))}
                          {tasks.map((task) => (
                            <li key={task.id} className="m-task">
                              <button
                                type="button"
                                className="m-check"
                                aria-label={`完成：${task.title}`}
                                onClick={() => toggleTask(task)}
                              >
                                <Check size={13} strokeWidth={2.2} aria-hidden />
                              </button>
                              <button
                                type="button"
                                className="m-task__body"
                                onClick={() => setSelectedTask(task)}
                              >
                                <span className="m-task__title">{task.title}</span>
                                <span className="m-task__meta">{taskDue(task)}</span>
                              </button>
                              <ChevronRight size={15} strokeWidth={1.7} aria-hidden />
                            </li>
                          ))}
                        </ul>
                        {hidden > 0 && (
                          <p className="m-more">
                            还有 {hidden} 项 · <Link to="/tasks">完整版查看</Link>
                          </p>
                        )}
                      </div>
                    )
                  })}
                  {hiddenUpcoming > 0 && (
                    <p className="m-more">
                      还有 {hiddenUpcoming} 天 · <Link to="/tasks">完整版查看</Link>
                    </p>
                  )}
                </section>
              )}

              <p className="m-pagefoot">
                <Link to="/?desktop=1">打开完整版</Link>
              </p>
            </motion.div>
          ) : (
            <motion.div key="record" {...tabMotion} transition={{ duration: reduce === true ? 0.01 : 0.2 }}>
              <div className="m-pagehead">
                <p className="m-kicker">CAPTURE / 记录</p>
                <h1 className="m-title">记录</h1>
                <p className="m-sub">先收进来，整理可以晚点做。</p>
              </div>

              <section className="m-capture" aria-label="记录一件事">
                <textarea
                  ref={draftRef}
                  rows={2}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="记一件事…"
                  aria-label="记录内容"
                />
                <div className="m-capture__actions">
                  <button
                    type="button"
                    className="m-iconbtn"
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
                    className="m-send"
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

              <section className="m-section" aria-labelledby="m-inbox-title">
                <div className="m-section__head">
                  <h2 id="m-inbox-title">待整理</h2>
                  <span>{recent.length}</span>
                </div>
                {recent.length === 0 ? (
                  <div className="m-empty m-empty--small">
                    <span>收件箱是空的。刚记下的东西会出现在这里。</span>
                  </div>
                ) : (
                  <ul className="m-list">
                    {recent.map((item) => (
                      <InboxLine key={item.id} item={item} now={now} />
                    ))}
                  </ul>
                )}
              </section>

              <p className="m-pagefoot">
                整理、分类和 AI 解析在完整版里。<Link to="/inbox">去收件箱</Link>
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <nav className="m-tabbar" aria-label="手机导航">
        <button
          type="button"
          className={tab === 'today' ? 'm-tab is-active' : 'm-tab'}
          onClick={() => setTab('today')}
          aria-current={tab === 'today' ? 'page' : undefined}
        >
          <Sun size={19} strokeWidth={1.8} aria-hidden />
          <span>今天</span>
        </button>
        <button
          type="button"
          className={tab === 'record' ? 'm-tab is-active' : 'm-tab'}
          onClick={() => setTab('record')}
          aria-current={tab === 'record' ? 'page' : undefined}
        >
          <Inbox size={19} strokeWidth={1.8} aria-hidden />
          <span>记录</span>
        </button>
      </nav>

      <AnimatePresence>
        {sheetOpen && (
          <>
            <motion.button
              type="button"
              className="m-sheet-scrim"
              aria-label="关闭"
              onClick={closeSheet}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduce === true ? 0.01 : 0.2 }}
            />
            <motion.section
              className="m-sheet"
              role="dialog"
              aria-modal="true"
              aria-labelledby="m-sheet-title"
              {...sheetMotion}
              transition={{ duration: reduce === true ? 0.01 : 0.28, ease: [0.16, 1, 0.3, 1] }}
            >
              <span className="m-sheet__handle" aria-hidden />
              <div className="m-sheet__head">
                <span className="m-sheet__kicker">
                  {selectedTask !== null ? '任务' : '日程'}
                </span>
                <button
                  ref={closeRef}
                  type="button"
                  className="m-sheet__close"
                  onClick={closeSheet}
                  aria-label="关闭详情"
                >
                  <X size={18} strokeWidth={1.9} aria-hidden />
                </button>
              </div>

              {selectedTask !== null ? (
                <>
                  <h2 className="m-sheet__title" id="m-sheet-title">
                    {selectedTask.title}
                  </h2>
                  <p className="m-sheet__meta">
                    {selectedTask.dueAt !== undefined
                      ? `${humanizeDay(selectedTask.dueAt, now)} ${timeOf(selectedTask.dueAt)}`
                      : '没有截止时间'}
                    {projectTitle(selectedTask) !== undefined
                      ? ` · ${projectTitle(selectedTask)}`
                      : ''}
                  </p>
                  {selectedTask.notes !== undefined && selectedTask.notes !== '' && (
                    <p className="m-sheet__notes">{selectedTask.notes}</p>
                  )}
                  <button
                    type="button"
                    className="m-sheet__primary"
                    onClick={() => {
                      toggleTask(selectedTask)
                      closeSheet()
                    }}
                  >
                    <Check size={16} strokeWidth={2.1} aria-hidden />
                    标记完成
                  </button>
                </>
              ) : selectedEvent !== null ? (
                <>
                  <h2 className="m-sheet__title" id="m-sheet-title">
                    {selectedEvent.title}
                  </h2>
                  <p className="m-sheet__meta">
                    {formatMonthDay(selectedEvent.startAt)} ·{' '}
                    {selectedEvent.allDay ? '全天' : timeOf(selectedEvent.startAt)}
                    {selectedEvent.endAt !== undefined && !selectedEvent.allDay
                      ? ` 至 ${timeOf(selectedEvent.endAt)}`
                      : ''}
                    {selectedEvent.location !== undefined ? ` · ${selectedEvent.location}` : ''}
                  </p>
                  {selectedEvent.notes !== undefined && selectedEvent.notes !== '' && (
                    <p className="m-sheet__notes">{selectedEvent.notes}</p>
                  )}
                  <button type="button" className="m-sheet__secondary" onClick={closeSheet}>
                    关闭
                  </button>
                </>
              ) : null}
            </motion.section>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
