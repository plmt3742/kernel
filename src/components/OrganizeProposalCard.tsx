// KERNEL · 项目「AI 整理」建议卡（v0.5 · Slice N8）
// 两段提案：① 归并到已有项目（任务 → 既有项目）② 建议新项目（任务 / 条目 → 新项目）。
// 每行可勾选（默认全选，重新整理后重置），页脚「全部应用（K 项）」/「重新整理」/「忽略」。
// 纪律：确认前绝不落盘；本组件只产出 onApply(selection 两数组)，由 Projects 调 applyOrganizeSelection。
import { useEffect, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Checkbox } from '@/components/Checkbox'
import { TagPill } from '@/components/TagPill'
import { getAreaById, getInboxById, getTaskById } from '@/lib/data'
import { formatTime, isToday } from '@/lib/date'
import { tagLabel } from '@/lib/format'
import { useOrganizeState } from '@/lib/organize'
import type { OrganizeAssignment, OrganizeCluster } from '@/lib/mutations'

const TITLE_MAX = 28

/** 截断过长任务 / 条目标题（成员列表保持单行安静） */
function truncate(text: string): string {
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text
}

interface OrganizeProposalCardProps {
  assignments: OrganizeAssignment[]
  clusters: OrganizeCluster[]
  /** 草稿请求在途（卡片显示「整理中…」并禁用按钮） */
  busy: boolean
  /** 应用请求在途 */
  applying: boolean
  onApply: (assignments: OrganizeAssignment[], clusters: OrganizeCluster[]) => void
  onRerun: () => void
  onDismiss: () => void
}

export function OrganizeProposalCard({
  assignments,
  clusters,
  busy,
  applying,
  onApply,
  onRerun,
  onDismiss,
}: OrganizeProposalCardProps): ReactNode {
  // 勾选态：默认全选；数组引用变化（重新整理 / 应用后裁剪）即重置为全选
  const [includedA, setIncludedA] = useState<boolean[]>(() => assignments.map(() => true))
  const [includedC, setIncludedC] = useState<boolean[]>(() => clusters.map(() => true))
  // 上次运行 / 错误态取自模块级 store（跨路由存活；不在 props 中传递运行元数据）
  const { ranAt, error, lastRunDate, unplanned } = useOrganizeState()

  useEffect(() => {
    setIncludedA(assignments.map(() => true))
    setIncludedC(clusters.map(() => true))
  }, [assignments, clusters])

  const hasData = assignments.length > 0 || clusters.length > 0

  // 无内容、无运行记录、无错误、且不在途 → 整卡不渲染
  if (!hasData && !busy && !applying && error === '' && ranAt === '' && lastRunDate === '') {
    return null
  }

  // 头部分节提示：非零部分以 · 连接（归并 N 条 · 新项目建议 M 个（确认后应用））
  const hintParts: string[] = []
  if (assignments.length > 0) hintParts.push(`归并建议 ${assignments.length} 条`)
  if (clusters.length > 0) hintParts.push(`新项目建议 ${clusters.length} 个`)
  const hint = hintParts.length > 0 ? `${hintParts.join(' · ')}（确认后应用）` : ''

  // 末次运行戳：仅今天显示（本地日；非今天省略）
  const stamp = ranAt !== '' && isToday(ranAt) ? `上次整理：今天 ${formatTime(ranAt)}` : ''

  const selectedAssignments = assignments.filter((_, index) => includedA[index] === true)
  const selectedClusters = clusters.filter((_, index) => includedC[index] === true)
  // K = 已勾选拟归入 / 建项的任务数（与服务端 assignedTotal 同口径）
  const selectedTaskCount =
    selectedAssignments.reduce((n, item) => n + item.taskIds.length, 0) +
    selectedClusters.reduce((n, item) => n + item.taskIds.length, 0)

  const toggleA = (index: number): void => {
    setIncludedA((prev) => prev.map((flag, i) => (i === index ? !flag : flag)))
  }
  const toggleC = (index: number): void => {
    setIncludedC((prev) => prev.map((flag, i) => (i === index ? !flag : flag)))
  }

  return (
    <div className="ic-organize">
      <div className="ic-organize__head">
        <span className="k-pill">
          <Sparkles size={12} strokeWidth={1.5} aria-hidden /> AI 整理
        </span>
        {hint !== '' && <span className="ic-organize__hint u-label k-muted">{hint}</span>}
        {stamp !== '' && <span className="ic-organize__caption u-label k-muted">{stamp}</span>}
      </div>

      {!hasData ? (
        busy || applying ? (
          <p className="ic-organize__msg">正在整理任务与项目…</p>
        ) : error !== '' ? (
          <p className="ic-organize__msg is-error">
            整理失败：{error}
            <button type="button" className="k-pill is-ghost" onClick={onRerun}>
              重试
            </button>
          </p>
        ) : (
          <p className="ic-organize__msg">
            {`今日整理已完成 · 暂无待确认建议${unplanned > 0 ? `（另有 ${unplanned} 项未纳入规划）` : ''}`}
          </p>
        )
      ) : (
        <>
          {error !== '' && <p className="ic-organize__msg is-error">整理失败：{error}</p>}

          {assignments.length > 0 && (
            <section className="ic-organize__section">
              <span className="ic-organize__section-title u-label k-muted">归并到已有项目</span>
              <ul className="ic-organize__list">
                {assignments.map((item, index) => {
                  const checked = includedA[index] === true
                  return (
                    <li
                      className={checked ? 'ic-organize__row' : 'ic-organize__row is-excluded'}
                      key={`${item.projectId}-${index}`}
                    >
                      <div className="ic-organize__row-head">
                        <Checkbox
                          checked={checked}
                          onToggle={() => toggleA(index)}
                          label={`纳入归并：${item.projectTitle}`}
                        />
                        <span className="ic-organize__row-title">归入「{item.projectTitle}」</span>
                        <span className="k-pill is-ghost">{item.taskIds.length} 项任务</span>
                      </div>
                      <ul className="ic-organize__members">
                        {item.taskIds.map((id) => {
                          const task = getTaskById(id)
                          return (
                            <li className="ic-organize__member" key={id}>
                              <span className="k-mono k-muted">{id}</span>
                              <span className="ic-organize__member-title">
                                {task !== undefined ? truncate(task.title) : id}
                              </span>
                            </li>
                          )
                        })}
                      </ul>
                      {item.reason !== '' && <p className="ic-organize__reason">{item.reason}</p>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {clusters.length > 0 && (
            <section className="ic-organize__section">
              <span className="ic-organize__section-title u-label k-muted">建议新项目</span>
              <ul className="ic-organize__list">
                {clusters.map((item, index) => {
                  const checked = includedC[index] === true
                  const area = item.areaId !== undefined ? getAreaById(item.areaId) : undefined
                  const inboxItems = item.inboxIds
                    .map((id) => getInboxById(id))
                    .filter((entry): entry is NonNullable<typeof entry> => entry !== undefined)
                  return (
                    <li
                      className={checked ? 'ic-organize__row' : 'ic-organize__row is-excluded'}
                      key={`${item.title}-${index}`}
                    >
                      <div className="ic-organize__row-head">
                        <Checkbox
                          checked={checked}
                          onToggle={() => toggleC(index)}
                          label={`纳入新项目：${item.title}`}
                        />
                        <span className="ic-organize__row-title">{item.title}</span>
                        <span className="k-pill is-ghost">{item.taskIds.length} 项任务</span>
                        {area !== undefined && <span className="k-pill">归入 {area.title}</span>}
                        {item.tags.map((tag) => (
                          <TagPill key={tag}>{tagLabel(tag)}</TagPill>
                        ))}
                      </div>
                      {item.outcome !== undefined && item.outcome !== '' && (
                        <p className="ic-organize__outcome">{item.outcome}</p>
                      )}
                      <ul className="ic-organize__members">
                        {item.taskIds.map((id) => {
                          const task = getTaskById(id)
                          return (
                            <li className="ic-organize__member" key={id}>
                              <span className="k-mono k-muted">{id}</span>
                              <span className="ic-organize__member-title">
                                {task !== undefined ? truncate(task.title) : id}
                              </span>
                            </li>
                          )
                        })}
                        {inboxItems.map((entry) => (
                          <li className="ic-organize__member" key={entry.id}>
                            <span className="k-mono k-muted">{entry.id}</span>
                            <span className="ic-organize__member-title">{truncate(entry.content)}</span>
                          </li>
                        ))}
                      </ul>
                      {inboxItems.length > 0 && (
                        <p className="ic-organize__related">相关条目（仅作命名参考，不会写入）</p>
                      )}
                      {item.reason !== '' && <p className="ic-organize__reason">{item.reason}</p>}
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {unplanned > 0 && (
            <p className="ic-organize__skipped">另有 {unplanned} 项未纳入规划（单项事务或联系不足）</p>
          )}
          <div className="ic-organize__actions">
            <button
              type="button"
              className="k-btn is-solid"
              disabled={selectedTaskCount === 0 || applying || busy}
              onClick={() => onApply(selectedAssignments, selectedClusters)}
            >
              全部应用（{selectedTaskCount} 项）
            </button>
            <button
              type="button"
              className="k-pill is-ghost"
              disabled={busy || applying}
              onClick={onRerun}
            >
              重新整理
            </button>
            <button type="button" className="k-pill is-ghost" disabled={applying} onClick={onDismiss}>
              忽略
            </button>
          </div>
        </>
      )}
    </div>
  )
}
