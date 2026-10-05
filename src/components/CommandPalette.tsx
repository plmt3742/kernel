// KERNEL · CommandPalette（cmdk：导航 / 动作 / 原型标注；墨底纸字反选行）
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Command } from 'cmdk'
import {
  BookOpen,
  CalendarDays,
  CornerDownLeft,
  FileText,
  FolderKanban,
  Footprints,
  Library,
  ListChecks,
  MoonStar,
  Plus,
  Search,
  Sparkles,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { usePalette } from '@/context/PaletteContext'
import { useTheme } from '@/context/ThemeContext'
import { NAV_ITEMS, NAV_GROUP_LABELS } from '@/lib/nav'
import { searchSnapshot, type SearchResult } from '@/lib/data'
import { DUR, EASE_ENTER } from '@/lib/motion'
import { trapTab } from '@/lib/focus'

/** 搜索结果的中文类型标签 */
const SEARCH_KIND_LABEL: Record<SearchResult['kind'], string> = {
  task: '任务',
  note: '笔记',
  resource: '资料',
  event: '日程',
  project: '项目',
  trace: '踪迹',
}

/** 搜索结果的前置图标（与导航口径一致） */
const SEARCH_KIND_ICON: Record<SearchResult['kind'], LucideIcon> = {
  task: ListChecks,
  note: FileText,
  resource: Library,
  event: CalendarDays,
  project: FolderKanban,
  trace: Footprints,
}

/** 分层导航：总览单项（无组标题）+ 四个功能组（组标题与 RailNav 同源） */
const NAV_HOME = NAV_ITEMS.filter((item) => item.group === 'home')
const NAV_SECTIONS = (['action', 'time', 'record', 'system'] as const).map((group) => {
  const { cn, en } = NAV_GROUP_LABELS[group]
  return {
    group,
    label: `${cn} · ${en}`,
    items: NAV_ITEMS.filter((item) => item.group === group),
  }
})

export function CommandPalette() {
  const { open, setOpen } = usePalette()
  const navigate = useNavigate()
  const { theme, setTheme } = useTheme()
  const reduce = useReducedMotion()
  const dialogRef = useRef<HTMLDivElement>(null)
  const setOpenRef = useRef(setOpen)
  setOpenRef.current = setOpen
  // 搜索输入受控：查询串驱动「搜索 · SEARCH」结果组（快照为模块态，渲染时现算即可）
  const [query, setQuery] = useState('')
  // run() 延迟执行动作的一次性计时器：卸载时清理，避免定时器悬浮
  const runTimerRef = useRef<number | null>(null)
  // 打开前最后聚焦的元素——面板自动聚焦会抢走焦点，须在打开前持续记录（M5a 验收修复）
  const prevFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    return () => {
      if (runTimerRef.current !== null) {
        window.clearTimeout(runTimerRef.current)
        runTimerRef.current = null
      }
    }
  }, [])

  // 关闭时清空查询：下次打开回到全新空白面板（与旧版非受控输入行为一致）
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])

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
    if (runTimerRef.current !== null) window.clearTimeout(runTimerRef.current)
    runTimerRef.current = window.setTimeout(() => {
      runTimerRef.current = null
      action()
    }, 20)
  }

  // 空查询不搜索（结果组整体不渲染）；快照为模块态，渲染期调用即可，无需额外订阅
  const searchResults: SearchResult[] = query.trim() === '' ? [] : searchSnapshot(query)

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
                  value={query}
                  onValueChange={setQuery}
                />
                <span className="k-palette__esc u-label">ESC</span>
              </div>

              <Command.List className="k-palette__list">
                <Command.Empty className="k-palette__empty">未找到匹配项</Command.Empty>

                {NAV_HOME.map((item) => {
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

                {NAV_SECTIONS.map((section) => (
                  <Command.Group
                    key={section.group}
                    heading={section.label}
                    className="k-palette__group"
                  >
                    {section.items.map((item) => {
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
                ))}

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
                    value="个人页 个人资料 profile me avatar"
                    onSelect={() => run(() => navigate('/profile', { viewTransition: true }))}
                  >
                    <UserRound size={16} strokeWidth={1.5} aria-hidden />
                    <span>个人页</span>
                    <span className="k-palette__hint u-label">PROFILE</span>
                  </Command.Item>
                  {/* 回收站并入「设置 · 回收站」（ADR-0041 Phase 3）：轨道不再单列，命令面板保留动作入口 */}
                  <Command.Item
                    className="k-palette__item"
                    value="回收站 trash 删除 恢复"
                    onSelect={() => run(() => navigate('/trash', { viewTransition: true }))}
                  >
                    <Trash2 size={16} strokeWidth={1.5} aria-hidden />
                    <span>回收站</span>
                    <span className="k-palette__hint u-label">TRASH</span>
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
                  <Command.Item
                    className="k-palette__item"
                    value="使用指南 guide help 帮助 教程"
                    onSelect={() => run(() => window.open('/guide.html', '_blank', 'noopener'))}
                  >
                    <BookOpen size={16} strokeWidth={1.5} aria-hidden />
                    <span>使用指南</span>
                    <span className="k-palette__hint u-label">GUIDE</span>
                  </Command.Item>
                </Command.Group>

                <Command.Group heading="AI" className="k-palette__group">
                  <Command.Item
                    className="k-palette__item"
                    value="AI 解析 收件箱 inbox parse"
                    onSelect={() => run(() => navigate('/inbox', { viewTransition: true }))}
                  >
                    <Sparkles size={16} strokeWidth={1.5} aria-hidden />
                    <span>AI 解析（收件箱）</span>
                    <span className="k-palette__hint u-label">INBOX</span>
                  </Command.Item>
                </Command.Group>

                {query.trim() !== '' && searchResults.length > 0 && (
                  <Command.Group heading="搜索 · SEARCH" className="k-palette__group">
                    {searchResults.map((result) => {
                      const Icon = SEARCH_KIND_ICON[result.kind]
                      return (
                        <Command.Item
                          key={`${result.kind}-${result.id}`}
                          className="k-palette__item"
                          // value 含原始查询串：正文命中（标题不含关键词）也不会被 cmdk 过滤掉
                          value={`${query} ${result.title} ${result.kind}`}
                          title={result.snippet}
                          onSelect={() =>
                            run(() => navigate(result.deepLink, { viewTransition: true }))
                          }
                        >
                          <Icon size={16} strokeWidth={1.5} aria-hidden />
                          <span>{result.title}</span>
                          <span className="k-palette__hint u-label">
                            {SEARCH_KIND_LABEL[result.kind]}
                          </span>
                        </Command.Item>
                      )
                    })}
                  </Command.Group>
                )}
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
