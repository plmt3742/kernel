// KERNEL · 总览 OVERVIEW（P0）——对齐 C 稿：状态胶囊 + 统计瓦片 + 紧凑日程 + 下一步行动
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { Panel } from '@/components/Panel'
import { StatTile } from '@/components/StatTile'
import { TaskRow } from '@/components/TaskRow'
import { ScheduleList } from '@/components/ScheduleList'
import { EmptyState } from '@/components/EmptyState'
import { MeterBar } from '@/components/MeterBar'
import {
  getActiveProjects,
  getInboxCount,
  getNextActions,
  getProjectProgress,
  getSnapshot,
  getTodayEvents,
} from '@/lib/data'
import { getCodingStreak, getNextEvent, getTodayTaskScope } from '@/lib/derive'
import { isTaskDone, useDone } from '@/lib/proto'
import { formatTime, isPast } from '@/lib/date'

const INBOX_THRESHOLD = 10
const WIP_LIMIT = 3

export function Overview() {
  const navigate = useNavigate()
  const { set: doneSet, toggle } = useDone()
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const snapshot = getSnapshot()
  const inboxCount = getInboxCount()
  const activeProjectList = getActiveProjects()
  const activeProjects = activeProjectList.length

  const scope = getTodayTaskScope(now, doneSet)
  const overdueOpen = useMemo(
    () =>
      snapshot.tasks.filter(
        (task) =>
          task.dueAt !== undefined &&
          task.status !== 'dropped' &&
          !isTaskDone(task, doneSet) &&
          isPast(task.dueAt, now),
      ).length,
    [snapshot.tasks, doneSet, now],
  )

  const nextEvent = getNextEvent(now)
  const todayEvents = getTodayEvents(now)
  const visibleEvents = todayEvents.slice(0, 6)
  const streak = getCodingStreak(now)

  const topActions = getNextActions(20)
    .filter((task) => !doneSet.has(task.id))
    .slice(0, 5)

  return (
    <div className="k-view">
      <div className="k-chips">
        <span className="k-chip">
          <span className="k-chip__dot" aria-hidden />
          {nextEvent !== undefined
            ? `下一项 · ${nextEvent.title} ${formatTime(nextEvent.startAt)}`
            : '下一项 · 今日暂无日程'}
        </span>
        <span className="k-chip">
          <span className="k-chip__dot k-chip__dot--quiet" aria-hidden />
          收件箱 · {inboxCount} 待处理
        </span>
        {overdueOpen > 0 && (
          <span className="k-chip">
            <span className="k-chip__dot k-chip__dot--accent" aria-hidden />
            逾期 · {overdueOpen} 项
          </span>
        )}
      </div>

      <div className="k-overview__stats">
        <StatTile
          label="收件箱水位"
          value={inboxCount}
          suffix={`/ ${INBOX_THRESHOLD}`}
          accent={inboxCount > INBOX_THRESHOLD}
          meter={{ value: inboxCount, max: INBOX_THRESHOLD, threshold: INBOX_THRESHOLD }}
          foot={inboxCount > INBOX_THRESHOLD ? '超过阈值 · 需要澄清排泄' : '低于阈值 · 存量健康'}
        />
        <StatTile
          label="今日任务"
          value={scope.done}
          suffix={`/ ${scope.total}`}
          foot={
            scope.overdue > 0 ? (
              <span>
                今日到期 {scope.dueToday} · <span className="k-accent">逾期 {scope.overdue}</span>
              </span>
            ) : (
              `今日到期 ${scope.dueToday} · 逾期 ${scope.overdue}`
            )
          }
        />
        <StatTile
          label="进行中项目"
          value={activeProjects}
          suffix={`/ ${WIP_LIMIT}`}
          accent={activeProjects > WIP_LIMIT}
          foot={activeProjects > WIP_LIMIT ? '超出在制品上限' : '活跃项目数在限内'}
        />
        <StatTile label="连续刷题" value={streak} suffix="天" foot="每日一题算法 · 习惯 h-0002" />
      </div>

      <div className="k-overview__split">
        <div className="k-overview__col">
          <Panel
            title="今日日程"
            en="TODAY"
            actions={<span className="u-label k-muted">{todayEvents.length} 项</span>}
          >
            {visibleEvents.length > 0 ? (
              <ScheduleList
                events={visibleEvents}
                now={now}
                onSelect={() => navigate('/calendar', { viewTransition: true })}
              />
            ) : (
              <EmptyState title="今日无日程" hint="空的一天，适合深工作。可到日程页查看本周安排。" />
            )}
          </Panel>

          <Panel
            title="下一步行动"
            en="NEXT ACTIONS"
            actions={<span className="u-label k-muted">{topActions.length} 项</span>}
          >
            {topActions.length > 0 ? (
              <div className="k-tasklist-mini">
                {topActions.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    done={isTaskDone(task, doneSet)}
                    onToggle={toggle}
                    onOpen={() => navigate('/tasks', { viewTransition: true })}
                  />
                ))}
              </div>
            ) : (
              <EmptyState title="没有可执行项" hint="收件箱与项目已清空，或全部为等待/将来状态。" />
            )}
          </Panel>
        </div>

        <div className="k-overview__col">
          <Panel
            title="项目"
            en="PROJECTS"
            actions={
              <button
                type="button"
                className="k-btn k-btn--sm"
                onClick={() => navigate('/projects', { viewTransition: true })}
              >
                全部
              </button>
            }
          >
            {activeProjectList.length > 0 ? (
              <div className="k-proj-mini">
                {activeProjectList.slice(0, 4).map((project) => {
                  const progress = getProjectProgress(project.id)
                  const pct =
                    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
                  return (
                    <button
                      type="button"
                      className="k-proj-mini__row"
                      key={project.id}
                      onClick={() => navigate('/projects', { viewTransition: true })}
                    >
                      <span className="k-proj-mini__top">
                        <span className="k-proj-mini__name">{project.title}</span>
                        <span className="k-pill is-ghost">进行中</span>
                      </span>
                      <MeterBar value={progress.done} max={Math.max(1, progress.total)} />
                      <span className="k-proj-mini__foot">
                        <span className="k-mono">
                          {progress.done} / {progress.total}
                        </span>
                        <span className="k-mono">{pct}%</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <EmptyState title="暂无进行中项目" hint="所有项目都在暂停或已完成状态。" />
            )}
          </Panel>
        </div>
      </div>

      <div className="k-aisug">
        <div className="k-aisug__head">
          <Sparkles size={16} strokeWidth={1.5} aria-hidden />
          <span className="k-panel__cn">AI 建议</span>
          <span className="k-aisug__badge u-label">待接入 v0.5</span>
        </div>
        <p className="k-view__intro">
          未来由 opencode 经本地服务生成，以下是形态预览（示意内容，非实时计算）：
        </p>
        <div className="k-aisug__list">
          <p className="k-aisug__line">
            <span className="k-aisug__bullet">01</span>
            数据结构期中临近，建议今天优先处理 t-0001 与 t-0003，避免临近截止堆积。
          </p>
          <p className="k-aisug__line">
            <span className="k-aisug__bullet">02</span>
            收件箱有 6 条未澄清，其中"助学金材料"类 2 条可合并为一个任务。
          </p>
          <p className="k-aisug__line">
            <span className="k-aisug__bullet">03</span>
            健康作息连续三天中断，建议今晚把睡眠列为首位习惯。
          </p>
        </div>
      </div>
    </div>
  )
}
