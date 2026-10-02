// KERNEL · 收件箱「AI 归纳」建议卡（v0.5 · Slice R2，见 ADR-0016）
// 呈现聚类提案（连续累积的相似任务 → 新项目）：标题 + 成员数 + 任务标题（截断）+
// 相关条目（澄清时会自动参考，本卡不写入它们）。「创建并归入」/「忽略」；确认前绝不落盘。
import type { ReactNode } from 'react'
import { Layers } from 'lucide-react'
import { TagPill } from '@/components/TagPill'
import { getAreaById, getInboxById, getTaskById } from '@/lib/data'
import { tagLabel } from '@/lib/format'
import type { ClusterProposal } from '@/lib/mutations'
import type { InboxItem, Task } from '@/types'

const TITLE_MAX = 28

function truncate(text: string): string {
  return text.length > TITLE_MAX ? `${text.slice(0, TITLE_MAX)}…` : text
}

interface ClusterProposalCardProps {
  proposals: ClusterProposal[]
  /** 有任一应用请求在途（禁用全部按钮，防重复提交） */
  applying: boolean
  onApply: (proposal: ClusterProposal) => void
  onIgnore: (proposal: ClusterProposal) => void
}

export function ClusterProposalCard({
  proposals,
  applying,
  onApply,
  onIgnore,
}: ClusterProposalCardProps): ReactNode {
  if (proposals.length === 0) return null
  return (
    <div className="ic-cluster">
      <div className="ic-cluster__head">
        <span className="k-pill">
          <Layers size={12} strokeWidth={1.5} aria-hidden /> AI 归纳
        </span>
        <span className="ic-cluster__hint u-label k-muted">
          发现 {proposals.length} 组可能成项的相似任务 · 确认后建项
        </span>
      </div>
      {proposals.map((proposal, index) => {
        const area = proposal.areaId !== undefined ? getAreaById(proposal.areaId) : undefined
        const tasks = proposal.taskIds
          .map((id) => getTaskById(id))
          .filter((task): task is Task => task !== undefined)
        const inboxItems = proposal.inboxIds
          .map((id) => getInboxById(id))
          .filter((item): item is InboxItem => item !== undefined)
        return (
          <div className="ic-cluster__item" key={`${proposal.title}-${index}`}>
            <div className="ic-cluster__title-row">
              <span className="ic-cluster__title">{proposal.title}</span>
              <span className="k-pill is-ghost">{proposal.taskIds.length} 项任务</span>
              {area !== undefined && <span className="k-pill">归入 {area.title}</span>}
              {proposal.tags.map((tag) => (
                <TagPill key={tag}>{tagLabel(tag)}</TagPill>
              ))}
            </div>
            {proposal.outcome !== undefined && proposal.outcome !== '' && (
              <p className="ic-cluster__outcome">{proposal.outcome}</p>
            )}
            <ul className="ic-cluster__members">
              {tasks.map((task) => (
                <li className="ic-cluster__member" key={task.id}>
                  <span className="k-mono k-muted">{task.id}</span>
                  <span className="ic-cluster__member-title">{truncate(task.title)}</span>
                </li>
              ))}
            </ul>
            {inboxItems.length > 0 && (
              <p className="ic-cluster__related">
                相关条目（澄清时会自动参考）：
                {inboxItems.map((item) => truncate(item.content)).join(' · ')}
              </p>
            )}
            {proposal.reason !== '' && <p className="ic-cluster__reason">{proposal.reason}</p>}
            <div className="ic-cluster__actions">
              <button
                type="button"
                className="k-btn is-solid k-btn--sm"
                disabled={applying}
                onClick={() => onApply(proposal)}
              >
                创建并归入
              </button>
              <button
                type="button"
                className="k-pill is-ghost"
                disabled={applying}
                onClick={() => onIgnore(proposal)}
              >
                忽略
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
