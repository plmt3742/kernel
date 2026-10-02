// KERNEL · 通用「界面状态」存储（v0.5 · Slice Z，见 ADR-0022）
//
// 目的（owner 反馈）：页面操作（筛选 / 草稿 / 展开 / 选中）在切换路由后清空，
//   「根本没有保留和记忆」。此处把界面状态提升到模块级 store，跨路由切换存活；
//   可选经 localStorage 跨刷新还原——复用 `src/lib/scroll.ts` 的「路由记忆」精神。
//
// 纪律：
//   · 只存**界面状态**（筛选 / 分组 / 草稿 / 展开 / 选中 / 游标），绝不存数据实体；
//   · localStorage 读取 / 解析 / 配额写入失败一律静默回退（绝不阻断界面）；
//   · `persist: false` = 仅模块级（跨路由存活、刷新即重置），用于体量较大或不宜持久的状态。
import { useSyncExternalStore } from 'react'

export interface UiStore<T> {
  get: () => T
  set: (next: T | ((prev: T) => T)) => void
  subscribe: (listener: () => void) => () => void
}

export interface UiStoreOptions<T> {
  /** 从 localStorage 读到的原始值 → 合法状态；返回 null 表示丢弃（回退初始值） */
  parse?: (raw: unknown) => T | null
  /** 持久化前的裁剪（如只留最近 N 条）；默认原样 */
  prune?: (value: T) => T
  /** 是否写 localStorage（默认 true）；false = 仅模块级 */
  persist?: boolean
}

/**
 * 创建一个模块级界面状态 store：
 * - 模块求值时（若 `persist`）尝试从 localStorage 还原一次；
 * - 每次 `set` 变更引用并广播订阅者 + 写回 localStorage；
 * - `set` 接受值或 `(prev) => next` 更新器；返回同一引用时跳过广播。
 */
export function createUiStore<T>(
  key: string,
  initial: T,
  options: UiStoreOptions<T> = {},
): UiStore<T> {
  const { parse, prune, persist = true } = options
  let state: T = initial

  if (persist) {
    try {
      const raw = window.localStorage.getItem(key)
      if (raw !== null) {
        const parsed = parse !== undefined ? parse(JSON.parse(raw)) : (JSON.parse(raw) as T)
        if (parsed !== null) state = parsed
      }
    } catch {
      /* 静默：localStorage 不可访问 / JSON 解析失败 → 使用初始值 */
    }
  }

  const listeners = new Set<() => void>()

  function write(value: T): void {
    if (!persist) return
    try {
      window.localStorage.setItem(key, JSON.stringify(prune !== undefined ? prune(value) : value))
    } catch {
      /* 静默：配额超限 / 序列化失败不阻断界面 */
    }
  }

  return {
    get: () => state,
    set: (next) => {
      const value = typeof next === 'function' ? (next as (prev: T) => T)(state) : next
      if (Object.is(value, state)) return
      state = value
      write(state)
      for (const listener of [...listeners]) listener()
    },
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

/** React 绑定（`useSyncExternalStore`；服务端快照同 `get`，本应用为纯 CSR） */
export function useUiStore<T>(store: UiStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get)
}

/** 安全取对象字段为字符串（parse 助手，避免 `as` 泛滥） */
export function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

/** 安全取对象字段为布尔 */
export function bool(value: unknown): boolean {
  return value === true
}

/** 从候选集合中挑出成员（parse 助手：用于枚举字段） */
export function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  fallback: T,
): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback
}

/** 从候选集合中挑出成员或空串（parse 助手：可清空的枚举筛选） */
export function oneOfOrEmpty<T extends string>(value: unknown, allowed: readonly T[]): T | '' {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : ''
}
