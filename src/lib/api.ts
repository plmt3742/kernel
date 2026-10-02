// KERNEL · 数据服务 API 客户端（同源 /api；dev 与 preview 均经 Vite 代理到 127.0.0.1:4097）
// 仅本文件允许发起数据写入请求；视图一律经 src/lib/mutations.ts。

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch {
    throw new Error('数据服务不可用（确认 npm run dev 已启动数据服务）')
  }
  const text = await response.text()
  let data: unknown = null
  if (text !== '') {
    try {
      data = JSON.parse(text)
    } catch {
      data = null
    }
  }
  if (!response.ok) {
    // 代理在数据服务未启动时返回 5xx 且非 JSON：给出可操作的提示
    if (response.status >= 500 && data === null) {
      throw new Error('数据服务不可用（确认 npm run dev 已启动数据服务）')
    }
    const message =
      data !== null &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `请求失败（HTTP ${response.status}）`
    throw new Error(message)
  }
  return data as T
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path)
  },
  post<T>(path: string, body?: unknown): Promise<T> {
    return request<T>(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
  },
}

/** 统一错误文案 */
export function errorText(err: unknown): string {
  return err instanceof Error ? err.message : '未知错误'
}
