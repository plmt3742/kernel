// KERNEL · TagPill（1px 描边、零圆角；交互态悬浮/选中反转）
import type { ReactNode } from 'react'
import { clsx } from 'clsx'

interface TagPillProps {
  children: ReactNode
  selected?: boolean
  onClick?: () => void
  title?: string
  accent?: boolean
  ghost?: boolean
}

export function TagPill({ children, selected, onClick, title, accent, ghost }: TagPillProps) {
  const className = clsx(
    'k-pill',
    selected === true && 'is-selected',
    accent === true && 'is-accent',
    ghost === true && 'is-ghost',
  )
  if (onClick !== undefined) {
    return (
      <button type="button" className={className} onClick={onClick} aria-pressed={selected === true} title={title}>
        {children}
      </button>
    )
  }
  return (
    <span className={className} title={title}>
      {children}
    </span>
  )
}
