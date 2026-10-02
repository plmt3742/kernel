// KERNEL · 实体关联派生（纯运行时读取，禁止落盘）
// 依据 docs/04-DATA-MODEL.md 的外键字段（projectId / areaId / goalId / nextActionId /
// parentTaskId / sourceInboxId / links），对当前数据快照做线性扫描，返回出链 + 入链。
// 数据量级为数百条，线性扫描足够；结果不缓存、不写回。
import type { CalendarEvent, Note, Project, Resource, Task } from '@/types'
import { getSnapshot } from '@/lib/data'

/** 可推导关联的实体类型（抽屉上下文） */
export type RelationKind = 'task' | 'project' | 'note' | 'event' | 'resource'

/** 关联指向的目标实体类型（含仅作来源的 area / goal / inbox） */
export type RefKind = RelationKind | 'area' | 'goal' | 'inbox'

/** 一条关联引用 */
export interface EntityRef {
  kind: RefKind
  id: string
  title: string
  /** 中文关系标签，如「所属项目」「反向链接」 */
  label: string
}

export interface EntityRelations {
  /** 本实体主动指向的关联 */
  outbound: EntityRef[]
  /** 其他实体反向指向本实体的关联 */
  inbound: EntityRef[]
}

function ref(kind: RefKind, id: string, title: string, label: string): EntityRef {
  return { kind, id, title, label }
}

function emptyRelations(): EntityRelations {
  return { outbound: [], inbound: [] }
}

/** 任务：所属项目 / 区域 / 父任务 / 来源条目；子任务 / 作为下一步行动 */
function taskRelations(task: Task): EntityRelations {
  const s = getSnapshot()
  const outbound: EntityRef[] = []

  if (task.projectId !== undefined) {
    const project = s.projects.find((x) => x.id === task.projectId)
    if (project !== undefined) outbound.push(ref('project', project.id, project.title, '所属项目'))
  }
  if (task.areaId !== undefined) {
    const area = s.areas.find((x) => x.id === task.areaId)
    if (area !== undefined) outbound.push(ref('area', area.id, area.title, '区域'))
  }
  if (task.parentTaskId !== undefined) {
    const parent = s.tasks.find((x) => x.id === task.parentTaskId)
    if (parent !== undefined) outbound.push(ref('task', parent.id, parent.title, '父任务'))
  }
  if (task.sourceInboxId !== undefined) {
    const source = s.inbox.find((x) => x.id === task.sourceInboxId)
    if (source !== undefined) outbound.push(ref('inbox', source.id, source.content, '来源条目'))
  }

  const inbound: EntityRef[] = []
  for (const child of s.tasks) {
    if (child.parentTaskId === task.id) inbound.push(ref('task', child.id, child.title, '子任务'))
  }
  for (const project of s.projects) {
    if (project.nextActionId === task.id) {
      inbound.push(ref('project', project.id, project.title, '作为下一步行动'))
    }
  }

  return { outbound, inbound }
}

/** 项目：区域 / 目标 / 下一步行动；关联任务 / 关联事件 / 关联笔记 */
function projectRelations(project: Project): EntityRelations {
  const s = getSnapshot()
  const outbound: EntityRef[] = []

  const area = s.areas.find((x) => x.id === project.areaId)
  if (area !== undefined) outbound.push(ref('area', area.id, area.title, '区域'))
  if (project.goalId !== undefined) {
    const goal = s.goals.find((x) => x.id === project.goalId)
    if (goal !== undefined) outbound.push(ref('goal', goal.id, goal.title, '目标'))
  }
  if (project.nextActionId !== undefined) {
    const next = s.tasks.find((x) => x.id === project.nextActionId)
    if (next !== undefined) outbound.push(ref('task', next.id, next.title, '下一步行动'))
  }

  const inbound: EntityRef[] = []
  for (const task of s.tasks) {
    if (task.projectId === project.id) inbound.push(ref('task', task.id, task.title, '关联任务'))
  }
  for (const event of s.events) {
    if (event.projectId === project.id) inbound.push(ref('event', event.id, event.title, '关联事件'))
  }
  for (const note of s.notes) {
    if (note.projectId === project.id) inbound.push(ref('note', note.id, note.title, '关联笔记'))
  }

  return { outbound, inbound }
}

/** 笔记：所属项目 / 区域 / 关联笔记（links）；反向链接 */
function noteRelations(note: Note): EntityRelations {
  const s = getSnapshot()
  const outbound: EntityRef[] = []

  if (note.projectId !== undefined) {
    const project = s.projects.find((x) => x.id === note.projectId)
    if (project !== undefined) outbound.push(ref('project', project.id, project.title, '所属项目'))
  }
  if (note.areaId !== undefined) {
    const area = s.areas.find((x) => x.id === note.areaId)
    if (area !== undefined) outbound.push(ref('area', area.id, area.title, '区域'))
  }
  for (const linkId of note.links) {
    const linked = s.notes.find((x) => x.id === linkId)
    if (linked !== undefined) outbound.push(ref('note', linked.id, linked.title, '关联笔记'))
  }

  const inbound: EntityRef[] = []
  for (const other of s.notes) {
    if (other.id !== note.id && other.links.includes(note.id)) {
      inbound.push(ref('note', other.id, other.title, '反向链接'))
    }
  }

  return { outbound, inbound }
}

/** 事件：所属项目 / 区域（无实体反向指向事件） */
function eventRelations(event: CalendarEvent): EntityRelations {
  const s = getSnapshot()
  const outbound: EntityRef[] = []

  if (event.projectId !== undefined) {
    const project = s.projects.find((x) => x.id === event.projectId)
    if (project !== undefined) outbound.push(ref('project', project.id, project.title, '所属项目'))
  }
  if (event.areaId !== undefined) {
    const area = s.areas.find((x) => x.id === event.areaId)
    if (area !== undefined) outbound.push(ref('area', area.id, area.title, '区域'))
  }

  return { outbound, inbound: [] }
}

/** 资料：区域（无实体反向指向资料） */
function resourceRelations(resource: Resource): EntityRelations {
  const s = getSnapshot()
  const outbound: EntityRef[] = []

  if (resource.areaId !== undefined) {
    const area = s.areas.find((x) => x.id === resource.areaId)
    if (area !== undefined) outbound.push(ref('area', area.id, area.title, '区域'))
  }

  return { outbound, inbound: [] }
}

/**
 * 实体 id → 详情深链（与 Relations 的 PATH_OF 同口径）。
 * 无独立页面（area / goal）或未知前缀返回 null。供收件箱「查看产物」等跨页跳转复用。
 */
export function deepLinkOfId(id: string): string | null {
  const dash = id.indexOf('-')
  const prefix = dash === -1 ? id : id.slice(0, dash)
  switch (prefix) {
    case 't':
      return `/tasks?task=${id}`
    case 'p':
      return `/projects?project=${id}`
    case 'n':
      return `/library?note=${id}`
    case 'r':
      return `/library?resource=${id}`
    case 'e':
      return `/calendar?event=${id}`
    case 'i':
      return '/inbox'
    default:
      return null
  }
}

/** 按实体类型与 id 派生关联（实体不存在时返回空） */
export function getRelations(kind: RelationKind, id: string): EntityRelations {
  const s = getSnapshot()
  switch (kind) {
    case 'task': {
      const task = s.tasks.find((x) => x.id === id)
      return task !== undefined ? taskRelations(task) : emptyRelations()
    }
    case 'project': {
      const project = s.projects.find((x) => x.id === id)
      return project !== undefined ? projectRelations(project) : emptyRelations()
    }
    case 'note': {
      const note = s.notes.find((x) => x.id === id)
      return note !== undefined ? noteRelations(note) : emptyRelations()
    }
    case 'event': {
      const event = s.events.find((x) => x.id === id)
      return event !== undefined ? eventRelations(event) : emptyRelations()
    }
    case 'resource': {
      const resource = s.resources.find((x) => x.id === id)
      return resource !== undefined ? resourceRelations(resource) : emptyRelations()
    }
    default:
      return emptyRelations()
  }
}
