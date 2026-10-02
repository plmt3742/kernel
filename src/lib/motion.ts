// KERNEL · Motion 常量（与 tokens.css 的 --dur-* / --ease-* 一一对应；Motion 以秒为单位）
// 距离分级见 tokens.css §5.5：instant 0.08 / micro 0.12 / fast 0.18 / base 0.24 / slow 0.4 / page 0.56
export const EASE_ENTER: [number, number, number, number] = [0.16, 1, 0.3, 1]
export const EASE_STANDARD: [number, number, number, number] = [0.22, 0.61, 0.36, 1] // = --ease-standard
export const EASE_EXIT: [number, number, number, number] = [0.4, 0, 1, 1]

export const DUR = {
  instant: 0.08,
  micro: 0.12,
  fast: 0.18,
  base: 0.24,
  slow: 0.4,
  page: 0.56,
} as const

/** 列表 stagger 步进公式：delay(i) = min(i, STAGGER_MAX) × STAGGER（宪法 §5.5：60ms 步进、封顶 12 项） */
export const STAGGER = 0.06
/** 入场 stagger 的最大应用条数，避免长列表延迟 */
export const STAGGER_MAX = 12
