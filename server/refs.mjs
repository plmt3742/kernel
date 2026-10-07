// KERNEL · 数据服务 · 外键引用生命周期（唯一事实源，见 ADR-0043）
// 立场：软删只隐藏，彻底删除才断链（soft delete hides, permanent delete detaches）。
//
// REF_EDGES 每项为 [target, source, field, array, mode]：
//   target  被引用方 kind（'*' = 任意目标，仅用于历史溯源）
//   source  持有引用的记录 kind（'*' = 任意来源）
//   field   引用字段名（嵌套字段用 'a[].b' 记法，仅供文档）
//   array   true = 字段是 id 数组；false = 标量 id
//   mode    'detach' 目标被彻底删除时清空；'keep' 溯源 / 历史，永不改写
//
// 纪律（ADR-0043 §2）：
//   - 软删除（moveToTrash）不触碰任何引用；消费方按「目标不在实时快照 = 未关联」解析。
//   - 只清 detach 边；keep 边永不改写（不做日志、不做重链）。

export const REF_EDGES = [
  // 项目 ← tasks / events / notes / traces 的 projectId（彻底删除项目时清除）
  ['projects', 'tasks', 'projectId', false, 'detach'],
  ['projects', 'events', 'projectId', false, 'detach'],
  ['projects', 'notes', 'projectId', false, 'detach'],
  ['projects', 'traces', 'projectId', false, 'detach'],
  // 区域 ← tasks / projects / events / notes / resources / goals / habits / traces 的 areaId
  ['areas', 'tasks', 'areaId', false, 'detach'],
  ['areas', 'projects', 'areaId', false, 'detach'],
  ['areas', 'events', 'areaId', false, 'detach'],
  ['areas', 'notes', 'areaId', false, 'detach'],
  ['areas', 'resources', 'areaId', false, 'detach'],
  ['areas', 'goals', 'areaId', false, 'detach'],
  ['areas', 'habits', 'areaId', false, 'detach'],
  ['areas', 'traces', 'areaId', false, 'detach'],
  // 目标 ← projects.goalId / goals.parentGoalId
  ['goals', 'projects', 'goalId', false, 'detach'],
  ['goals', 'goals', 'parentGoalId', false, 'detach'],
  // 任务 ← tasks.parentTaskId / projects.nextActionId
  ['tasks', 'tasks', 'parentTaskId', false, 'detach'],
  ['tasks', 'projects', 'nextActionId', false, 'detach'],
  // 收件箱 ← tasks.sourceInboxId（溯源，永不改写）
  ['inbox', 'tasks', 'sourceInboxId', false, 'keep'],
  // 收件箱 ← inbox.linkedId / linkedIds（溯源；target '*' = 任意产物）
  ['*', 'inbox', 'linkedId', false, 'keep'],
  ['*', 'inbox', 'linkedIds', true, 'keep'],
  // 标签 ← inbox.appliedTagIds（撤销凭据，永不改写）
  ['tags', 'inbox', 'appliedTagIds', true, 'keep'],
  // 项目 ← reviews.staleProjectIds（历史报告引用，永不改写）
  ['projects', 'reviews', 'staleProjectIds', true, 'keep'],
  // 项目 ← reviews.staleAdvice[].projectId（嵌套，仅文档；keep 无写入方）
  ['projects', 'reviews', 'staleAdvice[].projectId', true, 'keep'],
]

/** 被引用目标 kind → 中文标签（编辑校验报错用） */
export const REF_TARGET_LABELS = {
  projects: '项目',
  areas: '区域',
  goals: '目标',
  tasks: '任务',
  inbox: '收件箱',
  tags: '标签',
  reviews: '回顾',
}

/** 是否为「彻底删除断开」边（mode === 'detach'） */
export function isDetachEdge(edge) {
  return Array.isArray(edge) && edge[4] === 'detach'
}

/** 目标为 targetKind 的全部 detach 边（彻底删除 targetKind 时需清扫的入引用） */
export function detachEdgesFor(targetKind) {
  return REF_EDGES.filter((edge) => isDetachEdge(edge) && edge[0] === targetKind)
}

/** 来源为 sourceKind（或通配 '*'）的全部边（编辑校验 / 文档用） */
export function edgesForSource(sourceKind) {
  return REF_EDGES.filter((edge) => edge[1] === sourceKind || edge[1] === '*')
}
