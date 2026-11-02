import { useEffect } from 'react'

const SURFACE_SELECTOR =
  '.gh-card, .gh-btn, .gh-quick, .gh-stat, .gh-tab, .gh-profile-hero'
const TILT_SELECTOR = '.gh-btn, .gh-quick, .gh-stat'

/**
 * 内页表面：指针位置带惯性，灯光 / 边缘光 / 按钮倾斜平滑跟随。
 * 只读 CSS 变量，零 React state；减少动效或粗糙指针时不启用。
 */
export function useGhSurfaceEffects(): void {
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
      if (active === null || rect === null) return
      if (rect.width === 0 || rect.height === 0) return
      const px = (currentX - rect.left) / rect.width
      const py = (currentY - rect.top) / rect.height
      const x = Math.max(0, Math.min(1, px))
      const y = Math.max(0, Math.min(1, py))
      active.style.setProperty('--mx', `${(x * 100).toFixed(2)}%`)
      active.style.setProperty('--my', `${(y * 100).toFixed(2)}%`)
      const x2 = Math.max(0, Math.min(1, (currentX2 - rect.left) / rect.width))
      const y2 = Math.max(0, Math.min(1, (currentY2 - rect.top) / rect.height))
      active.style.setProperty('--mx2', `${(x2 * 100).toFixed(2)}%`)
      active.style.setProperty('--my2', `${(y2 * 100).toFixed(2)}%`)
      if (active.matches(TILT_SELECTOR)) {
        active.style.setProperty('--lry', `${((x - 0.5) * 3.6).toFixed(2)}deg`)
        active.style.setProperty('--lrx', `${((0.5 - y) * 3.6).toFixed(2)}deg`)
      }
      active.style.setProperty('--angle', `${((Math.atan2(y - 0.5, x - 0.5) * 180) / Math.PI + 90).toFixed(1)}deg`)
    }

    const tick = (): void => {
      frame = 0
      if (active === null) return
      currentX += (targetX - currentX) * 0.18
      currentY += (targetY - currentY) * 0.18
      currentX2 += (targetX - currentX2) * 0.07
      currentY2 += (targetY - currentY2) * 0.07
      write()
      if (Math.abs(targetX - currentX) > 0.35 || Math.abs(targetY - currentY) > 0.35) {
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
      const next = target.closest<HTMLElement>(SURFACE_SELECTOR)
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

    document.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    return () => {
      document.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
      reset()
    }
  }, [])
}
