import { useEffect } from 'react'

/**
 * 开始菜单表面：指针位置带惯性（lerp 0.16），边缘光与轻微 3D 倾斜跟随。
 * 只写 CSS 变量，零 React state；指针离开 / 滚动 / 减少动效时复位。
 */
export function useLaunchSurface(): void {
  useEffect(() => {
    const fine = window.matchMedia('(pointer: fine)').matches
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!fine || reduce) return

    let active: HTMLElement | null = null
    let rect: DOMRect | null = null
    let frame = 0
    let targetX = 0
    let targetY = 0
    let currentX = 0
    let currentY = 0
    let currentX2 = 0
    let currentY2 = 0

    const write = (): void => {
      if (active === null || rect === null || rect.width === 0 || rect.height === 0) return
      const x = Math.min(1, Math.max(0, (currentX - rect.left) / rect.width))
      const y = Math.min(1, Math.max(0, (currentY - rect.top) / rect.height))
      active.style.setProperty('--mx', `${(x * 100).toFixed(2)}%`)
      active.style.setProperty('--my', `${(y * 100).toFixed(2)}%`)
      const x2 = Math.min(1, Math.max(0, (currentX2 - rect.left) / rect.width))
      const y2 = Math.min(1, Math.max(0, (currentY2 - rect.top) / rect.height))
      active.style.setProperty('--mx2', `${(x2 * 100).toFixed(2)}%`)
      active.style.setProperty('--my2', `${(y2 * 100).toFixed(2)}%`)
      active.style.setProperty('--lrx', `${((0.5 - y) * 6).toFixed(2)}deg`)
      active.style.setProperty('--lry', `${((x - 0.5) * 6).toFixed(2)}deg`)
      active.style.setProperty('--angle', `${((Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI + 90).toFixed(1)}deg`)
    }

    const tick = (): void => {
      frame = 0
      if (active === null) return
      currentX += (targetX - currentX) * 0.16
      currentY += (targetY - currentY) * 0.16
      currentX2 += (targetX - currentX2) * 0.07
      currentY2 += (targetY - currentY2) * 0.07
      write()
      const dx = targetX - currentX
      const dy = targetY - currentY
      if (Math.abs(dx) > 0.35 || Math.abs(dy) > 0.35) {
        frame = window.requestAnimationFrame(tick)
      } else {
        currentX = targetX
        currentY = targetY
        currentX2 = targetX
        currentY2 = targetY
        write()
      }
    }

    const start = (): void => {
      if (frame === 0) frame = window.requestAnimationFrame(tick)
    }

    const reset = (): void => {
      if (frame !== 0) {
        window.cancelAnimationFrame(frame)
        frame = 0
      }
      if (active !== null) {
        active.style.removeProperty('--mx')
        active.style.removeProperty('--my')
        active.style.removeProperty('--mx2')
        active.style.removeProperty('--my2')
        active.style.removeProperty('--lrx')
        active.style.removeProperty('--lry')
        active.style.removeProperty('--angle')
      }
      active = null
      rect = null
    }

    const onMove = (event: PointerEvent): void => {
      const target = event.target
      if (!(target instanceof Element)) {
        reset()
        return
      }
      const next = target.closest<HTMLElement>('[data-launch-surface]')
      if (next !== active) {
        reset()
        active = next
        rect = next !== null ? next.getBoundingClientRect() : null
        if (active !== null) {
          targetX = event.clientX
          targetY = event.clientY
          currentX = targetX
          currentY = targetY
          currentX2 = targetX
          currentY2 = targetY
          write()
        }
      }
      if (active === null) return
      targetX = event.clientX
      targetY = event.clientY
      start()
    }

    const onLeave = (): void => reset()
    const onScroll = (): void => reset()

    document.addEventListener('pointermove', onMove)
    window.addEventListener('pointerleave', onLeave)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      document.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('scroll', onScroll)
      reset()
    }
  }, [])
}
