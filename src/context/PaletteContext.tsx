// KERNEL · 命令面板开关状态（Ctrl/Cmd+K）
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

interface PaletteContextValue {
  open: boolean
  setOpen: (open: boolean) => void
  toggle: () => void
}

const PaletteContext = createContext<PaletteContextValue | null>(null)

export function PaletteProvider({ children }: { children: ReactNode }): ReactNode {
  const [open, setOpen] = useState(false)

  const toggle = useCallback(() => setOpen((prev) => !prev), [])

  const value = useMemo<PaletteContextValue>(() => ({ open, setOpen, toggle }), [open, toggle])

  return <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>
}

export function usePalette(): PaletteContextValue {
  const ctx = useContext(PaletteContext)
  if (ctx === null) throw new Error('usePalette 必须在 PaletteProvider 内使用')
  return ctx
}
