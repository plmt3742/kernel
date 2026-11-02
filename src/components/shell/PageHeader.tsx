// KERNEL · 页面头（GitHub 式：面包屑 / 标题 / 描述 / 计数 / 操作 / tabs）
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { navByPath, NAV_GROUP_LABELS } from '@/lib/nav'
import {
  getCourses,
  getHabits,
  getInboxCount,
  getInboxTotalCount,
  getNotes,
  getOverdueTasks,
  getResources,
  getReviews,
  getSnapshot,
  getTasks,
  getTodayEvents,
  getTraces,
  getUpcomingEvents,
} from '@/lib/data'
import { getDataRecordCount, isHabitHitToday } from '@/lib/derive'
import { isoWeekKey, toMonthKey } from '@/lib/date'
import { useDataRevision, useNow } from '@/lib/hooks'

export interface Crumb {
  label: string
  to?: string
}

export interface PageHeaderProps {
  breadcrumb: Crumb[]
  title: string
  description?: string
  meta?: ReactNode
  actions?: ReactNode
  tabs?: ReactNode
}

export function PageHeader({ breadcrumb, title, description, meta, actions, tabs }: PageHeaderProps) {
  return (
    <header className="gh-pagehead">
      <nav className="gh-crumbs" aria-label="面包屑">
        {breadcrumb.map((crumb, index) => (
          <span key={`${crumb.label}-${index}`}>
            {index > 0 && <i aria-hidden>/</i>}
            {crumb.to !== undefined ? (
              <Link to={crumb.to}>{crumb.label}</Link>
            ) : (
              <span aria-current="page">{crumb.label}</span>
            )}
          </span>
        ))}
      </nav>
      <div className="gh-pagehead__row">
        <div className="gh-pagehead__main">
          <h1>{title}</h1>
          {description !== undefined && <p>{description}</p>}
        </div>
        <div className="gh-pagehead__right">
          {meta !== undefined && <div className="gh-pagehead__meta">{meta}</div>}
          {actions !== undefined && <div className="gh-pagehead__actions">{actions}</div>}
        </div>
      </div>
      {tabs !== undefined && <div className="gh-tabs">{tabs}</div>}
    </header>
  )
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

interface RouteMeta {
  title: string
  description: string
  primary: string
  secondary: string
}

function routeMeta(pathname: string): RouteMeta | undefined {
  const snapshot = getSnapshot()
  const inbox = getInboxCount()
  const tasks = getTasks()
  const open = tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped').length
  const overdue = getOverdueTasks(new Date()).length
  const active = snapshot.projects.filter((project) => project.status === 'active').length
  const reviews = getReviews()
  const upcoming = getUpcomingEvents(7)
  const courses = getCourses()
  const notes = getNotes()
  const resources = getResources()
  const habits = getHabits()
  const traces = getTraces()
  const now = new Date()
  const hits = habits.filter((habit) => isHabitHitToday(habit.id, now)).length

  switch (pathname) {
    case '/today':
      return {
        title: '今天',
        description: '先看今天要做什么，再决定先处理哪一件。',
        primary: `${pad2(inbox)} 待澄清`,
        secondary: `${pad2(open)} 待办 · ${pad2(overdue)} 逾期 · ${pad2(active)} 项目`,
      }
    case '/assistant':
      return {
        title: '助手',
        description: '先问清楚，再动手。需要保存时，它会先问你。',
        primary: '能查库 · 能联网',
        secondary: '写入前确认',
      }
    case '/inbox':
      return {
        title: '收件箱',
        description: '先把东西放进来，稍后再整理。AI 只提建议，确认后才保存。',
        primary: `${pad2(inbox)} 待澄清`,
        secondary: `累计 ${pad2(getInboxTotalCount())} 条`,
      }
    case '/tasks':
      return {
        title: '任务',
        description: '所有未完成的事按截止时间排好；逾期和今天在最前面。',
        primary: `${pad2(open)} 未完成`,
        secondary: `${pad2(overdue)} 逾期 · 共 ${pad2(tasks.length)} 条`,
      }
    case '/projects':
      return {
        title: '项目',
        description: '需要多个步骤才能做完的事。看状态、下一步和进度。',
        primary: `${pad2(active)} 进行中`,
        secondary: `共 ${pad2(snapshot.projects.length)} 个项目`,
      }
    case '/review':
      return {
        title: '回顾',
        description: '每周或每月花几分钟，看看完成了什么、卡在哪里、接下来先做什么。',
        primary: `${pad2(reviews.length)} 份归档`,
        secondary: `${isoWeekKey(now)} · ${toMonthKey(now)}`,
      }
    case '/calendar':
      return {
        title: '日程',
        description: '今天要做什么，接下来还有什么，按时间排在一起。',
        primary: `${pad2(upcoming.length)} 场 · 未来 7 天`,
        secondary: `${pad2(getTodayEvents(now).length)} 场今日 · ${pad2(courses.length)} 门课程`,
      }
    case '/timetable':
      return {
        title: '课表',
        description: '这学期的课按周排好；连堂合并，点一门课看详情。',
        primary: `${pad2(courses.length)} 门课程`,
        secondary:
          snapshot.term !== undefined && snapshot.term !== null
            ? `第 1 周起 · 共 ${snapshot.term.totalWeeks} 周`
            : '学期未设置',
      }
    case '/library':
      return {
        title: '资料',
        description: '笔记和资料放在同一张索引里；写下的、收进来的，都按最近更新排。',
        primary: `${pad2(notes.length)} 笔记 · ${pad2(resources.length)} 资料`,
        secondary: `${pad2(snapshot.tags.length)} 标签`,
      }
    case '/habits':
      return {
        title: '习惯',
        description: '每天打一次卡；连续天数、最长记录和热力图会自己长出来。',
        primary: `${pad2(habits.length)} 个习惯`,
        secondary: `今日 ${pad2(hits)} / ${pad2(habits.length)} 已打卡`,
      }
    case '/traces':
      return {
        title: '踪迹',
        description: '做过的事按时间留在这里；动态和时间线是同一份记录。',
        primary: `${pad2(traces.length)} 条记录`,
        secondary: '回车即记 · 可配图',
      }
    case '/settings':
      return {
        title: '设置',
        description: '外观、AI、通知和数据都在这里。会改动数据的操作，都会先问你。',
        primary: `${pad2(getDataRecordCount(snapshot))} 条记录`,
        secondary: '本机保存',
      }
    case '/profile':
      return {
        title: '个人',
        description: '你的资料、最近活动和系统记录下来的操作。',
        primary: `${pad2(getDataRecordCount(snapshot))} 条记录`,
        secondary: '仅本机可见',
      }
    case '/trash':
      return {
        title: '回收站',
        description: '删除的东西先放这里；恢复不会丢，彻底删除需要再点一次。',
        primary: '软删除',
        secondary: '彻底删除才会断开关联',
      }
    default:
      return undefined
  }
}

const GROUP_LABEL: Record<string, string> = {
  home: '工作台',
  action: '行动',
  time: '时间',
  record: '记录',
  system: '系统',
}

export function RoutePageHeader({ pathname }: { pathname: string }) {
  useDataRevision()
  useNow(30_000)
  if (
    pathname === '/library' ||
    pathname === '/projects' ||
    pathname === '/tasks' ||
    pathname === '/settings' ||
    pathname === '/inbox' ||
    pathname === '/profile'
  ) {
    return null
  }
  const meta = routeMeta(pathname)
  if (meta === undefined) return null
  const nav = navByPath(pathname)
  const group = nav !== undefined ? GROUP_LABEL[nav.group] : 'KERNEL'
  const groupKey = nav?.group
  const groupText =
    groupKey !== undefined && groupKey !== 'home' ? NAV_GROUP_LABELS[groupKey].cn : group
  return (
    <PageHeader
      breadcrumb={[{ label: 'KERNEL', to: '/' }, { label: groupText }, { label: meta.title }]}
      title={meta.title}
      description={meta.description}
      meta={
        <>
          <b>{meta.primary}</b>
          <span>{meta.secondary}</span>
        </>
      }
    />
  )
}
