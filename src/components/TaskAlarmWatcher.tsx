// KERNEL · 任务闹铃（Phase 1：页面打开时响铃）
// 15s 轮询本地快照；alarmAt 到点且任务未完成/未丢弃 → 播放铃声 + 浏览器通知 + 应用内弹窗。
// 去重 / 稍后提醒只存 localStorage（界面记忆，不写 data/）。
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '@/components/Modal'
import { getSnapshot } from '@/lib/data'
import { formatDateTime } from '@/lib/date'
import { useDataRevision } from '@/lib/hooks'
import type { Task } from '@/types'

const FIRED_KEY = 'kernel.ui.alarms.fired.v1'
const SNOOZE_KEY = 'kernel.ui.alarms.snooze.v1'
const CHECK_MS = 15_000
const SNOOZE_MS = 10 * 60_000

function readMap(key: string): Record<string, string> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}')
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed as Record<string, string>
  } catch {
    return {}
  }
}

function writeMap(key: string, value: Record<string, string>): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 配额满：静默降级为本次会话内去重 */
  }
}

function alarmKey(task: Task): string {
  return `${task.id}|${task.alarmAt ?? ''}`
}

type AudioWindow = Window & { webkitAudioContext?: typeof AudioContext }

export function TaskAlarmWatcher() {
  useDataRevision()
  const navigate = useNavigate()
  const [pending, setPending] = useState<Task | null>(null)
  const [blocked, setBlocked] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const beepTimerRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const stopAudio = (): void => {
    if (audioRef.current !== null) {
      audioRef.current.pause()
      audioRef.current.src = ''
      audioRef.current = null
    }
    if (beepTimerRef.current !== null) {
      window.clearInterval(beepTimerRef.current)
      beepTimerRef.current = null
    }
    if (audioContextRef.current !== null) {
      void audioContextRef.current.close().catch(() => undefined)
      audioContextRef.current = null
    }
  }

  const startBeep = (): void => {
    const AudioCtor = window.AudioContext ?? (window as AudioWindow).webkitAudioContext
    if (AudioCtor === undefined) {
      setBlocked(true)
      return
    }
    try {
      const ctx = new AudioCtor()
      audioContextRef.current = ctx
      void ctx.resume().catch(() => setBlocked(true))
      const beep = (): void => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = 880
        gain.gain.value = 0.16
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.35)
      }
      beep()
      beepTimerRef.current = window.setInterval(beep, 1000)
    } catch {
      setBlocked(true)
    }
  }

  const playSound = (task: Task): void => {
    stopAudio()
    if (task.alarmSoundId !== undefined && task.alarmSoundId !== '') {
      const audio = new Audio(`/api/alarm/sounds/${task.alarmSoundId}/file`)
      audio.loop = true
      audio.volume = 1
      audioRef.current = audio
      void audio.play().catch(() => {
        setBlocked(true)
        startBeep()
      })
      return
    }
    startBeep()
  }

  const ring = (task: Task): void => {
    const key = alarmKey(task)
    const fired = readMap(FIRED_KEY)
    if (fired[key] !== undefined) return
    fired[key] = new Date().toISOString()
    writeMap(FIRED_KEY, fired)
    setBlocked(false)
    setPending(task)
    playSound(task)
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        const notice = new Notification('KERNEL 闹铃', {
          body: `${task.title}\n${task.alarmAt !== undefined ? formatDateTime(task.alarmAt) : ''}`,
          tag: key,
        })
        notice.onclick = () => {
          window.focus()
          notice.close()
        }
      } catch {
        /* 通知失败不影响应用内闹铃 */
      }
    }
  }

  const stop = (): void => {
    stopAudio()
    setPending(null)
    setBlocked(false)
  }

  const snooze = (): void => {
    if (pending === null) return
    const key = alarmKey(pending)
    const fired = readMap(FIRED_KEY)
    delete fired[key]
    writeMap(FIRED_KEY, fired)
    const snoozeMap = readMap(SNOOZE_KEY)
    snoozeMap[key] = new Date(Date.now() + SNOOZE_MS).toISOString()
    writeMap(SNOOZE_KEY, snoozeMap)
    stop()
  }

  const retryRing = (): void => {
    if (pending === null) return
    setBlocked(false)
    playSound(pending)
  }

  useEffect(() => {
    const check = (): void => {
      if (pending !== null) return
      const now = Date.now()
      const fired = readMap(FIRED_KEY)
      const snoozed = readMap(SNOOZE_KEY)
      const due = getSnapshot()
        .tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped')
        .filter((task) => task.alarmAt !== undefined && task.alarmAt !== '')
        .map((task) => ({ task, at: new Date(task.alarmAt ?? '').getTime() }))
        .filter((item) => Number.isFinite(item.at) && item.at <= now)
        .filter((item) => {
          const key = alarmKey(item.task)
          if (fired[key] !== undefined) return false
          const until = snoozed[key] !== undefined ? new Date(snoozed[key]).getTime() : 0
          return !Number.isFinite(until) || until <= now
        })
        .sort((a, b) => a.at - b.at)
      if (due.length > 0) ring(due[0].task)
    }

    check()
    const timer = window.setInterval(check, CHECK_MS)
    window.addEventListener('focus', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [pending])

  useEffect(() => stopAudio, [])

  return (
    <Modal
      open={pending !== null}
      onClose={stop}
      kicker="KERNEL · ALARM"
      title="闹铃"
      footer={
        <div className="k-modal__foot-actions">
          <button type="button" className="k-btn" onClick={snooze}>
            10 分钟后提醒
          </button>
          <button type="button" className="k-btn is-solid" onClick={blocked ? retryRing : stop}>
            {blocked ? '响铃' : '停止'}
          </button>
        </div>
      }
    >
      {pending !== null && (
        <>
          <p className="k-view__intro">
            {pending.title}
            {pending.alarmAt !== undefined && ` · ${formatDateTime(pending.alarmAt)}`}
          </p>
          {blocked && (
            <p className="k-view__intro k-muted">
              浏览器阻止了自动播放，点「响铃」继续；也可以到「设置 → 闹铃」开启浏览器通知。
            </p>
          )}
          <div className="k-view__actions">
            <button
              type="button"
              className="k-btn k-btn--sm"
              onClick={() => {
                const id = pending.id
                stop()
                navigate(`/tasks?task=${id}`)
              }}
            >
              查看任务
            </button>
          </div>
        </>
      )}
    </Modal>
  )
}
