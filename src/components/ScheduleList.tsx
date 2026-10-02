// KERNEL · ScheduleList（紧凑日程列表：时间 + 标题 + 地点；总览用，替代全高日脊）
import { clsx } from 'clsx'
import type { CalendarEvent } from '@/types'
import { formatTime } from '@/lib/date'

interface ScheduleListProps {
  events: CalendarEvent[]
  now: Date
  onSelect?: (id: string) => void
}

export function ScheduleList({ events, now, onSelect }: ScheduleListProps) {
  const nowMs = now.getTime()
  const nextId = events.find(
    (event) => !event.allDay && new Date(event.startAt).getTime() >= nowMs,
  )?.id

  return (
    <ul className="k-schedule">
      {events.map((event) => (
        <li key={event.id}>
          <button
            type="button"
            className={clsx('k-sched', event.id === nextId && 'is-next')}
            onClick={() => onSelect?.(event.id)}
          >
            <span className="k-sched__time">
              {event.allDay
                ? '全天'
                : `${formatTime(event.startAt)}–${formatTime(event.endAt)}`}
            </span>
            <span className="k-sched__marker">
              <span className="k-sched__dot" aria-hidden />
            </span>
            <span className="k-sched__body">
              <span className="k-sched__title">{event.title}</span>
              {event.location !== undefined && (
                <span className="k-sched__meta">{event.location}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}
