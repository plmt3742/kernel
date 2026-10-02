// KERNEL · RailNav（左侧索引轨道；移动端变底部标签栏）
import { Link, useLocation } from 'react-router-dom'
import { clsx } from 'clsx'
import { MoreHorizontal, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NAV_ITEMS } from '@/lib/nav'

interface RailNavProps {
  collapsed: boolean
  onToggle: () => void
  onMore: () => void
}

export function RailNav({ collapsed, onToggle, onMore }: RailNavProps) {
  const location = useLocation()

  return (
    <nav className="k-rail" aria-label="主导航">
      <div className="k-rail__brand">
        <span className="k-rail__mark" aria-hidden>
          K
        </span>
        <span className="k-rail__brandtext">
          <b>KERNEL</b>
          <span className="u-label k-muted">v0.5.0</span>
        </span>
      </div>

      <ul className="k-rail__list">
        {NAV_ITEMS.map((item) => {
          const active = location.pathname === item.path
          const Icon = item.icon
          return (
            <li key={item.path}>
              <Link
                to={item.path}
                viewTransition
                className={clsx('k-rail__item', active && 'is-active')}
                data-secondary={item.secondary === true ? 'true' : undefined}
                aria-current={active ? 'page' : undefined}
                title={`${item.cn} · ${item.en}`}
              >
                <Icon size={19} strokeWidth={1.5} aria-hidden />
                <span className="k-rail__cn">{item.cn}</span>
              </Link>
            </li>
          )
        })}
      </ul>

      <div className="k-rail__foot">
        <button
          type="button"
          className="k-rail__toggle"
          onClick={onToggle}
          aria-label={collapsed ? '展开导航轨道' : '收起导航轨道'}
          aria-pressed={collapsed}
        >
          {collapsed ? (
            <PanelLeftOpen size={16} strokeWidth={1.5} aria-hidden />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.5} aria-hidden />
          )}
          <span className="u-label">{collapsed ? 'EXPAND' : 'COLLAPSE'}</span>
        </button>
      </div>

      <button
        type="button"
        className="k-rail__more"
        onClick={onMore}
        aria-label="更多（打开命令面板）"
      >
        <MoreHorizontal size={18} strokeWidth={1.5} aria-hidden />
        <span className="k-rail__cn">更多</span>
      </button>
    </nav>
  )
}
