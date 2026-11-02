// KERNEL · AppLayout（GitHub 式壳：全局顶栏 + 分组侧栏 + 内容容器）
import { Suspense, useEffect, useRef } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'motion/react'
import { Skeleton } from '@/components/Skeleton'
import { AppHeader } from '@/components/shell/AppHeader'
import { RoutePageHeader } from '@/components/shell/PageHeader'
import { CommandPalette } from '@/components/CommandPalette'
import { usePalette } from '@/context/PaletteContext'
import { navByPath } from '@/lib/nav'
import { hydrateFromServer } from '@/lib/mutations'
import { useOrganizeScheduler } from '@/lib/organize'
import { useReviewScheduler } from '@/lib/review'
import { useRouteScrollMemory } from '@/lib/scroll'
import { useGhSurfaceEffects } from '@/lib/ghSurface'
import { DUR, EASE_ENTER } from '@/lib/motion'

function rootNav(pathname: string) {
  const first = pathname.split('/').filter(Boolean)[0]
  return navByPath(first === undefined ? '/' : `/${first}`)
}

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { toggle: togglePalette } = usePalette()
  const reduce = useReducedMotion()
  const captureTimerRef = useRef<number | null>(null)
  const isDetail = location.pathname.split('/').filter(Boolean).length > 1

  useRouteScrollMemory()
  useGhSurfaceEffects()
  useOrganizeScheduler()
  useReviewScheduler()

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
      if (
        !typing &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.repeat &&
        event.key.toLowerCase() === 'c'
      ) {
        if (document.querySelector('[role="dialog"][aria-modal="true"]') !== null) return
        navigate('/inbox', { viewTransition: true })
        if (captureTimerRef.current !== null) window.clearTimeout(captureTimerRef.current)
        captureTimerRef.current = window.setTimeout(() => {
          captureTimerRef.current = null
          window.dispatchEvent(new Event('kernel:focus-capture'))
        }, 90)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (captureTimerRef.current !== null) {
        window.clearTimeout(captureTimerRef.current)
        captureTimerRef.current = null
      }
    }
  }, [togglePalette, navigate])

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

  useEffect(() => {
    const nav = rootNav(location.pathname)
    document.title = nav !== undefined ? `KERNEL · ${nav.cn}` : 'KERNEL'
    try {
      if (location.pathname !== '/') localStorage.setItem('kernel.lastRoute', location.pathname + location.search)
    } catch {
      /* 忽略 */
    }
  }, [location.pathname])

  return (
    <div className="k-app gh-app">
      <AppHeader onOpenMenu={() => navigate('/')} onOpenPalette={togglePalette} />
      <main className="gh-main">
        <div className="gh-container">
          {!isDetail && <RoutePageHeader pathname={location.pathname} />}
          <motion.div
            key={location.pathname}
            className="gh-route"
            initial={reduce === true ? { opacity: 0 } : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: DUR.fast, ease: EASE_ENTER }}
          >
            <Suspense fallback={<Skeleton lines={4} />}>
              <Outlet />
            </Suspense>
          </motion.div>
        </div>
      </main>
      <CommandPalette />
    </div>
  )
}
