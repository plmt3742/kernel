import { useId } from 'react'
import type { ActivityDay } from '@/components/ActivityCalendar'

/** 七日活跃 sparkline：趋势用线，不用七根柱子。 */
export function ActivitySparkline({ days }: { days: ActivityDay[] }) {
  const rawId = useId()
  const gradientId = `spark-${rawId.replace(/[^a-zA-Z0-9_-]/g, '')}`
  if (days.length === 0) return null

  const width = 240
  const height = 84
  const padX = 8
  const padTop = 8
  const baseline = 76
  const max = Math.max(1, ...days.map((day) => day.count))
  const step = days.length > 1 ? (width - padX * 2) / (days.length - 1) : 0
  const points = days.map((day, index) => {
    const x = padX + index * step
    const y = baseline - (day.count / max) * (baseline - padTop - 8)
    return { x, y, day }
  })
  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x.toFixed(2)},${point.y.toFixed(2)}`)
    .join(' ')
  const area = `${line} L${(padX + (days.length - 1) * step).toFixed(2)},${baseline} L${padX},${baseline} Z`
  const today = points[points.length - 1]

  return (
    <svg
      className="gh-spark"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label="近七天活跃趋势"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="rgb(205 187 255)" stopOpacity="0.32" />
          <stop offset="1" stopColor="rgb(205 187 255)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <line x1={padX} y1={baseline} x2={width - padX} y2={baseline} className="gh-spark__axis" />
      <path d={area} fill={`url(#${gradientId})`} />
      <path d={line} className="gh-spark__line" />
      {points.map((point) => (
        <circle key={point.day.date} cx={point.x} cy={point.y} r="2.2" className="gh-spark__dot">
          <title>{`${point.day.date} · ${point.day.count} 次`}</title>
        </circle>
      ))}
      {today !== undefined && (
        <circle cx={today.x} cy={today.y} r="4.2" className="gh-spark__today">
          <title>{`今天 · ${today.day.count} 次`}</title>
        </circle>
      )}
    </svg>
  )
}
