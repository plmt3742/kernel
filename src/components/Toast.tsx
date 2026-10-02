// KERNEL · Toast（克制：左下角、默认 3s 自动消失；支持动作与错误态）
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'
import { clsx } from 'clsx'

export interface ToastAction {
  label: string
  onClick: () => void
}

export type ToastTone = 'normal' | 'error'

export interface ToastItem {
  id: string
  message: string
  action?: ToastAction
  tag?: string
  tone?: ToastTone
}

interface ToastViewProps {
  items: ToastItem[]
  onDismiss: (id: string) => void
}

export function ToastView({ items, onDismiss }: ToastViewProps) {
  return (
    <div className="k-toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((item) => {
          const action = item.action
          return (
            <motion.div
              key={item.id}
              className={clsx('k-toast', item.tone === 'error' && 'is-error')}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              {item.tag !== undefined && <span className="k-toast__tag u-label">{item.tag}</span>}
              <span className="k-toast__msg">{item.message}</span>
              {action !== undefined && (
                <button
                  type="button"
                  className="k-toast__action"
                  onClick={() => {
                    action.onClick()
                    onDismiss(item.id)
                  }}
                >
                  {action.label}
                </button>
              )}
              <button
                type="button"
                className="k-toast__close"
                onClick={() => onDismiss(item.id)}
                aria-label="关闭提示"
              >
                <X size={14} strokeWidth={1.5} aria-hidden />
              </button>
            </motion.div>
          )
        })}
      </AnimatePresence>
    </div>
  )
}
