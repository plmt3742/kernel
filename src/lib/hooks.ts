// KERNEL · 共享 React hooks（时刻刷新 / 数据订阅 / 完成切换 + 撤销）
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useToast } from '@/context/ToastContext'
import { api, errorText } from '@/lib/api'
import { getDataSource, getRevision, subscribeData, type DataSource } from '@/lib/data'
import { completeTask, reopenTask } from '@/lib/mutations'
import type { Task } from '@/types'

/** 统一「当前时刻」：每 intervalMs 自动刷新，供日期派生与相对时间同口径消费 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

/** 订阅数据快照版本：任何写入 / 水合后触发重渲染 */
export function useDataRevision(): number {
  return useSyncExternalStore(subscribeData, getRevision, getRevision)
}

/** AI（opencode）健康状态：挂载即查 + 每 60s 轮询；请求失败按离线处理 */
export interface AiHealth {
  status: 'checking' | 'online' | 'offline'
  model: string | null
  /**
   * DeepSeek API Key 是否已配置（Slice N5）：独立于 opencode 在线状态展示。
   * 兼容旧服务端 / 离线的容错读取——响应缺 hasKey 或请求失败时按「未配置」保守兜底。
   */
  hasKey: boolean
  /** 强制立即复查（保存 / 清除 API Key 后调用以刷新状态 pill） */
  refresh: () => void
}

/** 内部状态：不含 refresh（避免把函数写进 state） */
interface AiHealthCore {
  status: AiHealth['status']
  model: string | null
  hasKey: boolean
}

export function useAiHealth(): AiHealth {
  const [health, setHealth] = useState<AiHealthCore>({ status: 'checking', model: null, hasKey: false })
  // tick 变化即触发 effect 重跑 = 立即复查 + 重置轮询计时
  const [tick, setTick] = useState(0)
  const refresh = useCallback((): void => setTick((n) => n + 1), [])
  useEffect(() => {
    let cancelled = false
    const check = (): void => {
      void api
        .get<{ available: boolean; model: string | null; url: string; hasKey?: boolean }>('/api/ai/health')
        .then((res) => {
          if (cancelled) return
          setHealth({
            status: res.available ? 'online' : 'offline',
            model: res.available ? res.model : null,
            // 容错：离线 / 旧服务端不带 hasKey 时保守视为未配置，绝不臆造「已配置」
            hasKey: res.hasKey === true,
          })
        })
        .catch(() => {
          if (!cancelled) setHealth({ status: 'offline', model: null, hasKey: false })
        })
    }
    check()
    const timer = window.setInterval(check, 60_000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [tick])
  return { ...health, refresh }
}

/** 数据源状态（seed 首帧 / server 已连接 / offline 服务离线） */
export function useDataSource(): DataSource {
  useDataRevision()
  return getDataSource()
}

/** 完成 / 取消完成（乐观更新 + 撤销 toast）；返回 wasDone（供调用方安排塌缩动效等） */
export function useUndoableToggle(): (task: Task) => boolean {
  const toast = useToast().toast
  return useCallback(
    (task: Task): boolean => {
      const wasDone = task.status === 'done'
      const title = task.title.length > 18 ? `${task.title.slice(0, 18)}…` : task.title
      void (async () => {
        try {
          if (wasDone) await reopenTask(task.id)
          else await completeTask(task.id)
          toast(`${wasDone ? '已重新打开' : '已完成'} · ${title}`, {
            action: {
              label: '撤销',
              onClick: () => {
                void (wasDone ? completeTask(task.id) : reopenTask(task.id)).catch((err) => {
                  toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
                })
              },
            },
          })
        } catch (err) {
          toast(`保存失败：${errorText(err)}`, { tone: 'error' })
        }
      })()
      return wasDone
    },
    [toast],
  )
}
