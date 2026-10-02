// KERNEL · TrendLine（折线趋势图：面积晕染 + 数据点 + 峰值信号；替代圆头柱形式）
// 所有者 2026-10-02 选型：趋势类图表不使用「大圆角柱」呈现，改用折线形式。
// 纪律：单一墨色数据系列（P7）；强调色仅作峰值信号环，不作数据系列。
import { useId } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { clsx } from 'clsx'
import { DUR, EASE_ENTER } from '@/lib/motion'

interface TrendLineProps {
  data: Array<{ label: string; value: number }>
  height?: number
  unit?: string
  /** 是否显示数据点数值标签（默认 true；总览 sparkline 传 false 隐藏） */
  showValues?: boolean
  /** 是否显示横轴标签（默认 true；总览 sparkline 传 false 隐藏） */
  showAxis?: boolean
  /** 图形无障碍名称（默认「折线趋势图」） */
  ariaLabel?: string
}

/** viewBox 坐标（0 0 1000 100，随容器拉伸；描边以 non-scaling-stroke 保持像素恒定） */
const PAD = 40
const TOP = 82
const BOTTOM = 100

export function TrendLine({
  data,
  height = 120,
  unit = '',
  showValues = true,
  showAxis = true,
  ariaLabel = '折线趋势图',
}: TrendLineProps) {
  const reduce = useReducedMotion()
  const gradientId = `k-line-grad-${useId().replaceAll(':', '')}`
  const max = Math.max(1, ...data.map((d) => d.value))
  const n = data.length
  const xOf = (i: number): number => (n <= 1 ? 500 : PAD + (i * (1000 - PAD * 2)) / (n - 1))
  const yOf = (v: number): number => BOTTOM - (v / max) * (BOTTOM - TOP)

  const points = data.map((d, i) => ({ ...d, x: xOf(i), y: yOf(d.value) }))
  const hasData = points.some((p) => p.value > 0)
  // 峰值信号环：仅当最大值唯一（避免并列时对任意一点误打信号）
  const maxValue = Math.max(...points.map((p) => p.value))
  const peakIndex = points.findIndex((p) => p.value === maxValue)
  const showPeak = hasData && maxValue > 0 && points.filter((p) => p.value === maxValue).length === 1

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const area = `${line} L ${xOf(n - 1)} ${BOTTOM} L ${xOf(0)} ${BOTTOM} Z`

  return (
    <motion.div
      className="k-line"
      style={{ height }}
      initial={reduce === true ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: DUR.slow, ease: EASE_ENTER }}
    >
      <div className="k-line__plot">
        <svg
          className="k-line__svg"
          viewBox="0 0 1000 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--ink)" stopOpacity={0.1} />
              <stop offset="100%" stopColor="var(--ink)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {hasData && <path d={area} fill={`url(#${gradientId})`} />}
          <path className="k-line__stroke" d={line} vectorEffect="non-scaling-stroke" />
          {points.map((p) => (
            <path
              key={`dot-${p.label}`}
              className="k-line__dot"
              d={`M ${p.x} ${p.y} l 0 0.01`}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          {hasData && showPeak && (
            <path
              className="k-line__peak"
              d={`M ${points[peakIndex].x} ${points[peakIndex].y} l 0 0.01`}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {showValues &&
          points.map((p, i) => (
            <span
              key={`val-${p.label}`}
              className={clsx('k-line__value u-label', showPeak && i === peakIndex && 'is-peak')}
              style={{ left: `${p.x / 10}%`, top: `${p.y}%` }}
            >
              {p.value}
              {unit}
            </span>
          ))}
      </div>
      {showAxis && (
        <div className="k-line__axis">
          {points.map((p) => (
            <span
              key={`lab-${p.label}`}
              className="k-line__label u-label"
              style={{ left: `${p.x / 10}%` }}
            >
              {p.label}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  )
}
