// KERNEL · 日程 CALENDAR：议程流（下一项高亮 + 今天/明天/本周/下周/更远 分组 + 迷你月历）
// Slice W（见 ADR-0018）：日程由只读转为可写——新建（先确认后写入）+ 点击详情（编辑 /
// 删除 / 状态快捷切换）+ 迷你月历日格可点（选中并滚动议程到该日）。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { EventDetailModal } from '@/components/EventDetailModal'
import { EventDraftModal } from '@/components/EventDraftModal'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { getEvents } from '@/lib/data'
import { removeEvent } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { EVENT_STATUS_LABEL } from '@/lib/format'
import {
  addDays,
  daysFromToday,
  endOfWeek,
  formatFullDate,
  formatMonthDay,
  formatTime,
  formatWeekdayShort,
  isSameDay,
  startOfWeek,
  toDate,
  toISODateTime,
} from '@/lib/date'
import { useDataRevision, useNow } from '@/lib/hooks'
import type { CalendarEvent } from '@/types'

/* ---------------------------------------------------------------------------
 * 分组桶规则（以「今天」0 点为基准的日历偏移）
 * · 今天   offset === 0（跨日进行中 offset < 0 也归今天）
 * · 明天   offset === 1
 * · 本周   落在 [startOfWeek(now), endOfWeek(now)] 且 offset ≥ 2
 * · 下周   落在下周同区间（本周起点 +7 天）
 * · 更远   其余未来事件
 * 前置过滤：status !== 'cancelled' 且 end ≥ now（尚未结束），按开始时间升序。
 * ------------------------------------------------------------------------- */
type BucketKey = 'today' | 'tomorrow' | 'thisWeek' | 'nextWeek' | 'later'

interface Bucket {
  key: BucketKey
  label: string
  events: CalendarEvent[]
}

const BUCKET_LABEL: Record<BucketKey, string> = {
  today: '今天',
  tomorrow: '明天',
  thisWeek: '本周',
  nextWeek: '下周',
  later: '更远',
}

const BUCKET_ORDER: BucketKey[] = ['today', 'tomorrow', 'thisWeek', 'nextWeek', 'later']

/** 迷你月历星期表头（周一为一周起点） */
const WEEKDAY_HEADER = ['一', '二', '三', '四', '五', '六', '日']

/** 事件结束时刻（endAt 可选；缺省视作与开始同刻） */
function eventEnd(event: CalendarEvent): string {
  return event.endAt ?? event.startAt
}

/** 事件 → 分组桶 */
function bucketOf(event: CalendarEvent, now: Date): BucketKey {
  const offset = daysFromToday(event.startAt, now)
  if (offset <= 0) return 'today'
  if (offset === 1) return 'tomorrow'
  const start = toDate(event.startAt)
  const weekStart = startOfWeek(now)
  if (start >= weekStart && start <= endOfWeek(now)) return 'thisWeek'
  const nextWeekStart = addDays(weekStart, 7)
  if (start >= nextWeekStart && start <= endOfWeek(nextWeekStart)) return 'nextWeek'
  return 'later'
}

/** 分组头右侧的安静摘要（日期范围 + 场次） */
function groupMeta(bucket: Bucket): string {
  const list = bucket.events
  const count = `${list.length} 场`
  const first = toDate(list[0].startAt)
  if (bucket.key === 'today' || bucket.key === 'tomorrow') {
    return `${formatWeekdayShort(first)} ${formatMonthDay(first)} · ${count}`
  }
  if (bucket.key === 'thisWeek') {
    const last = toDate(list[list.length - 1].startAt)
    const range = isSameDay(first, last)
      ? `${formatWeekdayShort(first)} ${formatMonthDay(first)}`
      : `${formatMonthDay(first)} – ${formatMonthDay(last)}`
    return `${range} · ${count}`
  }
  if (bucket.key === 'nextWeek') {
    const weekStart = startOfWeek(first)
    return `${formatMonthDay(weekStart)} – ${formatMonthDay(endOfWeek(weekStart))} · ${count}`
  }
  return `${formatMonthDay(first)} 起 · ${count}`
}

/** 行内时间：当天写「08:00–09:40」，跨天补星期「周一 15:00–16:00」；无结束则仅开始 */
function rowRange(event: CalendarEvent): string {
  return event.endAt !== undefined
    ? `${formatTime(event.startAt)}–${formatTime(event.endAt)}`
    : formatTime(event.startAt)
}

function rowTime(event: CalendarEvent, now: Date): string {
  return isSameDay(event.startAt, now) ? rowRange(event) : `${formatWeekdayShort(event.startAt)} ${rowRange(event)}`
}

/** 相对日：今天 / 明天 / 周X */
function relativeDay(input: string, now: Date): string {
  const offset = daysFromToday(input, now)
  if (offset <= 0) return '今天'
  if (offset === 1) return '明天'
  return formatWeekdayShort(input)
}

/** 倒计时：<48h「还有 X 小时 Y 分」，否则「还有 N 天」；已开始 = 进行中 */
function countdown(start: Date, now: Date): string {
  const diff = start.getTime() - now.getTime()
  if (diff <= 0) return '进行中'
  const hours = Math.floor(diff / 3_600_000)
  if (hours < 48) {
    const mins = Math.floor((diff % 3_600_000) / 60_000)
    return `还有 ${hours} 小时 ${mins} 分`
  }
  return `还有 ${Math.ceil(diff / 86_400_000)} 天`
}

interface MiniCell {
  key: string
  day?: number
  isToday: boolean
  hasEvent: boolean
}

export function Calendar() {
  const now = useNow()
  const revision = useDataRevision()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [drawerId, setDrawerId] = useState<string | null>(null)
  // 新建弹窗：null = 关闭；否则为预填开始时刻（ISO）
  const [draftStartAt, setDraftStartAt] = useState<string | null>(null)
  // 迷你月历选中日（点击日格；用于高亮 + 预填新建开始时刻）
  const [selectedDay, setSelectedDay] = useState<Date | null>(null)
  const [monthCursor, setMonthCursor] = useState(() => new Date())
  const heroRef = useRef<HTMLElement>(null)
  const todayRef = useRef<HTMLElement>(null)
  // 事件行 DOM 引用（按事件 id）：迷你月历点击后滚动到该日首个事件
  const eventRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  // 深链直达事件抽屉：/calendar?event=e-0003
  useEffect(() => {
    const id = searchParams.get('event')
    if (id !== null && getEvents().some((event) => event.id === id)) {
      setDrawerId(id)
    }
  }, [searchParams, revision])

  const closeDrawer = (): void => {
    setDrawerId(null)
    if (searchParams.get('event') !== null) {
      setSearchParams({}, { replace: true })
    }
  }

  const scrollToRef = (ref: RefObject<HTMLElement | null>): void => {
    const el = ref.current
    if (el === null) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' })
  }

  /** 未结束（end ≥ now）且未取消的未来事件，按开始时间升序 */
  const upcoming = useMemo(
    () =>
      getEvents()
        .filter((e) => e.status !== 'cancelled' && toDate(eventEnd(e)).getTime() >= now.getTime())
        .sort((a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime()),
    [now, revision],
  )

  const next = upcoming[0]

  const buckets = useMemo(() => {
    const map: Record<BucketKey, CalendarEvent[]> = {
      today: [],
      tomorrow: [],
      thisWeek: [],
      nextWeek: [],
      later: [],
    }
    for (const event of upcoming) map[bucketOf(event, now)].push(event)
    return BUCKET_ORDER.map((key) => ({ key, label: BUCKET_LABEL[key], events: map[key] }))
  }, [upcoming, now])

  /* --- 迷你月历（显示月由 monthCursor 控制） --- */
  const year = monthCursor.getFullYear()
  const month = monthCursor.getMonth()

  const monthEvents = useMemo(
    () =>
      getEvents()
        .filter((e) => {
          if (e.status === 'cancelled') return false
          const d = toDate(e.startAt)
          return d.getFullYear() === year && d.getMonth() === month
        })
        .sort((a, b) => toDate(a.startAt).getTime() - toDate(b.startAt).getTime()),
    [year, month, revision],
  )

  const eventDays = useMemo(
    () => new Set(monthEvents.map((e) => toDate(e.startAt).getDate())),
    [monthEvents],
  )

  const cells = useMemo(() => {
    const first = new Date(year, month, 1)
    const leading = (first.getDay() + 6) % 7 // JS 0=周日 → 周一为首列
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const list: MiniCell[] = []
    for (let i = 0; i < leading; i += 1) {
      list.push({ key: `void-${i}`, isToday: false, hasEvent: false })
    }
    for (let d = 1; d <= daysInMonth; d += 1) {
      list.push({
        key: `d-${d}`,
        day: d,
        isToday: isSameDay(new Date(year, month, d), now),
        hasEvent: eventDays.has(d),
      })
    }
    while (list.length % 7 !== 0) {
      list.push({ key: `tail-${list.length}`, isToday: false, hasEvent: false })
    }
    return list
  }, [year, month, now, eventDays])

  const monthFoot =
    monthEvents.length === 0
      ? '本月暂无安排'
      : `${formatMonthDay(monthEvents[0].startAt)} – ${formatMonthDay(
          monthEvents[monthEvents.length - 1].startAt,
        )}`

  const shiftMonth = (delta: number): void => {
    setSelectedDay(null)
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))
  }

  // 「今天」= 滚到今天分组，无今天分组则回到顶部（下一项卡）
  const goToday = (): void => scrollToRef(todayRef.current !== null ? todayRef : heroRef)
  // 「回到现在」= 滚到下一项卡（顶部锚点）
  const goNow = (): void => scrollToRef(heroRef)

  /** 迷你月历日格点击（F10）：选中该日 + 滚动议程到该日首个未结束事件 */
  const handleDayClick = (day: number): void => {
    const date = new Date(year, month, day)
    setSelectedDay(date)
    const target = upcoming.find((event) => isSameDay(event.startAt, date))
    const el = target !== undefined ? eventRefs.current.get(target.id) : undefined
    if (el === undefined) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }

  /** 新建日程预填开始时刻：选中日 09:00；否则下一整点 */
  const defaultStartForCreate = (): string => {
    if (selectedDay !== null) {
      const d = new Date(selectedDay)
      d.setHours(9, 0, 0, 0)
      return toISODateTime(d)
    }
    const d = new Date(now)
    d.setMinutes(0, 0, 0)
    d.setHours(d.getHours() + 1)
    return toISODateTime(d)
  }

  const handleCreate = (): void => setDraftStartAt(defaultStartForCreate())

  // 创建成功：关闭弹窗 + toast 撤销（删除走回收站，经 event.remove）
  const handleCreated = (event: CalendarEvent): void => {
    setDraftStartAt(null)
    setSelectedDay(null)
    toast(`已创建日程「${event.title}」`, {
      action: {
        label: '撤销',
        onClick: () => {
          void removeEvent(event.id).catch((err) => {
            toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
          })
        },
      },
    })
  }

  return (
    <div className="k-view k-cal-c">
      <div className="k-cal__bar">
        <div className="k-cal-c__meta">
          <span className="k-cal__date">今天 · {formatFullDate(now)}</span>
          <span className="u-label k-muted">
            接下来 {upcoming.length} 场 · 现在 {formatTime(now)}
          </span>
        </div>
        <div className="k-cal__nav">
          <button type="button" className="k-btn" onClick={handleCreate}>
            新建日程
          </button>
          <button type="button" className="k-btn" onClick={goToday}>
            今天
          </button>
          <button type="button" className="k-btn" onClick={goNow}>
            回到现在
          </button>
        </div>
      </div>

      {next !== undefined ? (
        <section ref={heroRef} className="k-cal-c__next">
          <div className="k-cal-c__next-body">
            <span className="k-cal-c__next-kicker u-label">下一项 · NEXT</span>
            <h2 className="k-cal-c__next-title">{next.title}</h2>
            <span className="k-cal-c__next-meta">
              {relativeDay(next.startAt, now)} · {formatFullDate(next.startAt)} ·{' '}
              {rowRange(next)}
              {next.location !== undefined ? ` · ${next.location}` : ''}
            </span>
          </div>
          <div className="k-cal-c__next-side">
            <span className="k-cal-c__count">
              <b>{countdown(toDate(next.startAt), now)}</b>
              <span className="u-label">距开始</span>
            </span>
            <button type="button" className="k-btn" onClick={() => setDrawerId(next.id)}>
              详情
            </button>
          </div>
        </section>
      ) : (
        <p className="k-cal__quiet">接下来没有安排。</p>
      )}

      <div className="k-cal-c__layout">
        <div className="k-cal-c__stream">
          {upcoming.length === 0 ? (
            <EmptyState title="接下来没有安排" hint="空档适合安排深工作或休息。可点「新建日程」添加一场。" />
          ) : (
            buckets.map((bucket) =>
              bucket.events.length === 0 ? null : (
                <section
                  key={bucket.key}
                  ref={bucket.key === 'today' ? todayRef : undefined}
                  className="k-cal-c__group"
                >
                  <div className="k-cal-c__grouphd">
                    <h3>{bucket.label}</h3>
                    <span className="k-mono">{groupMeta(bucket)}</span>
                  </div>
                  {bucket.events.map((event) => (
                    <button
                      type="button"
                      key={event.id}
                      className="k-lib-row"
                      ref={(el) => {
                        if (el !== null) eventRefs.current.set(event.id, el)
                        else eventRefs.current.delete(event.id)
                      }}
                      onClick={() => setDrawerId(event.id)}
                    >
                      <span className="k-lib-row__kind k-mono">{rowTime(event, now)}</span>
                      <span className="k-lib-row__title">{event.title}</span>
                      <span className="k-lib-row__meta">
                        {event.location !== undefined
                          ? event.location
                          : EVENT_STATUS_LABEL[event.status]}
                      </span>
                    </button>
                  ))}
                </section>
              ),
            )
          )}
        </div>

        <aside className="k-cal-c__side">
          <Panel
            title={`${month + 1}月`}
            en={`${year}`}
            actions={
              <>
                <button
                  type="button"
                  className="k-iconbtn"
                  onClick={() => shiftMonth(-1)}
                  aria-label="上个月"
                >
                  <ChevronLeft size={15} strokeWidth={1.5} aria-hidden />
                </button>
                <button
                  type="button"
                  className="k-iconbtn"
                  onClick={() => shiftMonth(1)}
                  aria-label="下个月"
                >
                  <ChevronRight size={15} strokeWidth={1.5} aria-hidden />
                </button>
              </>
            }
          >
            <div className="k-minical" aria-label={`${year}年${month + 1}月`}>
              {WEEKDAY_HEADER.map((dow) => (
                <span key={dow} className="k-minical__dow">
                  {dow}
                </span>
              ))}
              {cells.map((cell) =>
                cell.day === undefined ? (
                  <span key={cell.key} className="k-minical__d is-void" aria-hidden>
                    ·
                  </span>
                ) : (
                  <button
                    type="button"
                    key={cell.key}
                    className={[
                      'k-minical__d',
                      cell.isToday ? 'is-today' : '',
                      cell.hasEvent ? 'is-event' : '',
                      selectedDay !== null && isSameDay(new Date(year, month, cell.day), selectedDay)
                        ? 'is-selected'
                        : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    aria-label={`${month + 1}月${cell.day}日`}
                    aria-pressed={
                      selectedDay !== null && isSameDay(new Date(year, month, cell.day), selectedDay)
                    }
                    onClick={() => handleDayClick(cell.day as number)}
                  >
                    {cell.day}
                  </button>
                ),
              )}
            </div>
            <div className="k-cal-c__legend">
              <span>
                <i className="is-today" />
                今天
              </span>
              <span>
                <i />
                有安排
              </span>
            </div>
          </Panel>

          <section className="k-stat">
            <span className="k-stat__label">本月 · {month + 1} 月安排</span>
            <span className="k-stat__value">
              {monthEvents.length}
              <span className="k-stat__suffix">场</span>
            </span>
            <span className="k-stat__foot">{monthFoot}</span>
          </section>
        </aside>
      </div>

      {/* 日程详情（Slice W）：编辑 / 删除 / 状态快捷切换，由 EventDetailModal 承载 */}
      <EventDetailModal eventId={drawerId} onClose={closeDrawer} />

      {/* 新建日程（先确认后写入，无 AI）：确认前零落盘 */}
      <EventDraftModal
        open={draftStartAt !== null}
        initialStartAt={draftStartAt ?? ''}
        onClose={() => setDraftStartAt(null)}
        onCreated={handleCreated}
      />
    </div>
  )
}
