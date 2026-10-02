// KERNEL · 焦点圈闭工具（M5：命令面板 / 抽屉的无障碍焦点管理）
// 纯工具，无副作用；不改动组件结构。

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** 容器内当前可聚焦元素（过滤不可见项） */
export function focusableWithin(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  )
}

/** 处理 Tab 键，将焦点圈闭在容器内（首尾循环） */
export function trapTab(container: HTMLElement, event: KeyboardEvent): void {
  if (event.key !== 'Tab') return
  const items = focusableWithin(container)
  if (items.length === 0) {
    event.preventDefault()
    return
  }
  const first = items[0]
  const last = items[items.length - 1]
  const active = document.activeElement as HTMLElement | null
  if (event.shiftKey) {
    if (active === first || active === null || !container.contains(active)) {
      event.preventDefault()
      last.focus()
    }
  } else if (active === last || active === null || !container.contains(active)) {
    event.preventDefault()
    first.focus()
  }
}
