// KERNEL · Panel（统一区块头：安静小标签 + 标题；可选右侧动作槽）
import type { ReactNode } from 'react'

interface PanelProps {
  /** 保留占位：v0.3 版式重排后不再渲染编号，避免数字噪音 */
  index?: string
  en?: string
  title?: string
  actions?: ReactNode
  children: ReactNode
  className?: string
}

export function Panel({ en, title, actions, children, className }: PanelProps) {
  const hasHead = en !== undefined || title !== undefined || actions !== undefined
  return (
    <section className={className !== undefined ? `k-panel ${className}` : 'k-panel'}>
      {hasHead && (
        <header className="k-panel__head">
          {title !== undefined && <h2 className="k-panel__cn">{title}</h2>}
          {en !== undefined && <span className="k-panel__en u-label">{en}</span>}
          {actions !== undefined && <div className="k-panel__actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}
