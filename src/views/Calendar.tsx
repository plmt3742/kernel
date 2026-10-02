// KERNEL · 日程 CALENDAR（P0）：日脊 0–24h + 事件块 + 实时"现在"线 + 周条密度
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { DaySpine } from '@/components/DaySpine'
import { Drawer } from '@/components/Drawer'
import { TagPill } from '@/components/TagPill'
import { EmptyState } from '@/components/EmptyState'
import { getAreaById, getEventById, getProjectById } from '@/lib/data'
import { eventsOnDay } from '@/lib/derive'
import { EVENT_STATUS_LABEL, tagLabel } from '@/lib/format'
import {
  addDays,
  formatFullDate,
  formatTime,
  formatWeekdayShort,
  isSameDay,
  startOfWeek,
} from '@/lib/date'
import { useNow } from '@/lib/hooks'

export function Calendar() {
  const [selected, setSelected] = useState(() => new Date())
  const now = useNow()
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const spineRef = useRef<HTMLDivElement>(null)

  // M4：进入日历自动滚动到"现在"（1440×900 下 NOW 线在首屏折叠之下）
  const scrollToNow = useCallback(() => {
    const el = spineRef.current?.querySelector('.k-spine__now')
    if (!(el instanceof HTMLElement)) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(scrollToNow, 160)
    return () => window.clearTimeout(timer)
  }, [scrollToNow])

  const goNow = (): void => {
    setSelected(new Date())
    window.setTimeout(scrollToNow, 80)
  }

  const dayEvents = eventsOnDay(selected)
  const weekDays = useMemo(() => {
    const start = startOfWeek(selected)
    return Array.from({ length: 7 }, (_, i) => addDays(start, i))
  }, [selected])

  const selectedEvent = drawerId !== null ? getEventById(drawerId) : undefined

  return (
    <div className="k-view">
      <div className="k-cal__bar">
        <span className="k-cal__date">{formatFullDate(selected)}</span>
        <div className="k-cal__nav">
          <button
            type="button"
            className="k-iconbtn"
            onClick={() => setSelected((prev) => addDays(prev, -1))}
            aria-label="前一天"
          >
            <ChevronLeft size={16} strokeWidth={1.5} aria-hidden />
          </button>
          <button type="button" className="k-btn" onClick={goNow}>
            今天
          </button>
          <button type="button" className="k-btn" onClick={scrollToNow}>
            回到现在
          </button>
          <button
            type="button"
            className="k-iconbtn"
            onClick={() => setSelected((prev) => addDays(prev, 1))}
            aria-label="后一天"
          >
            <ChevronRight size={16} strokeWidth={1.5} aria-hidden />
          </button>
        </div>
      </div>

      <div className="k-weekstrip">
        {weekDays.map((day) => {
          const count = eventsOnDay(day).length
          const active = isSameDay(day, selected)
          return (
            <button
              type="button"
              key={day.toISOString()}
              className={[
                'k-weekday',
                active ? 'is-active' : '',
                isSameDay(day, now) ? 'is-today' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => setSelected(day)}
              aria-pressed={active}
            >
              <span className="k-weekday__dow u-label">
                <span>{formatWeekdayShort(day)}</span>
                <span>{day.getDate()}</span>
              </span>
              <span className="k-weekday__blocks">
                {Array.from({ length: Math.min(4, count) }, (_, i) => (
                  <span className="k-weekday__block" key={i} />
                ))}
              </span>
              <span className="k-weekday__density">{count} 项</span>
            </button>
          )
        })}
      </div>

      <div className="k-cal__body">
        <Panel index="01" title="日脊" en="DAY SPINE">
          <div ref={spineRef}>
            {dayEvents.length > 0 ? (
              <DaySpine events={dayEvents} date={selected} now={now} onSelect={setDrawerId} />
            ) : (
              <EmptyState index="01" title="这一天没有安排" hint="空档适合安排深工作或休息。" />
            )}
          </div>
        </Panel>

        <Panel index="02" title="议程" en="AGENDA">
          {dayEvents.length === 0 ? (
            <p className="k-muted">—</p>
          ) : (
            <div className="k-stack">
              {dayEvents.map((event) => (
                <button
                  type="button"
                  key={event.id}
                  className="k-lib-row"
                  onClick={() => setDrawerId(event.id)}
                >
                  <span className="k-lib-row__kind k-mono">{formatTime(event.startAt)}</span>
                  <span className="k-lib-row__title">{event.title}</span>
                  <span className="k-lib-row__meta">
                    {event.location !== undefined ? event.location : EVENT_STATUS_LABEL[event.status]}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Panel>
      </div>

      <Drawer
        open={selectedEvent !== undefined}
        onClose={() => setDrawerId(null)}
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
          </div>
        )}
      </Drawer>
    </div>
  )
}
