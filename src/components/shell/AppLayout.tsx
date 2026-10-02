// KERNEL · AppLayout（布局路由：RailNav + TopBar + 内容 + StatusBar + 命令面板）
import { Suspense, useEffect, useState } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Skeleton } from '@/components/Skeleton'
import { RailNav } from '@/components/shell/RailNav'
import { TopBar } from '@/components/shell/TopBar'
import { StatusBar } from '@/components/shell/StatusBar'
import { CommandPalette } from '@/components/CommandPalette'
import { usePalette } from '@/context/PaletteContext'
import { navByPath } from '@/lib/nav'
import { hydrateFromServer } from '@/lib/mutations'
import { useRouteScrollMemory } from '@/lib/scroll'
import { DUR, EASE_ENTER } from '@/lib/motion'

function readCollapsed(): boolean {
  try {
    return localStorage.getItem('kernel-rail') === 'collapsed'
  } catch {
    return false
  }
}

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { toggle: togglePalette } = usePalette()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const reduce = useReducedMotion()

  // 路由滚动记忆：各页面独立位置（回访恢复 / 首次回顶）
  useRouteScrollMemory()

  // 全局快捷键：Ctrl/Cmd+K 命令面板；c 捕捉（跳转收件箱并聚焦）
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target !== null &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        togglePalette()
        return
      }
      if (!typing && !event.metaKey && !event.ctrlKey && !event.altKey && event.key.toLowerCase() === 'c') {
        navigate('/inbox', { viewTransition: true })
        window.setTimeout(() => window.dispatchEvent(new Event('kernel:focus-capture')), 90)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [togglePalette, navigate])

  // 轨道折叠持久化 + 同步到 <html>（供 .k-app 之外的浮层如 Toast 跟随轨道宽度）
  useEffect(() => {
    try {
      localStorage.setItem('kernel-rail', collapsed ? 'collapsed' : 'expanded')
    } catch {
      /* 忽略 */
    }
    document.documentElement.setAttribute('data-rail', collapsed ? 'collapsed' : 'expanded')
  }, [collapsed])

  // 数据服务水合（首屏后拉取最新快照）+ 窗口聚焦刷新（多标签页同步）
  useEffect(() => {
    void hydrateFromServer()
    const onFocus = (): void => {
      void hydrateFromServer()
    }
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') void hydrateFromServer()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // 文档标题
  useEffect(() => {
    const nav = navByPath(location.pathname)
    document.title = nav !== undefined ? `KERNEL · ${nav.cn}` : 'KERNEL · 事务内核'
  }, [location.pathname])

  return (
    <div className="k-app" data-rail={collapsed ? 'collapsed' : 'expanded'}>
      <RailNav
        collapsed={collapsed}
        onToggle={() => setCollapsed((prev) => !prev)}
        onMore={togglePalette}
      />
      <div className="k-main">
        <TopBar onOpenPalette={togglePalette} />
        <main className="k-content">
          <motion.div
            key={location.pathname}
            className="k-route"
            initial={reduce === true ? { opacity: 0 } : { opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.fast, ease: EASE_ENTER }}
          >
            <Suspense fallback={<Skeleton lines={4} />}>
              <Outlet />
            </Suspense>
          </motion.div>
        </main>
      </div>
      <StatusBar />
      <CommandPalette />
    </div>
  )
}
