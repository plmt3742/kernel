// KERNEL · DaySpine（垂直日脊：0–24h + 事件块 + 实时"现在"线）
import type { CalendarEvent } from '@/types'
import { EVENT_STATUS_LABEL } from '@/lib/format'
import { formatTime, isSameDay } from '@/lib/date'
import { layoutOverlaps, minutesOfDay } from '@/lib/derive'

interface DaySpineProps {
  events: CalendarEvent[]
  date: Date
  now: Date
  onSelect?: (id: string) => void
}

export function DaySpine({ events, date, now, onSelect }: DaySpineProps) {
  const allDay = events.filter((event) => event.allDay)
  const timed = events.filter((event) => !event.allDay)
  const laid = layoutOverlaps(timed)
  const showNow = isSameDay(date, now)
  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    <div className="k-spine">
      {allDay.length > 0 && (
        <div className="k-allday">
          {allDay.map((event) => (
            <button
              type="button"
              className="k-spine__event is-all-day"
              key={event.id}
              onClick={() => onSelect?.(event.id)}
            >
              <span className="k-spine__event-title">{event.title}</span>
              <span className="k-spine__event-meta">
                全天 · {EVENT_STATUS_LABEL[event.status]}
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="k-spine__body">
        {hours.map((hour) => (
          <div className="k-spine__hour" key={hour} style={{ top: `${(hour / 24) * 100}%` }}>
            <span className="k-spine__hourline" aria-hidden />
            <span className="k-spine__hourlabel">{String(hour).padStart(2, '0')}:00</span>
          </div>
        ))}
        {laid.map(({ event, col, cols }) => {
          const top = (minutesOfDay(event.startAt) / 1440) * 100
          const bottom = (minutesOfDay(event.endAt) / 1440) * 100
          const height = Math.max(1.2, bottom - top)
          const left = (col / cols) * 100
          const width = 100 / cols
          return (
            <button
              type="button"
              className="k-spine__event"
              key={event.id}
              onClick={() => onSelect?.(event.id)}
              style={{
                top: `${top}%`,
                height: `${height}%`,
                left: `${left}%`,
                width: `calc(${width}% - 2px)`,
              }}
              title={`${formatTime(event.startAt)}–${formatTime(event.endAt)} ${event.title}`}
            >
              <span className="k-spine__event-title">{event.title}</span>
              <span className="k-spine__event-meta">
                {formatTime(event.startAt)}–{formatTime(event.endAt)}
                {event.location !== undefined ? ` · ${event.location}` : ''}
              </span>
            </button>
          )
        })}
        {showNow && (
          <div
            className="k-spine__now is-breathing"
            style={{ top: `${(minutesOfDay(now) / 1440) * 100}%` }}
          >
            <span className="k-spine__now-label">{formatTime(now)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
