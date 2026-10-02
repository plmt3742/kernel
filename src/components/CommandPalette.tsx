// KERNEL · CommandPalette（cmdk：导航 / 动作 / 原型标注；墨底纸字反选行）
import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Command } from 'cmdk'
import { CornerDownLeft, MoonStar, Plus, Search, Sparkles } from 'lucide-react'
import { usePalette } from '@/context/PaletteContext'
import { useTheme } from '@/context/ThemeContext'
import { useToast } from '@/context/ToastContext'
import { NAV_ITEMS } from '@/lib/nav'
import { DUR, EASE_ENTER } from '@/lib/motion'
import { trapTab } from '@/lib/focus'

export function CommandPalette() {
  const { open, setOpen } = usePalette()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()
  const reduce = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const setOpenRef = useRef(setOpen)
  setOpenRef.current = setOpen
  // 打开前最后聚焦的元素——面板自动聚焦会抢走焦点，须在打开前持续记录（M5a 验收修复）
  const prevFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (open) return
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      // 忽略面板自身（autoFocus 会在监听器卸载前触发）与 body，避免记录错位
      if (target === document.body || target.closest('.k-palette') !== null) return
      prevFocusRef.current = target
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setOpenRef.current(false)
        return
      }
      if (dialogRef.current !== null) trapTab(dialogRef.current, event)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      // 关闭后还原焦点到打开前的触发元素（若仍挂载）
      const target = prevFocusRef.current
      if (target !== null && target.isConnected) target.focus()
    }
  }, [open])

  const run = (action: () => void): void => {
    setOpen(false)
    window.setTimeout(action, 20)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="k-palette__scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.micro }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <motion.div
            ref={dialogRef}
            className="k-palette"
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            initial={reduce === true ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce === true ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: DUR.fast, ease: EASE_ENTER }}
          >
            <Command label="命令面板" loop>
              <div className="k-palette__search">
                <Search size={16} strokeWidth={1.5} className="k-muted" aria-hidden />
                <Command.Input
                  autoFocus
                  className="k-palette__input u-tnum"
                  placeholder="搜索视图、动作…"
                />
                <span className="k-palette__esc u-label">ESC</span>
              </div>

              <Command.List className="k-palette__list">
                <Command.Empty className="k-palette__empty">未找到匹配项</Command.Empty>

                <Command.Group heading="导航 · NAVIGATE" className="k-palette__group">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon
                    return (
                      <Command.Item
                        key={item.path}
                        className="k-palette__item"
                        value={`${item.index} ${item.cn} ${item.en}`}
                        onSelect={() => run(() => navigate(item.path, { viewTransition: true }))}
                      >
                        <Icon size={16} strokeWidth={1.5} aria-hidden />
                        <span>{item.cn}</span>
                        <span className="k-palette__hint u-label">
                          {item.index} · {item.en}
                        </span>
                      </Command.Item>
                    )
                  })}
                </Command.Group>

                <Command.Group heading="动作 · ACTIONS" className="k-palette__group">
                  <Command.Item
                    className="k-palette__item"
                    value="新建任务 new task"
                    onSelect={() => run(() => navigate('/tasks', { viewTransition: true }))}
                  >
                    <Plus size={16} strokeWidth={1.5} aria-hidden />
                    <span>新建任务</span>
                    <span className="k-palette__hint u-label">TASKS</span>
                  </Command.Item>
                  <Command.Item
                    className="k-palette__item"
                    value="收件箱捕捉 capture inbox"
                    onSelect={() => run(() => navigate('/inbox', { viewTransition: true }))}
                  >
                    <CornerDownLeft size={16} strokeWidth={1.5} aria-hidden />
                    <span>收件箱捕捉</span>
                    <span className="k-palette__hint u-label">C</span>
                  </Command.Item>
                  <Command.Item
                    className="k-palette__item"
                    value="切换主题 theme toggle dark light"
                    onSelect={() =>
                      run(() => setTheme(theme === 'dark' ? 'light' : 'dark'))
                    }
                  >
                    <MoonStar size={16} strokeWidth={1.5} aria-hidden />
                    <span>切换主题</span>
                    <span className="k-palette__hint u-label">
                      当前 {theme === 'dark' ? '暗' : '亮'}
                    </span>
                  </Command.Item>
                </Command.Group>

                <Command.Group heading="原型标注 · PROTOTYPE" className="k-palette__group">
                  <Command.Item
                    className="k-palette__item"
                    value="AI 指令 待接入 v0.5"
                    onSelect={() =>
                      run(() => {
                        toast('原型态：AI 集成计划于 v0.5 接入')
                        navigate('/settings', { viewTransition: true })
                      })
                    }
                  >
                    <Sparkles size={16} strokeWidth={1.5} aria-hidden />
                    <span>AI 指令入口</span>
                    <span className="k-palette__hint u-label">待接入 v0.5</span>
                  </Command.Item>
                </Command.Group>
              </Command.List>

              <div className="k-palette__foot u-label">
                <span>↑↓ 导航</span>
                <span className="k-statusbar__sep" />
                <span>↵ 选择</span>
                <span className="k-statusbar__sep" />
                <span>esc 关闭</span>
              </div>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
