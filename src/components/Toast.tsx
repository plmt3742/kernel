// KERNEL · Toast（克制：左下角、等宽、3s 自动消失）
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'

export interface ToastItem {
  id: string
  message: string
}

interface ToastViewProps {
  items: ToastItem[]
  onDismiss: (id: string) => void
}

export function ToastView({ items, onDismiss }: ToastViewProps) {
  return (
    <div className="k-toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <motion.div
            key={item.id}
            className="k-toast"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          >
            <span className="k-toast__tag u-label">原型态</span>
            <span className="k-toast__msg">{item.message}</span>
            <button
              type="button"
              className="k-toast__close"
              onClick={() => onDismiss(item.id)}
              aria-label="关闭提示"
            >
              <X size={14} strokeWidth={1.5} aria-hidden />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
