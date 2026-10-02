// KERNEL · 展示标签映射（枚举 → 中文 / 英文微标签）
// 纪律：所有枚举中文展示集中于此，视图不内联魔法字符串。
import type {
  AreaCadence,
  Energy,
  EventStatus,
  GoalStatus,
  InboxSource,
  NoteType,
  ProjectStatus,
  ResourceKind,
  ResourceStatus,
  ReviewType,
  TaskStatus,
} from '@/types'
import { getTags } from '@/lib/data'

export const ENERGY_LABEL: Record<Energy, string> = { low: '低', medium: '中', high: '高' }
export const ENERGY_EN: Record<Energy, string> = { low: 'LOW', medium: 'MED', high: 'HIGH' }

export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  next: '下一步',
  waiting: '等待中',
  scheduled: '已排期',
  someday: '将来',
  done: '已完成',
  dropped: '已丢弃',
}
export const TASK_STATUS_EN: Record<TaskStatus, string> = {
  next: 'NEXT',
  waiting: 'WAITING',
  scheduled: 'SCHEDULED',
  someday: 'SOMEDAY',
  done: 'DONE',
  dropped: 'DROPPED',
}

export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  active: '进行中',
  onHold: '暂停',
  someday: '将来',
  done: '已完成',
  archived: '已归档',
}
export const PROJECT_STATUS_EN: Record<ProjectStatus, string> = {
  active: 'ACTIVE',
  onHold: 'ON HOLD',
  someday: 'SOMEDAY',
  done: 'DONE',
  archived: 'ARCHIVED',
}

export const NOTE_TYPE_LABEL: Record<NoteType, string> = {
  fleeting: '闪念',
  literature: '文献',
  permanent: '永久',
  meeting: '会议',
  memo: '备忘',
}
export const NOTE_TYPE_EN: Record<NoteType, string> = {
  fleeting: 'FLEETING',
  literature: 'LITERATURE',
  permanent: 'PERMANENT',
  meeting: 'MEETING',
  memo: 'MEMO',
}

export const RESOURCE_KIND_LABEL: Record<ResourceKind, string> = {
  article: '文章',
  course: '课程',
  book: '书籍',
  tool: '工具',
  paper: '论文',
  file: '文件',
}
export const RESOURCE_KIND_EN: Record<ResourceKind, string> = {
  article: 'ARTICLE',
  course: 'COURSE',
  book: 'BOOK',
  tool: 'TOOL',
  paper: 'PAPER',
  file: 'FILE',
}

export const RESOURCE_STATUS_LABEL: Record<ResourceStatus, string> = {
  unread: '未读',
  reading: '在读',
  read: '读完',
  reference: '参考',
  archived: '归档',
}
export const RESOURCE_STATUS_EN: Record<ResourceStatus, string> = {
  unread: 'UNREAD',
  reading: 'READING',
  read: 'READ',
  reference: 'REFERENCE',
  archived: 'ARCHIVED',
}

export const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  confirmed: '已确认',
  tentative: '待定',
  cancelled: '已取消',
}
export const EVENT_STATUS_EN: Record<EventStatus, string> = {
  confirmed: 'CONFIRMED',
  tentative: 'TENTATIVE',
  cancelled: 'CANCELLED',
}

export const INBOX_SOURCE_LABEL: Record<InboxSource, string> = {
  manual: '手动',
  file: '文件',
  notification: '通知',
  voice: '语音',
}
export const INBOX_SOURCE_EN: Record<InboxSource, string> = {
  manual: 'MANUAL',
  file: 'FILE',
  notification: 'NOTIFY',
  voice: 'VOICE',
}

export const GOAL_STATUS_LABEL: Record<GoalStatus, string> = {
  active: '进行中',
  achieved: '已达成',
  dropped: '已放弃',
  someday: '将来',
}

export const AREA_CADENCE_LABEL: Record<AreaCadence, string> = {
  weekly: '每周',
  monthly: '每月',
  quarterly: '每季',
}

export const REVIEW_TYPE_LABEL: Record<ReviewType, string> = {
  weekly: '周回顾',
  monthly: '月回顾',
}

/* ---------------------------------------------------------------------------
 * 标签
 * ------------------------------------------------------------------------- */

const tagMap = new Map(getTags().map((tag) => [tag.name, tag.label]))

/** 标签名 → 中文标签（未知则回退原名） */
export function tagLabel(name: string): string {
  return tagMap.get(name) ?? name
}

/** 去掉命名空间前缀：role:acm → acm；@lab 原样返回 */
export function shortTag(name: string): string {
  const colon = name.indexOf(':')
  return colon >= 0 ? name.slice(colon + 1) : name
}

/** 身份标签中文短名：role:competition-head → 学生组织部长 */
export function roleLabel(name: string): string {
  return tagLabel(name)
}
