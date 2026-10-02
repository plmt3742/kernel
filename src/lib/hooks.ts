// KERNEL · 共享 React hooks（时刻刷新 / 数据订阅 / 完成切换 + 撤销）
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { useToast } from '@/context/ToastContext'
import { errorText } from '@/lib/api'
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
