// KERNEL · 导航注册表（一级信息架构：通用循环）
// 事实源：docs/00-DESIGN-BRIEF.md §3 / §4
import type { LucideIcon } from 'lucide-react'
import {
  CalendarDays,
  FolderKanban,
  LayoutGrid,
  Library,
  ListChecks,
  RefreshCw,
  Settings,
  SlidersHorizontal,
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
  { index: '05', path: '/projects', en: 'PROJECTS', cn: '项目', icon: FolderKanban },
  { index: '06', path: '/library', en: 'LIBRARY', cn: '资料', icon: Library, secondary: true },
  { index: '07', path: '/review', en: 'REVIEW', cn: '回顾', icon: RefreshCw, secondary: true },
  { index: '08', path: '/settings', en: 'SETTINGS', cn: '设置', icon: Settings, secondary: true },
]

/** 按路径匹配导航项（精确匹配；未知路径返回 undefined） */
export function navByPath(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.path === pathname)
}
