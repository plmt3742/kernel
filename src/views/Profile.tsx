// KERNEL · 个人页 PROFILE
// 资料卡（头像 / 名称 / 简介 + 内联编辑 + 头像上传·移除）+ 活跃贡献日历（异步）+
// 动作时间线（复用 ActivityTimeline，只读审计）。
// 资料写入走 POST /api/config 与 /api/profile/avatar*（唯一写者）；成功后整体水合。
// 活动统计经 api 客户端读 GET /api/activity/summary（挂载 + revision 变化时刷新）。
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react'
import { Panel } from '@/components/Panel'
import { ActivityCalendar, type ActivityDay } from '@/components/ActivityCalendar'
import { ActivityTimeline } from '@/components/ActivityTimeline'
import { api, errorText } from '@/lib/api'
import { getConfig, profileAvatarUrl, profileMonogram } from '@/lib/data'
import { useDataRevision } from '@/lib/hooks'
import { useToast } from '@/context/ToastContext'
import {
  removeProfileAvatar,
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

type ActivityPhase = 'loading' | 'ready' | 'error'

export function Profile(): ReactNode {
  const { toast } = useToast()
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

  const owner = config.owner?.trim() ?? ''
  const displayName = owner === '' ? '未命名' : owner
  const displayBio = config.bio?.trim() ?? ''
  const avatarUrl = profileAvatarUrl(config.avatarPath)
  const hasAvatar = config.avatarPath !== undefined && config.avatarPath.trim() !== ''

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

  return (
    <div className="k-view">
      {/* 资料卡 */}
      <section className="k-profile__card" aria-label="个人资料">
        <div className="k-profile__avatar">
          {avatarUrl !== null ? (
            <img className="k-profile__avatar-img" src={avatarUrl} alt="" />
          ) : (
            <span className="k-profile__avatar-mono" aria-hidden>
              {profileMonogram(owner)}
            </span>
          )}
        </div>
        <div className="k-profile__body">
          <h2 className="k-profile__name">{displayName}</h2>
          <p className={displayBio === '' ? 'k-profile__bio is-empty' : 'k-profile__bio'}>
            {displayBio === '' ? '还没有简介 · 点「编辑资料」写一句' : displayBio}
          </p>
        </div>
        {!editing && (
          <div className="k-profile__actions">
            <button type="button" className="k-btn k-btn--sm" onClick={openEdit}>
              编辑资料
            </button>
          </div>
        )}
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

      {/* 活跃贡献日历（异步） */}
      <Panel title="活跃日历" en={`ACTIVITY · 近 ${ACTIVITY_WEEKS} 周`}>
        {activityPhase === 'loading' && (
          <p className="k-contrib__note">正在读取活动记录…</p>
        )}
        {activityPhase === 'error' && (
          <p className="k-contrib__note">数据服务离线 · 暂时无法读取活动统计，稍后自动重试。</p>
        )}
        <ActivityCalendar days={activity} weeks={ACTIVITY_WEEKS} />
      </Panel>

      {/* 动作时间线（复用既有只读审计时间线） */}
      <section className="k-profile__section" aria-label="动作时间线">
        <header className="k-profile__sechead">
          <h2 className="k-profile__sechead-cn">动作时间线</h2>
          <span className="u-label">ACTIVITY · 只读审计</span>
        </header>
        <ActivityTimeline />
      </section>
    </div>
  )
}
