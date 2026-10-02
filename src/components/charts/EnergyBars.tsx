// KERNEL · 能量分布（纯单色阶 + 图案区分；强调色不作数据系列 —— P7）
import type { Energy } from '@/types'
import { ENERGY_LABEL } from '@/lib/format'

interface EnergyBarsProps {
  data: Array<{ energy: Energy; value: number }>
}

export function EnergyBars({ data }: EnergyBarsProps) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <div className="k-energy" role="img" aria-label="能量分布">
      {data.map((item) => (
        <div className="k-energy__row" key={item.energy}>
          <span className="u-label k-muted">{ENERGY_LABEL[item.energy]}能</span>
          <div className="k-energy__track">
            <div
              className="k-energy__fill"
              data-energy={item.energy}
              style={{ width: `${(item.value / max) * 100}%` }}
            />
          </div>
          <span className="k-energy__value k-mono">{item.value}</span>
        </div>
      ))}
    </div>
  )
}
