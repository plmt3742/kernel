// KERNEL · AI 建议的「可编辑表单」状态与换算（v0.5 · Slice O）
// 任务快速新建弹窗（TaskDraftModal）与收件箱建议卡（AiReadyCard）共用同一套字段：
//   title / contexts / energy / importance / estimateMin / dueAt / projectId / areaId / tags。
// 表单内部一律用字符串（逗号列表 / datetime-local），仅在提交时换算为 API 负载。
// 纪律：AI 只负责预填；用户可任意编辑；提交前的任何失败都不落盘。
import { toDate, toISODateTime } from '@/lib/date'
import type { AiSuggestion, TaskCreateInput, TaskDraftSuggestion } from '@/lib/mutations'
import type { Energy } from '@/types'

/** 表单值（全字符串，便于受控 input / select） */
export interface AiSuggestionFormValues {
  title: string
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
  /** '' = 未关联 */
  projectId: string
  /** '' = 未归入 */
  areaId: string
  /** 逗号分隔（'' = 未设置） */
  tags: string
}

export const EMPTY_AI_FORM: AiSuggestionFormValues = {
  title: '',
  contexts: '',
  energy: '',
  importance: '',
  estimateMin: '',
  dueAt: '',
  projectId: '',
  areaId: '',
  tags: '',
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
    contexts: listToText(suggestion.contexts),
    energy: suggestion.energy,
    importance: String(suggestion.importance),
    estimateMin: suggestion.estimateMin === undefined ? '' : String(suggestion.estimateMin),
    dueAt: toLocalInput(suggestion.dueAt),
    projectId: suggestion.projectId ?? '',
    areaId: suggestion.areaId ?? '',
    tags: listToText(suggestion.tags),
  }
}

/** 任务补全建议（+ 标题）→ 表单值；全部字段可选，缺省留空 */
export function draftToForm(title: string, draft: TaskDraftSuggestion): AiSuggestionFormValues {
  return {
    title,
    contexts: listToText(draft.contexts),
    energy: draft.energy ?? '',
    importance: draft.importance === undefined ? '' : String(draft.importance),
    estimateMin: draft.estimateMin === undefined ? '' : String(draft.estimateMin),
    dueAt: toLocalInput(draft.dueAt),
    projectId: draft.projectId ?? '',
    areaId: draft.areaId ?? '',
    tags: listToText(draft.tags),
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
