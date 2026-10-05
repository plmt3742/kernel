// KERNEL · EmptyState（设计过的排版空态，不用通用插画）
import type { ReactNode } from 'react'

interface EmptyStateProps {
  /** 保留占位：版式重排后空态不再渲染编号 */
  index?: string
  title: string
  hint?: string
  action?: ReactNode
  /** 首启引导：为 true 时在提示 / 动作下方附「查看使用指南 →」新标签外链 */
  guide?: boolean
}

export function EmptyState({ title, hint, action, guide = false }: EmptyStateProps) {
  return (
    <div className="k-empty">
      <p className="k-empty__title">{title}</p>
      {hint !== undefined && <p className="k-empty__hint">{hint}</p>}
      {action !== undefined && <div className="k-view__actions">{action}</div>}
      {guide && (
        <a className="k-empty__guide" href="/guide.html" target="_blank" rel="noreferrer">
          查看使用指南 →
        </a>
      )}
    </div>
  )
}
