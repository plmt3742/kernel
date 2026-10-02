// KERNEL · 总览 OVERVIEW（P0）——「工作台（Workbench）」：状态条 + AI 对话 + 左工作区（日程/行动交织）+ 右粘性监视柱 + 项目推进
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clsx } from 'clsx'
import { Panel } from '@/components/Panel'
import { TaskRow } from '@/components/TaskRow'
import { ScheduleList } from '@/components/ScheduleList'
import { EmptyState } from '@/components/EmptyState'
import { TaskDetailModal } from '@/components/TaskDetailModal'
import { ProjectDetailModal } from '@/components/ProjectDetailModal'
import { OverviewChat } from '@/components/OverviewChat'
import { TrendLine } from '@/components/charts/TrendLine'
import {
  getActiveProjects,
  getInboxCount,
  getProjectById,
  getProjectProgress,
  getReviews,
  getTodayEvents,
} from '@/lib/data'
import {
  getCodingStreakDetail,
  getDueLoadSeries,
  getNextEvent,
  getOverdueOpen,
  getTodayTaskScope,
  getUpcomingNextActions,
  getWeeklyCompletionSeries,
} from '@/lib/derive'
import { isTaskDone, checkinHabit, uncheckinHabit } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useToast } from '@/context/ToastContext'
import { useDataRevision, useNow, useUndoableToggle } from '@/lib/hooks'
import { formatTime, humanizeDay, isPast, toDate } from '@/lib/date'

/* 水位容量 / 阈值与 WIP 上限：与 StatusBar 口径一致（capacity 12 · threshold 8） */
const INBOX_CAPACITY = 12
const INBOX_THRESHOLD = 8
const WIP_LIMIT = 3

/** 监视柱水平计：draft 版 .k-meter 轨道 + role=meter 语义 */
function MonitorMeter({
  value,
  max,
  threshold,
  ariaLabel,
  foot,
}: {
  value: number
  max: number
  threshold: number
  ariaLabel: string
  foot: string
}) {
  const safeMax = Math.max(1, max)
  const fill = Math.min(100, (value / safeMax) * 100)
  return (
    <>
      <div className={clsx('k-meter', value > threshold && 'is-over')}>
        <div
          className="k-meter__track"
          role="meter"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={safeMax}
          aria-label={ariaLabel}
        >
          <div className="k-meter__fill" style={{ width: `${fill}%` }} />
          <div
            className="k-meter__threshold"
            style={{ left: `${Math.min(100, (threshold / safeMax) * 100)}%` }}
            aria-hidden
          />
        </div>
      </div>
      <span className="k-meter__foot">{foot}</span>
    </>
  )
}

export function Overview() {
  useDataRevision()
  const navigate = useNavigate()
  const toggleTask = useUndoableToggle()
  const { toast } = useToast()
  const now = useNow()
  const [habitBusy, setHabitBusy] = useState(false)

  // 就地详情弹窗（Slice G）：URL 保持在 "/"，不跳转（owner 反馈：跳转后无高亮、不知在哪）
  const [taskModalId, setTaskModalId] = useState<string | null>(null)
  const [projectModalId, setProjectModalId] = useState<string | null>(null)

  const inboxCount = getInboxCount()
  const activeProjectList = getActiveProjects()
  const scope = getTodayTaskScope(now)
  const overdueOpen = getOverdueOpen(now).length

  const nextEvent = getNextEvent(now)
  const todayEvents = getTodayEvents(now)
  const endedEvents = todayEvents.filter((event) => isPast(event.endAt ?? event.startAt, now))
  // 行动列：即将到期的下一步行动（按截止升序，逾期已排除）
  const flow = getUpcomingNextActions(5, now)
  const streak = getCodingStreakDetail(now)

  const completionSeries = getWeeklyCompletionSeries(now)
  const dueLoadSeries = getDueLoadSeries(now)

  /* 监视柱显示口径 */
  const inboxOver = inboxCount > INBOX_THRESHOLD
  const inboxFoot = inboxOver
    ? '超过阈值 · 需要澄清排泄'
    : `低于阈值 ${INBOX_THRESHOLD} · 存量健康`

  const wip = activeProjectList.length
  const wipMax = Math.max(WIP_LIMIT, wip)
  const wipOver = wip > WIP_LIMIT
  const wipFoot = wipOver ? `超出上限 ${wip - WIP_LIMIT} · 需收口` : `在限内 · 上限 ${WIP_LIMIT}`

  const streakFoot =
    streak.gaps.length === 0
      ? `近 14 天命中 ${streak.hits} · 无缺口`
      : `近 14 天命中 ${streak.hits} · 缺口 ${streak.gaps.join(' / ')}`

  // 今日打卡切换（Slice X）：point 态反映今天的 log；点击幂等打卡 / 取消打卡 + toast 撤销
  const toggleHabitToday = (): void => {
    const habitId = streak.habitId
    if (habitId === null || habitBusy) return
    const wasHit = streak.todayHit
    const label =
      streak.habitTitle.length > 12 ? `${streak.habitTitle.slice(0, 12)}…` : streak.habitTitle
    setHabitBusy(true)
    void (async () => {
      try {
        if (wasHit) await uncheckinHabit(habitId)
        else await checkinHabit(habitId)
        toast(wasHit ? `已取消今日打卡 · ${label}` : `今日已打卡 · ${label}`, {
          action: {
            label: '撤销',
            onClick: () => {
              void (wasHit ? checkinHabit(habitId) : uncheckinHabit(habitId)).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`打卡失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setHabitBusy(false)
      }
    })()
  }

  const completionSum = completionSeries.reduce((sum, day) => sum + day.value, 0)
  // 周起点为周一：索引 5、6 即周六、周日
  const weekendSum = completionSeries.slice(5).reduce((sum, day) => sum + day.value, 0)
  const completedDays = completionSeries.filter((day) => day.value > 0)
  const completionFoot =
    completedDays.length === 0
      ? '本周尚无完成 · 保持节奏'
      : `${completedDays[0].label}–${completedDays[completedDays.length - 1].label} ${completionSum} 项 · 周末 ${weekendSum}`

  const dueLoadSum = dueLoadSeries.reduce((sum, day) => sum + day.value, 0)
  const dueLoadMax = Math.max(0, ...dueLoadSeries.map((day) => day.value))
  const peakLabels = dueLoadSeries.filter((day) => day.value === dueLoadMax).map((day) => day.label)
  const dueLoadFoot =
    dueLoadSum === 0 ? '未来 7 天暂无到期' : `未来 7 天合计 ${dueLoadSum} · 峰值${peakLabels.join(' / ')}`

  /* 最新周回顾：W40 一行（无周回顾则省略） */
  const weeklyReview = [...getReviews()]
    .filter((review) => review.type === 'weekly')
    .sort((a, b) => toDate(b.date).getTime() - toDate(a.date).getTime())
    .at(0)
  const w40 =
    weeklyReview === undefined
      ? undefined
      : `${weeklyReview.periodKey.replace(/^\d{4}-/, '')} 回顾 · 捕捉 ${weeklyReview.metrics.captured} · 新增 ${weeklyReview.metrics.created} · 完成 ${weeklyReview.metrics.completed} · 逾期 ${weeklyReview.metrics.overdue} · 迁移 ${weeklyReview.metrics.migrated ?? '—'}`

  return (
    <div className="k-view">
      {/* 状态条（Slice G 重做）：整宽三等分、左右对齐版心；替代此前左对齐 / 右边参差的胶囊行 */}
      <div className="k-status" role="group" aria-label="今日状态">
        <button
          type="button"
          className="k-status__seg"
          onClick={() => navigate('/calendar', { viewTransition: true })}
        >
          <span className="k-status__dot" aria-hidden />
          <span className="k-status__k">下一项</span>
          <span className="k-status__v">
            {nextEvent !== undefined
              ? `${nextEvent.title} ${humanizeDay(nextEvent.startAt, now)} ${formatTime(nextEvent.startAt)}`
              : '今日暂无日程'}
          </span>
        </button>
        <button
          type="button"
          className="k-status__seg"
          onClick={() => navigate('/inbox', { viewTransition: true })}
        >
          <span className="k-status__dot k-status__dot--quiet" aria-hidden />
          <span className="k-status__k">收件箱</span>
          <span className="k-status__v">{inboxCount} 待处理</span>
        </button>
        <button
          type="button"
          className={overdueOpen > 0 ? 'k-status__seg is-accent' : 'k-status__seg'}
          onClick={() => navigate('/tasks', { viewTransition: true })}
        >
          <span
            className={overdueOpen > 0 ? 'k-status__dot k-status__dot--accent' : 'k-status__dot k-status__dot--quiet'}
            aria-hidden
          />
          <span className="k-status__k">逾期</span>
          <span className="k-status__v">{overdueOpen} 项</span>
        </button>
      </div>

      {/* AI 对话盒（Slice G）：状态条之下、工作台之上 */}
      <OverviewChat />

      <div className="r3c-body">
        {/* 左 2/3：工作台（已结束日程 + 现在分界 + 行动） */}
        <Panel
          title="工作台"
          en="WORKBENCH"
          actions={
            <span className="u-label k-muted">
              今日任务 {scope.done} / {scope.total} · 日程 {todayEvents.length} · 行动 {flow.length}
            </span>
          }
        >
          {endedEvents.length > 0 || flow.length > 0 ? (
            <div className="r3c-flow">
              {endedEvents.length > 0 && (
                <ScheduleList
                  events={endedEvents}
                  now={now}
                  ended
                  onSelect={() => navigate('/calendar', { viewTransition: true })}
                />
              )}

              <div className="r3c-now">
                <span className="r3c-now__line" aria-hidden />
                <span className="r3c-now__label u-label">
                  现在 · {formatTime(now)} · 以下按截止时间排序
                </span>
                <span className="r3c-now__line" aria-hidden />
              </div>

              {flow.map((task) => {
                const project = task.projectId !== undefined ? getProjectById(task.projectId) : undefined
                const progress = task.projectId !== undefined ? getProjectProgress(task.projectId) : undefined
                const projectProgress =
                  project !== undefined && progress !== undefined
                    ? { title: project.title, done: progress.done, total: progress.total }
                    : undefined
                return (
                  <TaskRow
                    key={task.id}
                    task={task}
                    done={isTaskDone(task)}
                    showDueTime
                    projectProgress={projectProgress}
                    onToggle={(id) => {
                      const target = flow.find((item) => item.id === id)
                      if (target !== undefined) toggleTask(target)
                    }}
                    onOpen={(id) => setTaskModalId(id)}
                  />
                )
              })}
            </div>
          ) : (
            <EmptyState title="工作台暂无内容" hint="今日无已结束日程，也没有可执行的下一步行动。" />
          )}
        </Panel>

        {/* 右 1/3：监视柱（粘性；窄容器落回单列） */}
        <Panel title="监视" en="MONITOR" className="r3c-rail">
          <div className="r3c-mon">
            <button
              type="button"
              className="r3c-block r3c-block--link"
              onClick={() => navigate('/inbox', { viewTransition: true })}
              aria-label="查看收件箱"
            >
              <div className="r3c-head">
                <span className="r3c-head__t">收件箱水位</span>
                <span className="r3c-head__v k-mono">
                  {inboxCount} / {INBOX_CAPACITY}
                </span>
              </div>
              <MonitorMeter
                value={inboxCount}
                max={INBOX_CAPACITY}
                threshold={INBOX_THRESHOLD}
                ariaLabel="收件箱水位"
                foot={inboxFoot}
              />
            </button>

            <button
              type="button"
              className="r3c-block r3c-block--link"
              onClick={() => navigate('/tasks', { viewTransition: true })}
              aria-label="查看任务"
            >
              <div className="r3c-head">
                <span className="r3c-head__t">WIP · 进行中</span>
                <span className={clsx('r3c-head__v', 'k-mono', wipOver && 'is-accent')}>
                  {wip} / 上限 {WIP_LIMIT}
                </span>
              </div>
              <MonitorMeter
                value={wip}
                max={wipMax}
                threshold={WIP_LIMIT}
                ariaLabel="在制品数量"
                foot={wipFoot}
              />
            </button>

            <div className="r3c-block">
              <div className="r3c-head">
                <span className="r3c-head__t">{streak.habitTitle !== '' ? streak.habitTitle : '习惯打卡'}</span>
                <span className="r3c-head__v k-mono">{streak.current} 天</span>
              </div>
              <div className="k-streak" role="img" aria-label="近 14 天打卡点阵">
                {streak.window.map((cell) => (
                  <div
                    key={cell.key}
                    className={clsx('k-streak__cell', !cell.hit && 'is-miss')}
                  />
                ))}
              </div>
              <div className="k-streak__actions">
                <button
                  type="button"
                  className={streak.todayHit ? 'k-btn k-btn--sm is-solid' : 'k-btn k-btn--sm'}
                  aria-pressed={streak.todayHit}
                  disabled={habitBusy || streak.habitId === null}
                  onClick={toggleHabitToday}
                >
                  {streak.todayHit ? '今日已打卡' : '今日打卡'}
                </button>
                <span className="k-meter__foot">{streakFoot}</span>
              </div>
            </div>

            <div className="r3c-block">
              <div className="r3c-head">
                <span className="r3c-head__t">完成趋势</span>
                <span className="r3c-head__v k-mono">合计 {completionSum}</span>
              </div>
              <TrendLine
                data={completionSeries}
                height={40}
                showValues={false}
                showAxis={false}
                ariaLabel="近 7 天完成趋势"
              />
              <span className="k-meter__foot">{completionFoot}</span>
            </div>

            <div className="r3c-block">
              <div className="r3c-head">
                <span className="r3c-head__t">到期负载</span>
                <span className="r3c-head__v k-mono">高峰 {dueLoadMax}</span>
              </div>
              <TrendLine
                data={dueLoadSeries}
                height={40}
                showValues={false}
                showAxis={false}
                ariaLabel="未来 7 天到期负载"
              />
              <span className="k-meter__foot">{dueLoadFoot}</span>
            </div>
          </div>
        </Panel>
      </div>

      {/* 底部：项目推进（首个 4 个活跃项目 + W40 回顾行） */}
      <Panel
        title="项目推进"
        en="PROJECTS"
        actions={<span className="u-label k-muted">{activeProjectList.length} 个进行中</span>}
      >
        {activeProjectList.length > 0 ? (
          <>
            <div className="r3c-proj">
              {activeProjectList.slice(0, 4).map((project) => {
                const progress = getProjectProgress(project.id)
                const pct =
                  progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
                return (
                  <button
                    type="button"
                    className="k-proj-mini__row"
                    key={project.id}
                    onClick={() => setProjectModalId(project.id)}
                  >
                    <span className="k-proj-mini__top">
                      <span className="k-proj-mini__name">{project.title}</span>
                      <span className="k-pill is-ghost">进行中</span>
                    </span>
                    <div className="k-meter__track">
                      <div className="k-meter__fill" style={{ width: `${pct}%` }} />
                    </div>
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
            {w40 !== undefined && (
              <button
                type="button"
                className="u-label k-muted r3c-w40"
                onClick={() => navigate('/review', { viewTransition: true })}
                aria-label="查看回顾"
              >
                {w40}
              </button>
            )}
          </>
        ) : (
          <EmptyState title="暂无进行中项目" hint="所有项目都在暂停或已完成状态。" />
        )}
      </Panel>

      {/* 就地详情弹窗（Slice K）：与 Tasks / Projects 页共用同一居中详情组件，
          任务与项目均补齐「编辑 / 删除」常规操作，全站动作一致。URL 保持 "/"。 */}
      <TaskDetailModal taskId={taskModalId} onClose={() => setTaskModalId(null)} />
      <ProjectDetailModal projectId={projectModalId} onClose={() => setProjectModalId(null)} />
    </div>
  )
}
