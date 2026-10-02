// KERNEL · EmptyState（设计过的排版空态，不用通用插画）
import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** 保留占位：版式重排后空态不再渲染编号 */
  index?: string
  title: string
  hint?: string
  action?: ReactNode
}

export function EmptyState({ title, hint, action }: EmptyStateProps) {
  return (
    <div className="k-empty">
      <p className="k-empty__title">{title}</p>
      {hint !== undefined && <p className="k-empty__hint">{hint}</p>}
      {action !== undefined && <div className="k-view__actions">{action}</div>}
    </div>
  )
}
