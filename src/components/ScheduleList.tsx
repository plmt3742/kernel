// KERNEL · ScheduleList（紧凑日程列表：时间 + 标题 + 地点；总览用，替代全高日脊）
import { clsx } from 'clsx'
import type { CalendarEvent } from '@/types'
import { formatTime } from '@/lib/date'

interface ScheduleListProps {
  events: CalendarEvent[]
  now: Date
  onSelect?: (id: string) => void
  /** 已结束样式：时间列只显示开始时刻，正文补「起–止 · 地点 · 已结束」（总览工作台用） */
  ended?: boolean
}

export function ScheduleList({ events, now, onSelect, ended }: ScheduleListProps) {
  const nowMs = now.getTime()
  const nextId = events.find(
    (event) => !event.allDay && new Date(event.startAt).getTime() >= nowMs,
  )?.id

  return (
    <ul className="k-schedule">
      {events.map((event) => {
        const timeLabel = event.allDay
          ? '全天'
          : ended === true
            ? formatTime(event.startAt)
            : `${formatTime(event.startAt)}–${formatTime(event.endAt)}`
        // 已结束：正文补完整时段与状态；默认（沿用既有调用）：仅地点
        const meta =
          ended === true
            ? [
                event.allDay
                  ? undefined
                  : `${formatTime(event.startAt)}–${formatTime(event.endAt)}`,
                event.location,
                '已结束',
              ]
                .filter((part): part is string => part !== undefined)
                .join(' · ')
            : event.location
        return (
          <li key={event.id}>
            <button
              type="button"
              className={clsx('k-sched', event.id === nextId && 'is-next')}
              onClick={() => onSelect?.(event.id)}
            >
              <span className="k-sched__time">{timeLabel}</span>
              <span className="k-sched__marker">
                <span className="k-sched__dot" aria-hidden />
              </span>
              <span className="k-sched__body">
                <span className="k-sched__title">{event.title}</span>
                {meta !== undefined && <span className="k-sched__meta">{meta}</span>}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
