// KERNEL · 导航注册表（一级信息架构：通用循环）
// 事实源：docs/00-DESIGN-BRIEF.md §3 / §4
import type { LucideIcon } from 'lucide-react'
import {
  CalendarDays,
  FolderKanban,
  Footprints,
  LayoutGrid,
  Library,
  ListChecks,
  RefreshCw,
  Repeat,
  Settings,
  SlidersHorizontal,
  Table2,
  Trash2,
  UserRound,
} from 'lucide-react'

export interface NavItem {
  /** 两位索引，用于瑞士式编号（01 / 02 …） */
  index: string
  path: string
  /** 英文大写微标签 */
  en: string
  /** 中文名（主显示） */
  cn: string
  icon: LucideIcon
  /** 移动端底部栏收纳进"更多"的次级项 */
  secondary?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { index: '01', path: '/', en: 'OVERVIEW', cn: '总览', icon: LayoutGrid },
  { index: '02', path: '/inbox', en: 'INBOX', cn: '收件箱', icon: SlidersHorizontal },
  { index: '03', path: '/tasks', en: 'TASKS', cn: '任务', icon: ListChecks },
  { index: '04', path: '/calendar', en: 'CALENDAR', cn: '日程', icon: CalendarDays },
  { index: '05', path: '/timetable', en: 'TIMETABLE', cn: '课表', icon: Table2 },
  { index: '06', path: '/projects', en: 'PROJECTS', cn: '项目', icon: FolderKanban },
  { index: '07', path: '/habits', en: 'HABITS', cn: '习惯', icon: Repeat },
  { index: '08', path: '/traces', en: 'TRACES', cn: '踪迹', icon: Footprints },
  { index: '09', path: '/library', en: 'LIBRARY', cn: '资料', icon: Library, secondary: true },
  { index: '10', path: '/review', en: 'REVIEW', cn: '回顾', icon: RefreshCw, secondary: true },
  { index: '11', path: '/settings', en: 'SETTINGS', cn: '设置', icon: Settings, secondary: true },
  { index: '12', path: '/trash', en: 'TRASH', cn: '回收站', icon: Trash2, secondary: true },
]

/**
 * 次级页面（不进侧栏轨道 / 命令面板导航组，但需顶栏标题与文档标题）：
 * 个人页从顶栏头像进入（类 GitHub），不占一级导航。
 */
const EXTRA_PAGES: NavItem[] = [
  { index: '—', path: '/profile', en: 'PROFILE', cn: '个人', icon: UserRound },
]

/** 按路径匹配导航项（主导航优先；含不进轨道但需标题的次级页面） */
export function navByPath(pathname: string): NavItem | undefined {
  return (
    NAV_ITEMS.find((item) => item.path === pathname) ??
    EXTRA_PAGES.find((item) => item.path === pathname)
  )
}
