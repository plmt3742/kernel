// KERNEL · 轻提示（原型态反馈）
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ToastView, type ToastItem } from '@/components/Toast'

interface ToastContextValue {
  toast: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let toastSeq = 0

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (message: string) => {
      const id = `toast-${toastSeq++}`
      setItems((prev) => [...prev.slice(-2), { id, message }])
      window.setTimeout(() => dismiss(id), 3000)
    },
    [dismiss],
  )

  const value = useMemo<ToastContextValue>(() => ({ toast }), [toast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastView items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (ctx === null) throw new Error('useToast 必须在 ToastProvider 内使用')
  return ctx
}
