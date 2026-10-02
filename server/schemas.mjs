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
    // 文件投递（v0.5 · Slice D）：附件元数据；二进制存 data/files/<id>-<name>（不进 git）
    file: z
      .object({
        name: z.string().min(1),
        size: z.number().int().min(0),
        mime: z.string().optional(),
      })
      .optional(),
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
    // 本地文件绝对路径（Slice E2）：文件投递澄清为资料时写入；可用于「在文件管理器中显示」
    path: z.string().min(1).optional(),
    kind: resourceKind,
    status: resourceStatus,
    tags: z.array(z.string()),
    areaId: z.string().optional(),
    addedAt: iso,
    note: z.string().optional(),
  })
  .catchall(z.unknown())

export const projectStatus = z.enum(['active', 'onHold', 'someday', 'done', 'archived'])

/** 回顾类型（周 / 月） */
export const reviewType = z.enum(['weekly', 'monthly'])

/** 回顾指标（对齐 docs/04 §4.10；`migrated` 可缺省——生成流程暂不产出，编辑追踪落地后补） */
export const reviewMetricsSchema = z.object({
  captured: z.number().int().min(0),
  created: z.number().int().min(0),
  completed: z.number().int().min(0),
  overdue: z.number().int().min(0),
  migrated: z.number().int().min(0).optional(),
})

export const reviewSchema = z
  .object({
    id: z.string().regex(/^rev-\d{4}$/),
    type: reviewType,
    periodKey: z.string().min(1),
    date: iso,
    metrics: reviewMetricsSchema,
    decisions: z.array(z.string().min(1).max(200)),
    // 报告 v2（Slice L）：7 段结构正文（结论速览 → … → 风险预警），≤800 汉字；上限保持 2000
    summary: z.string().min(1).max(2000),
    staleProjectIds: z.array(z.string()).optional(),
    // 自动归档（Slice L）：source='ai' 表示由 AI 生成后系统自动归档；旧记录缺省
    source: z.enum(['ai', 'manual']).optional(),
    // 用户编辑归档报告时 bump（review.update）；旧记录缺省
    updatedAt: iso.optional(),
  })
  .catchall(z.unknown())

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
  reviews: reviewSchema,
}

/** 实体 kind → id 模式（防目录穿越；与 docs/04 ID 约定一致） */
export const ID_PATTERNS = {
  tasks: /^t-\d{4}$/,
  inbox: /^i-\d{4}$/,
  notes: /^n-\d{4}$/,
  resources: /^r-\d{4}$/,
  projects: /^p-\d{4}$/,
  areas: /^a-\d{4}$/,
  reviews: /^rev-\d{4}$/,
}

/* ---------------------------------------------------------------------------
 * AI（v0.5）：收件箱解析建议 + 澄清覆盖字段
 * 说明：AI 只产出「建议」，真正落盘仍走 commit()；本文件只做形状校验。
 * ------------------------------------------------------------------------- */

/** AI 收件箱解析建议（不完全对应任何持久化实体，仅作前端预览/应用） */
export const aiSuggestionSchema = z.object({
  target: z.enum(['task', 'note', 'resource', 'discard']),
  title: z.string().min(1).max(80),
  contexts: z.array(z.string().min(1)).max(5).default([]),
  energy,
  importance: z.number().int().min(1).max(3),
  estimateMin: z.number().int().min(1).max(600).optional(),
  // 允许模型显式返回 null（"无截止/无关联"），post-validate 时丢弃
  dueAt: z.union([iso, z.null()]).optional(),
  // 关联建议：只能来自系统摘要中列出的 id / 标签，post-validate 时按快照过滤
  projectId: z.union([z.string(), z.null()]).optional(),
  areaId: z.union([z.string(), z.null()]).optional(),
  duplicateOf: z.union([z.string(), z.null()]).optional(),
  // 新事务提示（Slice E2.5）：与 projectId 互斥；≤40 字；仅提示，不自动创建
  newProjectHint: z.union([z.string(), z.null()]).optional(),
  tags: z.array(z.string().min(1)).max(5).default([]),
  reason: z.string().max(300).default(''),
})

/**
 * AI 任务快速新建草稿（v0.5 · Slice H）：「只填标题」新建的任务 → AI 补全建议。
 * 全部字段可选：模型拿不准就不返回该键；前端按实际返回字段呈现「应用 / 忽略」。
 * 关联 id / 标签经 postValidate 按快照过滤（防臆造）；绝不自动落盘。
 */
export const taskDraftSchema = z.object({
  contexts: z.array(z.string().min(1)).max(5).default([]),
  energy: energy.optional(),
  importance: z.number().int().min(1).max(3).optional(),
  estimateMin: z.number().int().min(1).max(600).optional(),
  dueAt: z.union([iso, z.null()]).optional(),
  projectId: z.union([z.string(), z.null()]).optional(),
  areaId: z.union([z.string(), z.null()]).optional(),
  tags: z.array(z.string().min(1)).max(5).default([]),
  reason: z.string().max(300).default(''),
})

/** 停滞项目处置建议（AI 周回顾草稿产出；action 决定处置方式） */
export const staleAdviceSchema = z.object({
  projectId: z.string().min(1),
  action: z.enum(['archive', 'migrate', 'reactivate']),
  reason: z.string().max(200).default(''),
})

/** AI 周回顾草稿（只作前端预览；用户确认后经 /api/reviews 落盘） */
export const reviewDraftSchema = z.object({
  summary: z.string().min(1).max(2000),
  decisions: z.array(z.string().min(1).max(200)).max(6).default([]),
  staleAdvice: z.array(staleAdviceSchema).default([]),
})

/**
 * 任务创建可选字段（v0.5 · Slice O）：「先确认后写入」的草稿确认流经 `POST /api/tasks`
 * 一次性携带用户确认（含编辑）后的字段；与 clarifyDetailsSchema 同口径（title 单独校验，
 * 保持仅传标题的旧调用行为不变）。zod 默认剥离未知键，故 body 中多余的 title 会被忽略。
 */
export const taskCreateFieldsSchema = z.object({
  contexts: z.array(z.string().min(1)).max(8).optional(),
  energy: energy.optional(),
  importance: z.number().int().min(1).max(3).optional(),
  estimateMin: z.number().int().min(1).max(600).optional(),
  dueAt: iso.optional(),
  tags: z.array(z.string().min(1)).max(8).optional(),
  projectId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
})

/** 澄清时的可选覆盖字段（AI 应用或手工预填；全部可选） */
export const clarifyDetailsSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  contexts: z.array(z.string().min(1)).max(8).optional(),
  energy: energy.optional(),
  importance: z.number().int().min(1).max(3).optional(),
  estimateMin: z.number().int().min(1).max(600).optional(),
  dueAt: iso.optional(),
  tags: z.array(z.string().min(1)).max(8).optional(),
  projectId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
})
