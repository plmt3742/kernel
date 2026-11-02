// KERNEL · 总览（专注「今天」：日程 + 下一步；其余内容去各自的页面）
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { clsx } from 'clsx'
import { EventDetailModal } from '@/components/EventDetailModal'
import { getActiveProjects, getInboxCount, getTodayEvents } from '@/lib/data'
import { getNextEvent, getOverdueOpen, getTodayTaskScope, getUpcomingNextActions } from '@/lib/derive'
import { useDataRevision, useNow, useUndoableToggle } from '@/lib/hooks'
import { eventEndOf, formatTime, humanizeDay, isPast } from '@/lib/date'

export function Overview() {
  useDataRevision()
  const navigate = useNavigate()
  const toggleTask = useUndoableToggle()
  const now = useNow()
  const [eventId, setEventId] = useState<string | null>(null)

  const inbox = getInboxCount()
  const overdue = getOverdueOpen(now).length
  const projects = getActiveProjects().length
  const scope = getTodayTaskScope(now)
  const events = getTodayEvents(now)
  const nextEvent = getNextEvent(now)
  const nextActions = getUpcomingNextActions(5, now)

  return (
    <div className="gh-page">
      <div className="gh-overview-grid">
        <div className="gh-overview-main">
          <section className="gh-card">
            <div className="gh-card__head">
              <span>今天</span>
              <span className="gh-card__muted">
                任务 {scope.done}/{scope.total} · 日程 {events.length} · 下一步 {nextActions.length}
                {overdue > 0 ? ` · 逾期 ${overdue}` : ''}
              </span>
            </div>
            {events.length === 0 && nextActions.length === 0 ? (
              <div className="gh-empty gh-empty--inset">
                {overdue > 0 ? (
                  <>
                    <b>今天没有新安排</b>
                    <span>还有 {overdue} 项逾期任务，先处理最旧的一件。</span>
                    <Link to="/tasks" className="gh-btn gh-btn--sm">
                      查看逾期
                    </Link>
                  </>
                ) : (
                  <>
                    <b>今天还没有安排</b>
                    <span>从收件箱澄清一件事，或直接新建任务。</span>
                  </>
                )}
              </div>
            ) : (
              <div>
                {events.map((event) => {
                  const ended = isPast(eventEndOf(event), now)
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className="gh-agenda-row"
                      onClick={() => setEventId(event.id)}
                    >
                      <span className="gh-agenda-row__time">
                        {event.allDay ? '全天' : formatTime(event.startAt)}
                      </span>
                      <span className="gh-agenda-row__main">
                        <span className="gh-agenda-row__title">{event.title}</span>
                        <span className="gh-agenda-row__meta">
                          {[event.location, event.endAt !== undefined ? `至 ${formatTime(event.endAt)}` : '']
                            .filter(Boolean)
                            .join(' · ') || '日程'}
                        </span>
                      </span>
                      <span className="gh-agenda-row__state">{ended ? '已结束' : '日程'}</span>
                    </button>
                  )
                })}
                {events.length > 0 && nextActions.length > 0 && (
                  <div className="gh-nowline">现在 {formatTime(now)}</div>
                )}
                {nextActions.map((task) => (
                  <div key={task.id} className="gh-agenda-row">
                    <button
                      type="button"
                      className="gh-issue-row__title"
                      style={{ flex: 1, textAlign: 'left' }}
                      onClick={() => navigate(`/tasks/${task.id}`)}
                    >
                      {task.title}
                    </button>
                    <span className="gh-agenda-row__meta" style={{ flex: 'none' }}>
                      {task.dueAt !== undefined ? humanizeDay(task.dueAt) : '无截止'}
                    </span>
                    <button
                      type="button"
                      className="gh-btn gh-btn--sm gh-btn--ghost"
                      onClick={() => toggleTask(task)}
                      aria-label={`完成：${task.title}`}
                    >
                      <Check size={13} strokeWidth={2} aria-hidden />
                      完成
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="gh-card__foot">
              <div className="gh-quicklinks">
                <Link to="/tasks" className="gh-link">
                  全部任务 <ArrowRight size={12} strokeWidth={1.8} aria-hidden />
                </Link>
                <Link to="/inbox" className="gh-link">
                  收件箱 <ArrowRight size={12} strokeWidth={1.8} aria-hidden />
                </Link>
                <Link to="/assistant" className="gh-link">
                  问助手 <ArrowRight size={12} strokeWidth={1.8} aria-hidden />
                </Link>
              </div>
            </div>
          </section>

          <section className="gh-card">
            <div className="gh-card__head">
              <span>快捷入口</span>
              <span className="gh-card__muted">只放入口，细节去各自页面</span>
            </div>
            <div className="gh-quickgrid">
              <Link to="/assistant" className="gh-quick">
                <b>助手</b>
                <span>问日程、任务、资料</span>
              </Link>
              <Link to="/projects" className="gh-quick">
                <b>项目</b>
                <span>看下一步和进度</span>
              </Link>
              <Link to="/library" className="gh-quick">
                <b>资料</b>
                <span>笔记与资料索引</span>
              </Link>
              <Link to="/habits" className="gh-quick">
                <b>习惯</b>
                <span>今日打卡与热力图</span>
              </Link>
              <Link to="/traces" className="gh-quick">
                <b>踪迹</b>
                <span>我做过的事</span>
              </Link>
              <Link to="/review" className="gh-quick">
                <b>回顾</b>
                <span>周 / 月复盘</span>
              </Link>
            </div>
          </section>
        </div>

        <aside className="gh-overview-side" aria-label="今日状态">
          <section className="gh-card">
            <div className="gh-card__head">状态</div>
            <div className="gh-status-list">
              <Link to="/inbox" className="gh-status-row">
                <span>收件箱待澄清</span>
                <b>{inbox}</b>
              </Link>
              <Link to="/tasks" className={clsx('gh-status-row', overdue > 0 && 'is-alert')}>
                <span>逾期任务</span>
                <b>{overdue}</b>
              </Link>
              <Link to="/projects" className="gh-status-row">
                <span>进行中项目</span>
                <b>{projects}</b>
              </Link>
            </div>
          </section>

          <section className="gh-card">
            <div className="gh-card__head">下一场</div>
            <div className="gh-card__body">
              {nextEvent === undefined ? (
                <span className="gh-card__muted">今日暂无日程</span>
              ) : (
                <>
                  <b className="gh-next">{nextEvent.title}</b>
                  <p className="gh-card__muted gh-next__meta">
                    {humanizeDay(nextEvent.startAt, now)} {formatTime(nextEvent.startAt)}
                  </p>
                  <Link to="/calendar" className="gh-link">
                    打开日程
                  </Link>
                </>
              )}
            </div>
          </section>


          <p className="gh-empty gh-empty--inset">
            <span>这里只放今天。项目、资料、习惯、踪迹和回顾各有自己的页面。</span>
          </p>
        </aside>
      </div>

      <EventDetailModal eventId={eventId} onClose={() => setEventId(null)} />
    </div>
  )
}
