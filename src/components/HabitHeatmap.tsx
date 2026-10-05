// KERNEL · 习惯热力图（v0.5 · 切片 → 视觉重设计）
// 近 N 周贡献式日历：命中=柔强调色信号 · 未命中=安静面 · 未来=留空。
// 左侧一/三/五星期轴给出行结构，顶部月份标签由 derive 按最小列距抑制碰撞；
// 网格 1fr 方格随容器铺满，不再是固定 8px 小格 + 右侧大片空白。
// 纯展示、不可聚焦（无 tab 停靠）；数据经 getHabitHeatWeeks 只读派生，
// 由父级 useDataRevision / useNow 驱动重渲染。
import { clsx } from 'clsx'
import { getHabitHeatWeeks } from '@/lib/derive'

interface HabitHeatmapProps {
  habitId: string
  /** 回看周数（默认 16 周，末列为本周，含今天） */
  weeks?: number
}

/** 行序与列内 days 一致：周一 → 周日；仅标一/三/五，其余留空 */
const WEEKDAY_AXIS = ['一', '', '三', '', '五', '', ''] as const

export function HabitHeatmap({ habitId, weeks = 16 }: HabitHeatmapProps) {
  const columns = getHabitHeatWeeks(habitId, weeks)
  // 最后一个「实际带月份标签」的列：其标签靠右锚定，避免 nowrap 文本从末列右缘溢出容器被裁切
  const lastLabelIndex = columns.reduce(
    (last, week, index) => (week.monthLabel !== undefined ? index : last),
    -1,
  )
  return (
    <div className="k-heat" role="img" aria-label={`习惯热力图 · 近 ${weeks} 周`}>
      <div className="k-heat__months" aria-hidden>
        {columns.map((week, index) => (
          <span
            key={week.start}
            className={clsx('k-heat__month', index === lastLabelIndex && 'is-tail')}
          >
            {week.monthLabel ?? ''}
          </span>
        ))}
      </div>
      <div className="k-heat__axis" aria-hidden>
        {WEEKDAY_AXIS.map((label, index) => (
          <span key={index} className="k-heat__axis-label">
            {label}
          </span>
        ))}
      </div>
      <div className="k-heat__grid" aria-hidden>
        {columns.map((week) => (
          <div key={week.start} className="k-heat__col">
            {week.days.map((day) => (
              <span
                key={day.date}
                className={clsx('k-heat__cell', day.hit && 'is-hit', day.future && 'is-future')}
                title={`${day.date} · ${day.hit ? '已打卡' : '未打卡'}`}
                aria-hidden
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
