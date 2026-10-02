// KERNEL · AI 代理（经本地 opencode 服务；仅数据服务在服务端调用）
// 纪律：AI 只经 127.0.0.1:4096 的 opencode serve 接入，不外泄、不越权；
//       AI 只产出「建议」，落盘仍由 server/index.mjs 经 commit() 唯一路径完成。
// 依据：.qa/v13/probe4/5 实证——variant:'low' 下 deepseek-flash 约 4~5s 返回干净 JSON；
//       format:json_schema 在 thinking 模式报 tool_choice 错误，故采用「指令式 JSON + Zod + 一次重试」。
import { createOpencodeClient } from '@opencode-ai/sdk/v2'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  aiActionsSchema,
  aiSuggestionSchema,
  clusterDraftSchema,
  clusterProposalSchema,
  projectDraftSchema,
  reviewDraftSchema,
  taskDraftSchema,
} from './schemas.mjs'
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

/** 构造系统提示词（注入当前本地时间 + 系统现状摘要 + 一揽子动作规则） */
function buildSystem(digest) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `你是 KERNEL 个人事务系统的收件箱解析器。把用户丢进来的内容拆解为「一揽子处置动作」，交给用户一次确认后全部落位。
只输出一个 JSON 对象：{ "actions": [ ... ] }，不要 markdown 代码块、不要解释、不要多余文字。

每个 action 对象字段：
- kind: "task" | "note" | "resource" | "project"（必填）
- title: 提炼后的标题（不超过 40 字，必填）
- reason: 一句话说明该动作的判断理由
- contexts: 仅 task 用，字符串数组，只能从 ["@lab","@computer","@campus","@phone","@org-room"] 中选
- energy: 仅 task 用，"low" | "medium" | "high"
- importance: 仅 task 用，1 | 2 | 3（整数）
- estimateMin: 仅 task 用，预计所需分钟数（整数，最少 1 分钟）
- dueAt: 仅 task 用，ISO8601 带时区或 null。现在是 ${stamp}
- projectId: 仅当有明确依据属于下方某个现有项目时填该项目 id；否则省略
- areaId: 仅当明确属于下方某个区域时填该区域 id；否则省略
- tags: 字符串数组。优先从下方【标签】中选已有标签名；仅当没有合适的已有标签、且该标签对日后检索明确有用时，才提出新标签名（写成 "topic:名称"，名称 ≤12 字）；每个动作最多 3 个，去重；无把握则空数组
- outcome: 仅 project 用，完成定义（一句话，说明「怎样算完成」）
- linkToNewProject: 仅 task / note 用。当本批次里有一个 kind:"project" 的新项目、且该动作应挂到它时填 true（此时不要填 projectId）
- duplicateOf: 仅 task 用，仅当与下方某个未完成任务高度可能重复时填该任务 id；否则省略

【系统现状摘要】
${digest}

规则：
1. 拆成一个自然包：例如一条「比赛通知」→ 1 个新项目 + 若干下一步任务 + 1 条要点笔记；一条纯资料链接 → 1 条 resource。宁少而精（1~4 个通常足够），最多 6 个动作。
2. 确实无事可做（纯寒暄 / 无价值信息）时返回 { "actions": [] }。
3. 挂靠宁缺毋滥：projectId / areaId / duplicateOf 只能取摘要中列出的 id，且必须有明确依据；表面相似（例如都含「竞赛 / 比赛 / 规则」字样）不算依据；拿不准一律省略。tags 优先取摘要中已有的标签名；仅当确实没有合适已有标签、且新标签是稳定的主题词（学科 / 领域，如「线性代数」「合唱排练」）时才提出新标签，写成 "topic:名称"（≤12 字）；禁止把日期、人名、整句话或临时描述当标签。
4. 最多一个新项目：整包中 kind:"project" 至多出现 1 次，且仅当内容像一件需要多步推进的新事务（新比赛 / 新活动 / 新项目）时才产出；若属于现有项目，改填 projectId。
5. 新项目与现有项目互斥：挂现有项目就填 projectId；新建项目就用 kind:"project" + 让相关 task/note 填 linkToNewProject:true，绝不同时填 projectId 和 linkToNewProject。
6. 附件不可读时更保守：当【附件】无法直接读取（只有文件名 / 元数据）时，除非文件名直接指向某现有项目（名称 / 主题强匹配），否则 projectId 一律省略，并在 reason 中注明「仅基于文件名判断」。
7. 若条目带【附件】，基于附件内容与文件名判断动作（读取失败则只凭文件名推断）。`
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

/**
 * 旧式单建议 → 动作数组（Slice R1 向后兼容）。
 * target 'discard' → []；task/note + newProjectHint → [新项目动作, 实体动作(linkToNewProject)]，
 * 其余 → 1 个实体动作。newProjectHint 从此不再作为独立顶层字段返回（避免与项目动作双路径）。
 */
function legacyToActions(suggestion) {
  if (suggestion.target === 'discard') return []
  const base = {
    kind: suggestion.target,
    title: suggestion.title,
    tags: suggestion.tags ?? [],
    reason: suggestion.reason ?? '',
  }
  if (suggestion.target === 'task') {
    base.contexts = suggestion.contexts ?? []
    base.energy = suggestion.energy
    base.importance = suggestion.importance
    if (suggestion.estimateMin !== undefined) base.estimateMin = suggestion.estimateMin
    if (suggestion.dueAt !== undefined) base.dueAt = suggestion.dueAt
    if (suggestion.duplicateOf !== undefined) base.duplicateOf = suggestion.duplicateOf
  }
  if (suggestion.projectId !== undefined) base.projectId = suggestion.projectId
  if (suggestion.areaId !== undefined) base.areaId = suggestion.areaId
  const actions = [base]
  if (typeof suggestion.newProjectHint === 'string' && suggestion.newProjectHint !== '') {
    base.linkToNewProject = true
    delete base.projectId
    actions.unshift({
      kind: 'project',
      title: suggestion.newProjectHint,
      tags: [],
      reason: '根据 AI 建议新建项目',
    })
  }
  return actions
}

/**
 * 多动作按快照后校验（Slice R1）：臆造 id 一律丢弃；标签规格化保留（≤3）；
 * 至多保留一个 project 动作（标题与现有项目完全相同者丢弃，防重复建项）；
 * linkToNewProject 仅在存在 project 动作且为 task/note 时保留，且与 projectId 互斥。
 * 导出供单测。返回清洗后的动作数组（可能为空）。
 */
export function postValidateActions(actions, snapshot) {
  const projects = snapshot.projects ?? []
  const projectIds = new Set(projects.map((p) => p.id))
  const projectTitles = new Set(projects.map((p) => p.title))
  const areaIds = new Set((snapshot.areas ?? []).map((a) => a.id))
  const taskIds = new Set((snapshot.tasks ?? []).map((t) => t.id))
  const tagNames = new Set((snapshot.tags ?? []).map((t) => t.name))

  const cleaned = []
  for (const raw of (Array.isArray(actions) ? actions : []).slice(0, 6)) {
    const out = { ...raw }
    for (const key of ['projectId', 'areaId', 'duplicateOf', 'outcome', 'dueAt', 'estimateMin', 'energy', 'importance']) {
      if (out[key] === null) delete out[key]
    }
    const title = Array.from(String(out.title ?? '').trim()).slice(0, 40).join('')
    if (title === '') continue
    out.title = title
    out.tags = cleanTagSuggestions(out.tags, tagNames)
    // 统一形状：所有动作都带 contexts 数组，避免前端按 kind 读取时缺键
    out.contexts = Array.isArray(out.contexts) ? out.contexts : []
    if (out.projectId !== undefined && !projectIds.has(out.projectId)) delete out.projectId
    if (out.areaId !== undefined && !areaIds.has(out.areaId)) delete out.areaId
    if (out.duplicateOf !== undefined && !taskIds.has(out.duplicateOf)) delete out.duplicateOf
    if (typeof out.outcome === 'string') {
      const outcome = out.outcome.trim()
      if (outcome === '') delete out.outcome
      else out.outcome = outcome
    }
    cleaned.push(out)
  }

  const projectCandidates = cleaned.filter((a) => a.kind === 'project')
  let projectAction = projectCandidates[0]
  if (projectAction !== undefined && projectTitles.has(projectAction.title)) projectAction = undefined
  const entityActions = cleaned.filter((a) => a.kind !== 'project')

  const out = []
  if (projectAction !== undefined) out.push(projectAction)
  for (const raw of entityActions) {
    const action = { ...raw }
    delete action.outcome // project 专属字段不落在实体动作上
    if (action.kind === 'resource') delete action.projectId // resource 无 projectId 结构
    if (projectAction !== undefined && action.linkToNewProject === true) {
      if (action.kind !== 'task' && action.kind !== 'note') delete action.linkToNewProject
      else delete action.projectId // 与 projectId 互斥
    } else {
      delete action.linkToNewProject
    }
    out.push(action)
  }
  return out
}

/** 解析 + 校验单次响应：接受 {actions:[...]} 或旧式单建议；返回 { ok, actions } 或失败原因（导出供单测） */
export function tryParseActions(res) {
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
    if (obj !== null && typeof obj === 'object' && Array.isArray(obj.actions)) {
      return { ok: true, actions: aiActionsSchema.parse(obj).actions }
    }
    // 向后兼容：旧式单建议形状
    return { ok: true, actions: legacyToActions(aiSuggestionSchema.parse(obj)) }
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
  let parsed = tryParseActions(res)
  if (!parsed.ok) {
    if (emit) emit({ kind: 'retry', reason: parsed.reason })
    console.warn(`[ai] inbox.parse 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象（形如 {"actions":[...]}），不要任何多余文字。`,
    )
    parsed = tryParseActions(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, actions: parsed.actions }
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
  const { res, actions } = await promptWithRetry(sessionID, system, userText, null)
  const clean = postValidateActions(actions, snapshot)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(`[ai] inbox.parse ${item.id} 完成 ${ms}ms（${model ?? '未知模型'} · ${clean.length} 动作）`)
  return { actions: clean, model, ms }
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
    const { res, actions } = await promptWithRetry(sessionID, system, userText, safeEmit)
    const clean = postValidateActions(actions, snapshot)
    const model = modelOf(res)
    const ms = Date.now() - t0
    safeEmit({ kind: 'suggestion', actions: clean, model, ms })
    console.log(`[ai] inbox.parse-stream ${item.id} 完成 ${ms}ms（${model ?? '未知模型'} · ${clean.length} 动作）`)
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
 * 项目快速新建 AI 草稿（v0.5 · Slice R1）：只填标题 → 建议完成定义 / 区域 / 标签
 * 纪律：AI 只出建议，绝不自动落盘；应用走扩展后的 POST /api/projects（草稿确认）。
 * ------------------------------------------------------------------------- */

/** 输入标题硬上限（超长截断；有界输入） */
export const PROJECT_DRAFT_MAX_TITLE_CHARS = 200

/** 构造项目补全系统提示词（注入当前本地时间 + 系统现状摘要） */
function buildProjectDraftSystem(digest) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `你是 KERNEL 个人事务系统的项目补全器。用户只给了一个项目标题，请推断可安全补全的字段，只输出一个 JSON 对象：不要 markdown 代码块、不要解释、不要多余文字。
可用字段（凡拿不准就省略该键，绝不编造）：
- outcome: 完成定义（一句话，说明「怎样算完成」，≤60 字）
- areaId: 字符串或 null。仅当标题明确属于下方某个区域时填该区域 id；否则省略
- tags: 字符串数组。优先从下方【标签】中选已有标签名；仅当没有合适的已有标签、且该标签是稳定的主题词（学科 / 领域，如「线性代数」）时才提出新标签名（写成 "topic:名称"，≤12 字）；最多 3 个，去重；无把握则省略
- reason: 一句话说明判断理由。现在是 ${stamp}

【系统现状摘要】
${digest}

规则：
1. 宁缺毋滥：areaId 只能取摘要中列出的 id，且必须有明确依据；表面相似不算；拿不准一律省略。tags 优先取已有标签名，仅在确有必要时提出稳定的主题词新标签（"topic:名称"，≤12 字），禁止日期 / 人名 / 整句话。
2. outcome 要具体可判定（例如「决赛名单与分工落定」），不要套话（「顺利完成」「取得好成绩」）；不确定则省略。
3. 一个字段都没把握时，返回 {"reason":"无明确可补全信息"}。`
}

/** 解析 + 校验单次项目补全响应；返回 { ok, draft } 或 { ok:false, reason } */
function tryParseProjectDraft(res) {
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
    return { ok: true, draft: projectDraftSchema.parse(obj) }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/** 单会话内「prompt → 解析 → 一次重试」；失败抛错 */
async function promptProjectDraftWithRetry(sessionID, system, title) {
  let res = await promptOnce(sessionID, system, `项目标题：${title}`)
  let parsed = tryParseProjectDraft(res)
  if (!parsed.ok) {
    console.warn(`[ai] project.draft 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象，不要任何多余文字。`,
    )
    parsed = tryParseProjectDraft(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, draft: parsed.draft }
}

/**
 * 项目快速新建 AI 补全：读系统摘要，对标题推断完成定义 / 区域 / 标签。
 * @param {string} title 已裁剪的项目标题
 * @returns {Promise<{ suggestion: object, model: string | null, ms: number }>}
 */
export async function draftProject(title) {
  const t0 = Date.now()
  const snapshot = await loadSnapshot()
  const system = buildProjectDraftSystem(buildDigest(snapshot))
  const sessionID = await createSession('kernel:project-draft')
  const { res, draft } = await promptProjectDraftWithRetry(sessionID, system, title)
  const clean = postValidate(draft, snapshot)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(`[ai] project.draft 完成 ${ms}ms（${model ?? '未知模型'}）`)
  return { suggestion: clean, model, ms }
}

/* ---------------------------------------------------------------------------
 * 聚类立项（v0.5 · Slice R2，见 ADR-0016）：连续累积的相似任务 / 未澄清条目 → 新项目
 * 纪律：AI 只出「建议提案」，绝不自动建项；确定性预分组限定成员（模型按组编号引用，
 *       无法编造 id）；应用经 POST /api/projects/cluster-apply（服务端一次写入 + 审计）。
 * ------------------------------------------------------------------------- */

/** 候选上限（有界成本） */
export const CLUSTER_MAX_CANDIDATES = 50
/** 构成一个提案所需的最少成员数 */
export const CLUSTER_MIN_MEMBERS = 3
/** 提案上限 */
export const CLUSTER_MAX_PROPOSALS = 3
/** 项目名硬上限 */
export const CLUSTER_TITLE_MAX_CHARS = 60

/** 连续 CJK 串（用于提取二元组） */
const CLUSTER_CJK_RUN = /[\u4e00-\u9fa5]+/g
/** 拉丁 / 数字词（≥2 字符） */
const CLUSTER_LATIN = /[a-zA-Z0-9]{2,}/g
/** 过泛的标题词（不作为关键词信号；避免把无关事务因通用动词并入一组） */
const CLUSTER_STOPWORDS = new Set([
  '任务', '项目', '事情', '一件', '进行', '处理', '完成', '准备', '相关', '整理',
  '作业', '复习', '学习', '安排', '计划', '确认', '查看', '了解', '跟进', '记录',
])

/**
 * 收集聚类候选（有界 ≤50）：无 projectId 的未完成任务（updatedAt 倒序）+ 未澄清收件箱
 * （capturedAt 倒序）。任务优先，因其结构字段更利于主题判断。
 */
export function collectClusterCandidates(snapshot) {
  const out = []
  const tasks = [...(snapshot.tasks ?? [])]
    .filter((t) => (t.projectId === undefined || t.projectId === '') && OPEN_TASK_STATUS.has(t.status))
    .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')))
  for (const t of tasks) {
    out.push({ id: t.id, kind: 'task', title: String(t.title ?? ''), tags: normalizeTagList(t.tags ?? []) })
    if (out.length >= CLUSTER_MAX_CANDIDATES) return out
  }
  const inbox = [...(snapshot.inbox ?? [])]
    .filter((i) => i.status === 'unprocessed')
    .sort((a, b) => String(b.capturedAt ?? '').localeCompare(String(a.capturedAt ?? '')))
  for (const i of inbox) {
    out.push({ id: i.id, kind: 'inbox', title: String(i.content ?? ''), tags: [] })
    if (out.length >= CLUSTER_MAX_CANDIDATES) return out
  }
  return out
}

/** 标签信号集：完整标签名 + 可读后缀（topic:线性代数 → 线性代数） */
function tagSignalSet(candidate) {
  const set = new Set()
  for (const raw of candidate.tags ?? []) {
    const name = String(raw)
    set.add(name)
    if (name.startsWith('@')) {
      if (name.length > 1) set.add(name.slice(1))
    } else {
      const colon = name.indexOf(':')
      if (colon >= 0 && colon + 1 < name.length) set.add(name.slice(colon + 1))
    }
  }
  return set
}

/** 标题关键词信号集：拉丁词（小写）+ CJK 二元组（去停用词） */
function keywordSignalSet(candidate) {
  const set = new Set()
  const title = String(candidate.title ?? '')
  for (const word of title.match(CLUSTER_LATIN) ?? []) {
    const lower = word.toLowerCase()
    if (!CLUSTER_STOPWORDS.has(lower)) set.add(lower)
  }
  for (const run of title.match(CLUSTER_CJK_RUN) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const bigram = run.slice(i, i + 2)
      if (!CLUSTER_STOPWORDS.has(bigram)) set.add(bigram)
    }
  }
  return set
}

/**
 * 确定性预分组：先用共享标签（≥3 个候选）贪心成组，再用标题关键词（≥3）在剩余项上补组；
 * 每个候选最多归入一组（强信号优先、按频次降序消费）。返回成员数组（组内 ≥3，按规模降序，≤6 组）。
 */
export function pregroupCandidates(candidates) {
  if (candidates.length < CLUSTER_MIN_MEMBERS) return []
  const signalOf = { tag: new Map(), keyword: new Map() }
  for (const c of candidates) {
    signalOf.tag.set(c.id, tagSignalSet(c))
    signalOf.keyword.set(c.id, keywordSignalSet(c))
  }
  const groups = []
  const assigned = new Set()
  const runPass = (map) => {
    const freq = new Map()
    for (const set of map.values()) for (const token of set) freq.set(token, (freq.get(token) ?? 0) + 1)
    const tokens = [...freq.entries()]
      .filter(([, count]) => count >= CLUSTER_MIN_MEMBERS)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    for (const [token] of tokens) {
      const members = candidates.filter((c) => !assigned.has(c.id) && map.get(c.id).has(token))
      if (members.length < CLUSTER_MIN_MEMBERS) continue
      groups.push(members)
      for (const m of members) assigned.add(m.id)
    }
  }
  runPass(signalOf.tag)
  runPass(signalOf.keyword)
  return groups.sort((a, b) => b.length - a.length).slice(0, CLUSTER_MAX_PROPOSALS * 2)
}

/** 构造聚类命名摘要（组编号 → 成员；附现有项目 / 区域 / 标签供命名与去重） */
function buildClusterDigest(snapshot, groups) {
  const lines = []
  groups.forEach((members, index) => {
    lines.push(`组 ${index + 1}（${members.length} 项）：`)
    for (const m of members) {
      const kindLabel = m.kind === 'task' ? '任务' : '收件箱'
      const tagText = (m.tags ?? []).length > 0 ? ` ｜ tags: ${m.tags.join(',')}` : ''
      lines.push(`- ${kindLabel} ${m.id} · ${m.title}${tagText}`)
    }
  })
  const projects = (snapshot.projects ?? []).map((p) => `${p.id} · ${p.title}`)
  const areas = (snapshot.areas ?? []).map((a) => `${a.id} · ${a.title}`)
  const tags = (snapshot.tags ?? []).map((t) => t.name)
  return `【候选分组】\n${lines.join('\n') || '（无）'}\n【现有项目（避免重复）】\n${projects.join('\n') || '（无）'}\n【区域】\n${areas.join('\n') || '（无）'}\n【标签】\n${tags.join(', ') || '（无）'}`
}

/** 构造项目归纳系统提示词（注入当前本地时间 + 组内成员 + 去重约束） */
function buildClusterSystem() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `你是 KERNEL 个人事务系统的「项目归纳器」。用户连续、分散地记录了若干尚未归入项目的任务 / 未澄清条目；系统已用确定性规则把它们预分组（见下方【候选分组】）。请判断每个组是否确实属于同一件「需要多步推进的新事务」，若是，为它起一个项目名、写完成定义与理由；若否（主题松散、只是巧合共享词），不要输出该组。

只输出一个 JSON 对象：{ "proposals": [ ... ] }，不要 markdown 代码块、不要解释、不要多余文字。
每个 proposal 字段：
- group: 整数，对应【候选分组】的组编号（必填）
- title: 项目名（≤20 字，名词短语，能看出在做什么；不要「各类任务」「待整理」「TODOs」等套话）
- outcome: 完成定义（一句话，说明「怎样算完成」，≤60 字；拿不准可省略）
- reason: 一句话说明为什么这些条目属于同一项目
- areaId: 仅当明确属于下方某个区域时填该区域 id；否则省略
- tags: 字符串数组，优先从【标签】选已有名；仅当确无合适已有标签时提议 "topic:名称"（≤12 字）；每个最多 3 个；无把握省略
现在是 ${stamp}。

规则：
1. 为每个【候选分组】给出提案（这些组已由系统按共享标签 / 关键词筛出，成员均 ≥3）；只有当某组已被现有项目覆盖（见规则 2）时，才跳过该组。最多 3 个提案。
2. 不得与【现有项目】重复：若某组已被某个现有项目覆盖（标题 / 主题强匹配），不要输出该组。
3. 只能引用被提供过的组编号；成员由系统按组展开，你不要自己写 id。
4. 项目名与完成定义不得编造组内不存在的事实。
5. 无需归纳时返回 {"proposals":[]}。`
}

/** 解析 + 校验单次聚类命名响应；返回 { ok, proposals } 或 { ok:false, reason } */
function tryParseClusterDraft(res) {
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
    return { ok: true, proposals: clusterDraftSchema.parse(obj).proposals }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/** 单会话内「prompt → 解析 → 一次重试」；失败抛错 */
async function promptClusterWithRetry(sessionID, system, digest) {
  let res = await promptOnce(sessionID, system, digest)
  let parsed = tryParseClusterDraft(res)
  if (!parsed.ok) {
    console.warn(`[ai] cluster.draft 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象（形如 {"proposals":[...]}），不要任何多余文字。`,
    )
    parsed = tryParseClusterDraft(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, proposals: parsed.proposals }
}

/**
 * 聚类提案后校验（导出供单测 / 冒烟）：按组编号展开成员（模型无法编造 id）；
 * 丢弃越界组 / 成员 <3 / 无任务成员 / 项目名与现有项目重复者；成员任务不跨提案复用；
 * areaId 必须在 areas；标签规格化保留（≤3，新标签落盘时登记）。
 */
export function postValidateClusters(proposals, groups, snapshot) {
  const areaIds = new Set((snapshot.areas ?? []).map((a) => a.id))
  const projectTitles = new Set((snapshot.projects ?? []).map((p) => String(p.title ?? '').trim()))
  const tagNames = new Set((snapshot.tags ?? []).map((t) => t.name))
  const usedTaskIds = new Set()
  const out = []
  for (const raw of Array.isArray(proposals) ? proposals : []) {
    const index = raw?.group
    if (!Number.isInteger(index) || index < 1 || index > groups.length) continue
    const members = groups[index - 1]
    if (!Array.isArray(members) || members.length < CLUSTER_MIN_MEMBERS) continue
    const title = Array.from(String(raw.title ?? '').trim()).slice(0, CLUSTER_TITLE_MAX_CHARS).join('')
    if (title === '' || projectTitles.has(title)) continue
    const taskIds = members.filter((m) => m.kind === 'task').map((m) => m.id)
    const inboxIds = members.filter((m) => m.kind === 'inbox').map((m) => m.id)
    if (taskIds.length === 0) continue
    if (taskIds.some((id) => usedTaskIds.has(id))) continue
    const proposal = {
      title,
      reason: String(raw.reason ?? '').slice(0, 300),
      taskIds,
      inboxIds,
      tags: cleanTagSuggestions(raw.tags, tagNames),
    }
    if (typeof raw.outcome === 'string' && raw.outcome.trim() !== '') {
      proposal.outcome = raw.outcome.trim().slice(0, 200)
    }
    if (typeof raw.areaId === 'string' && areaIds.has(raw.areaId)) proposal.areaId = raw.areaId
    const parsed = clusterProposalSchema.safeParse(proposal)
    if (!parsed.success) continue
    for (const id of taskIds) usedTaskIds.add(id)
    out.push(parsed.data)
    if (out.length >= CLUSTER_MAX_PROPOSALS) break
  }
  return out
}

/** AI 命名不可用时的确定性回退：以组内最高频标签（或首条标题）命名 */
function fallbackClusterProposals(groups) {
  return groups.map((members, index) => {
    const counts = new Map()
    for (const m of members) for (const tag of m.tags ?? []) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    let best = ''
    let bestCount = 0
    for (const [tag, count] of counts) {
      if (count > bestCount) {
        best = tag
        bestCount = count
      }
    }
    let name = ''
    if (best !== '') {
      name = best.startsWith('@') ? best.slice(1) : best.includes(':') ? best.slice(best.indexOf(':') + 1) : best
    }
    if (name === '') name = Array.from(members[0].title).slice(0, 16).join('')
    return {
      group: index + 1,
      title: `归纳：${name}`.slice(0, CLUSTER_TITLE_MAX_CHARS),
      reason: '按共同标签 / 关键词自动归纳（AI 命名不可用）',
    }
  })
}

/**
 * 聚类草稿：收集候选 → 确定性预分组 → AI 命名（失败回退确定性命名）→ 后校验。
 * 不写任何数据；无候选或无 ≥3 成员分组时返回空提案。
 * @returns {Promise<{ proposals: Array, model: string | null, ms: number, candidates: number }>}
 */
export async function draftClusters(snapshot) {
  const t0 = Date.now()
  const candidates = collectClusterCandidates(snapshot)
  const groups = pregroupCandidates(candidates)
  if (groups.length === 0) {
    return { proposals: [], model: null, ms: Date.now() - t0, candidates: candidates.length }
  }
  const system = buildClusterSystem()
  const digest = buildClusterDigest(snapshot, groups)
  const sessionID = await createSession('kernel:cluster-draft')
  let raw = []
  let model = null
  try {
    const result = await promptClusterWithRetry(sessionID, system, digest)
    raw = result.proposals
    model = modelOf(result.res)
  } catch (err) {
    console.warn(`[ai] cluster.draft AI 命名失败，回退确定性命名：${err?.message ?? err}`)
  }
  // 覆盖兜底：AI 未覆盖（或提案被校验丢弃）的组，用确定性命名补上——保证每个
  //「成员 ≥3 且未被现有项目覆盖」的组都被提议（用户仍可逐条忽略）；AI 命名正常时不会触发。
  const firstPass = postValidateClusters(raw, groups, snapshot)
  const coveredTaskIds = new Set(firstPass.flatMap((p) => p.taskIds))
  const fill = fallbackClusterProposals(groups).filter((proposal) => {
    const members = groups[proposal.group - 1] ?? []
    const ids = members.filter((m) => m.kind === 'task').map((m) => m.id)
    return ids.length > 0 && !ids.some((id) => coveredTaskIds.has(id))
  })
  const proposals = postValidateClusters([...raw, ...fill], groups, snapshot)
  const ms = Date.now() - t0
  console.log(
    `[ai] cluster.draft 完成 ${ms}ms（${model ?? '回退'} · ${proposals.length} 提案 / ${candidates.length} 候选）`,
  )
  return { proposals, model, ms, candidates: candidates.length }
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

/**
 * 回顾窗口（Slice U）：本周期起点 + 上一周期**同等已走完长度**的对照窗口。
 * 月：本月 1..N 日 ↔ 上月 1..N 日（短月按上月末截断）；周：本周至今 ↔ 上周同一星期数。
 * 这样进行中的周期不会拿「3 天」去比「一整月」。见 ADR-0013 §6。
 */
export function reviewWindows(now = new Date(), monthly = false) {
  const periodStart = monthly ? startOfMonth(now) : startOfWeekMonday(now)
  const prevStart = monthly ? startOfPrevMonth(now) : startOfPrevWeek(now)
  const elapsed = now.getTime() - periodStart.getTime()
  const prevEndRaw = prevStart.getTime() + elapsed
  // 短月 / 跨月截断：对照窗口不越过上一周期最后一刻（periodStart − 1ms）
  const prevEnd = new Date(Math.min(prevEndRaw, periodStart.getTime() - 1))
  const elapsedDays = Math.max(1, calendarDayDiff(now, periodStart) + 1)
  return { periodStart, prevStart, prevEnd, elapsedDays }
}

/** 上一周期「同期」指标（与本节窗口等长；逾期参考时刻取对照窗口末端） */
export function computeSameWindowPrevMetrics(snapshot, now = new Date(), monthly = false) {
  const { prevStart, prevEnd } = reviewWindows(now, monthly)
  return computeMetricsForWindow(snapshot, prevStart, prevEnd, prevEnd)
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

/* ---------------------------------------------------------------------------
 * 报告分节解析（Slice U）：把 summary 拆成七段，供服务端「下期行动」去重；
 * 前端同规则解析见 src/lib/reviewReport.ts（两处刻意保持一致，勿单边改动）。
 * 兼容「结论速览：…」与「一、结论速览」两种标题写法。
 * ------------------------------------------------------------------------- */

const REVIEW_SECTION_ALIASES = [
  { label: '结论速览', aliases: ['结论速览'] },
  { label: '数据解读', aliases: ['本期数据解读', '数据解读'] },
  { label: '趋势与对比', aliases: ['趋势与对比', '趋势对比'] },
  { label: '问题诊断', aliases: ['问题诊断'] },
  { label: '值得保留', aliases: ['值得保留'] },
  { label: '下期行动', aliases: ['下期行动'] },
  { label: '风险预警', aliases: ['风险预警'] },
]

const REVIEW_ALIAS_INDEX = REVIEW_SECTION_ALIASES.flatMap((entry) =>
  entry.aliases.map((alias) => ({ alias, label: entry.label })),
).sort((a, b) => b.alias.length - a.alias.length)

/** 去掉行首序号（「一、」「（二）」「1.」「1)」等） */
function stripSectionNumbering(line) {
  return line.replace(/^[（(]?(?:[一二三四五六七八九十]+|\d+)[）)]?\s*[、.．:：)）]?\s*/, '')
}

/** 识别分节标题行；返回 { label, body } 或 null */
function matchReviewHeading(line) {
  const raw = String(line ?? '').trim()
  if (raw === '') return null
  const stripped = stripSectionNumbering(raw).trim()
  for (const { alias, label } of REVIEW_ALIAS_INDEX) {
    if (!stripped.startsWith(alias)) continue
    const rest = stripped.slice(alias.length)
    if (rest === '') return { label, body: '' }
    if (/^[：:]/.test(rest)) return { label, body: rest.slice(1).trim() }
    if (/^[\s，,。.、（(]/.test(rest)) {
      return { label, body: rest.replace(/^[\s，,。.、（(]+/, '').trim() }
    }
    return null
  }
  return null
}

/**
 * 拆解报告正文为 { intro, sections }。intro 为第一个标题之前的文字；
 * sections 为 `[{ label, body }]`（body 保留多行，行间以 \n 连接）。
 */
export function splitReportSections(summary) {
  const lines = String(summary ?? '').split(/\r?\n/)
  const sections = []
  const intro = []
  let current = null
  for (const line of lines) {
    const heading = matchReviewHeading(line)
    if (heading !== null) {
      current = { label: heading.label, body: heading.body }
      sections.push(current)
      continue
    }
    const text = line.trim()
    if (text === '') continue
    if (current === null) intro.push(text)
    else current.body = current.body === '' ? text : `${current.body}\n${text}`
  }
  return { intro: intro.join('\n'), sections }
}

/**
 * 「下期行动」去重（Slice U）：把 summary 第 6 段整段替换为一行指针
 * 「下期行动：见决策区（N 条）。」，完整 if-then 只留在 decisions，杜绝逐字重复。
 * decisions 为空时不动（避免把唯一的行动记录也抹掉）。
 */
export function dedupeActionSection(summary, decisions) {
  const text = String(summary ?? '')
  const count = (Array.isArray(decisions) ? decisions : [])
    .map((d) => String(d ?? '').trim())
    .filter((d) => d !== '').length
  if (count === 0) return text
  const lines = text.split(/\r?\n/)
  let start = -1
  let end = lines.length
  for (let i = 0; i < lines.length; i += 1) {
    const heading = matchReviewHeading(lines[i])
    if (heading === null) continue
    if (start === -1) {
      if (heading.label === '下期行动') start = i
    } else {
      end = i
      break
    }
  }
  if (start === -1) return text
  const pointer = `下期行动：见决策区（${count} 条）。`
  return [...lines.slice(0, start), pointer, ...lines.slice(end)].join('\n')
}

/**
 * 环比展示（Slice U 可读性规则）：基准 ≥5 才给百分比；基准 <5 时只给
 * 绝对变化 + 基准（避免 0 / 1 基准下百分比失真）。
 */
export function formatDelta(cur, prev) {
  const delta = cur - prev
  const sign = delta > 0 ? '+' : ''
  if (prev >= 5) {
    const pct = `${sign}${Math.round((delta / prev) * 100)}%`
    return `${sign}${delta}（${pct}，基准 ${prev}）`
  }
  return `${sign}${delta}（基准 ${prev}）`
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
async function buildReviewDigest(
  snapshot,
  metrics,
  now,
  periodStart,
  scope,
  prevMetrics,
  monthly,
  windowInfo,
) {
  const label = `本${scope}`
  const prevLabel = `上${scope}同期`
  const daysLate = (due) => Math.max(0, calendarDayDiff(now, new Date(due)))
  const periodLabel = monthly ? monthKey(now) : isoWeekKey(now)
  const { prevStart, prevEnd, elapsedDays } = windowInfo

  const completed = (snapshot.tasks ?? [])
    .filter((t) => inRange(t.doneAt, periodStart, now))
    .map((t) => `${t.title}（${t.id}）`)

  const overdue = (snapshot.tasks ?? [])
    .filter(
      (t) =>
        typeof t.dueAt === 'string' &&
        new Date(t.dueAt).getTime() < now.getTime() &&
        ['next', 'waiting', 'scheduled'].includes(t.status),
    )
    .map((t) => `${t.title}（${t.id}）· 逾期 ${daysLate(t.dueAt)} 天`)

  const staleList = staleProjects(snapshot, 14, now)
  const stale = staleList.map((p) => {
    const staleDays = Math.abs(calendarDayDiff(new Date(p.updatedAt), now))
    const next = p.nextActionId === undefined ? '' : ` · 下一步 ${p.nextActionId}`
    return `${p.title}（${p.id}）· 停滞 ${staleDays} 天 · 完成定义：${p.outcome}${next}`
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

  const lines = [
    `【周期】本${scope} ${periodLabel} · 窗口 ${shortDate(periodStart)} → ${shortDate(now)}（已走完 ${elapsedDays} 天，本机时区）`,
    `【${label}指标】捕获 ${metrics.captured} · 新增 ${metrics.created} · 完成 ${metrics.completed} · 逾期 ${metrics.overdue}`,
    `【${prevLabel}指标（对照 · 窗口 ${shortDate(prevStart)} → ${shortDate(prevEnd)}）】捕获 ${prevMetrics.captured} · 新增 ${prevMetrics.created} · 完成 ${prevMetrics.completed} · 逾期 ${prevMetrics.overdue}`,
    `【环比（本${scope}相对${prevLabel} · 等长窗口）】捕获 ${formatDelta(metrics.captured, prevMetrics.captured)} · 新增 ${formatDelta(metrics.created, prevMetrics.created)} · 完成 ${formatDelta(metrics.completed, prevMetrics.completed)} · 逾期 ${formatDelta(metrics.overdue, prevMetrics.overdue)}`,
    `【${label}完成（${completed.length}，标题优先 · 括号补 id）】\n${completed.join('\n') || '（无）'}`,
    `【当前逾期（${overdue.length}）】\n${overdue.join('\n') || '（无）'}`,
    `【停滞项目（≥14 天未更新，共 ${stale.length}）】\n${stale.join('\n') || '（无）'}`,
    `【可处置停滞项目 id】${staleList.map((p) => p.id).join(', ') || '（无）'}`,
    `【习惯（近 7 天 / 上 7 天 / 连续未达标周数）】\n${habits.join('\n') || '（无）'}`,
    `【${label}活动计数】\n${activityLines.join('\n') || '（无）'}`,
    `【阈值常量】逾期 = 任务截止时间已过且状态为 next/waiting/scheduled；停滞 = active 项目 ≥14 天未更新；习惯未达标 = 近 7 天命中数 < 目标数`,
  ]
  if (elapsedDays < 7) {
    lines.push(
      `【窗口说明】本期窗口尚未走完（已 ${elapsedDays} 天，未满 7 天）；对照为${prevLabel}（${shortDate(prevStart)} → ${shortDate(prevEnd)}）。请在「结论速览」或「风险预警」里自然说明窗口不完整、结论仅供参考，禁止以「窗口仅 N 天」作为结论开场。`,
    )
  }
  return lines.join('\n\n')
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
  2. 本期数据解读：逐项数字 + 环比（与上${scope}同期等长窗口对照）
  3. 趋势与对比：方向（上升 / 下降 / 持平）+ 连续周数（摘要中有则写，没有就写「数据不足」）
  4. 问题诊断：一层因果（现象 → 原因）+ 数据证据（优先引用摘要中的对象标题，必要时括号补 id）
  5. 值得保留：至少一条本${scope}在起作用的做法（带数据支撑）
  6. 下期行动：只写一行指针，固定为「下期行动：见决策区（N 条）。」（N = decisions 条数，1–3）。完整 if-then 行动全部放进 decisions，正文此段不再重复。
  7. 风险预警：越线阈值 + 触发对象（逾期任务 / 停滞项目，优先标题、必要时括号补 id）
- decisions：1–3 条中文 if-then 行动（每条一行、含时间与完成标准；正文第 6 段只留指针，完整行动在此）
- staleAdvice：数组，可空：{ projectId, action: 'archive'|'migrate'|'reactivate', reason }，仅针对摘要中列出的停滞项目

【本${scope}数据摘要】
${digest}

硬性规则（违反即不合格）：
1. 只能使用摘要中出现的数字、日期、标题、id；禁止编造任何数字或对象。
2. 每个判断都要有具体数字或具体对象作为证据。
3. 任何绝对值都要带对比基准（环比 / 上${scope}同期 / 目标）。
4. 禁止套话：「显著 / 一定程度 / 多方面 / 持续发力 / 闭环 / 赋能 / 值得注意 / 综上所述 / 整体向好」等一律不许出现。
5. 短句、主动语态；结论先行。
6. 证据不足就写「数据不足」，不要硬凑。
7. 行动必须 if-then，且含 何时 + 完成标准（全部写在 decisions）。
8. 允许（并鼓励）指出不确定性；不夸大。
9. 叙述优先用对象标题（摘要清单已是「标题（id）」）；id 只在 decisions 的行动里为绑定对象时以括号补充，可选。
10. 百分比只在基准 ≥5 时使用；基准 <5 时只写绝对变化并注明基准（如「+2（基准 0）」），禁止硬算百分比。
11. 若摘要含【窗口说明】（窗口未满 7 天），在「结论速览」或「风险预警」里自然说明窗口不完整；禁止以「窗口仅 N 天」作为结论开场。

对照示例（字母仅示形，写作时必须替换成摘要里的真实数字）：
弱（禁止）："本${scope}整体推进顺利，效率显著提升，需持续发力。"
强（合格）："完成 X 项，比上${scope}同期 Y 项多 Z 项。"（仅当基准 Y≥5 时才补「+P%」）

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
  // 同期窗口（Slice U）：进行中的周期对照上一周期**同等已走完长度**——
  // 月：本月 1..N 日 ↔ 上月 1..N 日；周：本周至今 ↔ 上周同期；短月按上月末截断。
  const { periodStart, prevStart, prevEnd, elapsedDays } = reviewWindows(now, monthly)
  const metrics = monthly ? computeMonthMetrics(snapshot, now) : computeWeekMetrics(snapshot, now)
  const prevMetrics = computeSameWindowPrevMetrics(snapshot, now, monthly)
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
    { prevStart, prevEnd, elapsedDays },
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
  // 「下期行动」去重（Slice U）：第 6 段改为指针，完整行动只在 decisions（杜绝逐字重复）
  const summary = dedupeActionSection(clean.summary, clean.decisions)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(
    `[ai] review.draft(${period}) 完成 ${ms}ms（${model ?? '未知模型'}）${grounded ? '' : ` · 数字未全部落地（${offenders.join(',')}）`}`,
  )
  return {
    periodKey: monthly ? monthKey(now) : isoWeekKey(now),
    metrics,
    prevMetrics,
    summary,
    decisions: clean.decisions,
    staleAdvice: clean.staleAdvice,
    staleProjectIds: [...staleIds],
    grounded,
    offenders,
    model,
    ms,
  }
}
