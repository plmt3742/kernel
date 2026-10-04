// KERNEL · 项目「AI 整理」状态与调度（v0.5 · Slice N8）
//
// 目的：把「无归属任务」交给 AI 出「归并到已有项目 / 建议新项目」的提案，
//   用户在项目页确认后才写入；此外每天中午后由 shell 静默跑一次（只出建议，绝不自动应用）。
//
// 纪律：
//   · 本模块只存**界面状态**（提案 / 上次运行日 / 在途态），并经 localStorage 跨刷新保留；
//     localStorage 键 `kernel.ui.organize.v1`（复用 createUiStore 的 parse / prune 语义）；
//   · AI 绝不自动应用——调度器只调用草稿端点，应用仅来自用户在建议卡上的显式点击；
//   · 日键取**本地**日期（src/lib/date.ts 的 toISODateString），绝不用 toISOString（UTC 偏移会跨日）。
import { useEffect } from 'react'
import { api, errorText } from '@/lib/api'
import { toISODateString } from '@/lib/date'
import { createUiStore, useUiStore } from '@/lib/uiState'
import {
  aiOrganizeDraft,
  applyOrganize,
  unapplyOrganize,
  type OrganizeApplyInput,
  type OrganizeApplyResult,
  type OrganizeAssignment,
  type OrganizeCluster,
} from '@/lib/mutations'

/* ---------------------------------------------------------------------------
 * 状态定义
 * ------------------------------------------------------------------------- */

export interface OrganizeState {
  /** 草稿请求在途（卡片 / 按钮显示「整理中…」） */
  busy: boolean
  /** 应用请求在途 */
  applying: boolean
  /** 最近一次失败文案（静默错误，无 toast；空串 = 无错误） */
  error: string
  /** 上次成功运行日（本地 'YYYY-MM-DD'；'' = 从未运行） */
  lastRunDate: string
  /** 上次成功运行时刻（ISO；'' = 从未运行） */
  ranAt: string
  assignments: OrganizeAssignment[]
  clusters: OrganizeCluster[]
  model: string | null
  ms: number
  candidates: number
  /** N8.1：上次运行未纳入任何建议的候选数（单项事务或联系不足） */
  unplanned: number
}

const INITIAL_STATE: OrganizeState = {
  busy: false,
  applying: false,
  error: '',
  lastRunDate: '',
  ranAt: '',
  assignments: [],
  clusters: [],
  model: null,
  ms: 0,
  candidates: 0,
  unplanned: 0,
}

/* ---------------------------------------------------------------------------
 * 解析 / 清洗（损坏数据绝不 crash 渲染）
 * ------------------------------------------------------------------------- */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const MAX_ASSIGNMENTS = 8
const MAX_CLUSTERS = 5
const STR_MAX = 200
const REASON_MAX = 400
const ID_MAX = 64
const MAX_IDS = 60
const MAX_TAGS = 8
const TAG_MAX = 40
const MS_MAX = 600_000

function cleanStr(value: unknown, max = STR_MAX): string {
  return typeof value === 'string' ? value.slice(0, max) : ''
}

function cleanOptionalStr(value: unknown, max = STR_MAX): string | undefined {
  return typeof value === 'string' && value !== '' ? value.slice(0, max) : undefined
}

function cleanIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry !== '' && !out.includes(entry)) out.push(entry.slice(0, ID_MAX))
    if (out.length >= MAX_IDS) break
  }
  return out
}

function cleanTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    if (typeof entry === 'string' && entry !== '' && !out.includes(entry)) out.push(entry.slice(0, TAG_MAX))
    if (out.length >= MAX_TAGS) break
  }
  return out
}

function parseAssignment(raw: unknown): OrganizeAssignment | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  const projectId = cleanStr(obj.projectId, ID_MAX)
  const taskIds = cleanIdList(obj.taskIds)
  if (projectId === '' || taskIds.length === 0) return null
  return {
    projectId,
    projectTitle: cleanStr(obj.projectTitle) || projectId,
    taskIds,
    reason: cleanStr(obj.reason, REASON_MAX),
  }
}

function parseCluster(raw: unknown): OrganizeCluster | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>
  const title = cleanStr(obj.title)
  const taskIds = cleanIdList(obj.taskIds)
  if (title === '' || taskIds.length === 0) return null
  return {
    title,
    outcome: cleanOptionalStr(obj.outcome, REASON_MAX),
    reason: cleanStr(obj.reason, REASON_MAX),
    taskIds,
    inboxIds: cleanIdList(obj.inboxIds),
    areaId: cleanOptionalStr(obj.areaId, ID_MAX),
    tags: cleanTags(obj.tags),
  }
}

function parseOrganize(raw: unknown): OrganizeState | null {
  if (typeof raw !== 'object' || raw === null) return null
  const obj = raw as Record<string, unknown>

  const lastRunDate =
    typeof obj.lastRunDate === 'string' && DATE_RE.test(obj.lastRunDate) ? obj.lastRunDate : ''
  const ranAt = typeof obj.ranAt === 'string' ? obj.ranAt : ''
  const assignments = Array.isArray(obj.assignments)
    ? obj.assignments
        .map(parseAssignment)
        .filter((item): item is OrganizeAssignment => item !== null)
        .slice(0, MAX_ASSIGNMENTS)
    : []
  const clusters = Array.isArray(obj.clusters)
    ? obj.clusters
        .map(parseCluster)
        .filter((item): item is OrganizeCluster => item !== null)
        .slice(0, MAX_CLUSTERS)
    : []
  const ms =
    typeof obj.ms === 'number' && Number.isFinite(obj.ms) && obj.ms >= 0
      ? Math.min(obj.ms, MS_MAX)
      : 0
  const candidates =
    typeof obj.candidates === 'number' && Number.isFinite(obj.candidates) && obj.candidates >= 0
      ? Math.floor(obj.candidates)
      : 0
  const unplanned =
    typeof obj.unplanned === 'number' && Number.isFinite(obj.unplanned) && obj.unplanned >= 0
      ? Math.floor(obj.unplanned)
      : 0

  // 在途态 / 错误一律重置：刷新后不存在「正在请求」的残留
  return {
    busy: false,
    applying: false,
    error: '',
    lastRunDate,
    ranAt,
    assignments,
    clusters,
    model: cleanOptionalStr(obj.model, ID_MAX) ?? null,
    ms,
    candidates,
    unplanned,
  }
}

const organizeStore = createUiStore<OrganizeState>('kernel.ui.organize.v1', INITIAL_STATE, {
  parse: parseOrganize,
})

/* ---------------------------------------------------------------------------
 * 订阅 / 读取
 * ------------------------------------------------------------------------- */

export function getOrganizeState(): OrganizeState {
  return organizeStore.get()
}

export function useOrganizeState(): OrganizeState {
  return useUiStore(organizeStore)
}

/* ---------------------------------------------------------------------------
 * 手动运行（项目页「AI 整理」）
 * ------------------------------------------------------------------------- */

/**
 * 手动整理：忽略小时 / 日期 / 跨标签锁，仅守 busy / applying；
 * 成功（含 0 条提案）即记 lastRunDate=today 并返回 true；失败置 error 并返回 false。
 */
export async function runOrganizeNow(): Promise<boolean> {
  const prev = organizeStore.get()
  if (prev.busy || prev.applying) return false
  organizeStore.set((state) => ({ ...state, busy: true, error: '' }))
  try {
    const result = await aiOrganizeDraft()
    const today = toISODateString(new Date())
    organizeStore.set((state) => ({
      ...state,
      busy: false,
      error: '',
      lastRunDate: today,
      ranAt: new Date().toISOString(),
      assignments: result.assignments,
      clusters: result.clusters,
      model: result.model,
      ms: result.ms,
      candidates: result.candidates,
      unplanned: result.unplanned,
    }))
    return true
  } catch (err) {
    organizeStore.set((state) => ({ ...state, busy: false, error: errorText(err) }))
    return false
  }
}

/** 忽略当前提案：清空 assignments / clusters，保留 lastRunDate / ranAt（今日不再自动跑） */
export function dismissOrganize(): void {
  organizeStore.set((state) => ({ ...state, assignments: [], clusters: [] }))
}

/* ---------------------------------------------------------------------------
 * 应用 / 撤销（应用仅来自用户显式点击）
 * ------------------------------------------------------------------------- */

/**
 * 应用选中的提案：置 applying，构造写入输入，调用服务端；成功后从 store 移除已应用行；
 * 失败重置 applying 并把错误抛回调用方（由 Projects 统一 toast）。
 */
export async function applyOrganizeSelection(
  assignments: OrganizeAssignment[],
  clusters: OrganizeCluster[],
): Promise<OrganizeApplyResult> {
  const input: OrganizeApplyInput = {
    assignments: assignments.map((item) => ({ projectId: item.projectId, taskIds: [...item.taskIds] })),
    clusters: clusters.map((item) => {
      const cluster: OrganizeApplyInput['clusters'][number] = {
        title: item.title,
        taskIds: [...item.taskIds],
      }
      if (item.outcome !== undefined) cluster.outcome = item.outcome
      if (item.areaId !== undefined) cluster.areaId = item.areaId
      if (item.tags.length > 0) cluster.tags = [...item.tags]
      return cluster
    }),
  }

  organizeStore.set((state) => ({ ...state, applying: true, error: '' }))
  try {
    const result = await applyOrganize(input)
    // 已应用行按 projectId / title 匹配移除（仅移除本次提交的行，保留其余待确认提案）
    const appliedProjectIds = new Set(input.assignments.map((item) => item.projectId))
    const appliedTitles = new Set(input.clusters.map((item) => item.title))
    organizeStore.set((state) => ({
      ...state,
      applying: false,
      assignments: state.assignments.filter((item) => !appliedProjectIds.has(item.projectId)),
      clusters: state.clusters.filter((item) => !appliedTitles.has(item.title)),
    }))
    return result
  } catch (err) {
    organizeStore.set((state) => ({ ...state, applying: false }))
    throw err
  }
}

/** 撤销一次整理：新建项目入回收站 + 归入任务恢复原状（成功后整体水合） */
export async function undoOrganizeApply(result: OrganizeApplyResult): Promise<void> {
  await unapplyOrganize({
    projects: result.projects.map((project) => project.id),
    assignments: result.assignments,
  })
}

/* ---------------------------------------------------------------------------
 * 每日静默调度（shell 挂载）
 * ------------------------------------------------------------------------- */

const TICK_MS = 30_000
const NOON_HOUR = 12
const LOCK_KEY = 'kernel.ui.organize.lock.v1'
const LOCK_TTL_MS = 120_000

/** 会话内「今天已尝试」守卫：探活前即置位，避免 30s tick 反复探活（AI 离线时也不风暴） */
let sessionAttemptDate = ''

/** 跨标签锁：并发窗口内仅一个标签真正发起网络请求 */
function tryAcquireLock(): boolean {
  try {
    const raw = window.localStorage.getItem(LOCK_KEY)
    if (raw !== null) {
      const parsed = JSON.parse(raw) as { startedAt?: unknown }
      if (typeof parsed.startedAt === 'number' && Date.now() - parsed.startedAt < LOCK_TTL_MS) {
        return false
      }
    }
    window.localStorage.setItem(LOCK_KEY, JSON.stringify({ startedAt: Date.now() }))
    return true
  } catch {
    // localStorage 不可用（隐私模式等）：视为已获取，由会话守卫兜底
    return true
  }
}

function releaseLock(): void {
  try {
    window.localStorage.removeItem(LOCK_KEY)
  } catch {
    /* 静默 */
  }
}

/** 复用收件箱自动解析的健康探活口径 */
async function probeAiAvailable(): Promise<boolean> {
  try {
    const health = await api.get<{ available: boolean }>('/api/ai/health')
    return health.available === true
  } catch {
    return false
  }
}

async function tick(): Promise<void> {
  const state = organizeStore.get()
  if (state.busy || state.applying) return

  const now = new Date()
  if (now.getHours() < NOON_HOUR) return

  const today = toISODateString(now)
  // 字符串比较同时覆盖「时钟回拨」（last 晚于 today 也不再跑）
  if (state.lastRunDate !== '' && state.lastRunDate >= today) return
  if (sessionAttemptDate === today) return
  if (!tryAcquireLock()) return

  // 守卫先置位：即使随后探活失败，本会话的 30s tick 也不会再发请求
  sessionAttemptDate = today
  try {
    if (!(await probeAiAvailable())) return
    const result = await aiOrganizeDraft()
    // set 更新器形式即「重读后再保存」，避免覆盖并发写入
    organizeStore.set((current) => ({
      ...current,
      error: '',
      lastRunDate: today,
      ranAt: new Date().toISOString(),
      assignments: result.assignments,
      clusters: result.clusters,
      model: result.model,
      ms: result.ms,
      candidates: result.candidates,
      unplanned: result.unplanned,
    }))
  } catch (err) {
    // 静默：仅存错误态供卡片展示，不 toast
    organizeStore.set((current) => ({ ...current, error: errorText(err) }))
  } finally {
    releaseLock()
  }
}

/**
 * 每日调度：挂载即 tick 一次；每 30s 轮询；可见性恢复 / 窗口聚焦即时补跑。
 * 中午前不跑；当天已跑 / 本会话已尝试 / 他标签持锁时不跑；AI 离线静默跳过。
 */
export function useOrganizeScheduler(): void {
  useEffect(() => {
    const run = (): void => {
      void tick()
    }
    run()
    const timer = window.setInterval(run, TICK_MS)
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') run()
    }
    window.addEventListener('focus', run)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', run)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])
}
