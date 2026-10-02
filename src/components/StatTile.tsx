// KERNEL · StatTile（统一瓦片：大数字 + 中文标签 + 一条安静副行）
import type { ReactNode } from 'react'
import { clsx } from 'clsx'
import { CountUp } from '@/components/CountUp'
import { MeterBar } from '@/components/MeterBar'

interface StatTileProps {
  /** 保留占位：版式重排后瓦片不再重复展示英文标签 */
  en?: string
  label: string
  value: number
  suffix?: ReactNode
  foot?: ReactNode
  accent?: boolean
  meter?: { value: number; max: number; threshold?: number }
}

export function StatTile({ label, value, suffix, foot, accent, meter }: StatTileProps) {
  return (
    <div className={clsx('k-stat', accent && 'k-stat--accent')}>
      <div className="k-stat__value">
        <CountUp value={value} />
        {suffix !== undefined && <span className="k-stat__suffix">{suffix}</span>}
      </div>
      <div className="k-stat__label">{label}</div>
      {foot !== undefined && <div className="k-stat__foot">{foot}</div>}
      {meter !== undefined && (
        <MeterBar value={meter.value} max={meter.max} threshold={meter.threshold} />
      )}
    </div>
  )
}
