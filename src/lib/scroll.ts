// KERNEL · 路由滚动记忆：各页面独立记住浏览位置
// 规则（所有者指定）：切换页面时——有记忆 → 恢复到上次位置；首次进入 → 回到顶部；
// 各页面互不影响。刷新时保留浏览器原生恢复（首挂载不干预）。
import { useEffect, useLayoutEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'

const positions = new Map<string, number>()

/** 某路径是否有已记忆的滚动位置（供页面自定义滚动行为判断，如日历的「进页滚到此刻」） */
export function getSavedScroll(pathname: string): number | undefined {
  return positions.get(pathname)
}

/**
 * 在应用壳调用一次（AppLayout）。
 * - 滚动监听常驻：实时把位置记到「当前页面」名下（用 ref 保证切换瞬间归属正确）；
 * - 路由切换后同步恢复：无记忆回顶；懒加载高度不足时做一次短重试。
 */
export function useRouteScrollMemory(): void {
  const { pathname } = useLocation()
  const currentRef = useRef(pathname)
  const firstRun = useRef(true)

  useEffect(() => {
    const record = (): void => {
      positions.set(currentRef.current, window.scrollY)
    }
    window.addEventListener('scroll', record, { passive: true })
    return () => {
      window.removeEventListener('scroll', record)
    }
  }, [])

  useLayoutEffect(() => {
    currentRef.current = pathname
    // 初次挂载（含刷新）：不干预，让浏览器原生滚动恢复生效
    if (firstRun.current) {
      firstRun.current = false
      return
    }
    const target = positions.get(pathname)
    window.scrollTo(0, target ?? 0)
    if (target === undefined || target === 0) return
    // 目标页若因懒加载/水合首帧高度不足，回滚会被钳制——180ms 后校正一次
    const retry = window.setTimeout(() => {
      if (Math.abs(window.scrollY - target) > 4) window.scrollTo(0, target)
    }, 180)
    return () => {
      window.clearTimeout(retry)
    }
  }, [pathname])
}
