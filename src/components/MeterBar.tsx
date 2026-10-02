// KERNEL · MeterBar（存量/限额水平计，超阈转 accent）
import { clsx } from 'clsx'

interface MeterBarProps {
  value: number
  max: number
  threshold?: number
  label?: string
  caption?: string
  suffix?: string
}

export function MeterBar({ value, max, threshold, label, caption, suffix }: MeterBarProps) {
  const safeMax = Math.max(1, max)
  const pct = Math.min(100, (value / safeMax) * 100)
  const over = threshold !== undefined && value > threshold
  return (
    <div className={clsx('k-meter', over && 'is-over')}>
      {(label !== undefined || caption !== undefined) && (
        <div className="k-meter__head u-label">
          <span>{label}</span>
          <span className="k-mono">
            {caption ?? `${value} / ${safeMax}`}
            {suffix !== undefined && ` ${suffix}`}
          </span>
        </div>
      )}
      <div
        className="k-meter__track"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={safeMax}
        aria-label={label ?? '水平计'}
      >
        <div className="k-meter__fill" style={{ width: `${pct}%` }} />
        {threshold !== undefined && (
          <div
            className="k-meter__threshold"
            style={{ left: `${Math.min(100, (threshold / safeMax) * 100)}%` }}
            aria-hidden
          />
        )}
      </div>
    </div>
  )
}
