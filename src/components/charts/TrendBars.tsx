// KERNEL · TrendBars（单色柱，入场纵向展开）
import { motion, useReducedMotion } from 'motion/react'
import { EASE_ENTER, STAGGER } from '@/lib/motion'

interface TrendBarsProps {
  data: Array<{ label: string; value: number }>
  height?: number
  unit?: string
}

export function TrendBars({ data, height = 140, unit = '' }: TrendBarsProps) {
  const reduce = useReducedMotion()
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="k-trend" style={{ height }} role="img" aria-label="趋势柱状图">
      {data.map((item, i) => (
        <div className="k-trend__col" key={item.label}>
          <span className="k-trend__value u-label">
            {item.value}
            {unit}
          </span>
          <motion.div
            className={item.value === 0 ? 'k-trend__bar is-empty' : 'k-trend__bar'}
            style={{ height: `${Math.max(2, (item.value / max) * 100)}%` }}
            initial={reduce === true ? false : { scaleY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 0.4, ease: EASE_ENTER, delay: i * STAGGER }}
          />
          <span className="k-trend__label u-label">{item.label}</span>
        </div>
      ))}
    </div>
  )
}
