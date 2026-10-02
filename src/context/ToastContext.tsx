// KERNEL · 轻提示（本地写入反馈；支持内嵌动作与错误态）
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ToastView, type ToastAction, type ToastItem, type ToastTone } from '@/components/Toast'

export interface ToastOptions {
  /** 内嵌动作（如撤销）；带动作时默认停留 5s */
  action?: ToastAction
  /** 自定义停留时长（毫秒） */
  durationMs?: number
  /** 顶部小标签（如「错误」）；缺省不渲染 */
  tag?: string
  /** 语气：error 使用危险色描边 */
  tone?: ToastTone
}

interface ToastContextValue {
  toast: (message: string, options?: ToastOptions) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

let toastSeq = 0

const DEFAULT_DURATION_MS = 3000
const ACTION_DURATION_MS = 5000

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [items, setItems] = useState<ToastItem[]>([])

  const dismiss = useCallback((id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, options?: ToastOptions) => {
      const id = `toast-${toastSeq++}`
      const tone = options?.tone ?? 'normal'
      const duration =
        options?.durationMs ??
        (options?.action !== undefined ? ACTION_DURATION_MS : DEFAULT_DURATION_MS)
      const tag = options?.tag ?? (tone === 'error' ? '错误' : undefined)
      setItems((prev) => [...prev.slice(-2), { id, message, action: options?.action, tag, tone }])
      window.setTimeout(() => dismiss(id), duration)
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
