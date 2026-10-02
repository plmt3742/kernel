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
/** 日程状态（v0.5 · Slice W）：tentative → confirmed → cancelled（见 ADR-0018） */
export const eventStatus = z.enum(['confirmed', 'tentative', 'cancelled'])
/** 区域审视节奏 / 状态（v0.5 · Slice X，见 ADR-0019） */
export const areaCadence = z.enum(['weekly', 'monthly', 'quarterly'])
export const areaStatus = z.enum(['active', 'archived'])
/** 目标时间视野 / 状态（v0.5 · Slice X） */
export const goalHorizon = z.enum(['term', 'quarter', 'year'])
export const goalStatus = z.enum(['active', 'achieved', 'dropped', 'someday'])
/** 习惯节奏 / 度量方式（v0.5 · Slice X） */
export const habitCadence = z.enum(['daily', 'weekly', 'monthly'])
export const habitMetric = z.enum(['count', 'minutes', 'bool'])

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

/**
 * 资料创建入参（v0.5 · Slice Y）：title 必填（trim 后非空，服务端再校验）；
 * kind / status 缺省为 article / unread；可选 url / path / note / areaId / tags。
 * 关联 id / 标签为宽松字符串（关联 id 在 index.mjs 做存在性校验），对齐既有创建端点口径。
 */
export const resourceCreateSchema = z.object({
  title: z.string().min(1).max(120),
  kind: resourceKind.optional(),
  status: resourceStatus.optional(),
  url: z.string().max(2000).optional(),
  path: z.string().min(1).max(1000).optional(),
  note: z.string().max(600).optional(),
  areaId: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).max(8).optional(),
})

/**
 * 日程 · e-（v0.5 · Slice W，见 ADR-0018）：最末一个只读实体转为可写。
 * 字段对齐既有 data/events/*.json；`endAt` / `allDay` 可缺省（结束可选 / 缺省非全天），
 * `repeatRule` 仅展示保留（重复规则 UI 与写入延后，见 ADR-0018 §边界）。无 createdAt/updatedAt，
 * 与既有事件形状保持一致。
 */
export const eventSchema = z
  .object({
    id: z.string().regex(/^e-\d{4}$/),
    title: z.string().min(1),
    startAt: iso,
    endAt: iso.optional(),
    allDay: z.boolean().optional(),
    location: z.string().optional(),
    areaId: z.string().optional(),
    projectId: z.string().optional(),
    tags: z.array(z.string()),
    status: eventStatus,
    notes: z.string().optional(),
    repeatRule: z.string().optional(),
  })
  .catchall(z.unknown())

/**
 * 区域 · a-（v0.5 · Slice X，见 ADR-0019）：标准式领域，此前种子只读，现转为可管理。
 * 字段对齐既有 data/areas/*.json（title / standard / cadence / status）；无 createdAt/updatedAt。
 */
export const areaSchema = z
  .object({
    id: z.string().regex(/^a-\d{4}$/),
    title: z.string().min(1),
    standard: z.string().optional(),
    cadence: areaCadence.optional(),
    status: areaStatus.optional(),
  })
  .catchall(z.unknown())

/** 关键结果（目标下，display-only：v1 只在既有记录上展示，不开放编辑，见 ADR-0019 边界） */
export const keyResultSchema = z.object({
  text: z.string().min(1),
  target: z.number(),
  current: z.number(),
  unit: z.string().optional(),
})

/**
 * 目标 · g-（v0.5 · Slice X）：字段对齐既有 data/goals/*.json；`keyResults` 保留展示，
 * 本切片不开放编辑（写入延后，见 ADR-0019 边界）。无 createdAt/updatedAt。
 */
export const goalSchema = z
  .object({
    id: z.string().regex(/^g-\d{4}$/),
    title: z.string().min(1),
    horizon: goalHorizon.optional(),
    areaId: z.string().optional(),
    parentGoalId: z.string().optional(),
    keyResults: z.array(keyResultSchema).optional(),
    status: goalStatus.optional(),
    targetDate: iso.optional(),
  })
  .catchall(z.unknown())

/** 习惯打卡记录（date 为 YYYY-MM-DD，value 为当日度量值） */
export const habitLogEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number(),
})

/**
 * 习惯 · h-（v0.5 · Slice X）：字段对齐既有 data/habits/*.json；`log` 由 check-in / uncheck-in
 * 端点维护（见 ADR-0019）。无 createdAt/updatedAt。
 */
export const habitSchema = z
  .object({
    id: z.string().regex(/^h-\d{4}$/),
    title: z.string().min(1),
    cadence: habitCadence.optional(),
    trigger: z.string().optional(),
    metric: habitMetric.optional(),
    target: z.number().optional(),
    areaId: z.string().optional(),
    log: z.array(habitLogEntrySchema).optional(),
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
  events: eventSchema,
  areas: areaSchema,
  goals: goalSchema,
  habits: habitSchema,
}

/** 实体 kind → id 模式（防目录穿越；与 docs/04 ID 约定一致） */
export const ID_PATTERNS = {
  tasks: /^t-\d{4}$/,
  inbox: /^i-\d{4}$/,
  notes: /^n-\d{4}$/,
  resources: /^r-\d{4}$/,
  projects: /^p-\d{4}$/,
  areas: /^a-\d{4}$/,
  goals: /^g-\d{4}$/,
  habits: /^h-\d{4}$/,
  reviews: /^rev-\d{4}$/,
  tags: /^tag-\d{3,}$/,
  events: /^e-\d{4}$/,
}

/* ---------------------------------------------------------------------------
 * 区域 / 目标 / 习惯 · 创建入参（v0.5 · Slice X，见 ADR-0019）
 * 更新走通用白名单（index.mjs EDITABLE_FIELDS）；此处只校验创建与打卡入参。
 * ------------------------------------------------------------------------- */

export const areaCreateSchema = z.object({
  title: z.string().max(60),
  standard: z.string().max(200).optional(),
  cadence: areaCadence.optional(),
  status: areaStatus.optional(),
})

export const goalCreateSchema = z.object({
  title: z.string().max(120),
  horizon: goalHorizon.optional(),
  areaId: z.string().min(1).optional(),
  status: goalStatus.optional(),
  targetDate: iso.optional(),
})

export const habitCreateSchema = z.object({
  title: z.string().max(120),
  cadence: habitCadence.optional(),
  metric: habitMetric.optional(),
  target: z.number().min(0).max(100000).optional(),
  trigger: z.string().max(200).optional(),
  areaId: z.string().min(1).optional(),
})

/** 打卡 / 取消打卡入参：date 缺省为服务端「今天」（本地时区） */
export const habitCheckinSchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
})

/* ---------------------------------------------------------------------------
 * 标签注册表（v0.5 · Slice T）：data/meta/tags.json
 * 既有字段向后兼容；origin / createdAt / firstUsedIn 为可选（旧种子记录缺省，
 * UI 将缺省 origin 视作 'seed'）。见 ADR-0014。
 * ------------------------------------------------------------------------- */

export const tagOrigin = z.enum(['seed', 'manual', 'ai'])

export const tagItemSchema = z
  .object({
    id: z.string().regex(/^tag-\d{3,}$/),
    name: z.string().min(1),
    namespace: z.enum(['role', 'context', 'topic']),
    label: z.string().min(1),
    origin: tagOrigin.optional(),
    createdAt: iso.optional(),
    firstUsedIn: z.string().min(1).optional(),
  })
  .catchall(z.unknown())

export const tagRegistrySchema = z
  .object({ tags: z.array(tagItemSchema) })
  .catchall(z.unknown())

/** 标签重命名（Slice T）：name / label 至少提供其一 */
export const tagUpdateSchema = z.object({
  name: z.string().min(1).max(64).optional(),
  label: z.string().min(1).max(60).optional(),
})

/** 标签合并（Slice T）：目标标签 id */
export const tagMergeSchema = z.object({
  targetId: z.string().regex(/^tag-\d{3,}$/),
})

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
  // 重要性：0–3（与 taskSchema 存储口径一致；Slice Y 统一量纲，0 = 最低 / 可略过的输入）
  importance: z.number().int().min(0).max(3),
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

/* ---------------------------------------------------------------------------
 * AI 全链 · 多实体一揽子处置（v0.5 · Slice R1，见 ADR-0015）
 * 一个收件箱条目可被拆解为多个动作（task / note / resource / project）；
 * 模型输出 { actions: [...] }，旧式单建议形状仍被接受并由 ai.mjs 归一化为动作数组。
 * ------------------------------------------------------------------------- */

/** 动作类型：project 表示「本批次要新建的项目」，task/note 可用 linkToNewProject 挂接它 */
export const aiActionKind = z.enum(['task', 'note', 'resource', 'project'])

/**
 * 单个 AI 动作（不完全对应持久化实体，仅作预览 / 批量应用入参）。
 * 字段刻意做成并集：与 kind 无关的键会被忽略；postValidateActions 再按 kind 清洗。
 * 关联 id / 标签经快照后校验（防臆造）；linkToNewProject 仅在存在 project 动作时保留。
 */
export const aiActionSchema = z.object({
  kind: aiActionKind,
  title: z.string().min(1).max(80),
  // task 专属
  contexts: z.array(z.string().min(1)).max(5).default([]),
  energy: energy.optional(),
  // 重要性：0–3（与 taskSchema 存储口径一致；Slice Y 统一量纲）
  importance: z.number().int().min(0).max(3).optional(),
  estimateMin: z.number().int().min(1).max(600).optional(),
  dueAt: z.union([iso, z.null()]).optional(),
  // 归属（note / resource / project；task 亦可用）
  projectId: z.union([z.string(), z.null()]).optional(),
  areaId: z.union([z.string(), z.null()]).optional(),
  tags: z.array(z.string().min(1)).max(5).default([]),
  // resource 专属（Slice R2.5）：1–3 句简约小结，作为资料详情页「简介」；postValidateActions 归一化
  note: z.union([z.string().max(200), z.null()]).optional(),
  // project 专属：完成定义
  outcome: z.union([z.string().max(200), z.null()]).optional(),
  // task / note：挂到本批次新建的项目（此时 projectId 须为空）
  linkToNewProject: z.boolean().optional(),
  // task：疑似重复的既有任务 id
  duplicateOf: z.union([z.string(), z.null()]).optional(),
  reason: z.string().max(300).default(''),
})

/** 模型整体输出形状（≤6 个动作；空数组表示无需创建） */
export const aiActionsSchema = z.object({
  actions: z.array(aiActionSchema).max(6).default([]),
})

/** 批量应用入参（客户端提交，服务端重新 Zod 校验，绝不信任客户端形状） */
export const inboxApplySchema = z.object({
  actions: z.array(aiActionSchema).min(1).max(6),
})

/**
 * AI 项目快速新建草稿（v0.5 · Slice R1）：只给标题 → 推断完成定义 / 区域 / 标签。
 * 全部可选：拿不准就缺省；关联 id / 标签经 postValidate 按快照过滤；绝不自动落盘。
 */
export const projectDraftSchema = z.object({
  outcome: z.union([z.string().max(200), z.null()]).optional(),
  areaId: z.union([z.string(), z.null()]).optional(),
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
  // 重要性：0–3（与 taskSchema 存储口径一致；Slice Y 统一量纲）
  importance: z.number().int().min(0).max(3).optional(),
  estimateMin: z.number().int().min(1).max(600).optional(),
  dueAt: z.union([iso, z.null()]).optional(),
  projectId: z.union([z.string(), z.null()]).optional(),
  areaId: z.union([z.string(), z.null()]).optional(),
  tags: z.array(z.string().min(1)).max(5).default([]),
  reason: z.string().max(300).default(''),
})

/* ---------------------------------------------------------------------------
 * AI 笔记蒸馏（v0.5 · Slice M，见 ADR-0020）：把笔记压缩到目标层级。
 * AI 只产出「下一层草稿文本」，绝不自动落盘；应用由用户确认后经
 * POST /api/notes/:id/update（body + distillLevel）写入。
 * ------------------------------------------------------------------------- */

/**
 * AI 蒸馏输出形状：text 为压缩后的正文（可 ≤1200 字；指令建议 ≤300 汉字），
 * reason 为可选的一句话依据。文本为空则视为无效（触发一次重试）。
 */
export const noteDistillSchema = z.object({
  text: z.string().min(1).max(1200),
  reason: z.string().max(300).default(''),
})

/** AI 蒸馏入参：id 必填；targetLevel 1–3 可选（缺省 = 当前层级 + 1，封顶 L3） */
export const noteDistillRequestSchema = z.object({
  id: z.string().regex(/^n-\d{4}$/),
  targetLevel: z.number().int().min(1).max(3).optional(),
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
  // 重要性：0–3（与 taskSchema 存储口径一致；Slice Y 统一量纲）
  importance: z.number().int().min(0).max(3).optional(),
  estimateMin: z.number().int().min(1).max(600).optional(),
  dueAt: iso.optional(),
  tags: z.array(z.string().min(1)).max(8).optional(),
  projectId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
  // Slice R3：父任务（子任务生成）；必须为真实存在且不构成环的任务 id（服务端校验）
  parentTaskId: z.string().min(1).optional(),
  // Slice T：本次创建来自 AI 草稿确认（新标签按 origin:'ai' 登记）；仅影响标签来源，缺省 manual
  ai: z.boolean().optional(),
})

/** 澄清时的可选覆盖字段（AI 应用或手工预填；全部可选） */
export const clarifyDetailsSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  contexts: z.array(z.string().min(1)).max(8).optional(),
  energy: energy.optional(),
  // 重要性：0–3（与 taskSchema 存储口径一致；Slice Y 统一量纲）
  importance: z.number().int().min(0).max(3).optional(),
  estimateMin: z.number().int().min(1).max(600).optional(),
  dueAt: iso.optional(),
  tags: z.array(z.string().min(1)).max(8).optional(),
  projectId: z.string().min(1).optional(),
  areaId: z.string().min(1).optional(),
  // Slice R2.5：文件投递澄清为资料时写入「简介」（resource.note）
  note: z.string().min(1).max(200).optional(),
})

/* ---------------------------------------------------------------------------
 * AI 自动化档位（v0.5 · Slice R2，见 ADR-0016）：data/meta/config.json 的可写白名单。
 * 缺省 'confirm'（先确认后写入）；'auto' 为显式选择（自动应用低风险动作，绝不删除/完成/归档）。
 * ------------------------------------------------------------------------- */

export const aiAutomationSchema = z.enum(['confirm', 'auto'])

/** 配置更新入参（当前仅 aiAutomation；白名单外字段被 zod 剥离，不落盘） */
export const configUpdateSchema = z.object({
  aiAutomation: aiAutomationSchema,
})

/* ---------------------------------------------------------------------------
 * 聚类立项（v0.5 · Slice R2，见 ADR-0016）：把「连续累积的相似任务 / 未澄清条目」
 * 归纳为一个新项目。确定性预分组（共享 topic 标签 / 标题关键词）→ AI 命名 + 完成定义。
 * AI 只出「建议提案」，绝不自动建项；应用经 POST /api/projects/cluster-apply。
 * ------------------------------------------------------------------------- */

/** AI 聚类草稿整体输出：按「预分组编号」引用成员（避免模型编造 id），0–3 个提案 */
export const clusterDraftSchema = z.object({
  proposals: z
    .array(
      z.object({
        group: z.number().int().min(1),
        title: z.string().min(1).max(60),
        outcome: z.union([z.string().max(200), z.null()]).optional(),
        reason: z.string().max(300).default(''),
        areaId: z.union([z.string(), z.null()]).optional(),
        tags: z.array(z.string().min(1)).max(5).default([]),
      }),
    )
    .max(3)
    .default([]),
})

/**
 * 单条聚类提案（对外契约；成员 id 必须真实存在——postValidateClusters 按候选集过滤臆造，
 * 且一律映射自服务端预分组，模型无法直接编造 id）。
 */
export const clusterProposalSchema = z.object({
  title: z.string().min(1).max(60),
  outcome: z.string().max(200).optional(),
  reason: z.string().max(300).default(''),
  taskIds: z.array(z.string()).default([]),
  inboxIds: z.array(z.string()).default([]),
  areaId: z.string().optional(),
  tags: z.array(z.string().min(1)).max(5).default([]),
})

/** 聚类应用入参（客户端提交；服务端重新校验 + 任务存在性/未归属校验，绝不信任客户端形状） */
export const clusterApplySchema = z.object({
  title: z.string().min(1).max(60),
  outcome: z.union([z.string().max(200), z.null()]).optional(),
  areaId: z.union([z.string(), z.null()]).optional(),
  tags: z.array(z.string().min(1)).max(5).default([]),
  taskIds: z.array(z.string().regex(/^t-\d{4}$/)).min(1).max(50),
})

/** 聚类撤销入参：项目 id；受影响任务 id 从项目上的 clusterTaskIds 还原（服务端自持） */
export const clusterUnapplySchema = z.object({
  projectId: z.string().regex(/^p-\d{4}$/),
})
