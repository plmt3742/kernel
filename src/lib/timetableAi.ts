// KERNEL · 课表导入状态存储（v0.5 · Slice H1）
// 纪律：提取过程不写数据（data/ 零写入）；AI 只出课程草稿，落盘仍经 importCourses（用户勾选确认）。
// 背景与 inboxAi 同理：把提取过程状态提升到模块级，切页卸载后回来仍见真实进度 / 草稿。
// 不落 localStorage：草稿由服务端一次性给出，刷新后重新提取即可，无需持久化。
import { errorText } from '@/lib/api'
import { aiTimetableDraftStream, type CourseCreateInput } from '@/lib/mutations'
import type { InboxItem } from '@/types'

/** 实时预览保留的尾部字符数（与 inboxAi 同一预览上限思路） */
const TT_PREVIEW_MAX = 240

/**
 * 课表类关键词（Slice H1.7）：文件名或文本内容命中即视为课表来源。
 * 无 `g` 标志，避免 test 的有状态匹配；大小写不敏感（兼容 `timetable`）。
 */
const TIMETABLE_HINT = /课表|课程表|时间表|timetable/i

/**
 * 判断投递条目是否疑似课表（Slice H1.7 自动路由）：
 * 仅当**存在附件**，且（文件名 或 文本内容）命中课表关键词时为 true。
 * 纯文本条目（无 file）一律 false；无关键词的截图一律 false——避免误路由，
 * 手动「导入为课表」入口始终保留。
 */
export function looksLikeTimetable(item: InboxItem): boolean {
  if (item.file === undefined) return false
  return TIMETABLE_HINT.test(item.file.name) || TIMETABLE_HINT.test(item.content)
}

/** 课表提取状态快照（useSyncExternalStore 消费；每次变更换新引用） */
export interface TimetableAiSnapshot {
  /** 当前操作的条目 id（null = 无面板） */
  itemId: string | null
  /** 提取在途 */
  busy: boolean
  /** 人类可读阶段文案（空串 = 无；由 SSE status / delta / retry 驱动） */
  stage: string
  /** 流式输出实时预览尾部（空串 = 无；仅取 field==='text' 的 delta） */
  preview: string
  /** 提取出的课程草稿（null = 未就绪 / 失败） */
  courses: CourseCreateInput[] | null
  /** 失败文案（空串 = 无错误） */
  error: string
}

let snapshot: TimetableAiSnapshot = {
  itemId: null,
  busy: false,
  stage: '',
  preview: '',
  courses: null,
  error: '',
}

const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of [...listeners]) listener()
}

function setState(patch: Partial<TimetableAiSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  emit()
}

export function subscribeTimetableAi(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getTimetableAiSnapshot(): TimetableAiSnapshot {
  return snapshot
}

// 活跃请求令牌：新运行 / 清空时自增，令旧响应迟到不落状态（新运行作废旧在途请求）
let activeToken = 0

/**
 * 运行一次课表提取（Slice H1.6：流式过程可视）：设置 itemId / busy，清空 stage / preview /
 * courses / error；经 SSE 事件驱动阶段文案与实时预览，成功存草稿（清空过程态），失败存可读文案。
 * 失败不抛出（错误态由面板承载，保持安静）；token 守卫保证仅最新一次运行落地（新运行作废旧请求）。
 */
export async function runTimetableDraft(item: InboxItem): Promise<void> {
  const token = (activeToken += 1)
  setState({ itemId: item.id, busy: true, stage: '', preview: '', courses: null, error: '' })
  try {
    const result = await aiTimetableDraftStream(item.id, (event) => {
      if (activeToken !== token) return
      if (event.kind === 'status') {
        if (event.status === 'busy') setState({ stage: 'AI 正在阅读课表…' })
      } else if (event.kind === 'delta') {
        if (event.field === 'text') {
          setState({
            stage: '正在提取课程…',
            preview: (snapshot.preview + event.delta).slice(-TT_PREVIEW_MAX),
          })
        }
      } else if (event.kind === 'retry') {
        setState({ stage: '输出校验重试中…' })
      } else if (event.kind === 'suggestion') {
        // 草稿就绪：过程态清空，busy 由 promise 兑现后统一收尾
        setState({ courses: event.courses, stage: '', preview: '' })
      }
    })
    if (activeToken !== token) return
    setState({ busy: false, stage: '', preview: '', courses: result.courses, error: '' })
  } catch (err) {
    if (activeToken !== token) return
    setState({ busy: false, stage: '', preview: '', courses: null, error: errorText(err) })
  }
}

/** 清空课表提取面板并作废在途请求（忽略 / 导入完成 / 收起时调用） */
export function clearTimetableDraft(): void {
  activeToken += 1
  setState({ itemId: null, busy: false, stage: '', preview: '', courses: null, error: '' })
}
