// KERNEL · 动作记录（回顾页时间线，v0.5 · Slice S）
//
// 纯函数 + 类型：把 `GET /api/activity` 的审计条目翻译成中文可读描述，并按
// 语义分桶（完成 / 新增 / 打卡 / 其他）、按天分组，供「动作记录」时间线消费。
// 纪律：本模块只读、不缓存、不落盘；审计条目类型复用 `mutations.ts`（单一事实源）。
import type { ActivityEntry } from '@/lib/mutations'
import { daysFromToday, formatMonthDay, toISODateString } from '@/lib/date'

export type { ActivityEntry }

/** 语义分桶：完成 / 新增 / 打卡 / 其他（时间线过滤与描述共用） */
export type ActivityBucket = 'done' | 'created' | 'checkin' | 'other'

/** 过滤档位：全部 + 四个语义桶 */
export type ActivityFilter = ActivityBucket | 'all'

/** 过滤档位全集（供 store 解析与 chips 渲染复用） */
export const ACTIVITY_FILTERS: readonly ActivityFilter[] = [
  'all',
  'done',
  'created',
  'checkin',
  'other',
]

/** 一条审计条目的中文描述结果 */
export interface DescribedActivity {
  bucket: ActivityBucket
  label: string
}

/** 按天分组后的一组条目（保持审计的倒序） */
export interface ActivityDayGroup {
  dayLabel: string
  items: ActivityEntry[]
}

/** 实体中文名（含审计里出现的 `inboxItem` 别名） */
const ENTITY_LABEL: Record<string, string> = {
  task: '任务',
  project: '项目',
  note: '笔记',
  resource: '资料',
  event: '日程',
  area: '区域',
  goal: '目标',
  habit: '习惯',
  course: '课程',
  inbox: '收件箱',
  inboxitem: '收件箱',
  review: '回顾',
  tag: '标签',
  config: '设置',
  term: '学期',
}

/** 任务状态 → 中文（`task.update` 的 `detail.status`） */
const TASK_STATUS_LABEL: Record<string, string> = {
  next: '下一步',
  waiting: '等待',
  scheduled: '已排期',
  someday: '将来',
  dropped: '已丢弃',
  done: '完成',
}

/** 显式「新增」动作 → 实体中文（其余 `*.create` 不在此列，走其他分支 / 回退） */
const CREATED_ACTION_ENTITY: Record<string, string> = {
  'task.create': '任务',
  'project.create': '项目',
  'note.create': '笔记',
  'resource.create': '资料',
  'event.create': '日程',
  'area.create': '区域',
  'goal.create': '目标',
  'habit.create': '习惯',
  'course.create': '课程',
}

/** 安全取 detail 字段为字符串（空串视为缺省） */
function strField(detail: Record<string, unknown>, key: string): string {
  const value = detail[key]
  return typeof value === 'string' && value.trim() !== '' ? value : ''
}

/** 条目标题：优先 `detail.title`，空则回退 id（保证文案始终可读） */
function titleOf(entry: ActivityEntry, detail: Record<string, unknown>): string {
  return strField(detail, 'title') !== '' ? strField(detail, 'title') : entry.id
}

/** 实体中文名：先查表，再剥离 `Item` 后缀（如 `inboxItem` → 收件箱），最后回退原值 */
function entityLabel(entity: string): string {
  const key = entity.toLowerCase()
  const direct = ENTITY_LABEL[key]
  if (direct !== undefined) return direct
  const stripped = ENTITY_LABEL[key.replace(/item$/, '')]
  return stripped !== undefined ? stripped : entity
}

/** 安全计数（用于 `inbox.apply` 的 items 数） */
function countOf(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * 把一条审计条目翻译为「分桶 + 中文文案」。
 * 覆盖现有全部动作；未知动作安静回退为 `action · id`（不臆造语义）。
 */
export function describeActivity(entry: ActivityEntry): DescribedActivity {
  const action = entry.action
  const detail = entry.detail ?? {}
  const title = titleOf(entry, detail)
  const entity = entry.entity

  // 任务完成 / 重开 / 状态变更（`task.complete` 为专用动作，`task.update` 携带 status）
  if (action === 'task.complete') return { bucket: 'done', label: `完成任务「${title}」` }
  if (action === 'task.reopen') return { bucket: 'other', label: `重新打开任务「${title}」` }
  if (action === 'task.update') {
    const status = detail.status
    if (status === 'done') return { bucket: 'done', label: `完成任务「${title}」` }
    if (typeof status === 'string' && TASK_STATUS_LABEL[status] !== undefined) {
      return { bucket: 'other', label: `调整任务「${title}」→ ${TASK_STATUS_LABEL[status]}` }
    }
    return { bucket: 'other', label: `修改任务「${title}」` }
  }

  // 新增（显式清单，避免把 tag.create 等误归为「新增实体」）
  const createdEntity = CREATED_ACTION_ENTITY[action]
  if (createdEntity !== undefined) {
    return { bucket: 'created', label: `新增${createdEntity}「${title}」` }
  }
  if (action === 'inbox.capture') return { bucket: 'created', label: '捕捉到收件箱' }
  if (action === 'inbox.upload') {
    const name = strField(detail, 'name')
    return { bucket: 'created', label: `投递文件「${name !== '' ? name : title}」` }
  }

  // 习惯打卡 / 取消打卡
  if (action === 'habit.checkin') return { bucket: 'checkin', label: `打卡「${title}」` }
  if (action === 'habit.uncheckin') return { bucket: 'checkin', label: `取消打卡「${title}」` }

  // 收件箱生命周期（须在通用 `*.remove` / `*.create` 之前判定）
  if (action === 'inbox.apply') {
    return { bucket: 'other', label: `整理收件箱（${countOf(detail.created)} 项）` }
  }
  if (action === 'inbox.unapply') return { bucket: 'other', label: '撤销整理收件箱' }
  if (action === 'inbox.clarify' || action.startsWith('inbox.clarify.')) {
    return { bucket: 'other', label: '澄清收件箱条目' }
  }
  if (action === 'inbox.discard') return { bucket: 'other', label: '丢弃收件箱条目' }
  if (action === 'inbox.revert' || action.startsWith('inbox.revert.')) {
    return { bucket: 'other', label: '撤回收件箱条目' }
  }
  if (action === 'inbox.remove') return { bucket: 'other', label: '删除收件箱条目' }

  // 回顾报告
  if (action === 'review.create') return { bucket: 'other', label: '生成回顾报告' }

  // 标签生命周期
  if (action === 'tag.create') {
    const name = strField(detail, 'name')
    return { bucket: 'other', label: `登记标签「${name !== '' ? name : title}」` }
  }
  if (action === 'tag.rename') return { bucket: 'other', label: '重命名标签' }
  if (action === 'tag.merge') return { bucket: 'other', label: '合并标签' }
  if (action === 'tag.remove') return { bucket: 'other', label: '删除标签' }
  if (action === 'tag.backfill') return { bucket: 'other', label: '扫描登记存量标签' }

  // 配置 / 学期元数据
  if (action === 'config.update') return { bucket: 'other', label: '更新设置' }
  if (action === 'term.update') return { bucket: 'other', label: '更新学期信息' }

  // 通用后缀：修改 / 移入回收站 / 恢复 / 彻底删除
  const label = entityLabel(entity)
  if (action.endsWith('.update') || action.endsWith('.touch')) {
    return { bucket: 'other', label: `修改${label}「${title}」` }
  }
  if (action.endsWith('.trash') || action.endsWith('.remove')) {
    return { bucket: 'other', label: `移入回收站：${label}「${title}」` }
  }
  if (action.endsWith('.restore')) {
    return { bucket: 'other', label: `从回收站恢复：${label}「${title}」` }
  }
  if (action.endsWith('.purge')) {
    return { bucket: 'other', label: `彻底删除：${label}「${entry.id}」` }
  }

  // 未知动作：安静回退（不臆造语义）
  return { bucket: 'other', label: `${action} · ${entry.id}` }
}

/** 按语义桶过滤（`all` 原样返回，保持倒序） */
export function filterByBucket(
  entries: ActivityEntry[],
  filter: ActivityFilter,
): ActivityEntry[] {
  if (filter === 'all') return entries
  return entries.filter((entry) => describeActivity(entry).bucket === filter)
}

/** 日标题：今天 / 昨天 / M月D日（复用现有日期助手） */
function dayLabelOf(ts: string): string {
  const diff = daysFromToday(ts)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  return formatMonthDay(ts)
}

/**
 * 按自然日分组（输入为审计的倒序，故组间亦倒序）。
 * 以 ISO 日期为组键（避免跨年同名「M月D日」被合并）；文案由 `dayLabelOf` 生成。
 */
export function groupByDay(entries: ActivityEntry[]): ActivityDayGroup[] {
  const groups: ActivityDayGroup[] = []
  let currentKey: string | null = null
  for (const entry of entries) {
    const key = toISODateString(entry.ts)
    if (key !== currentKey) {
      groups.push({ dayLabel: dayLabelOf(entry.ts), items: [] })
      currentKey = key
    }
    groups[groups.length - 1].items.push(entry)
  }
  return groups
}
