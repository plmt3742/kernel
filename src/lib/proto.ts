// KERNEL · 原型态本地存储（v0.3）
// 纪律：只读写 localStorage，绝不触碰 data/**；所有键名集中于此，便于 v0.4 迁移到数据服务。
// 说明：这些状态是"原型态"（界面标注），用于演示交互与跨视图联动，不是事实源。
import { useMemo, useSyncExternalStore } from 'react'
import type { InboxSource, Task } from '@/types'

const DONE_KEY = 'kernel:proto:done'
const INBOX_KEY = 'kernel:proto:inbox'
const TASKS_KEY = 'kernel:proto:tasks'

/** 原型态收件箱条目（仅手动捕捉） */
export interface ProtoInboxItem {
  id: string
  content: string
  capturedAt: string
  source: InboxSource
}

/* ---------------------------------------------------------------------------
 * 微型 store：模块级缓存 + 订阅（同一标签页内即时联动）
 * ------------------------------------------------------------------------- */

type Listener = () => void
const listeners = new Set<Listener>()

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function write<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* 隐私模式 / 配额不足：静默降级，界面仍可用 */
  }
}

/* ---------------------------------------------------------------------------
 * 完成态（kernel:proto:done）
 * ------------------------------------------------------------------------- */

let doneIds: string[] = read<string[]>(DONE_KEY, [])

/** 稳定引用：供 useSyncExternalStore 使用 */
export function getDoneIds(): string[] {
  return doneIds
}

export function toggleDone(id: string): void {
  doneIds = doneIds.includes(id) ? doneIds.filter((x) => x !== id) : [...doneIds, id]
  write(DONE_KEY, doneIds)
  emit()
}

export function isDoneProto(id: string): boolean {
  return doneIds.includes(id)
}

/** 订阅原型态完成集合，返回 { ids, set, toggle } */
export function useDone(): {
  ids: string[]
  set: Set<string>
  toggle: (id: string) => void
} {
  const ids = useSyncExternalStore(subscribe, getDoneIds, getDoneIds)
  const set = useMemo(() => new Set(ids), [ids])
  return { ids, set, toggle: toggleDone }
}

/** 任务的有效完成状态（真实 done 或原型态勾选） */
export function isTaskDone(task: Task, doneSet: Set<string>): boolean {
  return task.status === 'done' || doneSet.has(task.id)
}

/* ---------------------------------------------------------------------------
 * 收件箱捕捉（kernel:proto:inbox）
 * ------------------------------------------------------------------------- */

let protoInbox: ProtoInboxItem[] = read<ProtoInboxItem[]>(INBOX_KEY, [])
let inboxSeq = 0

export function getProtoInbox(): ProtoInboxItem[] {
  return protoInbox
}

export function addProtoInbox(content: string): ProtoInboxItem {
  const item: ProtoInboxItem = {
    id: `proto-i-${Date.now().toString(36)}-${inboxSeq++}`,
    content: content.trim(),
    capturedAt: new Date().toISOString(),
    source: 'manual',
  }
  protoInbox = [item, ...protoInbox]
  write(INBOX_KEY, protoInbox)
  emit()
  return item
}

export function useProtoInbox(): ProtoInboxItem[] {
  return useSyncExternalStore(subscribe, getProtoInbox, getProtoInbox)
}

/* ---------------------------------------------------------------------------
 * 快速新建任务（kernel:proto:tasks）
 * ------------------------------------------------------------------------- */

let protoTasks: Task[] = read<Task[]>(TASKS_KEY, [])
let taskSeq = 0

export function getProtoTasks(): Task[] {
  return protoTasks
}

export function addProtoTask(title: string): Task {
  const now = new Date().toISOString()
  const task: Task = {
    id: `proto-t-${Date.now().toString(36)}-${taskSeq++}`,
    title: title.trim(),
    status: 'next',
    contexts: ['@computer'],
    energy: 'low',
    importance: 2,
    tags: [],
    createdAt: now,
    updatedAt: now,
  }
  protoTasks = [task, ...protoTasks]
  write(TASKS_KEY, protoTasks)
  emit()
  return task
}

export function useProtoTasks(): Task[] {
  return useSyncExternalStore(subscribe, getProtoTasks, getProtoTasks)
}

/* ---------------------------------------------------------------------------
 * 维护
 * ------------------------------------------------------------------------- */

/** 清空全部原型态数据（设置页"清除原型态"用） */
export function resetProto(): void {
  doneIds = []
  protoInbox = []
  protoTasks = []
  write(DONE_KEY, doneIds)
  write(INBOX_KEY, protoInbox)
  write(TASKS_KEY, protoTasks)
  emit()
}
