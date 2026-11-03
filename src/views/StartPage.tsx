// KERNEL · 第一层级：4:6 开始菜单 + 系统介绍 / 流程 / 状态
import { Link, useNavigate } from 'react-router-dom'
import { useLaunchSurface } from '@/lib/launchSurface'
import {
  ArrowRight,
  Command,
  Moon,
  Sun,
} from 'lucide-react'
import { CommandPalette } from '@/components/CommandPalette'
import { usePalette } from '@/context/PaletteContext'
import { useTheme } from '@/context/ThemeContext'
import {
  getActiveProjects,
  getConfig,
  getInboxCount,
  getReviews,
  getTasks,
  getTodayEvents,
  profileAvatarUrl,
  profileMonogram,
} from '@/lib/data'
import { getNextEvent } from '@/lib/derive'
import { useAiHealth, useDataRevision, useDataSource, useNow } from '@/lib/hooks'
import { NAV_ITEMS, navByPath } from '@/lib/nav'
import { formatMonthDay, formatTime, formatWeekdayShort } from '@/lib/date'

const FLOW_STEPS = [
  { n: '01', label: '捕捉', en: 'CAPTURE', to: '/inbox', desc: '先记下来' },
  { n: '02', label: '澄清', en: 'CLARIFY', to: '/inbox', desc: '想清楚是什么' },
  { n: '03', label: '组织', en: 'ORGANIZE', to: '/projects', desc: '放进对应项目' },
  { n: '04', label: '执行', en: 'EXECUTE', to: '/tasks', desc: '今天先做哪件' },
  { n: '05', label: '回顾', en: 'REVIEW', to: '/review', desc: '每周每月回看' },
]

export function StartPage() {
  useDataRevision()
  const navigate = useNavigate()
  const now = useNow(30_000)
  const { theme, setTheme } = useTheme()
  const { toggle: togglePalette } = usePalette()
  const ai = useAiHealth()
  const source = useDataSource()
  const config = getConfig()
  const avatarUrl = profileAvatarUrl(config.avatarPath)
  const owner = config.owner.trim() === '' || config.owner === 'unknown' ? '本机用户' : config.owner
  useLaunchSurface()

  const inbox = getInboxCount()
  const tasks = getTasks()
  const openTasks = tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped').length
  const projects = getActiveProjects()
  const reviews = getReviews()
  const todayEvents = getTodayEvents(now)
  const nextEvent = getNextEvent(now)
  const counts: Record<string, number> = {
    '/inbox': inbox,
    '/tasks': openTasks,
    '/projects': projects.length,
    '/review': reviews.length,
    '/calendar': todayEvents.length,
    '/library': 0,
    '/habits': 0,
    '/traces': 0,
  }

  const rawLast = (() => {
    try {
      return localStorage.getItem('kernel.lastRoute') ?? ''
    } catch {
      return ''
    }
  })()
  const lastPath = rawLast !== '' && rawLast !== '/' ? rawLast : '/today'
  const lastBase = lastPath.split('?')[0]
  const lastNav = navByPath(lastBase.split('/').slice(0, 2).join('/')) ?? navByPath('/today')

  const menuItems = NAV_ITEMS.filter((item) => item.path !== '/today')

  return (
    <div className="gh-launch">
      <aside className="gh-launch__menu" aria-label="开始菜单">
        <header className="gh-launch__brand">
          <span className="gh-brand__mark" aria-hidden>
            K
          </span>
          <span>
            <b>KERNEL</b>
            <em>PERSONAL KERNEL / 个人事务</em>
          </span>
        </header>

        <div className="gh-launch__menuhead">
          <span>开始菜单</span>
          <em>START MENU</em>
        </div>

        <button
          type="button"
          className="gh-launch-start gh-launch-start--primary"
          data-launch-surface
          onClick={() => navigate('/today')}
        >
          <span className="gh-launch-start__n">01</span>
          <span className="gh-launch-start__main">
            <b>开始</b>
            <em>START · 从今天开始</em>
          </span>
          <ArrowRight size={18} strokeWidth={1.8} aria-hidden />
        </button>

        <button
          type="button"
          className="gh-launch-start"
          data-launch-surface
          onClick={() => navigate(lastPath)}
        >
          <span className="gh-launch-start__n">02</span>
          <span className="gh-launch-start__main">
            <b>继续</b>
            <em>CONTINUE · 上次停在{lastNav?.cn ?? '今天'}</em>
          </span>
          <ArrowRight size={18} strokeWidth={1.8} aria-hidden />
        </button>

        <nav className="gh-launch__grid" aria-label="页面">
          {menuItems.map((item) => {
            const Icon = item.icon
            const count = counts[item.path]
            return (
              <Link
                key={item.path}
                to={item.path}
                className="gh-launch-item"
                data-launch-surface
              >
                <Icon size={16} strokeWidth={1.7} aria-hidden />
                <span className="gh-launch-item__main">
                  <b>{item.cn}</b>
                  <em>{item.en}</em>
                </span>
                {count !== undefined && <span className="gh-launch-item__count">{count}</span>}
              </Link>
            )
          })}
        </nav>

        <div className="gh-launch__shortcuts" data-launch-surface>
          <span className="gh-launch__shortcuts-k">快捷</span>
          <span>
            <kbd>C</kbd> 收件箱
          </span>
          <span>
            <kbd>Ctrl K</kbd> 命令
          </span>
        </div>

        <footer className="gh-launch__foot">
          <div className="gh-launch__date">
            <span>
              {now.getFullYear()} / {String(now.getMonth() + 1).padStart(2, '0')} /{' '}
              {String(now.getDate()).padStart(2, '0')} · {formatWeekdayShort(now)}
            </span>
            <span>{formatTime(now)}</span>
          </div>
          <div className="gh-launch__status">
            <span className={ai.status === 'online' ? 'is-on' : ai.status === 'offline' ? 'is-off' : ''}>
              <i aria-hidden /> AI
            </span>
            <span className={source === 'server' ? 'is-on' : source === 'offline' ? 'is-off' : ''}>
              <i aria-hidden /> 数据
            </span>
          </div>
          <div className="gh-launch__utils">
            <button
              type="button"
              className="gh-btn gh-btn--sm"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            >
              {theme === 'dark' ? <Sun size={13} strokeWidth={1.8} /> : <Moon size={13} strokeWidth={1.8} />}
              {theme === 'dark' ? '亮色' : '暗色'}
            </button>
            <button type="button" className="gh-btn gh-btn--sm" onClick={togglePalette}>
              <Command size={13} strokeWidth={1.8} />
              命令
            </button>
            <Link to="/profile" className="gh-launch__user" title="个人页">
              <span className="gh-avatar">
                {avatarUrl !== null ? <img src={avatarUrl} alt="" /> : <span>{profileMonogram(config.owner)}</span>}
              </span>
              <span>{owner}</span>
            </Link>
          </div>
        </footer>
      </aside>

      <section className="gh-launch__info">
        <header className="gh-launch__intro">
          <p className="gh-launch__kicker">KERNEL / LOCAL FIRST</p>
          <h1>去繁化简</h1>
          <p>
            把工作、学习、生活里的待办、资料和临时想法收在一处。每天打开，先看今天，再决定下一步。
          </p>
        </header>

        <section className="gh-launch__flow" aria-label="每天怎么用">
          <div className="gh-launch__sectionhead">
            <span>每天怎么用</span>
            <em>5 个步骤</em>
          </div>
          <div className="gh-launch__flowgrid">
            {FLOW_STEPS.map((step) => (
              <Link key={step.n} to={step.to} className="gh-launch-flow" data-launch-surface>
                <span className="gh-launch-flow__n">{step.n}</span>
                <b>{step.label}</b>
                <em>{step.en}</em>
                <span>{step.desc}</span>
              </Link>
            ))}
          </div>
        </section>

        <section className="gh-launch__stats" aria-label="实时状态">
          <Link to="/inbox" className="gh-launch-stat" data-launch-surface>
            <span>收件箱</span>
            <b>{inbox}</b>
            <em>待澄清</em>
          </Link>
          <Link to="/tasks" className="gh-launch-stat" data-launch-surface>
            <span>未完成</span>
            <b>{openTasks}</b>
            <em>任务</em>
          </Link>
          <Link to="/projects" className="gh-launch-stat" data-launch-surface>
            <span>进行中</span>
            <b>{projects.length}</b>
            <em>项目</em>
          </Link>
          <Link to="/calendar" className="gh-launch-stat" data-launch-surface>
            <span>今日</span>
            <b>{todayEvents.length}</b>
            <em>日程</em>
          </Link>
        </section>

        <div className="gh-launch__actions">
          <Link to="/assistant" className="gh-btn gh-btn--primary">
            <span>打开助手</span>
            <ArrowRight size={14} strokeWidth={1.8} aria-hidden />
          </Link>
          <Link to="/inbox" className="gh-btn">
            快速捕捉
          </Link>
          <button type="button" className="gh-btn" onClick={togglePalette}>
            <Command size={14} strokeWidth={1.8} aria-hidden />
            命令面板
          </button>
        </div>

        {nextEvent !== undefined && (
          <p className="gh-launch__next">
            接下来 · <b>{nextEvent.title}</b> · {formatMonthDay(nextEvent.startAt)}{' '}
            {formatTime(nextEvent.startAt)}
          </p>
        )}

        <footer className="gh-launch__legend">
          <span>数据存在本机</span>
          <span>AI 只给建议</span>
          <span>写入由你确认</span>
          <span className="gh-launch__more">
            <Link to="/timetable">课表</Link>
            <Link to="/trash">回收站</Link>
            <Link to="/settings">设置</Link>
          </span>
        </footer>
      </section>

      <CommandPalette />
    </div>
  )
}
