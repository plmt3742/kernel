// KERNEL · 通知适配器 · 企业微信群机器人 webhook（Phase 1 仅出站）
// 安全边界：
//   - 只允许企业微信官方 HTTPS webhook（qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…）
//     或本机 mock 地址（127.0.0.1 / localhost / ::1，供联调）；
//   - URL 只存本机 secrets.json，绝不回显 / 入日志；
//   - 发送超时 10s，响应非 2xx 或 errcode != 0 视为失败。

const WECOM_HOST = 'qyapi.weixin.qq.com'
const MOCK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])
const SEND_TIMEOUT_MS = 10_000

/**
 * 校验并规格化 webhook URL。
 * @param {string} raw
 * @returns {{ url: string, host: string }} 空串返回 { url:'', host:'' }（清除配置）
 * @throws {Error & { status: number }} 非法 / 非白名单地址 → 400
 */
export function normalizeWebhookUrl(raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (value === '') return { url: '', host: '' }
  let parsed
  try {
    parsed = new URL(value)
  } catch {
    throw Object.assign(new Error('webhook URL 不是合法 URL'), { status: 400 })
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw Object.assign(new Error('webhook 仅支持 http(s)'), { status: 400 })
  }
  if (parsed.username !== '' || parsed.password !== '') {
    throw Object.assign(new Error('webhook URL 不能包含账号密码'), { status: 400 })
  }
  const host = parsed.hostname.toLowerCase()
  if (host === WECOM_HOST) {
    if (parsed.protocol !== 'https:') {
      throw Object.assign(new Error('企业微信 webhook 必须使用 https'), { status: 400 })
    }
    if (!parsed.pathname.startsWith('/cgi-bin/webhook/send')) {
      throw Object.assign(new Error('企业微信 webhook 路径不正确'), { status: 400 })
    }
    if ((parsed.searchParams.get('key') ?? '').trim() === '') {
      throw Object.assign(new Error('企业微信 webhook 缺少 key'), { status: 400 })
    }
  } else if (!MOCK_HOSTS.has(host)) {
    throw Object.assign(new Error('webhook 仅允许企业微信官方地址或本机 mock 地址'), { status: 400 })
  }
  return { url: parsed.toString(), host }
}

/**
 * 发送企业微信文本消息。
 * @param {string} webhookUrl 已校验 / 已保存的 URL
 * @param {string} text 文本内容（调用方负责截断到 2048 字节内）
 * @returns {Promise<void>}
 */
export async function sendWecomText(webhookUrl, text) {
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`webhook HTTP ${response.status}`)
  let data = null
  try {
    data = await response.json()
  } catch {
    /* mock / 非 JSON 响应按 2xx 成功处理 */
  }
  if (data !== null && typeof data.errcode === 'number' && data.errcode !== 0) {
    throw new Error(`webhook errcode ${data.errcode}`)
  }
}

/**
 * Notifier 接口（JSDoc 契约）：后续公众号 / 自建应用适配器实现同一 send。
 * @typedef {{ send: (text: string) => Promise<void> }} Notifier
 */

/**
 * 创建企业微信 webhook 通知器。
 * @param {string} webhookUrl
 * @returns {Notifier}
 */
export function createWecomNotifier(webhookUrl) {
  return {
    send(text) {
      return sendWecomText(webhookUrl, text)
    },
  }
}
