// KERNEL · 日程 CALENDAR：议程流（下一项高亮 + 今天/明天/本周/下周/更远 分组 + 迷你月历）
import { useEffect, useMemo, useRef, useState } from 'react'
import type { RefObject } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { Drawer } from '@/components/Drawer'
import { TagPill } from '@/components/TagPill'
import { EmptyState } from '@/components/EmptyState'
import { Relations } from '@/components/Relations'
import { getAreaById, getEventById, getEvents, getProjectById } from '@/lib/data'
import { EVENT_STATUS_LABEL, tagLabel } from '@/lib/format'
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

/** 行内时间：当天写「08:00–09:40」，跨天补星期「周一 15:00–16:00」 */
function rowTime(event: CalendarEvent, now: Date): string {
  const range = `${formatTime(event.startAt)}–${formatTime(event.endAt)}`
  return isSameDay(event.startAt, now) ? range : `${formatWeekdayShort(event.startAt)} ${range}`
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
  const [searchParams, setSearchParams] = useSearchParams()
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [monthCursor, setMonthCursor] = useState(() => new Date())
  const heroRef = useRef<HTMLElement>(null)
  const todayRef = useRef<HTMLElement>(null)

  // 深链直达事件抽屉：/calendar?event=e-0003
  useEffect(() => {
    const id = searchParams.get('event')
    if (id !== null && getEventById(id) !== undefined) {
      setDrawerId(id)
    }
  }, [searchParams])

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
        .filter((e) => e.status !== 'cancelled' && toDate(e.endAt).getTime() >= now.getTime())
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
    setMonthCursor((prev) => new Date(prev.getFullYear(), prev.getMonth() + delta, 1))
  }

  // 「今天」= 滚到今天分组，无今天分组则回到顶部（下一项卡）
  const goToday = (): void => scrollToRef(todayRef.current !== null ? todayRef : heroRef)
  // 「回到现在」= 滚到下一项卡（顶部锚点）
  const goNow = (): void => scrollToRef(heroRef)

  const selectedEvent = drawerId !== null ? getEventById(drawerId) : undefined

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
              {formatTime(next.startAt)}–{formatTime(next.endAt)}
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
            <EmptyState title="接下来没有安排" hint="空档适合安排深工作或休息。" />
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
                  <span
                    key={cell.key}
                    className={[
                      'k-minical__d',
                      cell.isToday ? 'is-today' : '',
                      cell.hasEvent ? 'is-event' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {cell.day}
                  </span>
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

      <Drawer
        open={selectedEvent !== undefined}
        onClose={closeDrawer}
        kicker={`日程 · ${selectedEvent?.id ?? ''}`}
        title={selectedEvent?.title ?? ''}
      >
        {selectedEvent !== undefined && (
          <div className="k-detail-grid">
            <dl className="k-dl">
              <dt>时间</dt>
              <dd>
                {formatTime(selectedEvent.startAt)}–{formatTime(selectedEvent.endAt)}
              </dd>
              <dt>日期</dt>
              <dd>{formatFullDate(selectedEvent.startAt)}</dd>
              <dt>全天</dt>
              <dd>{selectedEvent.allDay ? '是' : '否'}</dd>
              <dt>地点</dt>
              <dd>{selectedEvent.location ?? '—'}</dd>
              <dt>状态</dt>
              <dd>{EVENT_STATUS_LABEL[selectedEvent.status]}</dd>
              <dt>区域</dt>
              <dd>
                {selectedEvent.areaId !== undefined
                  ? (getAreaById(selectedEvent.areaId)?.title ?? selectedEvent.areaId)
                  : '—'}
              </dd>
              <dt>项目</dt>
              <dd>
                {selectedEvent.projectId !== undefined
                  ? (getProjectById(selectedEvent.projectId)?.title ?? selectedEvent.projectId)
                  : '—'}
              </dd>
            </dl>
            {selectedEvent.tags.length > 0 && (
              <div className="k-detail-block">
                <span className="k-detail-block__label u-label">标签</span>
                <div className="k-hstack">
                  {selectedEvent.tags.map((tag) => (
                    <TagPill key={tag}>{tagLabel(tag)}</TagPill>
                  ))}
                </div>
              </div>
            )}
            <Relations kind="event" id={selectedEvent.id} />
          </div>
        )}
      </Drawer>
    </div>
  )
}
