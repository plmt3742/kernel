// KERNEL · 方形勾选框（自绘，选中用 accent）
import { Check } from 'lucide-react'
import { clsx } from 'clsx'

interface CheckboxProps {
  checked: boolean
  onToggle: () => void
  label: string
}

export function Checkbox({ checked, onToggle, label }: CheckboxProps) {
  return (
    <button
      type="button"
      className={clsx('k-check', checked && 'is-done')}
      onClick={onToggle}
      aria-pressed={checked}
      aria-label={label}
    >
      <Check size={12} strokeWidth={2.5} aria-hidden />
    </button>
  )
}
