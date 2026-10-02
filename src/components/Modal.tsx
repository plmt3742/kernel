// KERNEL · Modal（居中弹窗，240ms 淡入 + 微缩放；ESC / 点击遮罩关闭；焦点圈闭 + 还原；打开时锁定页面滚动）
// 视觉取自 public/guide.html 的任务详情演示弹窗；焦点管理与 CommandPalette 一致（trapTab + 关闭还原）。
// Slice K 起，全站所有实体详情（任务 / 项目 / 笔记 / 资料 / 日程）统一由本组件承载，见 ADR-0012。
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { DUR, EASE_ENTER, EASE_EXIT } from '@/lib/motion'
import { trapTab } from '@/lib/focus'

interface ModalProps {
  open: boolean
  onClose: () => void
  kicker?: string
  title: string
  children: ReactNode
  footer?: ReactNode
  /** 追加到面板的类名（如收窄 / 加宽的变体）；样式仍走 token */
  className?: string
}

export function Modal({ open, onClose, kicker, title, children, footer, className }: ModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const reduce = useReducedMotion()
  const titleId = useId()

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
    // 等入场动画开始后把焦点送入弹窗（与命令面板一致）
    const timer = window.setTimeout(() => closeRef.current?.focus(), 80)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
      document.body.style.overflow = previousOverflow
      // 关闭后还原焦点到触发元素
      previous?.focus?.()
    }
  }, [open])

  // Portal 到 body：详情弹窗可能挂在具名容器（如 .k-route 的 container-type: inline-size，
  // 含 layout containment）之下——那会把 position: fixed 的包含块改成该祖先，导致滚动 / 重载时
  // 弹窗不再相对视口居中。挂到 body 后，fixed 语义稳定为视口。
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="k-modal__scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.fast }}
            onClick={onClose}
            aria-hidden
          />
          <motion.div
            ref={panelRef}
            className={className !== undefined ? `k-modal ${className}` : 'k-modal'}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={reduce === true ? { opacity: 0 } : { opacity: 0, scale: 0.985, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              reduce === true
                ? { opacity: 0, transition: { duration: DUR.fast } }
                : {
                    opacity: 0,
                    scale: 0.985,
                    y: 6,
                    transition: { duration: DUR.fast, ease: EASE_EXIT },
                  }
            }
            transition={{ duration: DUR.base, ease: EASE_ENTER }}
          >
            <header className="k-modal__head">
              <div>
                {kicker !== undefined && <span className="k-modal__kicker u-label">{kicker}</span>}
                <h2 className="k-modal__title" id={titleId}>
                  {title}
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="k-iconbtn"
                onClick={onClose}
                aria-label="关闭弹窗"
              >
                <X size={16} strokeWidth={1.5} aria-hidden />
              </button>
            </header>
            <div className="k-modal__body">{children}</div>
            {footer !== undefined && <footer className="k-modal__foot">{footer}</footer>}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}
