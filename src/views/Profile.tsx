// KERNEL · 个人页 PROFILE
// 资料卡（头像 / 名称 / 简介 + 内联编辑 + 头像上传·移除）+ 活跃贡献日历（异步）+
// 动作时间线（复用 ActivityTimeline，只读审计）。
// 资料写入走 POST /api/config 与 /api/profile/avatar*（唯一写者）；成功后整体水合。
// 活动统计经 api 客户端读 GET /api/activity/summary（挂载 + revision 变化时刷新）。
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ActivityCalendar, type ActivityDay } from '@/components/ActivityCalendar'
import { ActivitySparkline } from '@/components/ActivitySparkline'
import { ActivityTimeline } from '@/components/ActivityTimeline'
import { api, errorText } from '@/lib/api'
import {
  getActiveProjects,
  getConfig,
  getHabitStreak,
  getHabits,
  getProjectProgress,
  getSnapshot,
  getTasks,
  getTraces,
  profileAvatarUrl,
  profileMonogram,
} from '@/lib/data'
import { useDataRevision } from '@/lib/hooks'
import { computeActivityStats, describeActivity, type ActivityEntry } from '@/lib/activity'
import { isHabitHitToday } from '@/lib/derive'
import { getDataRecordCount } from '@/lib/derive'
import { formatMonthDay, formatRelative, formatWeekdayShort } from '@/lib/date'
import { deepLinkOfId } from '@/lib/relations'
import { useToast } from '@/context/ToastContext'
import {
  checkinHabit,
  fetchActivity,
  removeProfileAvatar,
  uncheckinHabit,
  updateProfile,
  uploadProfileAvatar,
} from '@/lib/mutations'

/** 活动窗口周数（与请求 days 一致）：近 20 周 */
const ACTIVITY_WEEKS = 20
const ACTIVITY_DAYS = ACTIVITY_WEEKS * 7
const NAME_MAX = 40
const BIO_MAX = 160
const AVATAR_MAX_BYTES = 2 * 1024 * 1024

/** 活动统计响应（服务端 GET /api/activity/summary） */
interface ActivitySummary {
  days: ActivityDay[]
  total: number
  span: number
}

function greetingOf(date: Date): string {
  const hour = date.getHours()
  if (hour < 6) return '夜深了'
  if (hour < 11) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

type ActivityPhase = 'loading' | 'ready' | 'error'

export function Profile(): ReactNode {
  const { toast } = useToast()
  const [searchParams] = useSearchParams()
  const rawTab = searchParams.get('tab')
  const profileTab: 'overview' | 'records' = rawTab === 'records' ? 'records' : 'overview'
  const revision = useDataRevision()
  const config = getConfig()

  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [bio, setBio] = useState('')
  const [saving, setSaving] = useState(false)
  const [avatarBusy, setAvatarBusy] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement | null>(null)

  const [activity, setActivity] = useState<ActivityDay[]>([])
  const [activityPhase, setActivityPhase] = useState<ActivityPhase>('loading')
  const [recentActions, setRecentActions] = useState<ActivityEntry[]>([])
  const [habitBusy, setHabitBusy] = useState<string | null>(null)

  // 活动统计：挂载即拉取；任何写入 / 水合（revision 变化）后刷新，使新活动即时出现。
  useEffect(() => {
    let cancelled = false
    api
      .get<ActivitySummary>(`/api/activity/summary?days=${ACTIVITY_DAYS}`)
      .then((res) => {
        if (cancelled) return
        setActivity(Array.isArray(res.days) ? res.days : [])
        setActivityPhase('ready')
      })
      .catch(() => {
        if (cancelled) return
        setActivity([])
        setActivityPhase('error')
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  useEffect(() => {
    let cancelled = false
    fetchActivity(6)
      .then((items) => {
        if (!cancelled) setRecentActions(Array.isArray(items) ? items : [])
      })
      .catch(() => {
        if (!cancelled) setRecentActions([])
      })
    return () => {
      cancelled = true
    }
  }, [revision])

  const owner = config.owner?.trim() ?? ''
  const displayName = owner === '' ? '未命名' : owner
  const displayBio = config.bio?.trim() ?? ''
  const avatarUrl = profileAvatarUrl(config.avatarPath)
  const hasAvatar = config.avatarPath !== undefined && config.avatarPath.trim() !== ''

  // 活跃统计（运行时派生）：由活动日历逐日计数计算，绝不落盘。
  const stats = computeActivityStats(activity)
  const recordCount = getDataRecordCount(getSnapshot())
  const lastActiveText = stats.lastActive !== null ? formatMonthDay(stats.lastActive) : '暂无'
  const habits = getHabits()
  const activeProjects = [...getActiveProjects()]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 4)
  const completedTasks = getTasks()
    .filter((task) => task.status === 'done')
    .sort((a, b) => (b.doneAt ?? b.updatedAt).localeCompare(a.doneAt ?? a.updatedAt))
    .slice(0, 4)
  const traces = [...getTraces()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4)
  const recentDays = activity.slice(-7)
  const weekTotal = recentDays.reduce((sum, day) => sum + day.count, 0)

  const openEdit = (): void => {
    setName(config.owner ?? '')
    setBio(config.bio ?? '')
    setError('')
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setEditing(false)
    setError('')
  }

  const onSave = (): void => {
    const nextOwner = name.trim()
    const nextBio = bio.trim()
    if (nextOwner.length > NAME_MAX || nextBio.length > BIO_MAX) {
      setError('名称或简介超出长度限制')
      return
    }
    setSaving(true)
    setError('')
    void (async () => {
      try {
        await updateProfile({ owner: nextOwner, bio: nextBio })
        setEditing(false)
        toast('资料已保存')
      } catch (err) {
        setError(errorText(err))
      } finally {
        setSaving(false)
      }
    })()
  }

  const onPickAvatar = (): void => {
    fileRef.current?.click()
  }

  const onAvatarChange = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.target.files?.[0]
    // 复位以便同一文件可再次选择（File 引用已捕获，不受影响）
    event.target.value = ''
    if (file === undefined) return
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件（png / jpeg / webp / gif）')
      return
    }
    if (file.size > AVATAR_MAX_BYTES) {
      setError('图片过大 · 请选择 2MB 以内的图片')
      return
    }
    setAvatarBusy(true)
    setError('')
    void (async () => {
      try {
        await uploadProfileAvatar(file)
        toast('头像已更新')
      } catch (err) {
        setError(errorText(err))
      } finally {
        setAvatarBusy(false)
      }
    })()
  }

  const onRemoveAvatar = (): void => {
    setAvatarBusy(true)
    setError('')
    void (async () => {
      try {
        await removeProfileAvatar()
        toast('已移除头像')
      } catch (err) {
        setError(errorText(err))
      } finally {
        setAvatarBusy(false)
      }
    })()
  }

  const onFormKeyDown = (event: KeyboardEvent<HTMLFormElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      cancelEdit()
    }
  }

  const toggleHabit = (habitId: string, done: boolean): void => {
    if (habitBusy !== null) return
    setHabitBusy(habitId)
    void (async () => {
      try {
        if (done) await uncheckinHabit(habitId)
        else await checkinHabit(habitId)
        toast(done ? '已取消打卡' : '已打卡')
      } catch (err) {
        toast(`打卡失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setHabitBusy(null)
      }
    })()
  }

  return (
    <div className="k-view gh-profile">
      <section className="gh-profile-hero" aria-label="个人档案">
        <div className="gh-profile-hero__aura" aria-hidden />
        <div className="gh-profile-hero__main">
          <div className="gh-profile-hero__avatar">
            {avatarUrl !== null ? (
              <img src={avatarUrl} alt="" />
            ) : (
              <span aria-hidden>{profileMonogram(owner)}</span>
            )}
            <i className="gh-profile-hero__status" aria-hidden />
          </div>
          <div className="gh-profile-hero__copy">
            <p className="gh-profile-hero__eyebrow">KERNEL / 个人档案</p>
            <h1>
              {greetingOf(new Date())}，{displayName}
            </h1>
            <p>
              {displayBio === ''
                ? '写一句介绍自己，让这个页面更像你。'
                : displayBio}
            </p>
            <div className="gh-profile-hero__meta">
              <span>{recordCount} 条记录</span>
              <span>最近活动 {lastActiveText}</span>
              <span>{activityPhase === 'ready' ? stats.streak : '—'} 天连续</span>
            </div>
            <div className="gh-profile-hero__actions">
              <button type="button" className="gh-btn gh-btn--primary" onClick={openEdit}>
                编辑资料
              </button>
              <Link to="/profile/activity" className="gh-btn">
                全部动作
              </Link>
            </div>
          </div>
        </div>

        <div className="gh-profile-hero__pulse" aria-label="近 7 天活跃">
          <div className="gh-profile-hero__pulsehead">
            <span>近 7 天</span>
            <b>{weekTotal} 次</b>
          </div>
          {recentDays.length === 0 ? (
            <p className="gh-profile-hero__pulseempty">还没有活动记录</p>
          ) : (
            <>
              <ActivitySparkline days={recentDays} />
              <div className="gh-spark-labels" aria-hidden>
                {recentDays.map((day) => (
                  <span key={day.date}>{formatWeekdayShort(day.date)}</span>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <nav className="gh-tabs gh-profile-tabs" aria-label="个人视图">
        <Link
          to="/profile"
          className={profileTab === 'overview' ? 'gh-tab is-active' : 'gh-tab'}
          aria-current={profileTab === 'overview' ? 'page' : undefined}
        >
          总览
        </Link>
        <Link
          to="/profile?tab=records"
          className={profileTab === 'records' ? 'gh-tab is-active' : 'gh-tab'}
          aria-current={profileTab === 'records' ? 'page' : undefined}
        >
          记录
        </Link>
      </nav>

      {profileTab === 'overview' && (
      <div className="k-profile__desk">
        {/* ============ 左栏 · 身份列（≥1024px 吸顶） ============ */}
        <aside className="k-profile__ident">
          {/* 3 瓦片统计条 */}
          <div className="k-profile__stats" aria-label="活跃统计">
            <div className="k-profile__stat">
              <span className="k-profile__stat-value k-mono">
                {activityPhase === 'ready' ? stats.activeDays : '—'}
              </span>
              <span className="k-profile__stat-label u-label">活跃天数</span>
            </div>
            <div className="k-profile__stat">
              <span className="k-profile__stat-value k-mono">
                {activityPhase === 'ready' ? stats.total : '—'}
              </span>
              <span className="k-profile__stat-label u-label">总计次数</span>
            </div>
            <div className="k-profile__stat">
              <span className="k-profile__stat-value k-mono">
                {activityPhase === 'ready' ? stats.streak : '—'}
              </span>
              <span className="k-profile__stat-label u-label">当前连续</span>
            </div>
          </div>

          <section className="gh-card k-profile__quick">
            <div className="gh-card__head">快捷</div>
            <div className="gh-status-list">
              <Link to="/profile/activity" className="gh-status-row">
                <span>全部动作</span>
                <b>→</b>
              </Link>
              <Link to="/settings" className="gh-status-row">
                <span>设置</span>
                <b>→</b>
              </Link>
              <Link to="/trash" className="gh-status-row">
                <span>回收站</span>
                <b>→</b>
              </Link>
            </div>
          </section>

          {/* 内联编辑表单（ESC / 取消丢弃） */}
          {editing && (
            <form
              className="k-profile__edit"
              onSubmit={(event) => {
                event.preventDefault()
                onSave()
              }}
              onKeyDown={onFormKeyDown}
            >
              <div className="k-field">
                <label className="k-field__label u-label" htmlFor="profile-name">
                  显示名称 · NAME
                </label>
                <input
                  id="profile-name"
                  className="k-input"
                  type="text"
                  maxLength={NAME_MAX}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="怎么称呼你"
                />
              </div>

              <div className="k-field">
                <label className="k-field__label u-label" htmlFor="profile-bio">
                  简介 · BIO（≤160 字）
                </label>
                <textarea
                  id="profile-bio"
                  className="k-textarea"
                  rows={3}
                  maxLength={BIO_MAX}
                  value={bio}
                  onChange={(event) => setBio(event.target.value)}
                  placeholder="一句话介绍自己"
                />
                <span className="k-field__hint">
                  {bio.length}/{BIO_MAX}
                </span>
              </div>

              <div className="k-field">
                <span className="k-field__label u-label">头像 · AVATAR</span>
                <div className="k-profile__avatar-row">
                  <input
                    ref={fileRef}
                    className="k-profile__file"
                    type="file"
                    accept="image/*"
                    onChange={onAvatarChange}
                  />
                  <button
                    type="button"
                    className="k-btn k-btn--sm"
                    onClick={onPickAvatar}
                    disabled={avatarBusy}
                  >
                    {avatarBusy ? '上传中…' : '更换头像'}
                  </button>
                  {hasAvatar && (
                    <button
                      type="button"
                      className="k-btn k-btn--sm is-danger"
                      onClick={onRemoveAvatar}
                      disabled={avatarBusy}
                    >
                      移除头像
                    </button>
                  )}
                </div>
              </div>

              {error !== '' && (
                <p className="k-profile__error" role="alert">
                  {error}
                </p>
              )}

              <div className="k-form__actions">
                <button type="submit" className="k-btn is-solid" disabled={saving}>
                  {saving ? '保存中…' : '保存'}
                </button>
                <button type="button" className="k-btn" onClick={cancelEdit} disabled={saving}>
                  取消
                </button>
              </div>
            </form>
          )}
        </aside>

        {/* ============ 右栏 · 活动流 ============ */}
        <div className="k-profile__stream">
          <section className="gh-card">
            <div className="gh-card__head">
              <span>活跃日历</span>
              <span className="gh-card__muted">
                近 {ACTIVITY_WEEKS} 周 · {activityPhase === 'ready' ? stats.activeDays : '—'} 天活跃
              </span>
            </div>
            <div className="gh-card__body">
              {activityPhase === 'loading' && (
                <p className="k-contrib__note">正在读取活动记录…</p>
              )}
              {activityPhase === 'error' && (
                <p className="k-contrib__note">数据服务离线 · 暂时无法读取活动统计，稍后自动重试。</p>
              )}
              <ActivityCalendar days={activity} weeks={ACTIVITY_WEEKS} />
            </div>
          </section>

          <div className="gh-profile__split">
            <section className="gh-card">
              <div className="gh-card__head">
                <span>我的习惯</span>
                <Link to="/habits" className="gh-link">
                  全部
                </Link>
              </div>
              {habits.length === 0 ? (
                <div className="gh-empty gh-empty--inset">
                  <b>还没有习惯</b>
                  <span>在习惯页创建一个，从今天开始打卡。</span>
                </div>
              ) : (
                <div>
                  {habits.slice(0, 4).map((habit) => {
                    const done = isHabitHitToday(habit.id)
                    const busy = habitBusy === habit.id
                    return (
                      <div key={habit.id} className="gh-row gh-profile-habit">
                        <Link to={`/habits/${habit.id}`} className="gh-profile-habit__main">
                          <span className="gh-row__title">{habit.title}</span>
                          <span className="gh-row__meta">
                            {done ? '今天已完成' : '今天还没打卡'}
                          </span>
                        </Link>
                        <button
                          type="button"
                          className={
                            done ? 'gh-btn gh-btn--sm' : 'gh-btn gh-btn--sm gh-btn--primary'
                          }
                          aria-pressed={done}
                          disabled={busy || habitBusy !== null}
                          onClick={() => toggleHabit(habit.id, done)}
                        >
                          {busy ? '…' : done ? '已打卡' : '打卡'}
                        </button>
                        <span className="gh-badge gh-badge--neutral">
                          {getHabitStreak(habit.id)} 天
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>

            <section className="gh-card">
              <div className="gh-card__head">
                <span>正在推进</span>
                <Link to="/projects" className="gh-link">
                  全部
                </Link>
              </div>
              {activeProjects.length === 0 ? (
                <div className="gh-empty gh-empty--inset">
                  <b>没有进行中的项目</b>
                  <span>在项目页新建一个，把下一步放进去。</span>
                </div>
              ) : (
                <div>
                  {activeProjects.map((project) => {
                    const progress = getProjectProgress(project.id)
                    return (
                      <Link
                        key={project.id}
                        to={`/projects/${project.id}`}
                        className="gh-row gh-row--link"
                      >
                        <span className="gh-row__main">
                          <span className="gh-row__title">{project.title}</span>
                          <span className="gh-row__meta">
                            {progress.done} / {progress.total} 个任务完成
                          </span>
                        </span>
                        <span className="gh-badge gh-badge--neutral">{Math.round(progress.ratio * 100)}%</span>
                      </Link>
                    )
                  })}
                </div>
              )}
            </section>
          </div>

          <section className="gh-card">
            <div className="gh-card__head">
              <span>最近完成</span>
              <Link to="/tasks" className="gh-link">
                全部任务
              </Link>
            </div>
            {completedTasks.length === 0 ? (
              <div className="gh-empty gh-empty--inset">
                <b>还没有完成记录</b>
                <span>完成任务后，这里会留下最近几件。</span>
              </div>
            ) : (
              <div>
                {completedTasks.map((task) => (
                  <Link key={task.id} to={`/tasks/${task.id}`} className="gh-row gh-row--link">
                    <span className="gh-row__main">
                      <span className="gh-row__title">{task.title}</span>
                      <span className="gh-row__meta">
                        完成于 {formatRelative(task.doneAt ?? task.updatedAt)}
                      </span>
                    </span>
                    <span className="gh-badge gh-badge--neutral">已完成</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="gh-card">
            <div className="gh-card__head">
              <span>最近踪迹</span>
              <Link to="/traces" className="gh-link">
                全部
              </Link>
            </div>
            {traces.length === 0 ? (
              <div className="gh-empty gh-empty--inset">
                <b>还没有踪迹</b>
                <span>随手记下做过的事，之后会出现在这里。</span>
              </div>
            ) : (
              <div>
                {traces.map((trace) => (
                  <Link key={trace.id} to={`/traces/${trace.id}`} className="gh-row gh-row--link">
                    <span className="gh-row__main">
                      <span className="gh-row__title">{trace.title}</span>
                      <span className="gh-row__meta">{formatRelative(trace.at)}</span>
                    </span>
                    <span className="gh-badge gh-badge--neutral">踪迹</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="gh-card">
            <div className="gh-card__head">
              <span>最近动作</span>
              <Link to="/profile/activity" className="gh-link">
                全部
              </Link>
            </div>
            {recentActions.length === 0 ? (
              <div className="gh-empty gh-empty--inset">
                <b>还没有动作记录</b>
                <span>新增、完成、打卡、删除和恢复都会留在这里。</span>
              </div>
            ) : (
              <div>
                {recentActions.map((entry) => {
                  const content = (
                    <>
                      <span className="gh-row__main">
                        <span className="gh-row__title">{describeActivity(entry).label}</span>
                        <span className="gh-row__meta">{formatRelative(entry.ts)}</span>
                      </span>
                      <span className="gh-badge gh-badge--neutral">动作</span>
                    </>
                  )
                  const to = deepLinkOfId(entry.id)
                  return to !== null && to !== undefined ? (
                    <Link key={`${entry.ts}-${entry.action}-${entry.id}`} to={to} className="gh-row gh-row--link">
                      {content}
                    </Link>
                  ) : (
                    <div key={`${entry.ts}-${entry.action}-${entry.id}`} className="gh-row">
                      {content}
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>
      </div>
      )}

      {profileTab === 'records' && (
        <div className="gh-profile-records">
          <ActivityTimeline />
        </div>
      )}
    </div>
  )
}
