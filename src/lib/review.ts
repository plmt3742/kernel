// KERNEL · 回顾自动化状态与调度（v0.5 · 回顾自动化）
//
// 目的：每天中午后由 shell 静默跑一次周 / 月回顾草稿生成。服务端 `/api/ai/review/draft`
//   成功即自动归档（审计 review.create · auto），本模块只决定「何时该跑」并在失败时保持安静。
//
// 纪律：
//   · 本模块**不落盘任何派生数据**：是否已生成完全由 `getReviews()` 里的 periodKey 判定；
//     仅「本会话已尝试」守卫（内存）与跨标签锁（localStorage）属于界面状态，非数据实体；
//   · 每个周期（ISO 周 / 自然月）每个会话最多尝试一次；AI 离线静默跳过，绝不 toast 报错；
//   · 写入仍只经单写者数据服务，前端不直接写文件；
//   · 周期键取**本地**时间（date.ts 的 isoWeekKey / toMonthKey），绝不用 toISOString（UTC 偏移会跨期）。
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { getDataSource, getReviews } from '@/lib/data'
import { isoWeekKey, startOfWeek, toMonthKey } from '@/lib/date'
import { generateReviewDraft, hydrateFromServer } from '@/lib/mutations'
import type { ReviewType } from '@/types'
import { useToast } from '@/context/ToastContext'

/* ---------------------------------------------------------------------------
 * 调度常量 / 守卫
 * ------------------------------------------------------------------------- */

const TICK_MS = 30_000
const NOON_HOUR = 12
const NOON_MS = NOON_HOUR * 3_600_000
const LOCK_KEY = 'kernel.ui.review.lock.v1'
const LOCK_TTL_MS = 120_000

/** 会话内「本周期已尝试」守卫：探活前即置位，避免 30s tick 反复探活（AI 离线时也不风暴） */
const attemptedPeriodKeys = new Set<string>()

/** 跨标签锁：并发窗口内仅一个标签真正发起网络请求（与 organize 同口径） */
function tryAcquireLock(): boolean {
  try {
    const raw = window.localStorage.getItem(LOCK_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { startedAt?: unknown }
      if (typeof parsed.startedAt === 'number' && Date.now() - parsed.startedAt < LOCK_TTL_MS) {
        return false
      }
    }
    window.localStorage.setItem(LOCK_KEY, JSON.stringify({ startedAt: Date.now() }))
    return true
  } catch {
    // localStorage 不可用（隐私模式等）：视为已获取，由会话守卫兜底
    return true
  }
}

function releaseLock(): void {
  try {
    window.localStorage.removeItem(LOCK_KEY)
  } catch {
    /* 静默 */
  }
}

/** 复用收件箱自动解析的健康探活口径 */
async function probeAiAvailable(): Promise<boolean> {
  try {
    const health = await api.get<{ available: boolean }>('/api/ai/health')
    return health.available === true
  } catch {
    return false
  }
}

/* ---------------------------------------------------------------------------
 * 到期判定（运行时派生，绝不落盘）
 * ------------------------------------------------------------------------- */

/** 周到期：当前 ISO 周内且已过本周一 12:00（叠加每日 12:00 门闸） */
function weeklyDue(now: Date): boolean {
  if (now.getHours() < NOON_HOUR) return false
  return now.getTime() >= startOfWeek(now).getTime() + NOON_MS
}

/** 月到期：已过本月 1 日 12:00（叠加每日 12:00 门闸） */
function monthlyDue(now: Date): boolean {
  if (now.getHours() < NOON_HOUR) return false
  const firstNoon = new Date(now.getFullYear(), now.getMonth(), 1, NOON_HOUR, 0, 0, 0)
  return now.getTime() >= firstNoon.getTime()
}

interface DuePeriod {
  period: ReviewType
  periodKey: string
}

/** 挑选本轮应生成的周期：到期 + 该 periodKey 尚无归档 + 本会话未尝试（周优先于月） */
function pickDuePeriod(now: Date): DuePeriod | null {
  const existingKeys = new Set(getReviews().map((review) => review.periodKey))
  const candidates: Array<{ period: ReviewType; periodKey: string; due: boolean }> = [
    { period: 'weekly', periodKey: isoWeekKey(now), due: weeklyDue(now) },
    { period: 'monthly', periodKey: toMonthKey(now), due: monthlyDue(now) },
  ]
  for (const candidate of candidates) {
    if (!candidate.due) continue
    if (existingKeys.has(candidate.periodKey)) continue
    if (attemptedPeriodKeys.has(candidate.periodKey)) continue
    return { period: candidate.period, periodKey: candidate.periodKey }
  }
  return null
}

/* ---------------------------------------------------------------------------
 * 静默调度
 * ------------------------------------------------------------------------- */

async function tick(notify: (period: ReviewType) => void): Promise<void> {
  // 未水合（离线 / 首屏未拉到快照）不跑：避免以空 reviews 误判「尚未生成」
  if (getDataSource() !== 'server') return
  const now = new Date()
  const due = pickDuePeriod(now)
  if (due === null) return
  if (!tryAcquireLock()) return

  // 守卫先置位：即使随后探活 / 生成失败，本会话也不再重复尝试该周期
  attemptedPeriodKeys.add(due.periodKey)
  try {
    // 跨标签保守校验：先拉最新快照，避免他标签刚归档的同一周期被重复生成
    if (!(await hydrateFromServer())) return
    if (getReviews().some((review) => review.periodKey === due.periodKey)) return
    if (!(await probeAiAvailable())) return
    await generateReviewDraft(due.period)
    await hydrateFromServer()
    notify(due.period)
  } catch {
    // 静默：后台自动化失败不打扰用户，也不 toast（与 organize 一致）
  } finally {
    releaseLock()
  }
}

/**
 * 每日调度：挂载即 tick 一次；每 30s 轮询；可见性恢复 / 窗口聚焦即时补跑。
 * 中午前不跑；该周期已有归档 / 本会话已尝试 / 他标签持锁时不跑；AI 离线静默跳过。
 */
export function useReviewScheduler(): void {
  const { toast } = useToast()
  const navigate = useNavigate()

  useEffect(() => {
    const notify = (period: ReviewType): void => {
      toast(period === 'weekly' ? '已自动生成本周回顾 · 查看' : '已自动生成本月回顾 · 查看', {
        action: { label: '查看', onClick: () => navigate('/review', { viewTransition: true }) },
      })
    }
    const run = (): void => {
      void tick(notify)
    }
    run()
    const timer = window.setInterval(run, TICK_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [navigate, toast])
}
