// KERNEL · AppLayout（GitHub 式壳：全局顶栏 + 分组侧栏 + 内容容器）
import { Suspense, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useOutlet } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'motion/react'
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

type RouteMotionKind = 'forward' | 'back' | 'tab' | 'fade'

const ROUTE_VARIANTS: Record<RouteMotionKind, Variants> = {
  forward: {
    initial: { opacity: 0, x: 24 },
    enter: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -14 },
  },
  back: {
    initial: { opacity: 0, x: -20 },
    enter: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: 18 },
  },
  tab: {
    initial: { opacity: 0, y: 7 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
  },
  fade: {
    initial: { opacity: 0, y: 8 },
    enter: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -5 },
  },
}

const REDUCED_VARIANTS: Variants = {
  initial: { opacity: 0 },
  enter: { opacity: 1 },
  exit: { opacity: 0 },
}

function routeMotionKind(previous: string, next: string): RouteMotionKind {
  const a = previous.split('/').filter(Boolean)
  const b = next.split('/').filter(Boolean)
  if (a.join('/') === b.join('/')) return 'fade'
  const sameRoot = a[0] !== undefined && a[0] === b[0]
  const tab =
    sameRoot &&
    (a[0] === 'inbox' ||
      a[0] === 'settings' ||
      ((a[0] === 'tasks' || a[0] === 'projects') && a.length >= 2 && b.length >= 2))
  if (tab) return 'tab'
  if (b.length > a.length) return 'forward'
  if (b.length < a.length) return 'back'
  return 'fade'
}

export function AppLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { toggle: togglePalette } = usePalette()
  const reduce = useReducedMotion()
  const captureTimerRef = useRef<number | null>(null)
  const previousPathRef = useRef(location.pathname)
  const outlet = useOutlet()
  const motionKind = routeMotionKind(previousPathRef.current, location.pathname)
  const isDetail = location.pathname.split('/').filter(Boolean).length > 1

  useEffect(() => {
    previousPathRef.current = location.pathname
  }, [location.pathname])

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
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              className="gh-route"
              variants={reduce === true ? REDUCED_VARIANTS : ROUTE_VARIANTS[motionKind]}
              initial="initial"
              animate="enter"
              exit="exit"
              transition={{
                duration: reduce === true ? 0.01 : motionKind === 'tab' ? DUR.fast : DUR.base,
                ease: EASE_ENTER,
              }}
              style={{ transformOrigin: 'top center' }}
            >
              <Suspense fallback={<Skeleton lines={4} />}>{outlet}</Suspense>
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <CommandPalette />
    </div>
  )
}
