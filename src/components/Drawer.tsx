// KERNEL · Drawer（右侧抽屉，240ms 滑入；ESC / 点击遮罩关闭；焦点圈闭 + 还原）
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { DUR, EASE_ENTER, EASE_EXIT } from '@/lib/motion'
import { trapTab } from '@/lib/focus'

interface DrawerProps {
  open: boolean
  onClose: () => void
  kicker?: string
  title: string
  children: ReactNode
  footer?: ReactNode
}

export function Drawer({ open, onClose, kicker, title, children, footer }: DrawerProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onCloseRef.current()
        return
      }
      if (panelRef.current !== null) trapTab(panelRef.current, event)
    }
    window.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => closeRef.current?.focus(), 80)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
      // 关闭后还原焦点到触发元素
      previous?.focus?.()
    }
  }, [open])

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="k-drawer-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.fast }}
            onClick={onClose}
            aria-hidden
          />
          <motion.aside
            ref={panelRef}
            className="k-drawer"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%', transition: { duration: DUR.fast, ease: EASE_EXIT } }}
            transition={{ duration: DUR.base, ease: EASE_ENTER }}
          >
            <header className="k-drawer__head">
              <div>
                {kicker !== undefined && <span className="k-drawer__kicker u-label">{kicker}</span>}
                <h2 className="k-drawer__title">{title}</h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="k-iconbtn"
                onClick={onClose}
                aria-label="关闭抽屉"
              >
                <X size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </header>
            <div className="k-drawer__body">{children}</div>
            {footer !== undefined && <footer className="k-drawer__foot">{footer}</footer>}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
