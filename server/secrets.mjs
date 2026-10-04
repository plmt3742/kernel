// KERNEL · 数据服务 · 本机凭据（secrets）读取 / 写入
// 纪律（v0.5 · Slice N5）：
//   - 凭据只存本机 data/meta/secrets.json（已在 .gitignore，绝不入库；
//     config.json 是 git 跟踪文件，绝不能把密钥放进去）；
//   - 文件缺失 / 解析失败 / 形状非法 → 一律视为「无凭据」（静默 {}），绝不抛出；
//   - 本模块无副作用：不写审计、不打日志、绝不输出凭据明文；
//     （写入后的 ai.key.update 审计由调用方 server/index.mjs 负责）；
//   - 可被数据服务与启动器 scripts/dev.mjs 相对导入（路径基于本文件定位，与 cwd 无关）。
import { promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import writeFileAtomic from 'write-file-atomic'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 凭据目录：data/meta（与 config.json / term.json 同级，但本文件不入库） */
const SECRETS_DIR = path.join(ROOT, 'data', 'meta')
const SECRETS_FILE = path.join(SECRETS_DIR, 'secrets.json')

/** 凭据文件绝对路径：data/meta/secrets.json */
export function secretsPath() {
  return SECRETS_FILE
}

/**
 * 读取凭据对象（同步）。
 * 文件缺失 / 非法 JSON / 非对象（数组、标量）→ 返回 {}，绝不抛。
 * @returns {Record<string, unknown>}
 */
export function readSecrets() {
  try {
    const parsed = JSON.parse(readFileSync(SECRETS_FILE, 'utf8'))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch {
    return {}
  }
}

/**
 * 合并写入凭据（原子写；目录不存在则递归创建）。
 * @param {Record<string, unknown>} patch 合并到现有凭据上的键值（浅合并）
 * @returns {Promise<Record<string, unknown>>} 写入后的完整凭据对象
 */
export async function writeSecrets(patch) {
  const next = { ...readSecrets(), ...(patch ?? {}) }
  await fs.mkdir(SECRETS_DIR, { recursive: true })
  await writeFileAtomic(SECRETS_FILE, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8' })
  return next
}

/**
 * 读取 DeepSeek API Key（同步；无 / 形状非法 → ''）。
 * @returns {string}
 */
export function getDeepseekKey() {
  const value = readSecrets().deepseekApiKey
  return typeof value === 'string' ? value : ''
}

/**
 * 写入 / 清除 DeepSeek API Key。
 * trim 后为空 → 删除该键（文件不存在或无该键时不产生空文件）；非空 → 保存。
 * @param {string} key 原始 key（内部 trim）
 * @returns {Promise<Record<string, unknown>>} 写入后的完整凭据对象
 */
export async function setDeepseekKey(key) {
  const value = typeof key === 'string' ? key.trim() : ''
  const current = readSecrets()
  if (value === '') {
    if (!Object.prototype.hasOwnProperty.call(current, 'deepseekApiKey')) return current
    delete current.deepseekApiKey
  } else {
    current.deepseekApiKey = value
  }
  await fs.mkdir(SECRETS_DIR, { recursive: true })
  await writeFileAtomic(SECRETS_FILE, `${JSON.stringify(current, null, 2)}\n`, { encoding: 'utf8' })
  return current
}
