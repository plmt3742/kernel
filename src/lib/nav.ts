// KERNEL · 导航注册表（分层信息架构：总览 + 行动 / 时间 / 记录 / 系统）
// 事实源：docs/00-DESIGN-BRIEF.md §3 / §4；分组决策见 ADR-0041
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

/** 一级导航的功能分组（分层 IA；'home' 组仅总览一项） */
export type NavGroup = 'home' | 'action' | 'time' | 'record' | 'system'

export interface NavItem {
  /** 两位索引，用于瑞士式编号（01 / 02 …） */
  index: string
  path: string
  /** 英文大写微标签 */
  en: string
  /** 中文名（主显示） */
  cn: string
  icon: LucideIcon
  /** 功能分组（用于轨道 / 命令面板分层） */
  group: NavGroup
  /** 是否进入移动端底部标签栏（false 者收纳进"更多"） */
  mobile?: boolean
}

export const NAV_ITEMS: NavItem[] = [
  { index: '01', path: '/', en: 'OVERVIEW', cn: '总览', icon: LayoutGrid, group: 'home', mobile: true },
  { index: '02', path: '/inbox', en: 'INBOX', cn: '收件箱', icon: SlidersHorizontal, group: 'action', mobile: true },
  { index: '03', path: '/tasks', en: 'TASKS', cn: '任务', icon: ListChecks, group: 'action', mobile: true },
  { index: '04', path: '/projects', en: 'PROJECTS', cn: '项目', icon: FolderKanban, group: 'action', mobile: true },
  { index: '05', path: '/review', en: 'REVIEW', cn: '回顾', icon: RefreshCw, group: 'action', mobile: false },
  { index: '06', path: '/calendar', en: 'CALENDAR', cn: '日程', icon: CalendarDays, group: 'time', mobile: true },
  { index: '07', path: '/timetable', en: 'TIMETABLE', cn: '课表', icon: Table2, group: 'time', mobile: false },
  { index: '08', path: '/library', en: 'LIBRARY', cn: '资料', icon: Library, group: 'record', mobile: false },
  { index: '09', path: '/habits', en: 'HABITS', cn: '习惯', icon: Repeat, group: 'record', mobile: false },
  { index: '10', path: '/traces', en: 'TRACES', cn: '踪迹', icon: Footprints, group: 'record', mobile: false },
  { index: '11', path: '/settings', en: 'SETTINGS', cn: '设置', icon: Settings, group: 'system', mobile: false },
]

/** 分层导航分组标签（'home' 组不显示标题；轨道渲染为双行 cn/en，命令面板渲染为合并串） */
export const NAV_GROUP_LABELS: Record<Exclude<NavGroup, 'home'>, { cn: string; en: string }> = {
  action: { cn: '行动', en: 'ACTION' },
  time: { cn: '时间', en: 'TIME' },
  record: { cn: '记录', en: 'RECORD' },
  system: { cn: '系统', en: 'SYSTEM' },
}

/**
 * 按 NAV_ITEMS 原顺序归并为分组块：home 块无标题，其余块带 NAV_GROUP_LABELS 标题。
 * 供轨道 / 命令面板等同源消费，保证各入口导航结构一致。
 */
export function navGrouped(): { group: NavGroup; label?: string; items: NavItem[] }[] {
  const blocks: { group: NavGroup; label?: string; items: NavItem[] }[] = []
  for (const item of NAV_ITEMS) {
    const last = blocks[blocks.length - 1]
    if (last !== undefined && last.group === item.group) {
      last.items.push(item)
      continue
    }
    blocks.push({
      group: item.group,
      label:
        item.group === 'home'
          ? undefined
          : `${NAV_GROUP_LABELS[item.group].cn} · ${NAV_GROUP_LABELS[item.group].en}`,
      items: [item],
    })
  }
  return blocks
}

/**
 * 次级页面（不进侧栏轨道 / 命令面板导航组，但需顶栏标题与文档标题）：
 * 个人页从顶栏头像进入（类 GitHub）；回收站并入「设置 · 回收站」分区（ADR-0041 Phase 3），
 * 主入口在设置页与命令面板动作组，/trash 路由与深链保留。
 */
const EXTRA_PAGES: NavItem[] = [
  // group 仅满足 NavItem 必填类型；这些页不进任何分组渲染（仅用于标题解析）
  { index: '—', path: '/profile', en: 'PROFILE', cn: '个人', icon: UserRound, group: 'system' },
  { index: '—', path: '/trash', en: 'TRASH', cn: '回收站', icon: Trash2, group: 'system' },
]

/** 按路径匹配导航项（主导航优先；含不进轨道但需标题的次级页面） */
export function navByPath(pathname: string): NavItem | undefined {
  return (
    NAV_ITEMS.find((item) => item.path === pathname) ??
    EXTRA_PAGES.find((item) => item.path === pathname)
  )
}
