// KERNEL · 数据服务 · Zod schema（写入前校验的唯一事实源）
// 对齐 docs/04-DATA-MODEL.md；catchall 保留未知字段（前向兼容，不因新增字段拒绝旧记录）。
import { z } from 'zod'

/** ISO 8601 带偏移（或 Z）：2026-10-02T09:00:00+08:00 */
export const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?([+-]\d{2}:\d{2}|Z)$/)

export const inboxSource = z.enum(['manual', 'file', 'notification', 'voice'])
export const inboxStatus = z.enum(['unprocessed', 'clarified', 'discarded'])
export const taskStatus = z.enum(['next', 'waiting', 'scheduled', 'someday', 'done', 'dropped'])
export const energy = z.enum(['low', 'medium', 'high'])
export const noteType = z.enum(['fleeting', 'literature', 'permanent', 'meeting', 'memo'])
export const resourceKind = z.enum(['article', 'course', 'book', 'tool', 'paper', 'file'])
export const resourceStatus = z.enum(['unread', 'reading', 'read', 'reference', 'archived'])

export const taskSchema = z
  .object({
    id: z.string().regex(/^t-\d{4}$/),
    title: z.string().min(1),
    notes: z.string().optional(),
    status: taskStatus,
    contexts: z.array(z.string()),
    energy,
    estimateMin: z.number().optional(),
    importance: z.number().int().min(0).max(3),
    dueAt: iso.optional(),
    deferUntil: iso.optional(),
    projectId: z.string().optional(),
    areaId: z.string().optional(),
    parentTaskId: z.string().optional(),
    tags: z.array(z.string()),
    repeatRule: z.string().optional(),
    createdAt: iso,
    updatedAt: iso,
    doneAt: iso.optional(),
    sourceInboxId: z.string().optional(),
  })
  .catchall(z.unknown())

export const inboxItemSchema = z
  .object({
    id: z.string().regex(/^i-\d{4}$/),
    content: z.string().min(1),
    source: inboxSource,
    capturedAt: iso,
    status: inboxStatus,
    linkedId: z.string().optional(),
    note: z.string().optional(),
  })
  .catchall(z.unknown())

export const noteSchema = z
  .object({
    id: z.string().regex(/^n-\d{4}$/),
    title: z.string().min(1),
    type: noteType,
    body: z.string(),
    links: z.array(z.string()),
    areaId: z.string().optional(),
    projectId: z.string().optional(),
    tags: z.array(z.string()),
    distillLevel: z.number().int().min(0).max(3),
    createdAt: iso,
    updatedAt: iso,
  })
  .catchall(z.unknown())

export const resourceSchema = z
  .object({
    id: z.string().regex(/^r-\d{4}$/),
    title: z.string().min(1),
    url: z.string().optional(),
    kind: resourceKind,
    status: resourceStatus,
    tags: z.array(z.string()),
    areaId: z.string().optional(),
    addedAt: iso,
    note: z.string().optional(),
  })
  .catchall(z.unknown())

export const projectStatus = z.enum(['active', 'onHold', 'someday', 'done', 'archived'])

export const projectSchema = z
  .object({
    id: z.string().regex(/^p-\d{4}$/),
    title: z.string().min(1),
    outcome: z.string(),
    status: projectStatus,
    areaId: z.string(),
    goalId: z.string().optional(),
    nextActionId: z.string().optional(),
    dueAt: iso.optional(),
    tags: z.array(z.string()),
    createdAt: iso,
    updatedAt: iso,
  })
  .catchall(z.unknown())

/** 可写实体：kind → schema（与 data/ 下目录名一致） */
export const SCHEMAS = {
  tasks: taskSchema,
  inbox: inboxItemSchema,
  notes: noteSchema,
  resources: resourceSchema,
  projects: projectSchema,
}

/** 实体 kind → id 模式（防目录穿越；与 docs/04 ID 约定一致） */
export const ID_PATTERNS = {
  tasks: /^t-\d{4}$/,
  inbox: /^i-\d{4}$/,
  notes: /^n-\d{4}$/,
  resources: /^r-\d{4}$/,
  projects: /^p-\d{4}$/,
}
