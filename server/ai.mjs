// KERNEL · AI 代理（经本地 opencode 服务；仅数据服务在服务端调用）
// 纪律：AI 只经 127.0.0.1:4096 的 opencode serve 接入，不外泄、不越权；
//       AI 只产出「建议」，落盘仍由 server/index.mjs 经 commit() 唯一路径完成。
// 依据：.qa/v13/probe4/5 实证——variant:'low' 下 deepseek-flash 约 4~5s 返回干净 JSON；
//       format:json_schema 在 thinking 模式报 tool_choice 错误，故采用「指令式 JSON + Zod + 一次重试」。
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { aiSuggestionSchema, reviewDraftSchema, taskDraftSchema } from './schemas.mjs'
import { DATA_DIR, normalizeTagList, readActivity, readSnapshot } from './store.mjs'

const OPENCODE_URL = process.env.KERNEL_OPENCODE_URL ?? 'http://127.0.0.1:4096'
const SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? ''
const HEALTH_TIMEOUT_MS = 3_000
const PROMPT_TIMEOUT_MS = 120_000
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** SDK 返回解包：{ data, error } → data（与探针 pick() 一致） */
const pick = (r) => (r && typeof r === 'object' && 'data' in r ? r.data : r)

let client = null

/** 惰性单例 opencode 客户端（可选 Basic 认证） */
function getClient() {
  if (client === null) {
    const headers =
      SERVER_PASSWORD !== ''
        ? { Authorization: `Basic ${Buffer.from(`opencode:${SERVER_PASSWORD}`).toString('base64')}` }
        : undefined
    client = createOpencodeClient({ baseUrl: OPENCODE_URL, headers })
  }
  return client
}

/** 带超时的 Promise 包装（超时后吞掉原 Promise 的迟到拒绝，避免未处理拒绝） */
function withTimeout(promise, ms, timeoutMessage) {
  promise.catch(() => {})
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/* ---------------------------------------------------------------------------
 * 健康检查
 * ------------------------------------------------------------------------- */

/**
 * 探测 opencode 是否可用（约 3s 超时；不可达不抛错，返回 available:false）
 * @returns {Promise<{ available: boolean, model: string | null, url: string }>}
 */
export async function getAiHealth() {
  try {
    const cfg = pick(await withTimeout(getClient().config.get(), HEALTH_TIMEOUT_MS, '健康检查超时'))
    return { available: true, model: cfg?.model ?? null, url: OPENCODE_URL }
  } catch {
    return { available: false, model: null, url: OPENCODE_URL }
  }
}

/* ---------------------------------------------------------------------------
 * 收件箱解析
 * ------------------------------------------------------------------------- */

/** 安全读快照：数据缺失时降级为空摘要（不阻断解析） */
async function loadSnapshot() {
  try {
    return await readSnapshot()
  } catch {
    return { projects: [], areas: [], tasks: [], tags: [] }
  }
}

/** 打开的（未完成）任务状态 */
const OPEN_TASK_STATUS = new Set(['next', 'waiting', 'scheduled', 'someday'])

/**
 * 构造系统现状摘要（紧凑中文；项目 / 区域 / 标签 / 近期未完成任务）
 * 供模型做关联判断（projectId / areaId / tags / duplicateOf）；
 * 控制在 ~4KB 内：任务按 updatedAt 倒序，超预算即截断。
 */
function buildDigest(snapshot) {
  const projects = (snapshot.projects ?? []).map(
    (p) => `${p.id} · ${p.title} · [${(p.tags ?? []).join(',')}]`,
  )
  const areas = (snapshot.areas ?? []).map((a) => `${a.id} · ${a.title}`)

  const tagGroups = new Map()
  for (const tag of snapshot.tags ?? []) {
    const ns = tag.namespace ?? 'other'
    if (!tagGroups.has(ns)) tagGroups.set(ns, [])
    tagGroups.get(ns).push(tag.name)
  }
  const tagLines = [...tagGroups.entries()].map(([ns, names]) => `${ns}: ${names.join(',')}`)

  const tasks = [...(snapshot.tasks ?? [])]
    .filter((t) => OPEN_TASK_STATUS.has(t.status))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
    .slice(0, 50)
    .map((t) => `${t.id} · ${t.title} · ${t.status}`)

  let out = `【项目】\n${projects.join('\n') || '（无）'}\n【区域】\n${areas.join('\n') || '（无）'}\n【标签】\n${tagLines.join('\n') || '（无）'}\n【未完成任务（updatedAt 倒序，最多 50）】\n`
  for (const line of tasks) {
    if (Buffer.byteLength(`${out}${line}\n`, 'utf8') > 3800) break
    out += `${line}\n`
  }
  return out.trim()
}

/** 可提取文本摘录的扩展名白名单（文件投递 · Slice D） */
const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.log', '.yml', '.yaml', '.toml', '.ini',
  '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.html', '.xml', '.sql', '.sh', '.bat', '.ps1',
])
/** 可抽取文本的 Office Open XML 扩展名（Slice J：docx / pptx / xlsx 二进制 docx 即 ZIP） */
const OOXML_EXTS = new Set(['.docx', '.pptx', '.xlsx'])
/** 摘录上限：≤5MB 且扩展名/mime 判定为文本时，读前 8000 字（else 仅给元数据） */
const FILE_EXCERPT_MAX_BYTES = 5 * 1024 * 1024
const FILE_EXCERPT_CHARS = 8000
const FILE_UNREADABLE_HINT = '——无法直接读取内容，请依据文件名与上下文判断'

/* ---------------------------------------------------------------------------
 * Office Open XML 文本抽取（Slice J）：无新依赖
 * - 最小 ZIP 读取器：解析 EOCD + 中央目录；method 8 → inflateRawSync，method 0 → 原文。
 * - .docx → word/document.xml；.pptx → ppt/slides/slideN.xml（数字排序）；
 *   .xlsx → xl/sharedStrings.xml。剥标签 + 解实体 + 归一空白。
 * - 任何异常 → 上层回退 FILE_UNREADABLE_HINT（5MB 上限沿用）。
 * ------------------------------------------------------------------------- */
const ZIP_EOCD_SIG = 0x06054b50
const ZIP_CD_SIG = 0x02014b50
const ZIP_LF_SIG = 0x04034b50

/** 解析 ZIP 中央目录，返回 name → { method, compSize, localOffset } */
function readZipEntries(buf) {
  let eocd = -1
  const minEocd = Math.max(0, buf.length - (22 + 0xffff))
  for (let i = buf.length - 22; i >= minEocd; i -= 1) {
    if (buf.readUInt32LE(i) === ZIP_EOCD_SIG) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('ZIP: 未找到中央目录结尾')
  const count = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== ZIP_CD_SIG) {
      throw new Error('ZIP: 中央目录项损坏')
    }
    const method = buf.readUInt16LE(offset + 10)
    const compSize = buf.readUInt32LE(offset + 20)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    if (compSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new Error('ZIP: 不支持 ZIP64')
    }
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)
    entries.set(name, { method, compSize, localOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

/** 读取单个 ZIP 条目并解压（method 0 原文 / method 8 raw deflate） */
function readZipEntry(buf, entry) {
  const lo = entry.localOffset
  if (lo + 30 > buf.length || buf.readUInt32LE(lo) !== ZIP_LF_SIG) {
    throw new Error('ZIP: 本地头损坏')
  }
  const nameLen = buf.readUInt16LE(lo + 26)
  const extraLen = buf.readUInt16LE(lo + 28)
  const start = lo + 30 + nameLen + extraLen
  const data = buf.subarray(start, start + entry.compSize)
  if (entry.method === 0) return data
  if (entry.method === 8) {
    return zlib.inflateRawSync(data, { maxOutputLength: FILE_EXCERPT_MAX_BYTES * 8 })
  }
  throw new Error(`ZIP: 不支持的压缩方法 ${entry.method}`)
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** 解 XML 实体（命名 + 十进制 / 十六进制数字引用） */
function decodeXmlEntities(text) {
  return text.replace(/&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === '#') {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? Number.parseInt(body.slice(2), 16)
          : Number.parseInt(body.slice(1), 10)
      try {
        return String.fromCodePoint(code)
      } catch {
        return match
      }
    }
    return Object.prototype.hasOwnProperty.call(XML_ENTITIES, body) ? XML_ENTITIES[body] : match
  })
}

/** XML → 纯文本：段落 / 换行 / 制表转为可读分隔，剥标签，解实体，归一空白 */
function xmlToText(xml) {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<\/a:p>/g, '\n')
    .replace(/<\/si>/g, '\n')
  const stripped = withBreaks.replace(/<[^>]*>/g, '')
  return decodeXmlEntities(stripped)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[\t\u00a0 ]+/g, ' ').trim())
    .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 抽取 OOXML 文本（供 buildFileSection 与冒烟测试复用）。
 * @param {string} ext 小写扩展名（.docx / .pptx / .xlsx）
 * @param {Buffer} buf 文件二进制
 * @returns {string} 归一化纯文本；失败抛出
 */
export function extractOfficeText(ext, buf) {
  const entries = readZipEntries(buf)
  if (ext === '.docx') {
    const entry = entries.get('word/document.xml')
    if (entry === undefined) throw new Error('docx: 缺少 word/document.xml')
    return xmlToText(readZipEntry(buf, entry).toString('utf8'))
  }
  if (ext === '.pptx') {
    const slides = [...entries.keys()]
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort((a, b) => {
        const na = Number.parseInt(a.replace(/\D+/g, ''), 10)
        const nb = Number.parseInt(b.replace(/\D+/g, ''), 10)
        return na - nb
      })
    if (slides.length === 0) throw new Error('pptx: 未找到幻灯片')
    return slides
      .map((name) => xmlToText(readZipEntry(buf, entries.get(name)).toString('utf8')))
      .filter((text) => text !== '')
      .join('\n\n')
  }
  if (ext === '.xlsx') {
    const entry = entries.get('xl/sharedStrings.xml')
    if (entry === undefined) throw new Error('xlsx: 缺少共享字符串表')
    return xmlToText(readZipEntry(buf, entry).toString('utf8'))
  }
  throw new Error(`不支持的 OOXML 扩展名 ${ext}`)
}

/**
 * 构造附件段落（供收件箱解析的同步 / 流式两条路径复用）。
 * 无附件返回 ''；文本类且 ≤5MB 时附前 8000 字摘录；否则仅给元数据。
 * @param {{ id: string, file?: { name: string, size: number, mime?: string } }} item
 * @returns {Promise<string>}
 */
export async function buildFileSection(item) {
  const file = item?.file
  if (file === undefined || file === null) return ''
  const mime = file.mime ?? '未知类型'
  const meta = `${file.name}（${mime}｜${file.size} 字节）`
  const ext = path.extname(file.name).toLowerCase()
  const isText =
    TEXT_EXTS.has(ext) || (typeof file.mime === 'string' && file.mime.startsWith('text/'))
  const isOffice = OOXML_EXTS.has(ext)
  if ((!isText && !isOffice) || file.size > FILE_EXCERPT_MAX_BYTES) {
    return `【附件】${meta}${FILE_UNREADABLE_HINT}`
  }
  const filePath = path.join(DATA_DIR, 'files', `${item.id}-${file.name}`)
  try {
    if (isOffice) {
      const buf = await fs.readFile(filePath)
      const extracted = extractOfficeText(ext, buf)
      if (extracted === '') return `【附件】${meta}${FILE_UNREADABLE_HINT}`
      return `【附件】${meta}\n内容摘录（前 ${FILE_EXCERPT_CHARS} 字）：\n${extracted.slice(0, FILE_EXCERPT_CHARS)}`
    }
    const raw = await fs.readFile(filePath, 'utf8')
    return `【附件】${meta}\n内容摘录（前 ${FILE_EXCERPT_CHARS} 字）：\n${raw.slice(0, FILE_EXCERPT_CHARS)}`
  } catch {
    return `【附件】${meta}${FILE_UNREADABLE_HINT}`
  }
}

/** 构造系统提示词（注入当前本地时间 + 系统现状摘要 + 关联建议字段规则） */
function buildSystem(digest) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `你是 KERNEL 个人事务系统的收件箱解析器。把用户的收件箱内容解析为结构化 JSON。
只输出一个 JSON 对象：不要 markdown 代码块、不要解释、不要多余文字。字段：
- target: "task" | "note" | "resource" | "discard"
- title: 提炼后的标题（不超过 40 字）
- contexts: 字符串数组，只能从 ["@lab","@computer","@campus","@phone","@org-room"] 中选
- energy: "low" | "medium" | "high"
- importance: 1 | 2 | 3（整数）
- estimateMin: 预计所需分钟数（整数，最少 1 分钟）
- dueAt: ISO8601 带时区或 null。现在是 ${stamp}
- projectId: 字符串或 null。仅当内容有明确依据属于下方某个项目时，填该项目 id；否则 null
- areaId: 字符串或 null。仅当内容明确属于下方某个区域时，填该区域 id；否则 null
- tags: 字符串数组。优先从下方【标签】中选已有标签名；仅当没有合适的已有标签、且该标签对日后检索明确有用时，才提出新标签名（必须写成 "topic:名称" 形式，名称 ≤12 字）；最多 3 个，去重；无把握则空数组
- duplicateOf: 字符串或 null。仅当与下方某个未完成任务高度可能重复时，填该任务 id；否则 null
- newProjectHint: 字符串或 null（不超过 40 字）。当内容像一件需要多步推进的新事务（如一个新比赛 / 新活动 / 新项目）且不属于任何现有项目时，给出建议项目名（例：「辩论赛筹备」）；否则 null
- reason: 一句话说明判断理由

【系统现状摘要】
${digest}

规则：
1. 挂靠宁缺毋滥：projectId / areaId / duplicateOf 只能取摘要中列出的 id，且必须有明确依据；表面相似（例如都含「竞赛 / 比赛 / 规则」字样）不算依据；拿不准一律填 null。tags 优先取摘要中已有的标签名；仅当确实没有合适已有标签、且新标签是稳定的主题词（学科 / 领域，如「线性代数」「合唱排练」）时才提出新标签，写成 "topic:名称"（≤12 字）；禁止把日期、人名、整句话或临时描述当标签。
2. 附件不可读时更保守：当【附件】无法直接读取（只有文件名 / 元数据）时，除非文件名直接指向某现有项目（名称 / 主题强匹配），否则 projectId 一律 null，并在 reason 中注明「仅基于文件名判断」。
3. newProjectHint 与 projectId 互斥：要么挂现有项目（填 projectId、newProjectHint 为 null），要么提示新建（填 newProjectHint、projectId 为 null），要么都不填；绝不能既挂现有项目又提示新建。
4. 若条目带【附件】，基于附件内容与文件名判断 target 与 title（读取失败则只凭文件名推断）。`
}

/** 从模型响应中抽取纯文本（多段拼接） */
function extractText(res) {
  return (res?.parts ?? [])
    .filter((part) => part?.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
}

/** zod 错误 → 可读中文原因 */
function describeError(err) {
  if (err !== null && typeof err === 'object' && Array.isArray(err.issues)) {
    const first = err.issues[0]
    const where = Array.isArray(first.path) && first.path.length > 0 ? `${first.path.join('.')}：` : ''
    return `${where}${first.message}`
  }
  return err?.message ?? String(err)
}

/** 丢弃模型显式给出的 null 关联字段（dueAt / projectId / areaId / duplicateOf / newProjectHint），保持输出干净 */
function normalizeSuggestion(suggestion) {
  const out = { ...suggestion }
  if (out.dueAt === null || out.dueAt === undefined) delete out.dueAt
  for (const key of ['projectId', 'areaId', 'duplicateOf', 'newProjectHint']) {
    if (out[key] === null) delete out[key]
  }
  return out
}

/** AI 新标签后缀硬上限（汉字 / 字符数）；超出即视为不可用提议而丢弃 */
const AI_TAG_MAX_CHARS = 12

/** 取标签名的可读后缀长度（@lab → lab；topic:线性代数 → 线性代数） */
function tagSuffixLength(name) {
  const colon = name.indexOf(':')
  if (colon >= 0) return name.slice(colon + 1).length
  return name.startsWith('@') ? name.length - 1 : name.length
}

/**
 * AI 标签建议清洗（Slice T）：规格化（裸名 → topic: 前缀）+ 去重 + 最多 3 个。
 * 已有注册标签名原样保留（不受长度上限影响）；新提议须 ≤ AI_TAG_MAX_CHARS 字。
 * **不再**过滤掉注册表外的标签名——新标签在应用 / 创建落盘时由服务端登记。
 */
function cleanTagSuggestions(rawTags, tagNames) {
  const out = []
  for (const name of normalizeTagList(rawTags)) {
    if (tagNames.has(name)) out.push(name)
    else if (tagSuffixLength(name) <= AI_TAG_MAX_CHARS) out.push(name)
    if (out.length >= 3) break
  }
  return out.slice(0, 3)
}

/**
 * 关联字段按快照后校验：臆造 id 一律丢弃（模型可能编造）；标签改为规格化保留（Slice T）。
 * projectId 必须在 projects；areaId 必须在 areas；duplicateOf 必须在 tasks；
 * tags 优先已有注册名，允许 ≤3 个新主题标签（应用时自动登记，origin:'ai'）。
 * newProjectHint（Slice E2.5）：trim + 截断 40 字 + 丢弃空串；与 projectId 互斥；
 * 与现有项目标题完全相同者丢弃（那是在重复已有项目）。
 * 导出供单测（验证新标签不再被剥离）。
 */
export function postValidate(suggestion, snapshot) {
  const out = { ...suggestion }
  const projects = snapshot.projects ?? []
  const projectIds = new Set(projects.map((p) => p.id))
  const areaIds = new Set((snapshot.areas ?? []).map((a) => a.id))
  const taskIds = new Set((snapshot.tasks ?? []).map((t) => t.id))
  const tagNames = new Set((snapshot.tags ?? []).map((t) => t.name))
  if (out.projectId !== undefined && !projectIds.has(out.projectId)) delete out.projectId
  if (out.areaId !== undefined && !areaIds.has(out.areaId)) delete out.areaId
  if (out.duplicateOf !== undefined && !taskIds.has(out.duplicateOf)) delete out.duplicateOf
  if (Array.isArray(out.tags)) out.tags = cleanTagSuggestions(out.tags, tagNames)

  if (typeof out.newProjectHint === 'string') {
    const hint = Array.from(out.newProjectHint.trim()).slice(0, 40).join('')
    if (hint === '') delete out.newProjectHint
    else out.newProjectHint = hint
  }
  if (out.newProjectHint !== undefined) {
    const projectTitles = new Set(projects.map((p) => p.title))
    // 互斥：已挂现有项目 → 丢弃提示；提示恰为现有项目标题 → 丢弃提示
    if (out.projectId !== undefined || projectTitles.has(out.newProjectHint)) {
      delete out.newProjectHint
    }
  }
  return out
}

/** 解析 + 校验单次响应；返回 { ok, suggestion } 或 { ok:false, reason } */
function tryParseSuggestion(res) {
  const cleaned = extractText(res)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, reason: `JSON 解析失败（${err.message}）` }
  }
  try {
    return { ok: true, suggestion: normalizeSuggestion(aiSuggestionSchema.parse(obj)) }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/** 单次带超时的 prompt 调用（结果解包；默认模型由 serve 决定，不传 model/format） */
function promptOnce(sessionID, system, text) {
  return withTimeout(
    getClient().session.prompt({
      sessionID,
      system,
      variant: 'low',
      parts: [{ type: 'text', text }],
    }),
    PROMPT_TIMEOUT_MS,
    'AI 响应超时',
  ).then(pick)
}

/** 创建解析会话并返回 sessionID（title 仅用于 opencode 会话列表展示） */
async function createSession(title = 'kernel:inbox-parse') {
  const created = pick(await getClient().session.create({ title }))
  const sessionID = created?.id
  if (typeof sessionID !== 'string' || sessionID === '') {
    throw new Error('无法创建 opencode 会话')
  }
  return sessionID
}

/** 从响应信息中取模型标识 */
function modelOf(res) {
  const info = res?.info
  return info?.providerID !== undefined && info?.modelID !== undefined
    ? `${info.providerID}/${info.modelID}`
    : null
}

/**
 * 单会话内「prompt → 解析 → 一次重试」；失败抛错。
 * emit 存在时在重试前发出 { kind:'retry', reason }（流式路径用）。
 */
async function promptWithRetry(sessionID, system, userText, emit) {
  let res = await promptOnce(sessionID, system, userText)
  let parsed = tryParseSuggestion(res)
  if (!parsed.ok) {
    if (emit) emit({ kind: 'retry', reason: parsed.reason })
    console.warn(`[ai] inbox.parse 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象，不要任何多余文字。`,
    )
    parsed = tryParseSuggestion(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, suggestion: parsed.suggestion }
}

/**
 * 解析收件箱条目为 AI 建议（同步；保持既有契约不变）
 * @param {{ id: string, content: string }} item
 * @returns {Promise<{ suggestion: object, model: string | null, ms: number }>}
 */
export async function parseInboxItem(item) {
  const t0 = Date.now()
  const snapshot = await loadSnapshot()
  const system = buildSystem(buildDigest(snapshot))
  const sessionID = await createSession()
  const fileSection = await buildFileSection(item)
  const userText = fileSection === '' ? item.content : `${item.content}\n\n${fileSection}`
  const { res, suggestion } = await promptWithRetry(sessionID, system, userText, null)
  const clean = postValidate(suggestion, snapshot)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(`[ai] inbox.parse ${item.id} 完成 ${ms}ms（${model ?? '未知模型'}）`)
  return { suggestion: clean, model, ms }
}

/**
 * 流式解析收件箱条目：先订阅事件流，边解析边 emit 过程事件。
 * @param {{ id: string, content: string }} item
 * @param {(event: object) => void} emit
 *   事件：{kind:'status',status} | {kind:'delta',field,delta} |
 *         {kind:'retry',reason} | {kind:'suggestion',suggestion,model,ms} | {kind:'error',message}
 * 说明：失败只 emit error，不抛出（SSE 路由由事件收尾）。
 */
export async function parseInboxItemStream(item, emit) {
  const t0 = Date.now()

  // 必须先订阅（避免漏掉会话创建后的早期事件）
  let stream = null
  try {
    const sub = await getClient().event.subscribe()
    stream = sub?.stream ?? null
  } catch (err) {
    console.warn(`[ai] event.subscribe 失败：${err?.message ?? err}`)
    stream = null
  }

  let closed = false
  let sessionID = null
  const safeEmit = (event) => {
    if (closed) return
    try {
      emit(event)
    } catch {
      /* 客户端已断开：忽略 */
    }
  }

  let pump = null
  if (stream !== null && typeof stream[Symbol.asyncIterator] === 'function') {
    pump = (async () => {
      try {
        for await (const ev of stream) {
          if (closed) break
          if (sessionID === null) continue
          const props = ev?.properties
          if (props?.sessionID !== sessionID) continue
          if (ev.type === 'session.status') {
            safeEmit({ kind: 'status', status: props.status?.type })
          } else if (ev.type === 'message.part.delta') {
            safeEmit({ kind: 'delta', field: props.field, delta: props.delta })
          }
        }
      } catch {
        /* 事件流异常不影响主解析路径（prompt 自身会报错） */
      }
    })()
  }

  try {
    const snapshot = await loadSnapshot()
    const system = buildSystem(buildDigest(snapshot))
    sessionID = await createSession()
    const fileSection = await buildFileSection(item)
    const userText = fileSection === '' ? item.content : `${item.content}\n\n${fileSection}`
    const { res, suggestion } = await promptWithRetry(sessionID, system, userText, safeEmit)
    const clean = postValidate(suggestion, snapshot)
    const model = modelOf(res)
    const ms = Date.now() - t0
    safeEmit({ kind: 'suggestion', suggestion: clean, model, ms })
    console.log(`[ai] inbox.parse-stream ${item.id} 完成 ${ms}ms（${model ?? '未知模型'}）`)
  } catch (err) {
    console.error(`[ai] inbox.parse-stream ${item.id} 失败：`, err?.message ?? err)
    safeEmit({ kind: 'error', message: err?.message ?? 'AI 调用失败' })
  } finally {
    closed = true
    try {
      await stream?.return?.()
    } catch {
      /* 忽略关闭错误 */
    }
    if (pump !== null) await pump.catch(() => {})
  }
}

/* ---------------------------------------------------------------------------
 * AI 对话（v0.5 · Slice G）：读系统现状回答用户问题
 * 纪律：无状态——客户端每次携带有界历史；服务端拼装「现状摘要」注入系统提示。
 *       自然语言输出（不解析 JSON）；120s 超时 + 单次重试；失败抛错（路由转 502）。
 * ------------------------------------------------------------------------- */

/** 对话历史硬上限：最近 20 条 / 单条 4000 字 / 合计 16000 字（服务端边界由路由裁剪） */
export const CHAT_MAX_MESSAGES = 20
export const CHAT_MAX_CHARS = 4000
export const CHAT_TOTAL_CHARS = 16000

/** 当前时刻（本机时区，中文可读；对话摘要用） */
function nowStamp() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 构造「问答用」现状摘要：突出「今天最紧急」所需事实。
 * 含：现在时刻 / 逾期任务 / 今日到期 / 未来 7 天日程 / 收件箱积压 / 进行中项目 / 高优先下一步。
 * 仅取事实，禁止模型据此编造；摘要外的信息模型须如实回答「数据里没有」。
 */
export function buildChatDigest(snapshot, now = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  const today = dayKey(now)
  const dueMs = (t) => (typeof t.dueAt === 'string' ? new Date(t.dueAt).getTime() : null)
  const openTasks = (snapshot.tasks ?? []).filter((t) => OPEN_TASK_STATUS.has(t.status))

  const overdue = openTasks
    .filter((t) => {
      const m = dueMs(t)
      return m !== null && Number.isFinite(m) && m < now.getTime()
    })
    .map((t) => {
      const days = Math.max(0, calendarDayDiff(now, new Date(t.dueAt)))
      return `${t.id} · ${t.title} · 逾期 ${days} 天 · 重要性 ${t.importance}/3`
    })

  const dueToday = openTasks
    .filter((t) => {
      const m = dueMs(t)
      return m !== null && Number.isFinite(m) && dayKey(new Date(m)) === today
    })
    .map((t) => `${t.id} · ${t.title} · 重要性 ${t.importance}/3`)

  const horizon = new Date(now)
  horizon.setDate(horizon.getDate() + 7)
  const events = [...(snapshot.events ?? [])]
    .filter((e) => e.status !== 'cancelled' && typeof e.startAt === 'string')
    .filter((e) => {
      const t = new Date(e.startAt).getTime()
      return Number.isFinite(t) && t >= now.getTime() && t <= horizon.getTime()
    })
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 12)
    .map((e) => {
      const d = new Date(e.startAt)
      const stamp = `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`
      return `${stamp} · ${e.title}${e.location ? ` · ${e.location}` : ''}`
    })

  const inbox = (snapshot.inbox ?? []).filter((i) => i.status === 'unprocessed')
  const inboxLines = inbox.slice(0, 20).map((i) => `${i.id} · ${i.content}`)

  const projects = (snapshot.projects ?? []).filter((p) => p.status === 'active')
  const projectLines = projects.map((p) => `${p.id} · ${p.title} · 完成定义：${p.outcome}`)

  const nextActions = openTasks
    .slice()
    .sort((a, b) => (b.importance ?? 0) - (a.importance ?? 0))
    .slice(0, 12)
    .map(
      (t) =>
        `${t.id} · ${t.title} · ${t.status} · 重要性 ${t.importance}/3${typeof t.dueAt === 'string' ? ` · 截止 ${t.dueAt}` : ''}`,
    )

  return [
    `【现在】${nowStamp()}`,
    `【逾期任务（${overdue.length}）】\n${overdue.join('\n') || '（无）'}`,
    `【今日到期（${dueToday.length}）】\n${dueToday.join('\n') || '（无）'}`,
    `【未来 7 天日程（${events.length}）】\n${events.join('\n') || '（无）'}`,
    `【收件箱积压（${inbox.length} 条未澄清）】\n${inboxLines.join('\n') || '（无）'}`,
    `【进行中项目（${projects.length}）】\n${projectLines.join('\n') || '（无）'}`,
    `【未完成下一步（按重要性，最多 12）】\n${nextActions.join('\n') || '（无）'}`,
  ].join('\n\n')
}

/** 构造对话系统提示词（自然语言；要求只依据摘要事实，优先回答「最紧急」） */
function buildChatSystem(digest) {
  return `你是 KERNEL（个人事务内核）的对话助手。用户会用中文问你关于他自己的事（例如「我今天有什么特别紧急需要去做的事情」「这周有什么安排」「项目进展如何」）。
回答要求：
- 只依据下方【系统现状摘要】中的事实回答；摘要里没有的信息，直接说「数据里没有」，绝不编造任务 / 日程 / 项目 / 时间。
- 简洁、直接、可执行；用中文；不要输出 JSON，不要用 markdown 代码块。
- 当被问「最紧急」时，按「逾期 → 今日到期 → 即将开始的日程」排序给出判断与理由。
- 当对话记录里含有「用户：」「KERNEL：」标记时，只回答最后一条「用户：」的内容。

【系统现状摘要】
${digest}`
}

/** 单次对话 prompt：调用 + 抽取纯文本；空响应视为失败（供重试判定） */
async function promptChatOnce(sessionID, system, text) {
  const res = await promptOnce(sessionID, system, text)
  const reply = extractText(res).trim()
  if (reply === '') throw new Error('AI 未返回内容')
  return { res, reply }
}

/**
 * 与 KERNEL 对话：读当前数据快照构造摘要，注入有界对话历史，返回自然语言回答。
 * @param {Array<{ role: 'user'|'assistant', content: string }>} messages 已由路由裁剪的有界历史（末条为用户）
 * @returns {Promise<{ reply: string, model: string | null, ms: number }>}
 */
export async function chatWithKernel(messages) {
  const t0 = Date.now()
  const snapshot = await loadSnapshot()
  const system = buildChatSystem(buildChatDigest(snapshot))
  const created = pick(await getClient().session.create({ title: 'kernel:chat' }))
  const sessionID = created?.id
  if (typeof sessionID !== 'string' || sessionID === '') {
    throw new Error('无法创建 opencode 会话')
  }
  const transcript = messages
    .map((m) => `${m.role === 'assistant' ? 'KERNEL' : '用户'}：${m.content}`)
    .join('\n\n')
  const userText = `${transcript}\n\n请只回答最后一条「用户：」的内容。`
  let outcome
  try {
    outcome = await promptChatOnce(sessionID, system, userText)
  } catch (err) {
    console.warn(`[ai] chat 首次失败（${err?.message ?? err}），重试一次`)
    outcome = await promptChatOnce(sessionID, system, userText)
  }
  const model = modelOf(outcome.res)
  const ms = Date.now() - t0
  console.log(`[ai] chat 完成 ${ms}ms（${model ?? '未知模型'}）`)
  return { reply: outcome.reply, model, ms }
}

/* ---------------------------------------------------------------------------
 * 任务快速新建 AI 补全（v0.5 · Slice H）：只填标题 → 建议可补全字段
 * 纪律：AI 只出建议，绝不自动落盘；应用走既有 /api/tasks/:id/update 白名单。
 * ------------------------------------------------------------------------- */

/** 输入标题硬上限（超长截断；有界输入） */
export const TASK_DRAFT_MAX_TITLE_CHARS = 200

/** 构造任务补全系统提示词（注入当前本地时间 + 系统现状摘要） */
function buildTaskDraftSystem(digest) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `你是 KERNEL 个人事务系统的任务补全器。用户只给了一个任务标题，请推断可安全补全的字段，只输出一个 JSON 对象：不要 markdown 代码块、不要解释、不要多余文字。
可用字段（凡拿不准就省略该键，绝不编造）：
- contexts: 字符串数组，只能从 ["@lab","@computer","@campus","@phone","@org-room"] 中选
- energy: "low" | "medium" | "high"
- importance: 1 | 2 | 3（整数）
- estimateMin: 预计所需分钟数（整数，最少 1 分钟）
- dueAt: ISO8601 带时区或 null。现在是 ${stamp}
- projectId: 字符串或 null。仅当标题有明确依据属于下方某个项目时，填该项目 id；否则省略
- areaId: 字符串或 null。仅当标题明确属于下方某个区域时，填该区域 id；否则省略
- tags: 字符串数组。优先从下方【标签】中选已有标签名；仅当没有合适的已有标签、且该标签是稳定的主题词（学科 / 领域，如「线性代数」）时才提出新标签名（必须写成 "topic:名称"，≤12 字）；最多 3 个，去重；无把握则省略
- reason: 一句话说明判断理由

【系统现状摘要】
${digest}

规则：
1. 宁缺毋滥：projectId / areaId 只能取摘要中列出的 id，且必须有明确依据；表面相似不算；拿不准一律省略。tags 优先取已有标签名，仅在确有必要时提出稳定的主题词新标签（"topic:名称"，≤12 字），禁止日期 / 人名 / 整句话。
2. 只补全标题之外的信息，不要返回 title / status / 备注字段。
3. 不确定 dueAt 就省略，不要编造截止日期。
4. 一个字段都没把握时，返回 {"reason":"无明确可补全信息"}。`
}

/** 解析 + 校验单次任务补全响应；返回 { ok, draft } 或 { ok:false, reason } */
function tryParseTaskDraft(res) {
  const cleaned = extractText(res)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, reason: `JSON 解析失败（${err.message}）` }
  }
  try {
    return { ok: true, draft: normalizeSuggestion(taskDraftSchema.parse(obj)) }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/** 单会话内「prompt → 解析 → 一次重试」；失败抛错 */
async function promptTaskDraftWithRetry(sessionID, system, title) {
  let res = await promptOnce(sessionID, system, `任务标题：${title}`)
  let parsed = tryParseTaskDraft(res)
  if (!parsed.ok) {
    console.warn(`[ai] task.draft 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象，不要任何多余文字。`,
    )
    parsed = tryParseTaskDraft(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, draft: parsed.draft }
}

/**
 * 任务快速新建 AI 补全：读系统摘要，对标题推断可安全补全的字段。
 * @param {string} title 已裁剪的任务标题
 * @returns {Promise<{ suggestion: object, model: string | null, ms: number }>}
 */
export async function draftTask(title) {
  const t0 = Date.now()
  const snapshot = await loadSnapshot()
  const system = buildTaskDraftSystem(buildDigest(snapshot))
  const sessionID = await createSession('kernel:task-draft')
  const { res, draft } = await promptTaskDraftWithRetry(sessionID, system, title)
  const clean = postValidate(draft, snapshot)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(`[ai] task.draft 完成 ${ms}ms（${model ?? '未知模型'}）`)
  return { suggestion: clean, model, ms }
}

/* ---------------------------------------------------------------------------
 * 周回顾（v0.5 · Slice C）：周期 / 指标 / 停滞项目（服务端事实源）
 * 说明：computeWeekMetrics 与 staleProjects 同时供「AI 草稿」与「写入路径」复用；
 *       staleProjects 与前端 src/lib/data.ts getStaleProjects 口径严格一致。
 * ------------------------------------------------------------------------- */

const MS_PER_DAY = 86_400_000

/** 当前周起点（本机时区周一 00:00） */
function startOfWeekMonday(now = new Date()) {
  const d = new Date(now)
  const diff = (d.getDay() + 6) % 7 // 周日=0 → 距周一的天数
  d.setDate(d.getDate() - diff)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 当前月起点（本机时区 1 日 00:00；Slice F 月回顾窗口） */
function startOfMonth(now = new Date()) {
  const d = new Date(now)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d
}

/** 日历日差值（镜像 date-fns differenceInCalendarDays：a − b，按本机日历日计） */
function calendarDayDiff(a, b) {
  const da = new Date(a.getFullYear(), a.getMonth(), a.getDate())
  const db = new Date(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((da.getTime() - db.getTime()) / MS_PER_DAY)
}

/** ISO 周键：2026-W40（ISO 周 · 周一起点 · 零填充；无依赖） */
export function isoWeekKey(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`
}

/** 月键：2026-10（本地时区；与前端 src/lib/date.ts toMonthKey 同口径；Slice F） */
export function monthKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

/** 是否落在 [start, end]（含端点；ISO 字符串非法返回 false） */
function inRange(isoValue, start, end) {
  if (typeof isoValue !== 'string') return false
  const t = new Date(isoValue).getTime()
  return Number.isFinite(t) && t >= start.getTime() && t <= end.getTime()
}

/**
 * 通用窗口指标（Slice L）：口径与周 / 月指标**完全一致**，仅参数化窗口 [start, end]。
 * captured = 收件箱 capturedAt 入区间；created = 任务 createdAt 入区间；
 * completed = 任务 doneAt 入区间；overdue = dueAt < ref 且 status ∈ next/waiting/scheduled。
 * `ref` 为逾期判定参考时刻（缺省 = 窗口末端 end）——算上期时传上期末尾，得到该期末的历史存量。
 * 注：migrated 刻意不产出（无编辑追踪来源），见 ADR-0007。
 */
export function computeMetricsForWindow(snapshot, start, end, ref = end) {
  const captured = (snapshot.inbox ?? []).filter((i) => inRange(i.capturedAt, start, end)).length
  const created = (snapshot.tasks ?? []).filter((t) => inRange(t.createdAt, start, end)).length
  const completed = (snapshot.tasks ?? []).filter((t) => inRange(t.doneAt, start, end)).length
  const overdue = (snapshot.tasks ?? []).filter(
    (t) =>
      typeof t.dueAt === 'string' &&
      new Date(t.dueAt).getTime() < ref.getTime() &&
      ['next', 'waiting', 'scheduled'].includes(t.status),
  ).length
  return { captured, created, completed, overdue }
}

/** 本周指标：当前周（本机时区周一 00:00 → 现在） */
export function computeWeekMetrics(snapshot, now = new Date()) {
  return computeMetricsForWindow(snapshot, startOfWeekMonday(now), now, now)
}

/**
 * 本月指标（Slice F 月回顾）：窗口为本机时区 1 日 00:00 → 现在；
 * 口径与 computeWeekMetrics 完全一致，仅换窗口起点。
 */
export function computeMonthMetrics(snapshot, now = new Date()) {
  return computeMetricsForWindow(snapshot, startOfMonth(now), now, now)
}

/** 上一个完整周起点（本周一 − 7 天，00:00；Slice L 环比窗口） */
export function startOfPrevWeek(now = new Date()) {
  const d = startOfWeekMonday(now)
  d.setDate(d.getDate() - 7)
  return d
}

/** 上一个完整月起点（本月 1 日 − 1 个月，00:00；Slice L 环比窗口） */
export function startOfPrevMonth(now = new Date()) {
  const d = startOfMonth(now)
  d.setMonth(d.getMonth() - 1)
  return d
}

/** 停滞项目：active 且 updatedAt 距 now ≥ staleDays 个日历日（镜像前端 getStaleProjects） */
export function staleProjects(snapshot, staleDays = 14, now = new Date()) {
  return (snapshot.projects ?? []).filter((p) => {
    if (p.status !== 'active' || typeof p.updatedAt !== 'string') return false
    const updated = new Date(p.updatedAt)
    if (!Number.isFinite(updated.getTime())) return false
    return -calendarDayDiff(updated, now) >= staleDays
  })
}

/** 近 N 天习惯命中数（log.date 在窗口内且 value > 0） */
function habitHitsLastDays(habit, days, now) {
  const start = new Date(now)
  start.setDate(start.getDate() - (days - 1))
  start.setHours(0, 0, 0, 0)
  return (habit.log ?? []).filter((entry) => {
    if (typeof entry?.date !== 'string' || !(entry.value > 0)) return false
    const d = new Date(`${entry.date}T00:00:00`)
    return Number.isFinite(d.getTime()) && d >= start && d <= now
  }).length
}

/** 习惯在 [start, end] 闭区间内的命中数（log.date 为 YYYY-MM-DD，value > 0） */
function habitHitsRange(habit, start, end) {
  return (habit.log ?? []).filter((entry) => {
    if (typeof entry?.date !== 'string' || !(entry.value > 0)) return false
    const d = new Date(`${entry.date}T00:00:00`)
    return Number.isFinite(d.getTime()) && d >= start && d <= end
  }).length
}

/** now 往回 offset 天的当日边界（'start' 00:00 / 'end' 23:59:59.999） */
function dayBack(now, offset, edge) {
  const d = new Date(now)
  d.setDate(d.getDate() - offset)
  if (edge === 'start') d.setHours(0, 0, 0, 0)
  else d.setHours(23, 59, 59, 999)
  return d
}

/**
 * 习惯连续未达标周数（近似值：以「近 7 天」为滚动窗口逐周回看，命中 < 目标
 * 记为未达标并继续，命中 ≥ 目标即停止；最多回看 8 周）。当前周尚未走完时也会
 * 计入，故报告可据此提示「数据不足」——不把近似值当精确结论。
 */
function habitMissStreak(habit, now, maxWeeks = 8) {
  const target = typeof habit.target === 'number' ? habit.target : 0
  if (!(target > 0)) return 0
  let miss = 0
  for (let k = 0; k < maxWeeks; k += 1) {
    const start = dayBack(now, 7 * k + 6, 'start')
    const end = k === 0 ? now : dayBack(now, 7 * k, 'end')
    if (habitHitsRange(habit, start, end) >= target) break
    miss += 1
  }
  return miss
}

/* ---------------------------------------------------------------------------
 * 数字落地护栏（Slice L）：从摘要抽取数字，断言其为 digest 数字的子集。
 * 允许：digest 中的字面数字；由 digest 数字加减 / 百分比派生出的数字；
 *       结构性小数字（≤3：段号 / 行动条数）；年份（1900–2099）。
 * 越界 → promptReviewWithRetry 做一次纠正重试；仍越界则保留并记录（不阻断）。
 * ------------------------------------------------------------------------- */

/** 从文本抽取「量词性」数字（剔除周键 / 完整日期 / 月键 / 行首序号 / 圈号） */
export function extractQuantities(text) {
  const cleaned = String(text)
    .replace(/\bW\d+\b/g, ' ')
    .replace(/\d{4}-\d{2}-\d{2}/g, ' ')
    .replace(/\d{4}-\d{2}\b/g, ' ')
    .replace(/^\s*\d+[.、)]/gm, ' ')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩]/g, ' ')
  const out = []
  const re = /\d+(?:\.\d+)?/g
  let m
  while ((m = re.exec(cleaned)) !== null) out.push(Number(m[0]))
  return out
}

/**
 * 数字落地审计：summary 中的数字是否都能在 digest 中找到依据。
 * @param {string} summary AI 生成的摘要正文
 * @param {string} digest 注入模型的数据摘要（事实源）
 * @returns {{ ok: boolean, offenders: number[] }} ok=false 时 offenders 为越界数字
 */
export function auditNumbers(summary, digest) {
  const base = extractQuantities(digest)
  const baseSet = new Set(base)
  const derived = new Set()
  for (const a of base) {
    for (const b of base) {
      derived.add(Math.abs(a - b))
      derived.add(a + b)
      if (b !== 0) derived.add(Math.round((a * 100) / b))
    }
  }
  const offenders = []
  for (const n of extractQuantities(summary)) {
    if (baseSet.has(n) || derived.has(n)) continue
    if (n <= 3) continue // 结构性小数字（段号 / 行动条数）
    if (n >= 1900 && n <= 2099) continue // 年份
    offenders.push(n)
  }
  return { ok: offenders.length === 0, offenders: [...new Set(offenders)] }
}

/** 环比展示：cur 相对 prev 的增量与百分比（prev 为 0 时百分比记 —） */
function deltaText(cur, prev) {
  const delta = cur - prev
  const sign = delta > 0 ? '+' : ''
  const pct = prev === 0 ? '—' : `${sign}${Math.round((delta / prev) * 100)}%`
  return `${sign}${delta}（${pct}）`
}

/** 日期短标签：M/D */
function shortDate(d) {
  return `${d.getMonth() + 1}/${d.getDate()}`
}

/**
 * 构造紧凑中文回顾摘要（指标 + 环比 + 完成/逾期/停滞清单 + 习惯 + 活动 + 阈值）。
 * `scope` 为 '周' | '月'；`periodStart` 为窗口起点（周首 / 月首）；
 * `prevMetrics` 为上一同等周期指标（调用方偏移窗口计算）——为报告提供
 * 「环比 / 与上周 / 上月对照」基准；每条清单带 id，便于报告引用具体对象。
 */
async function buildReviewDigest(snapshot, metrics, now, periodStart, scope, prevMetrics, monthly) {
  const label = `本${scope}`
  const prevLabel = `上${scope}`
  const daysLate = (due) => Math.max(0, calendarDayDiff(now, new Date(due)))
  const periodLabel = monthly ? monthKey(now) : isoWeekKey(now)

  const completed = (snapshot.tasks ?? [])
    .filter((t) => inRange(t.doneAt, periodStart, now))
    .map((t) => `${t.id} · ${t.title}`)

  const overdue = (snapshot.tasks ?? [])
    .filter(
      (t) =>
        typeof t.dueAt === 'string' &&
        new Date(t.dueAt).getTime() < now.getTime() &&
        ['next', 'waiting', 'scheduled'].includes(t.status),
    )
    .map((t) => `${t.id} · ${t.title} · 逾期 ${daysLate(t.dueAt)} 天`)

  const staleList = staleProjects(snapshot, 14, now)
  const stale = staleList.map((p) => {
    const staleDays = Math.abs(calendarDayDiff(new Date(p.updatedAt), now))
    const next = p.nextActionId === undefined ? '' : ` · 下一步 ${p.nextActionId}`
    return `${p.id} · ${p.title} · 停滞 ${staleDays} 天 · 完成定义：${p.outcome}${next}`
  })

  const habits = (snapshot.habits ?? []).map((h) => {
    const current = habitHitsLastDays(h, 7, now)
    const prior = habitHitsRange(h, dayBack(now, 13, 'start'), dayBack(now, 7, 'end'))
    const miss = habitMissStreak(h, now)
    return `${h.title} · 近 7 天命中 ${current} · 上 7 天命中 ${prior} · 目标 ${h.target} · 节奏 ${h.cadence} · 连续未达标 ${miss} 周`
  })

  const activity = (await readActivity(200)).filter((entry) => {
    const t = Date.parse(entry.ts)
    return Number.isFinite(t) && t >= periodStart.getTime()
  })
  const counts = new Map()
  for (const entry of activity) counts.set(entry.action, (counts.get(entry.action) ?? 0) + 1)
  const activityLines = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([action, count]) => `${action} ×${count}`)

  return [
    `【周期】${label} ${periodLabel} · 窗口 ${shortDate(periodStart)} → ${shortDate(now)}（本机时区）`,
    `【${label}指标】捕获 ${metrics.captured} · 新增 ${metrics.created} · 完成 ${metrics.completed} · 逾期 ${metrics.overdue}`,
    `【${prevLabel}指标（对照）】捕获 ${prevMetrics.captured} · 新增 ${prevMetrics.created} · 完成 ${prevMetrics.completed} · 逾期 ${prevMetrics.overdue}`,
    `【环比（本${scope}相对上${scope}）】捕获 ${deltaText(metrics.captured, prevMetrics.captured)} · 新增 ${deltaText(metrics.created, prevMetrics.created)} · 完成 ${deltaText(metrics.completed, prevMetrics.completed)} · 逾期 ${deltaText(metrics.overdue, prevMetrics.overdue)}`,
    `【${label}完成（${completed.length}，含 id）】\n${completed.join('\n') || '（无）'}`,
    `【当前逾期（${overdue.length}）】\n${overdue.join('\n') || '（无）'}`,
    `【停滞项目（≥14 天未更新，共 ${stale.length}）】\n${stale.join('\n') || '（无）'}`,
    `【可处置停滞项目 id】${staleList.map((p) => p.id).join(', ') || '（无）'}`,
    `【习惯（近 7 天 / 上 7 天 / 连续未达标周数）】\n${habits.join('\n') || '（无）'}`,
    `【${label}活动计数】\n${activityLines.join('\n') || '（无）'}`,
    `【阈值常量】逾期 = 任务截止时间已过且状态为 next/waiting/scheduled；停滞 = active 项目 ≥14 天未更新；习惯未达标 = 近 7 天命中数 < 目标数`,
  ].join('\n\n')
}

/**
 * 构造回顾系统提示词（指令式 JSON；Slice L 升级为七段报告）。
 * summary 为多段纯文本，恰好七段，每段以「结论式标题」开头；decisions 为 1–3 条
 * if-then 行动；staleAdvice 语义不变。硬性规则保证：只用摘要数字 / 对象、
 * 每个判断带证据、绝对值带对比基准、禁套话、行动含时间与完成标准。
 */
function buildReviewSystem(digest, scope) {
  return `你是 KERNEL 的${scope}回顾助手。只输出一个 JSON 对象：不要 markdown、不要解释、不要多余文字。字段：

- summary：中文纯文本，恰好 7 段，段与段之间用一个换行分隔。每段以「结论式标题」开头，标题后接「：」。全篇不超过 800 字。七段依次为：
  1. 结论速览：一句话结论 + 关键数字（数字必须带对比基准）
  2. 本期数据解读：逐项数字 + 环比（与上${scope}对照）
  3. 趋势与对比：方向（上升 / 下降 / 持平）+ 连续周数（摘要中有则写，没有就写「数据不足」）
  4. 问题诊断：一层因果（现象 → 原因）+ 数据证据（引用摘要中的具体 id 或数字）
  5. 值得保留：至少一条本${scope}在起作用的做法（带数据支撑）
  6. 下期行动：1–3 条 if-then，格式「如果…，那么…」，每条写明 做什么 + 何时 + 完成标准，并绑定摘要中的任务 / 项目名或 id
  7. 风险预警：越线阈值 + 触发对象（逾期任务 id / 停滞项目 id）
- decisions：1–3 条中文 if-then 行动（与第 6 段一致，每条一行、含时间与完成标准）
- staleAdvice：数组，可空：{ projectId, action: 'archive'|'migrate'|'reactivate', reason }，仅针对摘要中列出的停滞项目

【本${scope}数据摘要】
${digest}

硬性规则（违反即不合格）：
1. 只能使用摘要中出现的数字、日期、标题、id；禁止编造任何数字或对象。
2. 每个判断都要有具体数字或具体对象（id / 标题）作为证据。
3. 任何绝对值都要带对比基准（环比 / 上${scope} / 目标）。
4. 禁止套话：「显著 / 一定程度 / 多方面 / 持续发力 / 闭环 / 赋能 / 值得注意 / 综上所述 / 整体向好」等一律不许出现。
5. 短句、主动语态；结论先行。
6. 证据不足就写「数据不足」，不要硬凑。
7. 行动必须 if-then，且含 何时 + 完成标准。
8. 允许（并鼓励）指出不确定性；不夸大。

对照示例（字母仅示形，写作时必须替换成摘要里的真实数字）：
弱（禁止）："本${scope}整体推进顺利，效率显著提升，需持续发力。"
强（合格）："完成 X 项，比上${scope} Y 项多 Z 项（+P%）；新增 M 项，比上${scope} N 项少 Q 项（-R%）。"

staleAdvice.projectId 只能取「可处置停滞项目 id」中列出的 id；没有把握就返回空数组。`
}

/** 解析 + 校验单次周回顾响应；返回 { ok, draft } 或 { ok:false, reason } */
function tryParseReview(res) {
  const cleaned = extractText(res)
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch (err) {
    return { ok: false, reason: `JSON 解析失败（${err.message}）` }
  }
  try {
    const parsed = reviewDraftSchema.parse(obj)
    if (parsed.summary.trim() === '') return { ok: false, reason: '摘要为空' }
    return { ok: true, draft: parsed }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/**
 * 按实际停滞集合后校验 + 文本归一化（trim；丢弃臆造的 projectId）。
 * summary / decisions 按 schema 上限截断（summary ≤2000 字；decisions ≤3 条、每条 ≤200 字），
 * 避免模型超产导致落盘校验失败。
 */
function postValidateDraft(draft, staleIds) {
  return {
    summary: draft.summary.trim().slice(0, 2000),
    decisions: draft.decisions
      .map((d) => d.trim())
      .filter((d) => d !== '')
      .slice(0, 3)
      .map((d) => d.slice(0, 200)),
    staleAdvice: draft.staleAdvice
      .filter((a) => staleIds.has(a.projectId))
      .map((a) => ({ projectId: a.projectId, action: a.action, reason: a.reason.trim() })),
  }
}

/**
 * 单会话内「prompt → 解析 → 数字护栏 → 一次纠正重试」。
 * 形状失败或数字越界各触发一次重试；数字仍越界则保留结果并记录（不阻断生成）。
 */
async function promptReviewWithRetry(sessionID, system, text, digest) {
  let res = await promptOnce(sessionID, system, text)
  let parsed = tryParseReview(res)
  if (!parsed.ok) {
    console.warn(`[ai] review.draft 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象，不要任何多余文字。`,
    )
    parsed = tryParseReview(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  let audit = auditNumbers(parsed.draft.summary, digest)
  if (!audit.ok) {
    console.warn(`[ai] review.draft 数字越界（${audit.offenders.join(',')}），纠正重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出含有数据摘要里不存在的数字：${audit.offenders.join('、')}。请只使用摘要中的数字（可做加减或百分比派生），重新输出合法 JSON。`,
    )
    const reparsed = tryParseReview(res)
    if (reparsed.ok) {
      parsed = reparsed
      audit = auditNumbers(parsed.draft.summary, digest)
    }
  }
  if (!audit.ok) {
    console.warn(`[ai] review.draft 数字仍越界（保留并记录）：${audit.offenders.join(',')}`)
  }
  return { res, draft: parsed.draft, grounded: audit.ok, offenders: audit.offenders }
}

/**
 * 生成回顾草稿（AI 只出草稿；落盘仍由用户确认后走 /api/reviews）。
 * @param {'weekly' | 'monthly'} period 周期；缺省 'weekly'（周行为保持不变）
 * @returns {Promise<{ periodKey: string, metrics: object, summary: string, decisions: string[], staleAdvice: object[], model: string | null, ms: number }>}
 */
export async function generateReviewDraft(period = 'weekly') {
  const t0 = Date.now()
  const now = new Date()
  const monthly = period === 'monthly'
  const scope = monthly ? '月' : '周'
  const snapshot = await loadSnapshot()
  const periodStart = monthly ? startOfMonth(now) : startOfWeekMonday(now)
  const metrics = monthly ? computeMonthMetrics(snapshot, now) : computeWeekMetrics(snapshot, now)
  // 上一同等周期指标：把 now 落在本周期起点前 1ms，窗口即自动回退一个周期（周对周 / 月对月）
  const prevRef = new Date(periodStart.getTime() - 1)
  const prevMetrics = monthly
    ? computeMonthMetrics(snapshot, prevRef)
    : computeWeekMetrics(snapshot, prevRef)
  const staleList = staleProjects(snapshot, 14, now)
  const staleIds = new Set(staleList.map((p) => p.id))
  const digest = await buildReviewDigest(
    snapshot,
    metrics,
    now,
    periodStart,
    scope,
    prevMetrics,
    monthly,
  )
  const system = buildReviewSystem(digest, scope)
  const created = pick(await getClient().session.create({ title: 'kernel:review-draft' }))
  const sessionID = created?.id
  if (typeof sessionID !== 'string' || sessionID === '') {
    throw new Error('无法创建 opencode 会话')
  }
  const { res, draft, grounded, offenders } = await promptReviewWithRetry(
    sessionID,
    system,
    `请生成本${scope}回顾草稿。`,
    digest,
  )
  const clean = postValidateDraft(draft, staleIds)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(
    `[ai] review.draft(${period}) 完成 ${ms}ms（${model ?? '未知模型'}）${grounded ? '' : ` · 数字未全部落地（${offenders.join(',')}）`}`,
  )
  return {
    periodKey: monthly ? monthKey(now) : isoWeekKey(now),
    metrics,
    prevMetrics,
    summary: clean.summary,
    decisions: clean.decisions,
    staleAdvice: clean.staleAdvice,
    staleProjectIds: [...staleIds],
    grounded,
    offenders,
    model,
    ms,
  }
}
