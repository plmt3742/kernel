// KERNEL · RailNav（左侧索引轨道；移动端变底部标签栏）
import { Fragment, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { clsx } from 'clsx'
import { ChevronDown, MoreHorizontal, PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { NAV_ITEMS, NAV_GROUP_LABELS } from '@/lib/nav'
import { createUiStore, useUiStore } from '@/lib/uiState'

/** 折叠的导航分组（跨刷新持久化；存分组 key，如 'action' / 'time'） */
const navCollapsedStore = createUiStore<string[]>('kernel.ui.nav.v1', [], {
  parse: (raw) =>
    Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : null,
})

interface RailNavProps {
  collapsed: boolean
  onToggle: () => void
  onMore: () => void
}

export function RailNav({ collapsed, onToggle, onMore }: RailNavProps) {
  const location = useLocation()
  const collapsedGroups = useUiStore(navCollapsedStore)

  // 切换某分组折叠态（仅桌面组头可点；'home' 组无组头不参与）
  function toggleGroup(group: string): void {
    navCollapsedStore.set((prev) =>
      prev.includes(group) ? prev.filter((g) => g !== group) : [...prev, group],
    )
  }

  // 进入某页时自动展开其所在分组：当前页永不因折叠而消失
  useEffect(() => {
    const activeItem = NAV_ITEMS.find((item) => item.path === location.pathname)
    if (activeItem === undefined || activeItem.group === 'home') return
    const activeGroup = activeItem.group
    navCollapsedStore.set((prev) =>
      prev.includes(activeGroup) ? prev.filter((g) => g !== activeGroup) : prev,
    )
  }, [location.pathname])

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
        {NAV_ITEMS.map((item, i) => {
          const active = location.pathname === item.path
          const Icon = item.icon
          const prevGroup = i > 0 ? NAV_ITEMS[i - 1].group : null
          const isCollapsed = item.group !== 'home' && collapsedGroups.includes(item.group)
          // 仅在每组首项前渲染一次组标题（总览组不渲染，'home' 组无标题）
          const headLabel =
            item.group !== 'home' && prevGroup !== item.group
              ? NAV_GROUP_LABELS[item.group]
              : null
          return (
            <Fragment key={item.path}>
              {headLabel !== null && (
                <li className="k-rail__grouphead">
                  <button
                    type="button"
                    className="k-rail__grouphead-btn"
                    aria-expanded={!isCollapsed}
                    aria-label={`${headLabel.cn} ${headLabel.en}（${isCollapsed ? '已折叠' : '已展开'}）`}
                    onClick={() => toggleGroup(item.group)}
                  >
                    <span className="k-rail__grouphead-line">
                      <ChevronDown
                        size={11}
                        strokeWidth={2}
                        aria-hidden
                        className={clsx('k-rail__grouphead-chev', isCollapsed && 'is-collapsed')}
                      />
                      <span className="k-rail__grouphead-cn">{headLabel.cn}</span>
                    </span>
                    <span className="k-rail__grouphead-en">{headLabel.en}</span>
                  </button>
                </li>
              )}
              <li
                data-mobile={item.mobile === true ? 'true' : 'false'}
                data-collapsed={isCollapsed ? 'true' : undefined}
              >
                <Link
                  to={item.path}
                  viewTransition
                  className={clsx('k-rail__item', active && 'is-active')}
                  aria-current={active ? 'page' : undefined}
                  title={`${item.cn} · ${item.en}`}
                >
                  <Icon size={19} strokeWidth={1.5} aria-hidden />
                  <span className="k-rail__cn">{item.cn}</span>
                </Link>
              </li>
            </Fragment>
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
