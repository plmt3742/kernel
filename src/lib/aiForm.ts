// KERNEL · AI 建议的「可编辑表单」状态与换算（v0.5 · Slice O）
// 任务快速新建弹窗（TaskDraftModal）与收件箱建议卡（AiReadyCard）共用同一套字段：
//   title / contexts / energy / importance / estimateMin / dueAt / projectId / areaId / tags。
// 表单内部一律用字符串（逗号列表 / datetime-local），仅在提交时换算为 API 负载。
// 纪律：AI 只负责预填；用户可任意编辑；提交前的任何失败都不落盘。
import { toDate, toISODateTime } from '@/lib/date'
import type {
  AiAction,
  AiActionKind,
  AiSuggestion,
  TaskCreateInput,
  TaskDraftSuggestion,
} from '@/lib/mutations'
import type { Energy } from '@/types'

/** 表单值（全字符串，便于受控 input / select） */
export interface AiSuggestionFormValues {
  title: string
  /** 仅项目用：完成定义（'' = 未设置） */
  outcome: string
  /** 逗号分隔（'' = 未设置） */
  contexts: string
  /** '' | 'low' | 'medium' | 'high' */
  energy: string
  /** '' | '1' | '2' | '3' */
  importance: string
  /** 数字字符串（'' = 未设置） */
  estimateMin: string
  /** datetime-local（'' = 未设置） */
  dueAt: string
  /** 软推迟（v0.5）：datetime-local（'' = 未设置） */
  deferUntil: string
  /** 仅 event 用：datetime-local（Slice N10；'' = 未设置） */
  startAt: string
  /** 仅 event 用：datetime-local（Slice N10；'' = 未设置） */
  endAt: string
  /** 仅 event 用：地点（Slice N10；'' = 未设置） */
  location: string
  /** '' = 未关联 */
  projectId: string
  /** '' = 未归入 */
  areaId: string
  /** 逗号分隔（'' = 未设置） */
  tags: string
  /** 仅资源用：资料简介（Slice R2.5；'' = 未设置） */
  note: string
  /** 仅资源用：资料链接（Slice N2；'' = 未设置） */
  url: string
}

/** 可编辑字段键（与 AiSuggestionForm 的渲染单元一一对应） */
export type ClarifyFieldKey =
  | 'title'
  | 'outcome'
  | 'contexts'
  | 'tags'
  | 'energy'
  | 'importance'
  | 'estimateMin'
  | 'dueAt'
  | 'startAt'
  | 'endAt'
  | 'location'
  | 'projectId'
  | 'areaId'
  | 'note'
  | 'url'

/** 任务目标的完整字段集（表单默认） */
export const ALL_CLARIFY_FIELDS: readonly ClarifyFieldKey[] = [
  'title',
  'contexts',
  'tags',
  'energy',
  'importance',
  'estimateMin',
  'dueAt',
  'projectId',
  'areaId',
]

/**
 * target × 可编辑字段矩阵（Slice V · F19/F31）——**与服务端 clarify 真正应用的字段严格一致**，
 * 绝不在 UI 展示一个不会被落盘的输入框。服务端各目标落盘范围见 server/index.mjs clarifyInbox：
 *   · task     → 全字段（title / contexts / energy / importance / estimateMin / dueAt / tags / projectId / areaId）
 *   · note     → title / tags / projectId / areaId（笔记无 contexts / 能量 / 预估 / 截止结构）
 *   · resource → title / tags / areaId（资料无 projectId / contexts / 能量…）
 *   · discard  → 无字段
 */
export const CLARIFY_FIELD_MATRIX: Record<AiSuggestion['target'], readonly ClarifyFieldKey[]> = {
  task: ALL_CLARIFY_FIELDS,
  note: ['title', 'tags', 'projectId', 'areaId'],
  resource: ['title', 'tags', 'areaId'],
  discard: [],
}

export const EMPTY_AI_FORM: AiSuggestionFormValues = {
  title: '',
  outcome: '',
  contexts: '',
  energy: '',
  importance: '',
  estimateMin: '',
  dueAt: '',
  deferUntil: '',
  startAt: '',
  endAt: '',
  location: '',
  projectId: '',
  areaId: '',
  tags: '',
  note: '',
  url: '',
}

/**
 * 动作 kind × 可编辑字段矩阵（Slice R1）——与服务端 applyInboxActions 真正落盘的字段一致：
 *   · task     → 全字段（含 contexts / 能量 / 预估 / 截止 / tags / projectId / areaId）
 *   · note     → title / tags / projectId / areaId
 *   · resource → title / tags / areaId
 *   · project  → title / outcome / tags / areaId
 *   · event    → title / startAt / endAt / location / tags / projectId / areaId（Slice N10）
 */
export const ACTION_FIELD_MATRIX: Record<AiActionKind, readonly ClarifyFieldKey[]> = {
  task: ALL_CLARIFY_FIELDS,
  note: ['title', 'tags', 'projectId', 'areaId'],
  resource: ['title', 'note', 'url', 'tags', 'areaId'],
  project: ['title', 'outcome', 'tags', 'areaId'],
  event: ['title', 'startAt', 'endAt', 'location', 'projectId', 'areaId', 'tags'],
}

/** 逗号列表 → 去空去重后的字符串数组 */
export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
}

function listToText(value: readonly string[] | undefined): string {
  return value === undefined || value.length === 0 ? '' : value.join(', ')
}

/** ISO → datetime-local 值（本机时区，精确到分钟；非法 / 空返回 ''） */
function toLocalInput(value: string | undefined): string {
  if (value === undefined || value === '') return ''
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 收件箱 AI 建议 → 表单值 */
export function suggestionToForm(suggestion: AiSuggestion): AiSuggestionFormValues {
  return {
    title: suggestion.title,
    outcome: '',
    contexts: listToText(suggestion.contexts),
    energy: suggestion.energy,
    importance: String(suggestion.importance),
    estimateMin: suggestion.estimateMin === undefined ? '' : String(suggestion.estimateMin),
    dueAt: toLocalInput(suggestion.dueAt),
    deferUntil: '',
    startAt: '',
    endAt: '',
    location: '',
    projectId: suggestion.projectId ?? '',
    areaId: suggestion.areaId ?? '',
    tags: listToText(suggestion.tags),
    note: '',
    url: '',
  }
}

/** 任务补全建议（+ 标题）→ 表单值；全部字段可选，缺省留空 */
export function draftToForm(title: string, draft: TaskDraftSuggestion): AiSuggestionFormValues {
  return {
    title,
    outcome: '',
    contexts: listToText(draft.contexts),
    energy: draft.energy ?? '',
    importance: draft.importance === undefined ? '' : String(draft.importance),
    estimateMin: draft.estimateMin === undefined ? '' : String(draft.estimateMin),
    dueAt: toLocalInput(draft.dueAt),
    deferUntil: '',
    startAt: '',
    endAt: '',
    location: '',
    projectId: draft.projectId ?? '',
    areaId: draft.areaId ?? '',
    tags: listToText(draft.tags),
    note: '',
    url: '',
  }
}

/** 表单值 → 任务创建负载（空字段省略，服务端补默认；dueAt 转 ISO） */
export function formToTaskCreate(values: AiSuggestionFormValues): TaskCreateInput {
  const input: TaskCreateInput = { title: values.title.trim() }
  const contexts = splitList(values.contexts)
  if (contexts.length > 0) input.contexts = contexts
  if (values.energy !== '') input.energy = values.energy as Energy
  if (values.importance !== '') input.importance = Number(values.importance)
  if (values.estimateMin.trim() !== '') input.estimateMin = Number(values.estimateMin)
  if (values.dueAt !== '') input.dueAt = toISODateTime(new Date(values.dueAt))
  // 软推迟（v0.5）：仅在填写（非空）时提交，空 = 省略（服务端不落该键）
  if (values.deferUntil !== '') input.deferUntil = toISODateTime(new Date(values.deferUntil))
  if (values.projectId !== '') input.projectId = values.projectId
  if (values.areaId !== '') input.areaId = values.areaId
  const tags = splitList(values.tags)
  if (tags.length > 0) input.tags = tags
  return input
}

/**
 * 把（可能编辑过的）表单值套回 AI 建议：非表单字段（reason / duplicateOf / newProjectHint）
 * 原样保留，target 可覆盖；空的可选字段从建议中删除（避免送出空串触发校验失败）。
 */
export function applyFormToSuggestion(
  suggestion: AiSuggestion,
  values: AiSuggestionFormValues,
  target: AiSuggestion['target'],
): AiSuggestion {
  const next: AiSuggestion = {
    ...suggestion,
    target,
    title: values.title.trim(),
    contexts: splitList(values.contexts),
    tags: splitList(values.tags),
    energy: values.energy === '' ? suggestion.energy : (values.energy as Energy),
    importance: values.importance === '' ? suggestion.importance : Number(values.importance),
  }
  if (values.estimateMin.trim() === '') delete next.estimateMin
  else next.estimateMin = Number(values.estimateMin)
  if (values.dueAt === '') delete next.dueAt
  else next.dueAt = toISODateTime(new Date(values.dueAt))
  if (values.projectId === '') delete next.projectId
  else next.projectId = values.projectId
  if (values.areaId === '') delete next.areaId
  else next.areaId = values.areaId
  return next
}

/* ---------------------------------------------------------------------------
 * AI 动作（Slice R1）：动作 ⇄ 表单值换算（处置卡逐条编辑用）
 * ------------------------------------------------------------------------- */

/** AI 动作 → 表单值（缺省轴留空；project 动作带 outcome） */
export function actionToForm(action: AiAction): AiSuggestionFormValues {
  return {
    title: action.title,
    outcome: action.outcome ?? '',
    contexts: listToText(action.contexts),
    energy: action.energy ?? '',
    importance: action.importance === undefined ? '' : String(action.importance),
    estimateMin: action.estimateMin === undefined ? '' : String(action.estimateMin),
    dueAt: toLocalInput(action.dueAt),
    deferUntil: '',
    startAt: toLocalInput(action.startAt),
    endAt: toLocalInput(action.endAt),
    location: action.location ?? '',
    projectId: action.projectId ?? '',
    areaId: action.areaId ?? '',
    tags: listToText(action.tags),
    note: action.note ?? '',
    url: action.url ?? '',
  }
}

/**
 * 表单值套回 AI 动作：非表单字段（kind / reason / linkToNewProject / duplicateOf / condition）原样保留；
 * condition（Slice N0）不是表单字段，须随原动作原样带入 apply 负载（...action 已透传）；
 * 空的可选字段从动作中删除（避免送出空串）；用户显式选了现有项目 → 取消 linkToNewProject（互斥）。
 */
export function formToAction(action: AiAction, values: AiSuggestionFormValues): AiAction {
  const next: AiAction = {
    // ...action 携带 condition 等非表单字段原样透传
    ...action,
    title: values.title.trim(),
    contexts: splitList(values.contexts),
    tags: splitList(values.tags),
  }
  if (values.energy === '') delete next.energy
  else next.energy = values.energy as Energy
  if (values.importance === '') delete next.importance
  else next.importance = Number(values.importance)
  if (values.estimateMin.trim() === '') delete next.estimateMin
  else next.estimateMin = Number(values.estimateMin)
  if (values.dueAt === '') delete next.dueAt
  else next.dueAt = toISODateTime(new Date(values.dueAt))
  // event 专属（Slice N10）：startAt / endAt 空则删除，否则转 ISO；location 空则删除
  if (values.startAt === '') delete next.startAt
  else next.startAt = toISODateTime(new Date(values.startAt))
  if (values.endAt === '') delete next.endAt
  else next.endAt = toISODateTime(new Date(values.endAt))
  const location = values.location.trim()
  if (location === '') delete next.location
  else next.location = location
  if (values.projectId === '') delete next.projectId
  else next.projectId = values.projectId
  if (values.areaId === '') delete next.areaId
  else next.areaId = values.areaId
  const outcome = values.outcome.trim()
  if (outcome === '') delete next.outcome
  else next.outcome = outcome
  // note 仅 resource 有意义（Slice R2.5）：空则删除，避免送出空串
  const note = values.note.trim()
  if (note === '') delete next.note
  else next.note = note
  // url 仅 resource 有意义（Slice N2）：空则删除，避免送出空串
  const url = values.url.trim()
  if (url === '') delete next.url
  else next.url = url
  if (next.projectId !== undefined) delete next.linkToNewProject
  return next
}
