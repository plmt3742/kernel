// KERNEL · 数据变更动作（唯一写入通道：经数据服务 API）
// 策略：本机写入毫秒级——任务完成采用乐观更新（即时反馈）+ 失败回滚；其余动作等待服务确认。
// 纪律：任何写入失败都要显式抛出（由调用方 toast 提示），不静默吞掉。
import { api } from '@/lib/api'
import { getTaskById, removeEntity, replaceSnapshot, setDataSource, upsertEntity } from '@/lib/data'
import { toISODateTime } from '@/lib/date'
import type { InboxItem, KernelSnapshot, Note, Project, Resource, Task } from '@/types'

/* ---------------------------------------------------------------------------
 * 快照水合（挂载 / 窗口聚焦 / 多标签同步）
 * ------------------------------------------------------------------------- */

export async function hydrateFromServer(): Promise<boolean> {
  try {
    const snapshot = await api.get<KernelSnapshot>('/api/snapshot')
    replaceSnapshot(snapshot)
    return true
  } catch {
    setDataSource('offline')
    return false
  }
}

/* ---------------------------------------------------------------------------
 * 任务
 * ------------------------------------------------------------------------- */

/** 有效完成态（v0.4 起完成即落盘 status==='done' + doneAt） */
export function isTaskDone(task: Task): boolean {
  return task.status === 'done'
}

function optimisticTask(id: string, patch: Partial<Task>): Task | undefined {
  const prev = getTaskById(id)
  if (prev !== undefined) {
    upsertEntity('tasks', { ...prev, ...patch, updatedAt: toISODateTime(new Date()) })
  }
  return prev
}

export async function completeTask(id: string): Promise<Task> {
  const prev = optimisticTask(id, { status: 'done', doneAt: toISODateTime(new Date()) })
  try {
    const { task } = await api.post<{ task: Task }>(`/api/tasks/${id}/complete`)
    upsertEntity('tasks', task)
    return task
  } catch (err) {
    if (prev !== undefined) upsertEntity('tasks', prev)
    throw err
  }
}

export async function reopenTask(id: string): Promise<Task> {
  const prev = optimisticTask(id, { status: 'next', doneAt: undefined })
  try {
    const { task } = await api.post<{ task: Task }>(`/api/tasks/${id}/reopen`)
    upsertEntity('tasks', task)
    return task
  } catch (err) {
    if (prev !== undefined) upsertEntity('tasks', prev)
    throw err
  }
}

export async function createTask(title: string): Promise<Task> {
  const { task } = await api.post<{ task: Task }>('/api/tasks', { title })
  upsertEntity('tasks', task)
  return task
}

/* ---------------------------------------------------------------------------
 * 收件箱
 * ------------------------------------------------------------------------- */

export async function captureInbox(content: string): Promise<InboxItem> {
  const { inbox } = await api.post<{ inbox: InboxItem }>('/api/inbox', { content })
  upsertEntity('inbox', inbox)
  return inbox
}

export type ClarifyTarget = 'task' | 'project' | 'note' | 'resource' | 'discard'

export type CreatedKind = 'tasks' | 'projects' | 'notes' | 'resources'

export interface ClarifyResult {
  inbox: InboxItem
  created: { kind: CreatedKind; record: Task | Project | Note | Resource } | null
}

export async function clarifyInbox(id: string, target: ClarifyTarget): Promise<ClarifyResult> {
  const result = await api.post<ClarifyResult>(`/api/inbox/${id}/clarify`, { target })
  upsertEntity('inbox', result.inbox)
  if (result.created !== null) upsertEntity(result.created.kind, result.created.record)
  return result
}

export interface RevertResult {
  inbox: InboxItem
  removed: { kind: CreatedKind; id: string } | null
}

export async function revertInbox(id: string): Promise<RevertResult> {
  const result = await api.post<RevertResult>(`/api/inbox/${id}/revert`)
  upsertEntity('inbox', result.inbox)
  if (result.removed !== null) removeEntity(result.removed.kind, result.removed.id)
  return result
}
