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
  noteDistillSchema,
  organizeDraftSchema,
  projectDraftSchema,
  reviewDraftSchema,
  taskDraftSchema,
  timetableDraftSchema,
} from './schemas.mjs'
import { DATA_DIR, normalizeTagList, readActivity, readSnapshot } from './store.mjs'

const OPENCODE_URL = process.env.KERNEL_OPENCODE_URL ?? 'http://127.0.0.1:4096'
const SERVER_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD ?? ''
const HEALTH_TIMEOUT_MS = 3_000
// 放宽至 180s：长截图会被前端切成多张分片图一并发给模型，解析耗时显著高于普通文本 / 单图
const PROMPT_TIMEOUT_MS = 180_000
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

/** 打开的（未完成）任务状态（导出：index.mjs 归并前亦据此跳过已完成 / 已丢弃任务） */
export const OPEN_TASK_STATUS = new Set(['next', 'waiting', 'scheduled', 'someday'])

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

/**
 * 情境标签名（namespace === 'context'）——从标签注册表派生，供 AI 提示词注入（Slice Y · F1）。
 * 此前提示词硬编码 5 个情境（@lab/@computer/@campus/@phone/@org-room），遗漏注册表中的
 * @errands / @home；改由注册表派生后，所有已登记情境对 AI 均可达。
 */
export function contextNamesOf(snapshot) {
  return (snapshot.tags ?? [])
    .filter((tag) => tag.namespace === 'context')
    .map((tag) => tag.name)
}

/** 提示词中的情境候选列表（注册表为空时回退 @computer，保证提示词始终有可用选项） */
function contextRuleText(contextNames) {
  const list = contextNames.length > 0 ? contextNames : ['@computer']
  return list.map((name) => `"${name}"`).join(', ')
}

/** 可提取文本摘录的扩展名白名单（文件投递 · Slice D） */
const TEXT_EXTS = new Set([
  '.txt', '.md', '.markdown', '.csv', '.json', '.log', '.yml', '.yaml', '.toml', '.ini',
  '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.java', '.c', '.cpp', '.h', '.hpp',
  '.css', '.html', '.xml', '.sql', '.sh', '.bat', '.ps1',
])
/** 可抽取文本的 Office Open XML 扩展名（Slice J：docx / pptx / xlsx 二进制 docx 即 ZIP） */
const OOXML_EXTS = new Set(['.docx', '.pptx', '.xlsx'])
/** 图片附件扩展名（v0.5 · Slice N0）：截图投递与文本共用同一解析管线（仅补 file part） */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
/** 图片扩展名 → mime（附件缺少 mime 时按扩展名回退推断） */
const IMAGE_MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
}
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
    return extractXlsxGrid(buf)
  }
  throw new Error(`不支持的 OOXML 扩展名 ${ext}`)
}

/** 表格行数硬上限（有界读取，避免超大表耗尽内存 / 提示词） */
const XLSX_MAX_ROWS = 500
/** 表格列数硬上限（安全加固：防 r="…" 超大列号触发补齐循环耗尽内存 / CPU） */
const XLSX_MAX_COLS = 256

/** 单元格引用（如 "C3" / "AA12"）的列字母 → 0-based 列号；无法解析返回 -1；超上限返回 XLSX_MAX_COLS */
function columnIndexFromRef(ref) {
  const letters = /^[A-Za-z]+/.exec(String(ref ?? ''))
  if (letters === null) return -1
  let index = 0
  for (const ch of letters[0].toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64)
    // 超上限提前返回，避免超长列引用序列无谓计算
    if (index > XLSX_MAX_COLS) return XLSX_MAX_COLS
  }
  return index - 1
}

/** 抽取单个 <si> / <is> 片段内的全部 <t> 文本（拼接 + 解实体） */
function textOfTextNodes(fragment) {
  let acc = ''
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g
  let m
  while ((m = re.exec(fragment)) !== null) acc += m[1]
  return decodeXmlEntities(acc)
}

/**
 * 抽取 .xlsx 工作表为「网格文本」（v0.5 · Slice H1）：
 * - 工作表：优先 xl/worksheets/sheet1.xml，否则数字序最先的 sheetN.xml；
 * - 共享字符串表 xl/sharedStrings.xml 可选：每个 <si> 拼接全部 <t> 片段并解实体；
 * - 逐 <c r="C3" t="s|str|inlineStr"><v>…</v></c>：t="s" 取共享串下标，inlineStr 取 <is> 文本，
 *   str 取 <v> 文本，其余取原始 <v>（数字）；按 r 列字母对齐并补齐空列；
 * - 每行以 \t 连接、行间 \n，跳过全空行，最多 XLSX_MAX_ROWS 行。
 * 导出供单测 / 探测复用。失败抛出（上层回退不可读提示）。
 * @param {Buffer} buf xlsx（ZIP）二进制
 * @returns {string} 网格文本
 */
export function extractXlsxGrid(buf) {
  const entries = readZipEntries(buf)

  // 共享字符串表（可选）
  const shared = []
  const sharedEntry = entries.get('xl/sharedStrings.xml')
  if (sharedEntry !== undefined) {
    const xml = readZipEntry(buf, sharedEntry).toString('utf8')
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g
    let m
    while ((m = siRe.exec(xml)) !== null) shared.push(textOfTextNodes(m[1]))
  }

  // 工作表定位
  let sheetName = 'xl/worksheets/sheet1.xml'
  if (!entries.has(sheetName)) {
    const candidates = [...entries.keys()]
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort(
        (a, b) =>
          Number.parseInt(a.replace(/\D+/g, ''), 10) - Number.parseInt(b.replace(/\D+/g, ''), 10),
      )
    if (candidates.length === 0) throw new Error('xlsx: 未找到工作表')
    sheetName = candidates[0]
  }
  const sheetXml = readZipEntry(buf, entries.get(sheetName)).toString('utf8')

  const rows = []
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g
  let rm
  while ((rm = rowRe.exec(sheetXml)) !== null && rows.length < XLSX_MAX_ROWS) {
    const cells = []
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
    let cm
    while ((cm = cellRe.exec(rm[1])) !== null) {
      const attrs = cm[1] ?? ''
      const inner = cm[2] ?? ''
      const refMatch = /\br="([A-Za-z]+\d+)"/.exec(attrs)
      const col = refMatch !== null ? columnIndexFromRef(refMatch[1]) : cells.length
      // 安全加固：列号超上限直接忽略该单元格（防补齐循环 DoS）
      if (col >= XLSX_MAX_COLS) continue
      const typeMatch = /\bt="([^"]*)"/.exec(attrs)
      const type = typeMatch !== null ? typeMatch[1] : ''
      let value = ''
      if (type === 'inlineStr') {
        value = textOfTextNodes(inner)
      } else {
        const vMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(inner)
        const rawV = vMatch !== null ? decodeXmlEntities(vMatch[1]) : ''
        if (type === 's') {
          const index = Number.parseInt(rawV, 10)
          value = Number.isInteger(index) && index >= 0 && index < shared.length ? shared[index] : ''
        } else {
          value = rawV
        }
      }
      if (col >= 0) {
        while (cells.length < col) cells.push('')
        cells[col] = value
      } else {
        cells.push(value)
      }
    }
    const joined = cells.map((cell) => String(cell ?? '')).join('\t').replace(/\t+$/, '')
    if (joined.trim() !== '') rows.push(joined)
  }
  return rows.join('\n')
}

/**
 * 是否图片附件（v0.5 · Slice N0）：扩展名命中图片白名单，或 mime 以 image/ 开头。
 * 图片与文本走同一解析管线；差异仅在提交形态（额外 file part）与提示词引导。
 * @param {{ file?: { name?: string, mime?: string } } | null | undefined} item
 * @returns {boolean}
 */
export function isImageFile(item) {
  const file = item?.file
  if (file === undefined || file === null) return false
  const ext = path.extname(String(file.name ?? '')).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return true
  return typeof file.mime === 'string' && file.mime.startsWith('image/')
}

/** OLE2 复合文档魔数（旧版 .xls；见 Slice H1 不可读指引） */
const OLE2_MAGIC = 0xd0cf11e0

/** 是否含大量替换字符（U+FFFD）：utf8 解码疑似乱码 → 上层尝试 GBK 回退 */
function isGarbledText(text) {
  if (typeof text !== 'string' || text === '') return false
  let replacement = 0
  for (const ch of text) if (ch === '\uFFFD') replacement += 1
  return replacement >= 3 || (replacement > 0 && replacement * 50 >= text.length)
}

/** 统计 CJK 汉字数（U+4E00–U+9FA5）；用于「像不像可读中文文本」判定 */
function countCjk(text) {
  const m = String(text).match(/[\u4e00-\u9fa5]/g)
  return m === null ? 0 : m.length
}

/**
 * HTML / XML 表格 → 纯文本（Slice H1）：<br>→\n、</tr>→\n、</td>→\t，剥其余标签，
 * 解实体，折叠连续空白与空行。用于网页另存 / 文本化表格的 .xls / .html 内容。
 */
function htmlTableToText(html) {
  const withBreaks = String(html)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '\t')
  const stripped = withBreaks.replace(/<[^>]*>/g, '')
  return decodeXmlEntities(stripped)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \u00a0]+/g, ' ').replace(/\s+$/g, '').replace(/^\s+/g, ''))
    .filter((line, index, arr) => !(line === '' && arr[index - 1] === ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 旧版 .xls 内容判定（v0.5 · Slice H1）：文件投递「资料 + 简介」路径无法吞下真二进制 .xls，
 * 但部分「.xls」实为 HTML/文本表格（网页另存 / 误改扩展名）。此处仅据内容判断：
 * - OLE2 魔数（真 BIFF 二进制）→ null（上层给不可读指引，不做 BIFF 解析）；
 * - 含表格标记 → htmlTableToText；
 * - 含 ≥10 个汉字 → 原文；
 * - 否则 → null。
 * 导出供探测复用（不读磁盘）。
 * @param {Buffer} buf 文件二进制
 * @returns {string | null} 可读文本；不可读返回 null
 */
export function extractLegacyXlsText(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 8) return null
  if (buf.readUInt32BE(0) === OLE2_MAGIC) return null
  let decoded = buf.toString('utf8')
  if (isGarbledText(decoded)) {
    try {
      decoded = new TextDecoder('gbk').decode(buf)
    } catch {
      /* 保留 utf8 结果 */
    }
  }
  if (/<(table|tr|td|html)/i.test(decoded)) {
    const text = htmlTableToText(decoded)
    return text === '' ? null : text
  }
  if (countCjk(decoded) >= 10) return decoded
  return null
}

/* ---------------------------------------------------------------------------
 * 旧版 .xls 直读（BIFF8 in OLE2/CFBF）：纯 Buffer、无新依赖（Slice H2）
 * - extractOleStream：解析 CFBF 复合文档容器，取指定命名流的原始字节
 *   （Workbook；BIFF5 时代的 Book 作 fallback，但 BIFF5 正文仍不支持）；
 * - BIFF8 记录遍历：BOUNDSHEET / SST(+CONTINUE) / LABELSST / LABEL / RSTRING /
 *   NUMBER / RK / MULRK / MERGEDCELLS → 网格文本；
 * - 合并单元格值向整个范围复制（课表跨行/跨列的课程名自动重复，AI 可直接读）；
 * - 任何解析失败一律返回 null（上层回退 FILE_UNREADABLE_HINT，绝不抛出）。
 * ------------------------------------------------------------------------- */

/** CFBF（OLE2 复合文档）8 字节签名 d0cf11e0a1b11ae1 */
const CFBF_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
/** CFBF 链结束 / 空闲扇区标记 */
const CFBF_ENDOFCHAIN = 0xfffffffe
const CFBF_FREESECT = 0xffffffff
/** 扇区链最大长度守卫（防脏 FAT 造成死循环） */
const CFBF_MAX_SECTORS = 1 << 20

/** 是否 OLE2/CFBF 容器（真二进制旧版 .xls） */
function isOle2(buf) {
  return Buffer.isBuffer(buf) && buf.length >= 8 && buf.subarray(0, 8).equals(CFBF_SIGNATURE)
}

/** GBK 解码器（惰性单例）：BIFF8 压缩串与 CFBF 目录名的代码页 */
let gbkDecoder = null
function decodeGbk(buf) {
  try {
    if (gbkDecoder === null) gbkDecoder = new TextDecoder('gbk')
    return gbkDecoder.decode(buf)
  } catch {
    return buf.toString('latin1')
  }
}

/** 取 CFBF 第 N 个扇区（N 从 0 起；文件偏移 = (N+1)*sectorSize） */
function cfbfSector(buf, sector, sectorSize) {
  const start = (sector + 1) * sectorSize
  return buf.subarray(start, start + sectorSize)
}

/**
 * 从 OLE2/CFBF 容器中抽取指定命名流的字节。
 * 支持常规 FAT 链与（流 < miniCutoff 时的）miniFAT 迷你流；失败返回 null。
 * 导出供探测复用（不读磁盘）。
 * @param {Buffer} buf OLE2 容器二进制
 * @param {string} [wantedName] 目标流名（默认 Workbook）
 * @returns {Buffer | null}
 */
export function extractOleStream(buf, wantedName = 'Workbook') {
  try {
    if (!isOle2(buf)) return null
    const sectorShift = buf.readUInt16LE(0x1e)
    const miniSectorShift = buf.readUInt16LE(0x20)
    if (sectorShift < 7 || sectorShift > 20) return null
    if (miniSectorShift < 2 || miniSectorShift > sectorShift) return null
    const sectorSize = 1 << sectorShift
    const miniSectorSize = 1 << miniSectorShift
    if (buf.length < sectorSize) return null
    const totalSectors = Math.floor(buf.length / sectorSize) - 1
    if (totalSectors <= 0) return null

    const firstDirSector = buf.readUInt32LE(0x30)
    const miniCutoff = buf.readUInt32LE(0x38)
    const firstMiniFatSector = buf.readUInt32LE(0x3c)
    const firstDifatSector = buf.readUInt32LE(0x44)

    // 1) DIFAT → FAT 扇区 id 列表（头部 109 项 + 后续 DIFAT 扇区链）
    const fatSectorIds = []
    for (let i = 0; i < 109; i += 1) {
      const id = buf.readUInt32LE(0x4c + i * 4)
      if (id !== CFBF_FREESECT && id !== CFBF_ENDOFCHAIN) fatSectorIds.push(id)
    }
    let difat = firstDifatSector
    for (let guard = 0; difat !== CFBF_ENDOFCHAIN && difat !== CFBF_FREESECT && guard < CFBF_MAX_SECTORS; guard += 1) {
      if (difat >= totalSectors) break
      const sec = cfbfSector(buf, difat, sectorSize)
      const perSector = sectorSize / 4
      for (let i = 0; i < perSector - 1; i += 1) {
        const id = sec.readUInt32LE(i * 4)
        if (id !== CFBF_FREESECT && id !== CFBF_ENDOFCHAIN) fatSectorIds.push(id)
      }
      difat = sec.readUInt32LE((perSector - 1) * 4)
    }

    // 2) FAT：DIFAT 列出的每个扇区解析为 u32 表（顺序拼接）
    const fat = []
    for (const id of fatSectorIds) {
      if (id >= totalSectors) continue
      const sec = cfbfSector(buf, id, sectorSize)
      for (let i = 0; i < sectorSize / 4; i += 1) fat.push(sec.readUInt32LE(i * 4))
    }
    if (fat.length === 0) return null

    /** 沿 FAT 链收集扇区 id（含环守卫） */
    const chain = (start) => {
      const out = []
      let cur = start
      for (let g = 0; cur !== CFBF_ENDOFCHAIN && cur !== CFBF_FREESECT && g < totalSectors + 1; g += 1) {
        if (!Number.isInteger(cur) || cur < 0 || cur >= fat.length) break
        out.push(cur)
        cur = fat[cur]
      }
      return out
    }
    /** 读常规链并截断到 size（size<0 → 全量） */
    const readChain = (start, size) => {
      const all = Buffer.concat(chain(start).map((s) => cfbfSector(buf, s, sectorSize)))
      return size >= 0 && size <= all.length ? all.subarray(0, size) : all
    }

    // 3) 目录项（128B）：type 2=流 / 5=根；名字 UTF-16LE；取目标流与根
    const dirSecs = chain(firstDirSector)
    if (dirSecs.length === 0) return null
    const dir = Buffer.concat(dirSecs.map((s) => cfbfSector(buf, s, sectorSize)))
    let target = null
    let root = null
    for (let base = 0; base + 128 <= dir.length; base += 128) {
      const type = dir.readUInt8(base + 0x42)
      if (type !== 2 && type !== 5) continue
      const nameLen = dir.readUInt16LE(base + 0x40)
      const chars = Math.max(0, nameLen / 2 - 1)
      let name = ''
      for (let i = 0; i < chars; i += 1) name += String.fromCharCode(dir.readUInt16LE(base + i * 2))
      const startSector = dir.readUInt32LE(base + 0x74)
      const size = dir.readUInt32LE(base + 0x78)
      if (type === 5) {
        root = { startSector, size }
      } else if (target === null && (name === wantedName || (wantedName === 'Workbook' && name === 'Book'))) {
        target = { startSector, size }
      }
    }
    if (target === null) return null
    if (target.size === 0) return Buffer.alloc(0)

    // 4) 迷你流（< miniCutoff）：迷你扇区位于根流容器（常规 FAT 链）内
    if (miniCutoff > 0 && target.size < miniCutoff) {
      if (root === null) return null
      const miniStream = readChain(root.startSector, -1)
      const miniFat = []
      let mf = firstMiniFatSector
      for (let guard = 0; mf !== CFBF_ENDOFCHAIN && mf !== CFBF_FREESECT && guard < CFBF_MAX_SECTORS; guard += 1) {
        if (!Number.isInteger(mf) || mf < 0 || mf >= fat.length) break
        const sec = cfbfSector(buf, mf, sectorSize)
        for (let i = 0; i < sectorSize / 4; i += 1) miniFat.push(sec.readUInt32LE(i * 4))
        mf = fat[mf]
      }
      if (miniFat.length === 0) return null
      const parts = []
      let cur = target.startSector
      for (let guard = 0; cur !== CFBF_ENDOFCHAIN && cur !== CFBF_FREESECT && guard < miniFat.length + 1; guard += 1) {
        if (!Number.isInteger(cur) || cur < 0 || cur >= miniFat.length) break
        const o = cur * miniSectorSize
        parts.push(miniStream.subarray(o, o + miniSectorSize))
        cur = miniFat[cur]
      }
      const all = Buffer.concat(parts)
      return target.size <= all.length ? all.subarray(0, target.size) : all
    }
    return readChain(target.startSector, target.size)
  } catch {
    return null
  }
}

/** BIFF8 关键记录号 */
const BIFF_BOF = 0x0809
const BIFF_EOF = 0x000a
const BIFF_BOUNDSHEET = 0x0085
const BIFF_SST = 0x00fc
const BIFF_CONTINUE = 0x003c
const BIFF_LABELSST = 0x00fd
const BIFF_LABEL = 0x0204
const BIFF_RSTRING = 0x00d6
const BIFF_NUMBER = 0x0203
const BIFF_RK = 0x027e
const BIFF_MULRK = 0x00bd
const BIFF_MERGEDCELLS = 0x00e5
const BIFF_MULBLANK = 0x00be
const BIFF_BLANK = 0x0201
/** BIFF8 版本号（BOF.vers）；BIFF5 为 0x0500，不支持 */
const BIFF8_VERSION = 0x0600
/** 网格装配上限（有界读取，防超大表耗尽内存 / 提示词） */
const XLS_MAX_ROWS = 500
const XLS_MAX_COLS = 100
/** 单工作簿解析的工作表上限 */
const XLS_MAX_SHEETS = 3

/**
 * RK 值解码：bit1(0x02) → 30 位有符号整数（(rk|0)>>2）；
 * 否则 → IEEE754 double（高 32 位 = rk & ~3，低 32 位 = 0）；bit0(0x01) → 结果 /100。
 * 导出供单测。
 * @param {number} rk u32 原始值
 * @returns {number}
 */
export function decodeRk(rk) {
  const u = rk >>> 0
  let value
  if ((u & 0x02) !== 0) {
    value = (u | 0) >> 2
  } else {
    const eight = Buffer.alloc(8)
    eight.writeUInt32LE(0, 0)
    eight.writeUInt32LE(u & 0xfffffffc, 4)
    value = eight.readDoubleLE(0)
  }
  if ((u & 0x01) !== 0) value /= 100
  return value
}

/** 数字 → 文本：整数原样；小数 ≤4 位去尾零（网格用，避免科学计数法噪声） */
function formatGridNumber(value) {
  if (!Number.isFinite(value)) return ''
  if (Number.isInteger(value)) return String(value)
  const fixed = value.toFixed(4)
  return fixed.replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * 解析 SST（共享字符串表，含 CONTINUE 段）：返回字符串数组。
 * 支持文档化的「CONTINUE 落在字符数组中间时，续段首字节重定义 grbit」细化。
 * @param {Buffer[]} segments [SST payload, ...CONTINUE payload]
 * @returns {string[]}
 */
function parseSstSegments(segments) {
  const strings = []
  if (segments.length === 0) return strings
  let segIndex = 0
  let pos = 0
  const atEnd = () => segIndex >= segments.length
  const readBytes = (n) => {
    if (atEnd() || pos + n > segments[segIndex].length) return null
    const out = segments[segIndex].subarray(pos, pos + n)
    pos += n
    return out
  }
  const header = readBytes(8)
  if (header === null) return strings
  const unique = header.readUInt32LE(4)

  for (let i = 0; i < unique && !atEnd(); i += 1) {
    const head = readBytes(3)
    if (head === null) break
    const cch = head.readUInt16LE(0)
    let high = (head.readUInt8(2) & 0x01) !== 0
    const rich = (head.readUInt8(2) & 0x08) !== 0
    const ext = (head.readUInt8(2) & 0x04) !== 0
    let cRun = 0
    let cbExt = 0
    if (rich) {
      const b = readBytes(2)
      if (b === null) break
      cRun = b.readUInt16LE(0)
    }
    if (ext) {
      const b = readBytes(4)
      if (b === null) break
      cbExt = b.readUInt32LE(0)
    }
    // 字符数据（可能跨 CONTINUE 段；跨段首字节重定义 grbit）
    let remaining = cch
    let acc = ''
    let chunkBytes = []
    const flush = () => {
      if (chunkBytes.length === 0) return
      const joined = Buffer.concat(chunkBytes)
      acc += high ? joined.toString('utf16le') : decodeGbk(joined)
      chunkBytes = []
    }
    while (remaining > 0 && !atEnd()) {
      if (pos >= segments[segIndex].length) {
        segIndex += 1
        pos = 0
        if (atEnd()) break
        // 续段首字节：字符数组跨段时重定义 grbit（保留 rich/ext 已消耗）
        flush()
        high = (segments[segIndex].readUInt8(0) & 0x01) !== 0
        pos = 1
        continue
      }
      const need = high ? remaining * 2 : remaining
      const avail = Math.min(need, segments[segIndex].length - pos)
      chunkBytes.push(segments[segIndex].subarray(pos, pos + avail))
      pos += avail
      remaining -= high ? Math.floor(avail / 2) : avail
    }
    flush()
    // 跳过 rich runs / ExtRst 原始字节（可能跨段，但不重定义 grbit）
    let skip = cRun * 4 + cbExt
    while (skip > 0 && !atEnd()) {
      if (pos >= segments[segIndex].length) {
        segIndex += 1
        pos = 0
        continue
      }
      const take = Math.min(skip, segments[segIndex].length - pos)
      pos += take
      skip -= take
    }
    strings.push(acc)
  }
  return strings
}

/**
 * 读取 BIFF8 内联 Unicode 字符串（LABEL / RSTRING 用）：
 * cch u16 + grbit u8（bit0 高位串 / bit2 phonetic / bit3 rich）+ 字符 +（rich runs / ExtRst）。
 * @returns {{ str: string, next: number } | null}
 */
function readBiffString(buf, offset, end) {
  if (offset + 3 > end) return null
  const cch = buf.readUInt16LE(offset)
  const grbit = buf.readUInt8(offset + 2)
  let p = offset + 3
  const high = (grbit & 0x01) !== 0
  const rich = (grbit & 0x08) !== 0
  const ext = (grbit & 0x04) !== 0
  let cRun = 0
  let cbExt = 0
  if (rich) {
    if (p + 2 > end) return null
    cRun = buf.readUInt16LE(p)
    p += 2
  }
  if (ext) {
    if (p + 4 > end) return null
    cbExt = buf.readUInt32LE(p)
    p += 4
  }
  const charBytes = high ? cch * 2 : cch
  if (p + charBytes > end) return null
  const str = high ? buf.subarray(p, p + charBytes).toString('utf16le') : decodeGbk(buf.subarray(p, p + charBytes))
  p += charBytes + cRun * 4 + cbExt
  return { str, next: p }
}

/**
 * 解析单个工作表：从 BOF 偏移遍历到 EOF，收集单元格与合并区域 → 网格文本。
 * @returns {{ name: string, text: string, nonEmpty: number } | null}
 */
function parseSheetGrid(stream, start, sst, name) {
  if (!Number.isInteger(start) || start < 0 || start + 4 > stream.length) return null
  if (stream.readUInt16LE(start) !== BIFF_BOF) return null
  let p = start + 4 + stream.readUInt16LE(start + 2)

  const rows = [] // rows[r][c] = string
  const merges = []
  let maxRow = -1
  let maxCol = -1
  const setCell = (r, c, value) => {
    if (r < 0 || c < 0 || r >= XLS_MAX_ROWS || c >= XLS_MAX_COLS) return
    if (rows[r] === undefined) rows[r] = []
    rows[r][c] = value
    if (r > maxRow) maxRow = r
    if (c > maxCol) maxCol = c
  }

  while (p + 4 <= stream.length) {
    const id = stream.readUInt16LE(p)
    const len = stream.readUInt16LE(p + 2)
    const ps = p + 4
    const pe = ps + len
    if (pe > stream.length) break
    if (id === BIFF_EOF) break
    if (id === BIFF_LABELSST && len >= 10) {
      const r = stream.readUInt16LE(ps)
      const c = stream.readUInt16LE(ps + 2)
      const isst = stream.readUInt32LE(ps + 6)
      setCell(r, c, isst >= 0 && isst < sst.length ? sst[isst] : '')
    } else if ((id === BIFF_LABEL || id === BIFF_RSTRING) && len >= 6) {
      const r = stream.readUInt16LE(ps)
      const c = stream.readUInt16LE(ps + 2)
      const parsed = readBiffString(stream, ps + 6, pe)
      setCell(r, c, parsed === null ? '' : parsed.str)
    } else if (id === BIFF_NUMBER && len >= 14) {
      const r = stream.readUInt16LE(ps)
      const c = stream.readUInt16LE(ps + 2)
      setCell(r, c, formatGridNumber(stream.readDoubleLE(ps + 6)))
    } else if (id === BIFF_RK && len >= 10) {
      const r = stream.readUInt16LE(ps)
      const c = stream.readUInt16LE(ps + 2)
      setCell(r, c, formatGridNumber(decodeRk(stream.readUInt32LE(ps + 6))))
    } else if (id === BIFF_MULRK && len >= 6) {
      const r = stream.readUInt16LE(ps)
      const colFirst = stream.readUInt16LE(ps + 2)
      const n = Math.floor((len - 6) / 6)
      for (let i = 0; i < n; i += 1) {
        const rk = stream.readUInt32LE(ps + 4 + i * 6 + 2)
        setCell(r, colFirst + i, formatGridNumber(decodeRk(rk)))
      }
    } else if (id === BIFF_MERGEDCELLS && len >= 2) {
      const cm = stream.readUInt16LE(ps)
      for (let i = 0; i < cm; i += 1) {
        const b = ps + 2 + i * 8
        if (b + 8 > pe) break
        merges.push({
          r1: stream.readUInt16LE(b),
          r2: stream.readUInt16LE(b + 2),
          c1: stream.readUInt16LE(b + 4),
          c2: stream.readUInt16LE(b + 6),
        })
      }
    }
    // BLANK / MULBLANK / 其他 → 空，跳过
    if (id === BIFF_BLANK || id === BIFF_MULBLANK) {
      /* 空白单元格：无需落值 */
    }
    p = pe
  }

  if (maxRow < 0 || maxCol < 0) return null

  // 合并单元格：把左上角值复制到整个范围（课表跨行/跨列课程名自动重复）
  for (const mg of merges) {
    const value = rows[mg.r1]?.[mg.c1] ?? ''
    for (let r = mg.r1; r <= Math.min(mg.r2, XLS_MAX_ROWS - 1); r += 1) {
      for (let c = mg.c1; c <= Math.min(mg.c2, XLS_MAX_COLS - 1); c += 1) setCell(r, c, value)
    }
  }

  // 装配文本：单元格内换行折叠为分隔符以保持逐行 tab 对齐；跳全空行；去行尾 tab
  const lines = []
  let nonEmpty = 0
  for (let r = 0; r <= maxRow; r += 1) {
    const row = rows[r] ?? []
    const cells = []
    for (let c = 0; c <= maxCol; c += 1) {
      const raw = row[c] ?? ''
      if (raw !== '') nonEmpty += 1
      cells.push(raw.replace(/[\r\n]+/g, ' / '))
    }
    const line = cells.join('\t').replace(/\t+$/, '')
    if (line.trim() !== '') lines.push(line)
  }
  if (lines.length === 0) return null
  return { name, text: lines.join('\n'), nonEmpty }
}

/**
 * 抽取旧版 .xls（OLE2/CFBF 二进制）为网格文本（Slice H2）。
 * 流程：extractOleStream 取 Workbook → 全局 BOF 版本须为 BIFF8 → 收集
 * BOUNDSHEET + SST(+CONTINUE) → 逐个工作表解析（最多 XLS_MAX_SHEETS 个有内容的表）。
 * 多表时每块前缀「【工作表 {name}】」；单表不加前缀。
 * 健全性：文本须含 ≥5 个汉字且 ≥10 个非空单元格，否则返回 null。
 * 任何异常 → null（绝不抛出）。导出供 buildFileSection 与探测复用。
 * @param {Buffer} buf 旧版 .xls 二进制
 * @returns {string | null} 网格文本；不可读返回 null
 */
export function extractLegacyXlsGrid(buf) {
  try {
    if (!isOle2(buf)) return null
    const stream = extractOleStream(buf, 'Workbook')
    if (stream === null || stream.length < 8) return null

    // 全局子流：版本 + BOUNDSHEET + SST（含 CONTINUE）
    let p = 0
    let version = -1
    let sawBof = false
    const boundsheets = []
    let sst = []
    while (p + 4 <= stream.length) {
      const id = stream.readUInt16LE(p)
      const len = stream.readUInt16LE(p + 2)
      const ps = p + 4
      const pe = ps + len
      if (pe > stream.length) break
      if (id === BIFF_BOF) {
        if (!sawBof) {
          sawBof = true
          version = stream.readUInt16LE(ps)
        }
      } else if (id === BIFF_BOUNDSHEET && len >= 8) {
        const lb = stream.readUInt32LE(ps)
        const cch = stream.readUInt8(ps + 6)
        const gchr = stream.readUInt8(ps + 7)
        const byteLen = cch * ((gchr & 0x01) !== 0 ? 2 : 1)
        const nameStart = ps + 8
        const name =
          (gchr & 0x01) !== 0
            ? stream.subarray(nameStart, nameStart + byteLen).toString('utf16le')
            : decodeGbk(stream.subarray(nameStart, nameStart + byteLen))
        boundsheets.push({ lb, name })
      } else if (id === BIFF_SST) {
        const segments = [stream.subarray(ps, pe)]
        let q = pe
        while (q + 4 <= stream.length && stream.readUInt16LE(q) === BIFF_CONTINUE) {
          const clen = stream.readUInt16LE(q + 2)
          if (q + 4 + clen > stream.length) break
          segments.push(stream.subarray(q + 4, q + 4 + clen))
          q += 4 + clen
        }
        sst = parseSstSegments(segments)
        p = q
        continue
      } else if (id === BIFF_EOF) {
        break
      }
      p = pe
    }

    if (version !== BIFF8_VERSION) return null // BIFF5 等旧格式不支持
    if (boundsheets.length === 0) return null

    const blocks = []
    for (const sheet of boundsheets) {
      if (blocks.length >= XLS_MAX_SHEETS) break
      const block = parseSheetGrid(stream, sheet.lb, sst, sheet.name)
      if (block !== null) blocks.push(block)
    }
    if (blocks.length === 0) return null

    const nonEmpty = blocks.reduce((sum, b) => sum + b.nonEmpty, 0)
    if (nonEmpty < 10) return null
    const text =
      blocks.length === 1
        ? blocks[0].text
        : blocks.map((b) => `【工作表 ${b.name}】\n${b.text}`).join('\n\n')
    if (countCjk(text) < 5) return null
    return text
  } catch {
    return null
  }
}

/**
 * 构造附件段落（供收件箱解析的同步 / 流式两条路径复用）。
 * 无附件返回 ''；图片返回单行「见附图」提示；文本类且 ≤5MB 时附前 8000 字摘录；否则仅给元数据。
 * 旧版 .xls（Slice H1）：真 OLE2 二进制 → 不可读指引；HTML / 文本表格 → 摘录（见 extractLegacyXlsText）。
 * @param {{ id: string, file?: { name: string, size: number, mime?: string } }} item
 * @returns {Promise<string>}
 */
export async function buildFileSection(item) {
  const file = item?.file
  if (file === undefined || file === null) return ''
  const mime = file.mime ?? '未知类型'
  const meta = `${file.name}（${mime}｜${file.size} 字节）`
  const ext = path.extname(file.name).toLowerCase()
  if (isImageFile(item)) {
    return `【附件】${meta}——图片内容见附图（请直接读取图片）。`
  }
  // 旧版 .xls（Slice H1）：不加入 TEXT_EXTS / OOXML_EXTS，单独按内容判定。
  // Slice H2：真 OLE2/BIFF8 二进制先走直读（extractLegacyXlsGrid）；失败或缺结构时
  // 再回退 extractLegacyXlsText（HTML / 文本表格；对 OLE2 恒返回 null → 不可读指引）。
  if (ext === '.xls') {
    if (file.size > FILE_EXCERPT_MAX_BYTES) return `【附件】${meta}${FILE_UNREADABLE_HINT}`
    const filePath = path.join(DATA_DIR, 'files', `${item.id}-${file.name}`)
    try {
      const buf = await fs.readFile(filePath)
      const grid = isOle2(buf) ? extractLegacyXlsGrid(buf) : null
      const text = grid !== null ? grid : extractLegacyXlsText(buf)
      if (text === null) return `【附件】${meta}${FILE_UNREADABLE_HINT}`
      return `【附件】${meta}\n内容摘录（前 ${FILE_EXCERPT_CHARS} 字）：\n${text.slice(0, FILE_EXCERPT_CHARS)}`
    } catch {
      return `【附件】${meta}${FILE_UNREADABLE_HINT}`
    }
  }
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

/** 资料小结硬上限（汉字 / 字符数；Slice R2.5） */
export const AI_RESOURCE_NOTE_MAX_CHARS = 120

/**
 * 资料小结归一化（Slice R2.5）：折叠空白 → 截断 ≤120 字；模型输出为空时用调用方兜底
 * （文件名保守概括）。导出供单测。
 */
export function normalizeResourceNote(raw, fallback = '') {
  const collapse = (value) => String(value ?? '').replace(/\s+/g, ' ').trim()
  let note = collapse(raw)
  if (note === '') note = collapse(fallback)
  return Array.from(note).slice(0, AI_RESOURCE_NOTE_MAX_CHARS).join('')
}

/* ---------------------------------------------------------------------------
 * 链接阅读（v0.5 · Slice N2）：系统首次「出站抓取」——收件箱文本条目含 http(s) 链接时，
 * 解析前在服务端抓首个链接的网页正文（纯文本摘录）注入解析上下文，并让 resource 动作带 url。
 * 安全纪律（越界即拒，绝不抛出）：
 * - 仅 http / https；私网 / 环回 / 链路本地 hostname 直接拒绝且不发请求（SSRF 防护）；
 * - 8s AbortController 超时；仅 text/html / application/xhtml+xml / text/plain；
 * - 流式读取上限 2MB（超限截断后继续解析）；导出供探测复用。
 * 注：个人本地工具，出站请求使用常规桌面浏览器 UA + Accept-Language，仅降低被反爬直接拒绝的概率，
 *     不代表任何自动爬取意图；结果只注入本机 AI 解析上下文，不落盘、不外传。
 * ------------------------------------------------------------------------- */

/** 链接抓取超时（毫秒） */
const LINK_FETCH_TIMEOUT_MS = 8000
/** 链接抓取响应流上限（字节）；超限截断后继续解析 */
const LINK_FETCH_MAX_BYTES = 2 * 1024 * 1024
/** 链接抓取最大重定向跳数（安全加固：每跳重新校验私网，防重定向绕过） */
const LINK_MAX_REDIRECTS = 3
/** 链接正文摘录上限（字符；汉字 / 字符数） */
const LINK_EXCERPT_MAX_CHARS = 8000
/** 网页标题上限（字符） */
const LINK_TITLE_MAX_CHARS = 200
/** 常规桌面浏览器 UA（降低被反爬直接拒绝的概率；个人本地工具） */
const LINK_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
/** 正文抽取时视为块级分隔的标签（开 / 闭标签都映射为换行） */
const LINK_BLOCK_TAGS =
  'address|article|aside|blockquote|dd|div|dl|dt|fieldset|figcaption|figure|footer|form|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|table|tbody|td|tfoot|th|thead|tr|ul'

/**
 * 从字符串中提取首个 http(s) URL（保守正则；Slice N2）。
 * 终止于空白、CJK 字符 / 常用中英文标点；再剥掉收尾 ASCII 标点；无法解析为 http(s) URL → null。
 * 导出供单测 / 探测复用。绝不抛出。
 * @param {unknown} text
 * @returns {string | null}
 */
export function extractFirstUrl(text) {
  const source = String(text ?? '')
  // 遇到空白 / 中日韩字符 / 常用中英文标点即停止（不做 URL 内部还原，保守优先）
  const match = /https?:\/\/[^\s\u3000-\u303f\u4e00-\u9fff\uff00-\uffef()\]】》」』"'`<>}]*/i.exec(source)
  if (match === null) return null
  const url = match[0].replace(/[.,;:!?]+$/u, '')
  if (url.length <= 8) return null // 仅 "https://" 空壳
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return url
  } catch {
    return null
  }
}

/**
 * 私网 / 环回 / 链路本地 hostname 判定（Slice N2 SSRF 防护）：
 * localhost（含子域）/ ::1 / 0.0.0.0 / 127.* / 10.* / 172.16-31.* / 192.168.* / 169.254.* → true。
 * @param {string} hostname URL.hostname（IPv6 可能带方括号）
 * @returns {boolean}
 */
function isPrivateHostname(hostname) {
  const host = String(hostname ?? '')
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
  if (host === '') return true
  if (host === 'localhost' || host.endsWith('.localhost')) return true
  if (host === '::1') return true
  // IPv4-mapped IPv6（如 [::ffff:127.0.0.1]）：解出内嵌 IPv4 再判定
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(host)
  if (mapped !== null) return isPrivateHostname(mapped[1])
  // 十六进制分组的映射形式（如 [::ffff:7f00:1]）
  const hexMapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host)
  if (hexMapped !== null) {
    const hi = Number.parseInt(hexMapped[1], 16)
    const lo = Number.parseInt(hexMapped[2], 16)
    return isPrivateHostname(`${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`)
  }
  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (ipv4 !== null) {
    const a = Number(ipv4[1])
    const b = Number(ipv4[2])
    if (a === 0) return true
    if (a === 127) return true
    if (a === 10) return true
    if (a === 172 && b >= 16 && b <= 31) return true
    if (a === 192 && b === 168) return true
    if (a === 169 && b === 254) return true
  }
  return false
}

/**
 * 流式读取响应体，上限 maxBytes（Slice N2）：reader 循环，达上限即截断并 cancel。
 * @param {Response} response
 * @param {number} maxBytes
 * @returns {Promise<Buffer | null>} 读取失败返回 null
 */
async function readBodyLimited(response, maxBytes) {
  if (response.body === null || response.body === undefined) {
    const buf = Buffer.from(await response.arrayBuffer())
    return buf.subarray(0, maxBytes)
  }
  const reader = response.body.getReader()
  const chunks = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined || value === null) continue
      const chunk = Buffer.from(value)
      if (total + chunk.length >= maxBytes) {
        chunks.push(chunk.subarray(0, maxBytes - total))
        try {
          await reader.cancel()
        } catch {
          /* 忽略取消错误 */
        }
        break
      }
      chunks.push(chunk)
      total += chunk.length
    }
  } catch {
    try {
      await reader.cancel()
    } catch {
      /* 忽略取消错误 */
    }
    return null
  }
  return Buffer.concat(chunks)
}

/**
 * charset 探测（Slice N2）：content-type → <meta charset> → 默认 utf8；gb2312 / gb18030 归一到 gbk。
 * @param {string} contentType 小写 content-type
 * @param {Buffer} bytes 响应体（截断后）
 * @returns {string} 规范化 charset 标签
 */
function detectCharset(contentType, bytes) {
  let charset = /charset=["']?([\w-]+)/i.exec(String(contentType ?? ''))?.[1] ?? ''
  if (charset === '') {
    const head = bytes.subarray(0, Math.min(bytes.length, 4096)).toString('latin1')
    const meta = /<meta[^>]+charset=["']?([\w-]+)/i.exec(head)
    if (meta !== null) charset = meta[1]
  }
  charset = charset.toLowerCase()
  if (charset === 'gb2312' || charset === 'gb18030') return 'gbk'
  return charset === '' ? 'utf8' : charset
}

/** 按 charset 解码字节（未知标签回退 utf8；绝不抛出） */
function decodeBytes(bytes, charset) {
  const label = charset === 'gbk' ? 'gbk' : charset === 'utf8' || charset === 'utf-8' ? 'utf-8' : charset
  try {
    return new TextDecoder(label).decode(bytes)
  } catch {
    return bytes.toString('utf8')
  }
}

/** 抽取 <title>（解实体 + 归一空白 + 截断 ≤200 字）；无 → 空串 */
function extractHtmlTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html ?? ''))
  if (match === null) return ''
  const title = decodeXmlEntities(match[1]).replace(/\s+/g, ' ').trim()
  return Array.from(title).slice(0, LINK_TITLE_MAX_CHARS).join('')
}

/**
 * HTML → 文章正文纯文本（Slice N2）：删 script/style/noscript/注释/svg；块级标签 → 换行；
 * 剥其余标签；解实体；折叠空白与连续空行；输出截断 ≤8000 字。导出供单测 / 探测复用。
 * @param {unknown} html
 * @returns {string}
 */
export function htmlToArticleText(html) {
  let s = String(html ?? '')
  s = s.replace(/<!--[\s\S]*?-->/g, ' ')
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
  s = s.replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
  s = s.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
  s = s.replace(/<svg\b[\s\S]*?<\/svg>/gi, ' ')
  // 块级标签 → 换行（开 / 闭标签都算边界）；<br> 单独处理
  s = s.replace(new RegExp(`</?(?:${LINK_BLOCK_TAGS})\\b[^>]*>`, 'gi'), '\n')
  s = s.replace(/<br\s*\/?>/gi, '\n')
  // 其余标签剥除
  s = s.replace(/<[^>]*>/g, ' ')
  s = decodeXmlEntities(s).replace(/\r\n?/g, '\n')
  const lines = s.split('\n').map((line) => line.replace(/[\t\u00a0 ]+/g, ' ').trim())
  const folded = []
  for (const line of lines) {
    if (line === '' && (folded.length === 0 || folded[folded.length - 1] === '')) continue
    folded.push(line)
  }
  const text = folded.join('\n').trim()
  return Array.from(text).slice(0, LINK_EXCERPT_MAX_CHARS).join('')
}

/**
 * 受限抓取：手动处理重定向，每一跳都重新校验协议与私网 hostname（安全加固，防重定向绕过 SSRF）。
 * 最多 LINK_MAX_REDIRECTS 跳；拒绝 / 超跳 / 异常返回 null。绝不抛出。
 * @param {string} startUrl 起始 URL
 * @param {AbortSignal} signal 超时信号
 * @returns {Promise<{ response: Response, url: URL } | null>}
 */
async function fetchLinkLimited(startUrl, signal) {
  let current = startUrl
  for (let i = 0; i <= LINK_MAX_REDIRECTS; i += 1) {
    let parsed
    try {
      parsed = new URL(current)
    } catch {
      return null
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    if (isPrivateHostname(parsed.hostname)) return null
    const response = await fetch(parsed.toString(), {
      method: 'GET',
      redirect: 'manual',
      signal,
      headers: {
        'User-Agent': LINK_USER_AGENT,
        'Accept-Language': 'zh-CN,zh;q=0.9',
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5',
      },
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (location === null || location === '') return null
      // 相对跳转按当前 URL 解析；下一轮循环再校验 hostname
      current = new URL(location, parsed).toString()
      continue
    }
    return { response, url: parsed }
  }
  return null
}

/**
 * 抓取首个链接的网页正文摘录（Slice N2）。绝不抛出：
 * @param {string} url 目标链接（仅 http / https；私网 / 环回直接拒绝，不发请求）
 * @returns {Promise<{ url: string, title: string, text: string } | null>}
 */
export async function fetchLinkExcerpt(url) {
  let parsed
  try {
    parsed = new URL(String(url))
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (isPrivateHostname(parsed.hostname)) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), LINK_FETCH_TIMEOUT_MS)
  try {
    const fetched = await fetchLinkLimited(parsed.toString(), controller.signal)
    if (fetched === null) return null
    const { response, url: finalUrl } = fetched
    if (!response.ok) return null
    const contentType = String(response.headers.get('content-type') ?? '').toLowerCase()
    if (
      !contentType.includes('text/html') &&
      !contentType.includes('application/xhtml+xml') &&
      !contentType.includes('text/plain')
    ) {
      return null
    }
    const bytes = await readBodyLimited(response, LINK_FETCH_MAX_BYTES)
    if (bytes === null || bytes.length === 0) return null
    const charset = detectCharset(contentType, bytes)
    let html = decodeBytes(bytes, charset)
    // utf8 结果出现过多替换字符 → 回退 gbk
    if (charset !== 'gbk' && isGarbledText(html)) {
      try {
        const gbk = new TextDecoder('gbk').decode(bytes)
        if (!isGarbledText(gbk)) html = gbk
      } catch {
        /* 保留 utf8 结果 */
      }
    }
    const title = extractHtmlTitle(html)
    const text = htmlToArticleText(html)
    if (text === '') return null
    return { url: finalUrl.toString(), title, text }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 链接摘录注入段（Slice N2）：抓取成功 → 【链接摘录】；失败 → 【链接】保守提示；无链接 → 空串。
 * @param {string} content 条目原文
 * @returns {Promise<{ section: string, linkUrl: string | null }>}
 */
async function buildLinkSection(content) {
  const url = extractFirstUrl(content)
  if (url === null) return { section: '', linkUrl: null }
  const link = await fetchLinkExcerpt(url)
  if (link !== null) {
    return {
      section: `【链接摘录】（${url}）\n${link.title}\n${link.text}`,
      linkUrl: url,
    }
  }
  return { section: `【链接】${url}（自动抓取未成功——按链接保守处理）`, linkUrl: url }
}

/**
 * 确定性兜底（Slice N2）：命中链接且首个 resource 动作无 url 时补上（URL 须 ≤2000）。
 * @param {object[]} actions postValidateActions 产物（就地修改）
 * @param {string | null} linkUrl
 */
function applyLinkUrlFallback(actions, linkUrl) {
  if (linkUrl === null || linkUrl.length > 2000) return
  const firstResource = actions.find((action) => action.kind === 'resource')
  if (firstResource !== undefined && typeof firstResource.url !== 'string') {
    firstResource.url = linkUrl
  }
}

/* ---------------------------------------------------------------------------
 * 联网检索（v0.5 · Slice N9）：模型在解析中「请求检索」时，先搜索再回喂一次（同会话）。
 * 纪律：与 N2 出站抓取同族——仅访问固定的搜索引擎主机（Sogou 主 / 360 次 / Bing 备，N9.1）；
 *       相关性过滤拒收限流泛化结果；首条结果页正文摘录复用 N2 的 fetchLinkExcerpt；
 *       12s 超时；结果仅作解析上下文（不落盘、无审计）；任何失败 → 降级，绝不抛错。
 * ------------------------------------------------------------------------- */

/** 单次解析最多执行的检索问题数 */
export const SEARCH_MAX_QUERIES = 2
/** 搜索请求超时（毫秒） */
const SEARCH_TIMEOUT_MS = 12_000
/** 搜索引擎请求 UA（常规桌面浏览器） */
const SEARCH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
/** 每个问题保留的结果条数 */
const SEARCH_MAX_RESULTS = 5
/** 单条 snippet 字符上限 */
const SEARCH_SNIPPET_MAX = 300
/** N9.1：首条结果页正文摘录字符上限 */
const SEARCH_PAGE_EXCERPT_MAX = 900
/** 注入段落总字符上限 */
const SEARCH_SECTION_MAX = 2600

/** 提取片段清洗：去脚本 / 样式 / 标签 / 实体，折叠空白并截断 */
function cleanFragment(html, max = SEARCH_SNIPPET_MAX) {
  return String(html ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#x?[0-9a-fA-F]+;/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)
}

/** Sogou SERP 提取（主引擎）：vrwrap 块 → title / url / snippet（≤max 条） */
export function extractSogouResults(html, max = SEARCH_MAX_RESULTS) {
  const out = []
  const parts = String(html ?? '').split(/<div[^>]*class="vrwrap/)
  for (const part of parts.slice(1)) {
    if (out.length >= max) break
    const link = part.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (link === null) continue
    const title = cleanFragment(link[2], 120)
    if (title === '') continue
    const body = part.split(/<div[^>]*class="vrwrap/)[0]
    const p = body.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    const snippet = cleanFragment(p === null ? body : p[1])
    let url = String(link[1] ?? '').trim()
    if (url.startsWith('/')) url = `https://www.sogou.com${url}`
    out.push({ url, title, snippet })
  }
  return out
}

/** Bing SERP 提取（备用引擎）：b_algo 块 → title / url / snippet（≤max 条） */
export function extractBingResults(html, max = SEARCH_MAX_RESULTS) {
  const out = []
  const parts = String(html ?? '').split(/<li class="b_algo"/)
  for (const part of parts.slice(1)) {
    if (out.length >= max) break
    const link = part.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (link === null) continue
    const title = cleanFragment(link[2], 120)
    if (title === '') continue
    const body = part.split(/<li class="b_algo"/)[0]
    const p = body.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    out.push({ url: String(link[1] ?? ''), title, snippet: p === null ? '' : cleanFragment(p[1]) })
  }
  return out
}

/** 360 搜索 SERP 提取（次引擎，N9.1）：res-list 块 → title / url / snippet（≤max 条） */
export function extract360Results(html, max = SEARCH_MAX_RESULTS) {
  const out = []
  const parts = String(html ?? '').split(/<li[^>]*class="res-list/)
  for (const part of parts.slice(1)) {
    if (out.length >= max) break
    const link = part.match(/<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (link === null) continue
    const title = cleanFragment(link[2], 120)
    if (title === '') continue
    const p = part.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    out.push({ url: String(link[1] ?? ''), title, snippet: p === null ? '' : cleanFragment(p[1]) })
  }
  return out
}

/** 抓取搜索引擎 SERP HTML（固定主机；失败抛出由调用方降级） */
async function fetchSearchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': SEARCH_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
    redirect: 'follow',
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  })
  return await res.text()
}

/** 检索通用词（二元组）——命中这些词不构成“相关”（防限流泛化页混入） */
const SEARCH_GENERIC_BIGRAMS = new Set([
  '时间', '考试', '报名', '全国', '大学', '今年', '安排', '通知', '怎么', '什么', '多少', '如何', '查询', '信息', '官网', '最新',
])

/** 检索词区分度令牌：CJK 二元组（去通用词）+ 拉丁词（≥3 字符，忽略纯数字） */
function searchTokens(query) {
  const tokens = new Set()
  for (const run of String(query).match(/[\u4e00-\u9fa5]+/g) ?? []) {
    for (let i = 0; i + 2 <= run.length; i += 1) {
      const bigram = run.slice(i, i + 2)
      if (!SEARCH_GENERIC_BIGRAMS.has(bigram)) tokens.add(bigram)
    }
  }
  for (const word of String(query).match(/[a-zA-Z0-9]{3,}/g) ?? []) {
    if (!/^\d+$/.test(word)) tokens.add(word.toLowerCase())
  }
  return tokens
}

/** 相关性过滤：title/snippet 至少命中一个检索令牌；无令牌（异常查询）时原样放行 */
function filterRelevantResults(results, tokens) {
  if (tokens.size === 0) return results
  return results.filter((r) => {
    const text = `${r.title} ${r.snippet}`.toLowerCase()
    for (const token of tokens) if (text.includes(token.toLowerCase())) return true
    return false
  })
}

/** 结果页摘录：优先从首个检索词命中处前 80 字起截取，否则取开头（≤ SEARCH_PAGE_EXCERPT_MAX） */
function pageExcerpt(text, tokens) {
  const src = String(text ?? '')
  let idx = -1
  for (const token of tokens) {
    const found = src.toLowerCase().indexOf(token.toLowerCase())
    if (found >= 0 && (idx === -1 || found < idx)) idx = found
  }
  const start = idx === -1 ? 0 : Math.max(0, idx - 80)
  return src.slice(start, start + SEARCH_PAGE_EXCERPT_MAX)
}

/**
 * 网页检索（N9.1：Sogou 主 / 360 次 / Bing 备）：逐引擎尝试并用相关性令牌过滤；
 * 限流泛化结果（不含任何检索令牌）视为该引擎失败 → 换下一引擎；全部无果返回 []，绝不抛出。
 * @param {string} query 检索问题（≤60 字）
 */
export async function searchWeb(query) {
  const q = String(query ?? '').trim().slice(0, 60)
  if (q === '') return []
  const tokens = searchTokens(q)
  const attempts = [
    ['sogou', `https://www.sogou.com/web?query=${encodeURIComponent(q)}`, extractSogouResults],
    ['so360', `https://www.so.com/s?q=${encodeURIComponent(q)}`, extract360Results],
    ['bing', `https://cn.bing.com/search?q=${encodeURIComponent(q)}`, extractBingResults],
  ]
  for (const [engine, url, extract] of attempts) {
    try {
      const html = await fetchSearchHtml(url)
      const relevant = filterRelevantResults(extract(html), tokens)
      console.log(`[ai] search「${q}」${engine} → ${relevant.length} 条`)
      if (relevant.length > 0) return relevant
    } catch (err) {
      console.warn(`[ai] search「${q}」${engine} 失败：${err?.message ?? err}`)
    }
  }
  return []
}

/**
 * 构造【联网检索】注入段落：对模型请求的问题（≤2）逐条搜索并汇编；
 * 返回 { section, queries, ok }——ok 表示至少一条问题取到了结果（决定是否回喂第二轮）。
 */
export async function buildSearchSection(queries) {
  const list = []
  for (const raw of Array.isArray(queries) ? queries : []) {
    const q = String(raw ?? '').trim()
    if (q !== '' && !list.includes(q)) list.push(q)
    if (list.length >= SEARCH_MAX_QUERIES) break
  }
  if (list.length === 0) return { section: '', queries: [], ok: false }
  const lines = ['【联网检索】（系统刚刚为你检索的网页摘要，可能不完整；只可据此修正时间与事实，不得编造）']
  let ok = false
  for (const q of list) {
    let results = []
    try {
      results = await searchWeb(q)
    } catch {
      results = []
    }
    if (results.length === 0) {
      lines.push(`问题「${q}」：（未取得结果）`)
      continue
    }
    ok = true
    lines.push(`问题「${q}」：`)
    for (const r of results) lines.push(`- ${r.title}｜${r.snippet}`)
    // N9.1：补充首条结果页正文摘录（复用 N2 抓取；失败 / 安全拒抓一律静默跳过）
    const page = await fetchLinkExcerpt(results[0].url)
    if (page !== null) {
      lines.push(`（首条结果页摘录）${pageExcerpt(page.text, searchTokens(q))}`)
    }
  }
  let section = lines.join('\n')
  if (section.length > SEARCH_SECTION_MAX) section = section.slice(0, SEARCH_SECTION_MAX)
  return { section, queries: list, ok }
}

/** 构造系统提示词（注入当前本地时间 + 系统现状摘要 + 一揽子动作规则；Slice N0 增通知三性与截图） */
function buildSystem(digest, hasFile = false, contextNames = [], opts = {}) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  const isImage = opts.isImage === true
  // 文件硬归一化（资料 + 简介）仅适用于「非图片」附件；图片按文本多动作管线处理（Slice N0）
  const fileMode = hasFile && !isImage
  const head = fileMode
    ? `你是 KERNEL 个人事务系统的收件箱解析器。本条是一个【文件投递】条目：它应当被收录为一条「资料」，并配一段用于资料详情页的「简介」，绝不拆分成任务 / 笔记 / 项目。
只输出一个 JSON 对象：{ "summary": "…", "actions": [ ... ] }，不要 markdown 代码块、不要解释、不要多余文字。
summary 为必出项：用一句话概括本条内容（≤40 字，单行）。`
    : `${isImage ? '本条是一个【截图投递】条目：附件为图片，请直接读取图片内容并解析。\n' : ''}你是 KERNEL 个人事务系统的收件箱解析器。把用户丢进来的内容拆解为「一揽子处置动作」，交给用户一次确认后全部落位。
只输出一个 JSON 对象：{ "summary": "…", "actions": [ ... ], "facts": [ "…" ], "searchQueries": [ "…" ] }，不要 markdown 代码块、不要解释、不要多余文字。
summary 为必出项：用一句话概括本条内容（≤40 字，单行）。`
  const rules = fileMode
    ? `规则（本条带【附件】——按「资料 + 简介」处理，绝不拆分）：
1. 恰好输出 1 个动作，kind 必须为 "resource"；禁止输出 task / note / project / event。
2. title：资料名（≤40 字），通常取文件名或内容主题。
3. note：1–3 句、≤${AI_RESOURCE_NOTE_MAX_CHARS} 字的简约小结，作为资料详情页「简介」（概括这是什么资料、讲了什么、有什么用）。必须基于【附件】内容摘录；若内容不可读，仅据文件名保守概括，并在小结中注明「仅据文件名」。
4. tags：优先从下方【标签】选已有名；仅当确无合适已有标签时提议 "topic:名称"（≤12 字）；最多 3 个；无把握省略。areaId 仅在明确属于某区域时填。
5. 不要输出 outcome / linkToNewProject / duplicateOf 或任务专属字段。
6. summary（顶层）为必出项：用一句话概括本条资料是什么 / 讲了什么（≤40 字，单行）。`
    : `规则：
1. 宁少而精：通常 1–4 个动作，最多 6 个。优先「资料 / 笔记 + 一句小结」；仅对明确可执行的事产出 task，绝不为凑数把同一件事拆成一堆细小任务。
2. 纯信息 / 资料类内容（链接、文章、规则、通知正文）：优先产出 1 个 resource（带 note 小结）或 1 个 note（正文含要点），不要硬拆成任务。若上方提供了【链接摘录】，resource 的 note 必须基于摘录实际内容撰写（这是什么/讲了什么/有什么用），禁止再写「未能读取」式保守话术。
3. 确实无事可做（纯寒暄 / 无价值信息）时返回 { "actions": [] }。
4. 挂靠宁缺毋滥：projectId / areaId / duplicateOf 只能取摘要中列出的 id，且必须有明确依据；表面相似（例如都含「竞赛 / 比赛 / 规则」字样）不算依据；拿不准一律省略。tags 优先取摘要中已有的标签名（先对照【标签】列表，近义 / 同类直接复用现名）；若内容是日常活动类型（吃饭 / 聚餐 / 面试 / 考试 / 运动 / 开会等）且确无合适已有标签，可提议对应的活动标签（如 "topic:吃饭"）；此外仅当新标签是稳定主题词（学科 / 领域，如「线性代数」「合唱排练」）时才提议（写成 "topic:名称"，≤12 字）；禁止把日期、人名、整句话或临时描述当标签。生成 tags / projectId 前先看【项目】【标签】：明显属于某现有项目（同课程 / 同赛事 / 同组织 / 同一件事）就填 projectId。
5. 最多一个新项目：整包中 kind:"project" 至多出现 1 次，且仅当内容像一件需要多步推进的新事务（新比赛 / 新活动 / 新项目）时才产出；若属于现有项目，改填 projectId。
6. 新项目与现有项目互斥：挂现有项目就填 projectId；新建项目就用 kind:"project" + 让相关 task/note 填 linkToNewProject:true，绝不同时填 projectId 和 linkToNewProject。
7. 通知 / 公告识别：若内容像「通知 / 公告 / 群消息」（含日期、面向群体的安排、要求或须知），按三性处理后再产出：
   硬事实（放假与调课安排、时间地点、报名或截止日期等客观信息）→ 写入顶层 facts 数组，不产实体；每条一句话、必须含具体日期或关键数字、不超过 140 字，例：「国庆放假：10月1日–7日调休共7天；10月10日（周六）补课，执行10月7日（周三）教学安排」。
   需要做的事（报备、提交、申请、报名等必须完成的动作）→ 产出 kind:"task" 动作；若该义务只对部分人成立，condition 写清适用条件（不超过 30 字，如「仅出国（境）者」「仅留校学生」）；确实对所有人成立的义务可省略 condition。
   纯建议 / 提醒 / 安全须知（防蚊、饮食、防溺水宣传等）→ 默认不产出任何动作；仅当某条具体、可操作、值得保留时，才作为一条 facts 写入。
8. facts 宁少而精：最多 8 条，只保留对个人有用的硬信息；与普通学生无关的泛泛内容不要写。actions 仍遵守第 1 条（通常 1–4 个，最多 6 个）。
9. 图片条目（QA v74）：附件是图片时，**始终额外产出 1 个 kind:"resource" 动作收录图片本身**——title 取内容主题或文件名；note 为 1–3 句、≤${AI_RESOURCE_NOTE_MAX_CHARS} 字的「简介」（概括图片内容与用途，作为资料详情页简介）；同时按本条（文本规则）解析图片中的信息，多动作产出（task / note / event / facts 等）。图片作为文字辅助时两者都要：内容动作 + 图片资料；仅为留存资料时 resource 单条即可。
10. summary（顶层）为必出项：一句话概括本条（≤40 字、单行；多要点用「 · 」分隔，含关键时间 / 事项）；不得引入原文没有的信息、不得整句照抄。例：内容混合（面试 + 项目 + 学习 + 简历）→「10/7 晚面试 · 院长项目 · Python 学习 · 简历投递」。
11. 联网检索：若内容涉及你无法确定的外部事实（未来考试 / 报名 / 活动 / 政策的具体日期与安排），先把要检索的问题写入顶层 searchQueries（≤2 条、中文关键词、含年份与机构名，如「2026年下半年 全国大学英语四级考试 时间」）；此时相关动作的 dueAt 等时间字段先省略（系统会先检索、再把结果发给你，随后你补全）。无需检索时省略该字段。绝不编造未来日期。
12. 定点安排识别：会在某个时刻「发生」的事（面试 / 会议 / 考试 / 约谈 / 活动 / 演出 / 用餐 / 聚会等）→ 产出 kind:"event"，startAt 为 ISO8601 带时区（必填，如 2026-10-07T19:00:00+08:00）。
    · 时间补全（系统认可的默认值，不算编造）：有日期（含今天 / 明天 / 后天 / 周X 等相对日）但只有模糊时段词时，按默认钟点补全——早上 08:00 · 上午 09:30 · 中午 12:00 · 下午 14:30 · 傍晚 17:30 · 晚上 / 今晚 19:30；用餐语境：早饭 07:30 · 午饭 12:00 · 晚饭 / 晚餐 18:00 · 夜宵 21:30。例：「今晚去某餐厅吃自助」→ 今天 18:00；「明晚开会」→ 明天 19:30；「周六下午打球」→ 本周六 14:30。
    · 明确给出起止时间才填 endAt（须 ≥ startAt）；只有日期没有时段词 → allDay:true（startAt 仍填当天 00:00）；连日期都无法推出 → 不产出 event（宁可 task + facts）。
    · 地点提取：内容含具体场所 / 店名 / 房间名（如「某餐厅」「某教室」）时填入该 event 的 location（≤50 字，只写场所名）；无法确定则省略。
    · 「需要去做」的动作（准备 / 提交 / 监督 / 学习等）→ task；同一内容可以同时产出 event（发生的事）与 task（要做的准备），但不得重复拆条。
13. 踪迹识别（已完成动作留痕）：当内容是在**陈述「我刚刚 / 今天做了什么」**（一件已经做完的事，如「我刚刚跑完 5 公里」「今天把实验报告写完了」「给学弟讲完课了」）时 → 产出 kind:"trace"：title 为一句「我做了什么」（≤40 字）；可附 note 补充一句细节 / 感受；at 填发生时间（有时间词就填，否则省略 = 现在，无需编造）。trace 仅用于「已发生的动作留痕」，不要与 task（待办）/ note（需成文的感想 / 知识）/ event（将来的安排）混用；纯情绪 / 思考 / 感悟（如「今天心情很好，觉得…」）属于 note，不是 trace。`
  const summaryHint = `- summary: 本条内容的一句话摘要（顶层字段，≤40 字，单行；多要点用「 · 」分隔；含关键时间 / 事项；不得引入原文没有的信息；不得整句照抄，也不得写「该内容主要讲述了…」式套话）\n`
  const factsHint = fileMode
    ? ''
    : `- facts: 顶层字符串数组，≤8 条；硬事实 / 值得保留的提醒，每条 ≤140 字、含具体日期或数字\n`
  const conditionHint = fileMode
    ? ''
    : `\n- condition: 仅 task 用。该义务的适用条件（≤30 字）；只对部分人成立时必填（如「仅出国（境）者」）；对所有人成立则省略`
  return `${head}

每个 action 对象字段：
${summaryHint}${factsHint}- kind: "task" | "note" | "resource" | "project" | "event" | "trace"（必填）
- title: 提炼后的标题（不超过 40 字，必填）
- note: 仅 resource 用。1–3 句、不超过 ${AI_RESOURCE_NOTE_MAX_CHARS} 字的简约小结，作为资料详情页的「简介」（概括这是什么资料、讲了什么、有什么用）；附件条目必须给出此字段
- url: 仅 resource 用；条目包含网页链接时原样填入
- reason: 一句话说明该动作的判断理由
- contexts: 仅 task 用，字符串数组，只能从 [${contextRuleText(contextNames)}] 中选（无把握则省略）
- energy: 仅 task 用，"low" | "medium" | "high"
- importance: 仅 task 用，0 | 1 | 2 | 3（整数；0 = 最低 / 可略过的输入）
- estimateMin: 仅 task 用，预计所需分钟数（整数，最少 1 分钟）
- dueAt: 仅 task 用，ISO8601 带时区或 null；只有在原文或【联网检索结果】中有明确依据时才填。现在是 ${stamp}${conditionHint}
- startAt: 仅 event 用，ISO8601 带时区（必填；只有日期没有时间时填当天 00:00，并把 allDay 设为 true）
- endAt: 仅 event 用，可选；有明确结束时间才填（须 ≥ startAt）
- allDay: 仅 event 用，true = 只有日期、无具体时间
- location: 仅 event 用，可选（具体场所 / 店名 / 房间名，≤50 字；无法确定则省略）
- at: 仅 trace 用，ISO8601 带时区（发生时间；有明确时间词才填，否则省略 = 现在）
- projectId: 仅当有明确依据属于下方某个现有项目时填该项目 id；否则省略
- areaId: 仅当明确属于下方某个区域时填该区域 id；否则省略
- tags: 字符串数组。优先从下方【标签】中选已有标签名；仅当没有合适的已有标签、且该标签对日后检索明确有用时，才提出新标签名（写成 "topic:名称"，名称 ≤12 字）；每个动作最多 3 个，去重；无把握则空数组
- outcome: 仅 project 用，完成定义（一句话，说明「怎样算完成」）
- linkToNewProject: 仅 task / note 用。当本批次里有一个 kind:"project" 的新项目、且该动作应挂到它时填 true（此时不要填 projectId）
- duplicateOf: 仅 task 用，仅当与下方某个未完成任务高度可能重复时填该任务 id；否则省略

【系统现状摘要】
${digest}

${rules}`
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
 *
 * Slice R2.5 文件条目校准：`options.hasFile === true` 时**硬归一化**为恰好一个 resource 动作——
 * 丢弃全部 task / note / project，仅保留 kind:'resource' + title + note（小结，≤120 字）+
 * tags（≤3）+ areaId；模型未产出 resource 时用调用方提供的 fallbackTitle / fallbackNote 兜底
 * （基于文件名保守概括），保证「文件 = 资料 + 简介」不变式。
 * 导出供单测。返回清洗后的动作数组（可能为空）。
 */
export function postValidateActions(actions, snapshot, options = {}) {
  const projects = snapshot.projects ?? []
  const projectIds = new Set(projects.map((p) => p.id))
  const projectTitles = new Set(projects.map((p) => p.title))
  const areaIds = new Set((snapshot.areas ?? []).map((a) => a.id))
  const taskIds = new Set((snapshot.tasks ?? []).map((t) => t.id))
  const tagNames = new Set((snapshot.tags ?? []).map((t) => t.name))

  const cleaned = []
  for (const raw of (Array.isArray(actions) ? actions : []).slice(0, 6)) {
    const out = { ...raw }
    for (const key of ['projectId', 'areaId', 'duplicateOf', 'outcome', 'dueAt', 'estimateMin', 'energy', 'importance', 'note', 'condition', 'url', 'startAt', 'endAt', 'allDay', 'location', 'at']) {
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
    // note 仅 resource（简介）/ trace（补充）有意义：resource 折叠 + 截断 ≤120；trace 截断 ≤500；其余删除
    if (out.kind === 'resource') {
      const note = normalizeResourceNote(out.note, '')
      if (note === '') delete out.note
      else out.note = note
    } else if (out.kind === 'trace') {
      if (typeof out.note === 'string') {
        const note = out.note.trim()
        if (note === '') delete out.note
        else out.note = Array.from(note).slice(0, 500).join('')
      } else {
        delete out.note
      }
    } else {
      delete out.note
    }
    // url 仅 resource 有意义（Slice N2）：trim 后须 http(s) 开头且 ≤2000 字；否则删除
    if (out.kind === 'resource') {
      if (typeof out.url === 'string') {
        const url = out.url.trim()
        if (url === '' || !/^https?:\/\//i.test(url)) delete out.url
        else out.url = Array.from(url).slice(0, 2000).join('')
      } else {
        delete out.url
      }
    } else {
      delete out.url
    }
    // condition 仅 task 有意义（Slice N0）：非 task 清除；字符串 trim 后为空则清除
    // （≤30 字由 aiActionSchema 的 Zod 上限保证，此处不再截断）
    if (out.kind !== 'task') {
      delete out.condition
    } else if (typeof out.condition === 'string') {
      const condition = out.condition.trim()
      if (condition === '') delete out.condition
      else out.condition = condition
    }
    // Slice N10：event 清洗——startAt 无效 / 缺失 → 丢弃该动作；endAt 须 ≥ startAt 否则删除；
    // 非 event 动作一律剥离 event 专属字段
    if (out.kind === 'event') {
      const startTs = typeof out.startAt === 'string' ? Date.parse(out.startAt) : Number.NaN
      if (!Number.isFinite(startTs)) continue
      out.startAt = Array.from(String(out.startAt).trim()).slice(0, 40).join('')
      if (typeof out.endAt === 'string') {
        const endTs = Date.parse(out.endAt)
        if (!Number.isFinite(endTs) || endTs < startTs) delete out.endAt
        else out.endAt = Array.from(String(out.endAt).trim()).slice(0, 40).join('')
      } else {
        delete out.endAt
      }
      if (out.allDay !== true) delete out.allDay
      if (typeof out.location === 'string') {
        const location = out.location.trim()
        if (location === '') delete out.location
        else out.location = Array.from(location).slice(0, 60).join('')
      } else {
        delete out.location
      }
    } else {
      delete out.startAt
      delete out.endAt
      delete out.allDay
      delete out.location
    }
    // 「踪迹」清洗：at 可为空（缺省应用时刻）；给了但无效则删除（不因无效时间丢弃整条）
    if (out.kind === 'trace') {
      if (typeof out.at === 'string') {
        const at = out.at.trim()
        if (at === '' || !Number.isFinite(Date.parse(at))) delete out.at
        else out.at = Array.from(at).slice(0, 40).join('')
      } else {
        delete out.at
      }
    } else {
      delete out.at
    }
    cleaned.push(out)
  }

  // 文件条目（Slice R2.5）：只保留一个 resource 动作，绝不拆分；
  // 图片条目（Slice N0）走多动作管线，故显式排除（hasFile && !isImage 才归一化）
  if (options.hasFile === true && options.isImage !== true) {
    const raw = cleaned.find((a) => a.kind === 'resource')
    const fallbackTitle = Array.from(String(options.fallbackTitle ?? '').trim()).slice(0, 40).join('')
    const title = raw !== undefined && raw.title !== '' ? raw.title : fallbackTitle
    if (title === '') return []
    const out = {
      kind: 'resource',
      title,
      contexts: [],
      tags: raw?.tags ?? [],
      reason: raw?.reason ?? '',
    }
    if (raw?.areaId !== undefined) out.areaId = raw.areaId
    const note = normalizeResourceNote(raw?.note, options.fallbackNote)
    if (note !== '') out.note = note
    return [out]
  }

  // QA v74：图片条目始终保留一条「图片本身」的 resource（保证图片可作资料入库）；
  // 模型未产出时按文件名兜底补齐（简介用兜底文案），其余内容动作照常保留（多动作管线）。
  if (options.hasFile === true && options.isImage === true && !cleaned.some((a) => a.kind === 'resource')) {
    const fallbackTitle = Array.from(String(options.fallbackTitle ?? '').trim()).slice(0, 40).join('')
    const resource = { kind: 'resource', title: fallbackTitle !== '' ? fallbackTitle : '图片资料', contexts: [], tags: [], reason: '' }
    const note = normalizeResourceNote('', options.fallbackNote)
    if (note !== '') resource.note = note
    // 资源动作置首；总数保持 ≤6（与 aiActionsSchema / inboxApplySchema 上限对齐）
    cleaned.unshift(resource)
    if (cleaned.length > 6) cleaned.length = 6
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
      if (action.kind !== 'task' && action.kind !== 'note' && action.kind !== 'event') delete action.linkToNewProject
      else delete action.projectId // 与 projectId 互斥
    } else {
      delete action.linkToNewProject
    }
    out.push(action)
  }
  return out
}

/**
 * 顶层硬事实清洗（Slice N0）：trim → 丢弃空串 → 截断 ≤140 字 → 去重 → 取前 ≤8 条。
 * 返回数组；导出供单测。
 * @param {unknown} raw
 * @returns {string[]}
 */
export function cleanFacts(raw) {
  const seen = new Set()
  const out = []
  for (const value of Array.isArray(raw) ? raw : []) {
    const text = String(value ?? '').trim()
    if (text === '') continue
    const fact = Array.from(text).slice(0, 140).join('')
    if (seen.has(fact)) continue
    seen.add(fact)
    out.push(fact)
    if (out.length >= 8) break
  }
  return out
}

/**
 * 来源摘要清洗（v0.5 · Slice N4）：折叠所有空白（含换行）为单空格 → 去首尾 →
 * 去包裹引号 / 项目符号前缀 → 硬截断 40 字符（中文按字符）；拿不到合适内容时返回空串。
 * 两条解析路径（同步 / 流式）在 promptWithRetry 汇聚处统一调用。
 * 导出供单测。
 * @param {unknown} raw
 * @returns {string}
 */
export function cleanSummary(raw) {
  let text = String(raw ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  // 去包裹引号（中英文）/ 书名号与首尾空白
  text = text.replace(/^["'“”‘’《》]+/, '').replace(/["'“”‘’《》]+$/, '').trim()
  // 去项目符号 / 编号前缀（· • - * – — 及 1. 1) 1、）
  text = text.replace(/^[·•\-*–—]+\s*/, '').replace(/^\d+[.)、]\s*/, '').trim()
  if (text === '') return ''
  return Array.from(text).slice(0, 40).join('')
}

/** 解析 + 校验单次响应：接受 {actions:[...],facts:[...]} 或旧式单建议；返回 { ok, actions, facts } 或失败原因（导出供单测） */
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
      const parsed = aiActionsSchema.parse(obj)
      return { ok: true, actions: parsed.actions, facts: parsed.facts, summary: parsed.summary ?? '', searchQueries: parsed.searchQueries }
    }
    // 向后兼容：旧式单建议形状（无顶层 facts）
    const parsed = aiSuggestionSchema.parse(obj)
    return { ok: true, actions: legacyToActions(parsed), facts: [], summary: parsed.summary ?? '', searchQueries: [] }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/** 单次带超时的 prompt 调用（结果解包；默认模型由 serve 决定，不传 model/format） */
function promptOnce(sessionID, system, text, extraParts = []) {
  return withTimeout(
    getClient().session.prompt({
      sessionID,
      system,
      variant: 'low',
      parts: [{ type: 'text', text }, ...extraParts],
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
async function promptWithRetry(sessionID, system, userText, emit, extraParts = []) {
  let res = await promptOnce(sessionID, system, userText, extraParts)
  let parsed = tryParseActions(res)
  if (!parsed.ok) {
    if (emit) emit({ kind: 'retry', reason: parsed.reason })
    console.warn(`[ai] inbox.parse 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象（形如 {"actions":[...]}），不要任何多余文字。`,
      extraParts,
    )
    parsed = tryParseActions(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  // Slice N4：两条解析路径在此汇聚，summary 统一清洗一次（缺失 → ''）
  return { res, actions: parsed.actions, facts: parsed.facts, summary: cleanSummary(parsed.summary), searchQueries: parsed.searchQueries ?? [] }
}

/**
 * 文件条目解析的后校验选项（Slice R2.5）：hasFile + 文件名兜底标题 + 内容可读性兜底小结。
 * 图片条目（Slice N0 / QA v74）附 isImage=true：跳过「资料 + 简介」硬归一化（多动作管线），
 * 但 postValidateActions 仍保证补齐一条「图片本身」的 resource。
 * @param {{ file?: { name: string } } | null | undefined} item
 * @param {boolean} hasFile
 * @param {string} fileSection buildFileSection 的产物（含不可读提示则判为不可读）
 */
function fileParseOptions(item, hasFile, fileSection) {
  if (hasFile !== true) return { hasFile: false }
  const name = String(item?.file?.name ?? '')
  const unreadable = fileSection.includes(FILE_UNREADABLE_HINT)
  return {
    hasFile: true,
    isImage: isImageFile(item),
    fallbackTitle: path.parse(name).name,
    fallbackNote: unreadable
      ? `文件「${name}」已收录为资料；未能自动读取内容，建议打开文件核对。`
      : `文件「${name}」已收录为资料。`,
  }
}

/**
 * 图片附件 → opencode file part（data URL，Slice N0）。
 * 路径解析镜像 buildFileSection（data/files/<id>-<name>，不依赖 index.mjs）；
 * 读取失败返回 null（优雅降级为纯文本路径，不阻断解析）。
 * @param {{ id: string, file?: { name: string, mime?: string } }} item
 * @returns {Promise<{ type: 'file', mime: string, filename: string, url: string } | null>}
 */
async function buildImagePart(item) {
  const file = item?.file
  if (file === undefined || file === null) return null
  const filePath = path.join(DATA_DIR, 'files', `${item.id}-${file.name}`)
  let buf
  try {
    buf = await fs.readFile(filePath)
  } catch {
    return null
  }
  const ext = path.extname(String(file.name ?? '')).toLowerCase()
  const mime =
    typeof file.mime === 'string' && file.mime.startsWith('image/')
      ? file.mime
      : (IMAGE_MIME_BY_EXT[ext] ?? 'image/png')
  return {
    type: 'file',
    mime,
    filename: file.name,
    url: `data:${mime};base64,${buf.toString('base64')}`,
  }
}

/**
 * 图片分片 → opencode file parts（长截图）：前端把超长截图切成 ≤6 张 JPEG，
 * 服务端落盘为 data/files/<id>-ai-<n>.jpg；此处按序读取并发为多个 file part。
 * 若没有任何分片，回退单图路径 buildImagePart（兼容旧数据 / 未切片图片）。
 * 读取分片失败即停止（不跳过、不报错）。
 * @param {{ id: string, file?: { name: string, mime?: string } }} item
 * @returns {Promise<object[]>}
 */
async function buildImageParts(item) {
  if (item?.file === undefined || item?.file === null) return []
  const parts = []
  for (let n = 1; n <= 6; n += 1) {
    const name = `${item.id}-ai-${n}.jpg`
    let buf
    try {
      buf = await fs.readFile(path.join(DATA_DIR, 'files', name))
    } catch {
      break
    }
    parts.push({
      type: 'file',
      mime: 'image/jpeg',
      filename: name,
      url: `data:image/jpeg;base64,${buf.toString('base64')}`,
    })
  }
  if (parts.length > 0) return parts
  const single = await buildImagePart(item)
  return single === null ? [] : [single]
}

/**
 * 解析收件箱条目为 AI 建议（同步；Slice N0 增 facts 与图片截图投递）
 * @param {{ id: string, content: string, file?: { name: string, mime?: string } }} item
 * @returns {Promise<{ actions: object[], facts: string[], model: string | null, ms: number }>}
 */
export async function parseInboxItem(item) {
  const t0 = Date.now()
  const snapshot = await loadSnapshot()
  const fileSection = await buildFileSection(item)
  const hasFile = item?.file !== undefined && item?.file !== null
  const isImage = isImageFile(item)
  const imageParts = isImage ? await buildImageParts(item) : []
  const system = buildSystem(buildDigest(snapshot), hasFile, contextNamesOf(snapshot), { isImage })
  const sessionID = await createSession()
  // Slice N2：文本条目（无附件）含 http(s) 链接时，解析前抓取首个链接正文摘录注入上下文
  const link = hasFile ? { section: '', linkUrl: null } : await buildLinkSection(item.content)
  const userText =
    link.section !== ''
      ? `${item.content}\n\n${link.section}`
      : fileSection === ''
        ? item.content
        : `${item.content}\n\n${fileSection}`
  const extraParts = imageParts
  let parsed = await promptWithRetry(sessionID, system, userText, null, extraParts)
  // Slice N9：模型请求联网检索时，先检索（Sogou 主 / Bing 备），再把结果回喂一次（同会话）
  let searched = []
  if (parsed.searchQueries.length > 0) {
    const search = await buildSearchSection(parsed.searchQueries)
    if (search.ok) {
      try {
        const res2 = await promptOnce(
          sessionID,
          system,
          `${search.section}\n\n请基于以上检索结果修正并补全你的 JSON 输出（尤其 task 的 dueAt 与 facts 里的日期）。仍然只输出一个 JSON 对象，不要任何解释。`,
          extraParts,
        )
        const parsed2 = tryParseActions(res2)
        if (parsed2.ok) {
          parsed = { res: res2, actions: parsed2.actions, facts: parsed2.facts, summary: parsed2.summary, searchQueries: [] }
          searched = search.queries
        }
      } catch (err) {
        console.warn(`[ai] inbox.parse ${item.id} 检索回喂失败，沿用首轮结果：${err?.message ?? err}`)
      }
    } else {
      console.warn(`[ai] inbox.parse ${item.id} 检索未取得结果（${search.queries.join(' / ')}）`)
    }
  }
  const clean = postValidateActions(parsed.actions, snapshot, fileParseOptions(item, hasFile, fileSection))
  applyLinkUrlFallback(clean, link.linkUrl)
  const cleanFactList = cleanFacts(parsed.facts)
  const model = modelOf(parsed.res)
  const ms = Date.now() - t0
  console.log(
    `[ai] inbox.parse ${item.id} 完成 ${ms}ms（${model ?? '未知模型'} · ${clean.length} 动作 · ${cleanFactList.length} 事实 · 摘要${parsed.summary === '' ? '无' : `「${parsed.summary}」`}${searched.length > 0 ? ` · 检索${searched.length}条` : ''}）`,
  )
  return { actions: clean, facts: cleanFactList, summary: parsed.summary, model, ms, searched }
}

/**
 * 流式解析收件箱条目：先订阅事件流，边解析边 emit 过程事件。
 * @param {{ id: string, content: string }} item
 * @param {(event: object) => void} emit
 * 事件：{kind:'status',status} | {kind:'delta',field,delta} |
 *       {kind:'retry',reason} | {kind:'suggestion',actions,facts,model,ms} | {kind:'error',message}
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
    const fileSection = await buildFileSection(item)
    const hasFile = item?.file !== undefined && item?.file !== null
    const isImage = isImageFile(item)
    const imageParts = isImage ? await buildImageParts(item) : []
    const system = buildSystem(buildDigest(snapshot), hasFile, contextNamesOf(snapshot), { isImage })
    sessionID = await createSession()
    // Slice N2：文本条目（无附件）含 http(s) 链接时，解析前抓取首个链接正文摘录注入上下文
    const link = hasFile ? { section: '', linkUrl: null } : await buildLinkSection(item.content)
    const userText =
      link.section !== ''
        ? `${item.content}\n\n${link.section}`
        : fileSection === ''
          ? item.content
          : `${item.content}\n\n${fileSection}`
    const extraParts = imageParts
    let parsed = await promptWithRetry(sessionID, system, userText, safeEmit, extraParts)
    // Slice N9：模型请求联网检索时，先 emit「检索中」，再检索（Sogou 主 / Bing 备）并回喂一次（同会话）
    let searched = []
    if (parsed.searchQueries.length > 0) {
      safeEmit({ kind: 'status', status: 'searching' })
      const search = await buildSearchSection(parsed.searchQueries)
      if (search.ok) {
        try {
          const res2 = await promptOnce(
            sessionID,
            system,
            `${search.section}\n\n请基于以上检索结果修正并补全你的 JSON 输出（尤其 task 的 dueAt 与 facts 里的日期）。仍然只输出一个 JSON 对象，不要任何解释。`,
            extraParts,
          )
          const parsed2 = tryParseActions(res2)
          if (parsed2.ok) {
            parsed = { res: res2, actions: parsed2.actions, facts: parsed2.facts, summary: parsed2.summary, searchQueries: [] }
            searched = search.queries
          }
        } catch (err) {
          console.warn(`[ai] inbox.parse-stream ${item.id} 检索回喂失败：${err?.message ?? err}`)
        }
      } else {
        console.warn(`[ai] inbox.parse-stream ${item.id} 检索未取得结果（${search.queries.join(' / ')}）`)
      }
    }
    const clean = postValidateActions(parsed.actions, snapshot, fileParseOptions(item, hasFile, fileSection))
    applyLinkUrlFallback(clean, link.linkUrl)
    const cleanFactList = cleanFacts(parsed.facts)
    const model = modelOf(parsed.res)
    const ms = Date.now() - t0
    safeEmit({ kind: 'suggestion', actions: clean, facts: cleanFactList, summary: parsed.summary, model, ms, searched })
    console.log(
      `[ai] inbox.parse-stream ${item.id} 完成 ${ms}ms（${model ?? '未知模型'} · ${clean.length} 动作 · ${cleanFactList.length} 事实 · 摘要${parsed.summary === '' ? '无' : `「${parsed.summary}」`}${searched.length > 0 ? ` · 检索${searched.length}条` : ''}）`,
    )
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

/** 构造对话系统提示词（Slice G.1：读库 + 联网检索 + 自由回答 + markdown） */
function buildChatSystem(digest) {
  return `你是 KERNEL（个人事务内核）的对话助手。用户会用中文问你：他自己的事（如「我今天有什么特别紧急需要去做的事情」）、外部信息（如「今年四级考试是什么时候」）、或一般问题。
回答要求：
- 关于用户自己的事：依据下方【系统现状摘要】中的事实回答；摘要里没有的，直接说「数据里没有」，绝不编造用户的任务 / 日程 / 项目 / 时间。
- 一般知识与建议：可以直接自由回答（不限于摘要），但不得把猜测写成用户的数据。
- 需要外部事实才能回答准确时（最新政策 / 未来日期 / 公开资料等），**只输出一个 JSON**（不要任何其他文字）：{"searchQueries":["…","…"]}（≤2 条、中文关键词、含年份，如「2026年下半年 全国大学英语四级考试 时间」）。系统会先检索并把结果发给你，然后你再正式回答。**一次对话最多请求一次检索**。
- 当用户想了解某条记录（任务 / 日程 / 资料 / 笔记 / 项目等）的详细内容，或想修改它，而摘要信息不足时，**只输出一个 JSON**（不要任何其他文字）：{"entityQueries":["关键词","…"]}（1–3 条、每条 ≤30 字）；系统会把匹配到的完整记录发给你，你再回答或提出修改。**一次对话最多请求一次实体调取**。
- 当用户明确要求修改某条记录，且你已能确定唯一目标记录时，**只输出一个 JSON**（不要任何其他文字）：{"edit":{"kind":"task|event|note|resource|project|area|goal|habit|course","id":"…","fields":{"字段名":"新值"},"label":"一句话说明将做什么修改"}}。绝不在不确定时输出 edit（先向用户确认）；id 必须来自你已看到的记录，绝不编造；fields 只放需要修改的字段；修改需要用户确认后才会生效。
- 当用户**在陈述「我刚刚 / 今天做了什么」这类已经做完的事**（如「我刚刚跑完 5 公里」「今天把实验报告写完了」「给学弟讲完课了」）时，**只输出一个 JSON**（不要任何其他文字）：{"trace":{"title":"≤40 字，一句话我做了什么","note":"可选补充（≤200 字，可为空串）","at":"可选 ISO8601 带时区（原文有时间词才填，否则省略）"}}。系统会把它作为一条「踪迹」记录交用户确认后入库。**待办（task）、将来的安排（event）、纯粹的思考 / 感悟（该记进笔记的）不要当作 trace**，后者仍按「整理进笔记」流程处理。
- 若系统发来【实体记录】段落：只可据此回答 / 提出修改，不得编造；若用户要求修改，只输出上面的 edit JSON；否则正常用文字回答。
- 正式回答用中文 markdown 组织（小标题 / 列表 / 加粗均可），简洁、直接、可执行；不要输出 markdown 代码块包裹整篇。
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

/** 解析「检索请求」JSON（Slice G.1）：{"searchQueries":[...]} → 清洗后的查询数组；非该形状返回 null */
export function tryParseSearchRequest(reply) {
  const cleaned = String(reply ?? '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
  if (!cleaned.startsWith('{')) return null
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch {
    return null
  }
  if (obj === null || typeof obj !== 'object' || !Array.isArray(obj.searchQueries)) return null
  const queries = []
  for (const raw of obj.searchQueries) {
    const q = String(raw ?? '').trim()
    if (q !== '' && !queries.includes(q)) queries.push(Array.from(q).slice(0, 60).join(''))
    if (queries.length >= 2) break
  }
  return queries.length > 0 ? queries : null
}

/** 去掉包裹的 ```json 代码围栏（仅去首尾；非 JSON 原样返回） */
function stripJsonFence(reply) {
  return String(reply ?? '')
    .trim()
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/, '')
    .trim()
}

/** 解析「实体调取请求」JSON：{"entityQueries":[...]} → 清洗后的关键词数组；非该形状返回 null */
export function tryParseEntityRequest(reply) {
  const cleaned = stripJsonFence(reply)
  if (!cleaned.startsWith('{')) return null
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch {
    return null
  }
  if (obj === null || typeof obj !== 'object' || !Array.isArray(obj.entityQueries)) return null
  const queries = []
  for (const raw of obj.entityQueries) {
    const q = String(raw ?? '').trim()
    if (q === '') continue
    const clamped = Array.from(q).slice(0, 30).join('')
    if (clamped !== '' && !queries.includes(clamped)) queries.push(clamped)
    if (queries.length >= 3) break
  }
  return queries.length > 0 ? queries : null
}

/** 可编辑实体单数名白名单（与 EDITABLE_FIELDS 的复数键一一对应） */
const EDIT_REQUEST_KINDS = new Set(['task', 'event', 'note', 'resource', 'project', 'area', 'goal', 'habit', 'course'])
/** 实体 id 形状（与前端 / 服务端一致：前缀-四位数字） */
const EDIT_REQUEST_ID_RE = /^[a-z]+-\d{4}$/

/**
 * 解析「修改建议」JSON：{"edit":{kind,id,fields,label}} → 清洗后的对象；非该形状返回 null。
 * 只做浅层校验（kind / id 形状 / fields 键数）；深层字段合法性由 index.mjs 白名单过滤。
 */
export function tryParseEditRequest(reply) {
  const cleaned = stripJsonFence(reply)
  if (!cleaned.startsWith('{')) return null
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch {
    return null
  }
  const edit = obj === null || typeof obj !== 'object' ? null : obj.edit
  if (edit === null || typeof edit !== 'object' || Array.isArray(edit)) return null
  if (typeof edit.kind !== 'string' || !EDIT_REQUEST_KINDS.has(edit.kind)) return null
  if (typeof edit.id !== 'string' || !EDIT_REQUEST_ID_RE.test(edit.id)) return null
  const fields = edit.fields
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) return null
  const keys = Object.keys(fields)
  if (keys.length < 1 || keys.length > 12) return null
  const label = typeof edit.label === 'string' ? Array.from(edit.label).slice(0, 120).join('') : ''
  return { kind: edit.kind, id: edit.id, fields, label }
}

/** 实体调取：可检索集合（与 EDITABLE / 课程实体一致） */
const ENTITY_SEARCH_KINDS = ['tasks', 'events', 'notes', 'resources', 'projects', 'courses']
/** 实体集合 → 中文标签 */
const ENTITY_KIND_LABEL = {
  tasks: '任务',
  events: '日程',
  notes: '笔记',
  resources: '资料',
  projects: '项目',
  courses: '课程',
}
/** 【实体记录】段落硬上限（字符） */
const ENTITY_SECTION_MAX = 2500

/** 取记录标题（非字符串 → 空串） */
function entityTitleOf(record) {
  return typeof record?.title === 'string' ? record.title : ''
}

/** 标题匹配打分：完全一致 100 · 标题含查询 70 · 查询含标题 40（大小写不敏感；空值不计分） */
function scoreEntityTitle(title, query) {
  if (title === '' || query === '') return 0
  const t = title.toLowerCase()
  const q = query.toLowerCase()
  if (t === q) return 100
  if (t.includes(q)) return 70
  if (q.includes(t)) return 40
  return 0
}

/** 字段值 → 可读文本（字符串数组按逗号连接；对象 / 混合数组 JSON 化；失败返回空串） */
function serializeEntityField(value) {
  if (Array.isArray(value)) {
    if (value.every((v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) {
      return value.map((v) => String(v)).join(',')
    }
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  if (value !== null && typeof value === 'object') {
    try {
      return JSON.stringify(value)
    } catch {
      return ''
    }
  }
  return String(value)
}

/** 按码点截断字符串至 max */
function clampEntityText(text, max) {
  return Array.from(String(text)).slice(0, max).join('')
}

/** 单条实体 → 一行记录（跳过 id/createdAt/updatedAt；笔记正文单独放宽至 600 字） */
function formatEntityLine(kind, record) {
  const label = ENTITY_KIND_LABEL[kind] ?? kind
  const parts = []
  for (const [key, value] of Object.entries(record)) {
    if (key === 'id' || key === 'createdAt' || key === 'updatedAt') continue
    if (key === 'body') continue
    if (value === undefined || value === null) continue
    const text = serializeEntityField(value)
    if (text === '') continue
    parts.push(`${key}=${clampEntityText(text, 200)}`)
  }
  if (kind === 'notes' && typeof record.body === 'string' && record.body !== '') {
    parts.push(`body=${clampEntityText(record.body, 600)}`)
  }
  return `- ${label} ${record.id}「${entityTitleOf(record)}」：${parts.join(' · ')}`
}

/**
 * 按关键词在收件箱外的实体集合里检索完整记录：每问取高分前 3、跨问按 id 去重、总上限 6。
 * 返回 { section, titles }：section 为注入段（无匹配则为空串），titles 为命中标题（去重 ≤6）。
 * @param {object} snapshot 数据快照
 * @param {string[]} queries 关键词（1–3 条）
 * @returns {{ section: string, titles: string[] }}
 */
export function resolveEntities(snapshot, queries) {
  const list = Array.isArray(queries)
    ? queries.map((q) => String(q ?? '').trim()).filter((q) => q !== '')
    : []
  const seen = new Set()
  const matched = []
  for (const q of list) {
    const scored = []
    for (const kind of ENTITY_SEARCH_KINDS) {
      const arr = snapshot?.[kind]
      if (!Array.isArray(arr)) continue
      for (const record of arr) {
        if (record === null || typeof record !== 'object') continue
        const score = scoreEntityTitle(entityTitleOf(record), q)
        if (score > 0) scored.push({ kind, record, score })
      }
    }
    scored.sort((a, b) => b.score - a.score)
    let added = 0
    for (const item of scored) {
      if (added >= 3 || matched.length >= 6) break
      const id = item.record.id
      if (id === undefined || id === null || seen.has(id)) continue
      seen.add(id)
      matched.push(item)
      added += 1
    }
    if (matched.length >= 6) break
  }
  const titles = []
  for (const item of matched) {
    const title = entityTitleOf(item.record)
    if (title !== '' && !titles.includes(title)) titles.push(title)
  }
  if (matched.length === 0) return { section: '', titles: [] }
  const header = '【实体记录】（系统按你的请求提供，只可据此回答，不得编造）'
  const lines = [header]
  let total = header.length
  for (const item of matched) {
    const line = formatEntityLine(item.kind, item.record)
    if (total + line.length + 1 > ENTITY_SECTION_MAX) break
    lines.push(line)
    total += line.length + 1
  }
  return { section: lines.join('\n'), titles: titles.slice(0, 6) }
}

/** 解析「踪迹提案」JSON：{"trace":{title,note?,at?}} → 清洗后的提案；非该形状返回 null（「踪迹」功能） */
export function tryParseTraceRequest(reply) {
  const cleaned = stripJsonFence(reply)
  if (!cleaned.startsWith('{')) return null
  let obj
  try {
    obj = JSON.parse(cleaned)
  } catch {
    return null
  }
  const raw = obj?.trace
  if (raw === null || typeof raw !== 'object') return null
  const title = Array.from(String(raw.title ?? '').trim()).slice(0, 40).join('')
  if (title === '') return null
  const trace = { title }
  if (typeof raw.note === 'string' && raw.note.trim() !== '') {
    trace.note = Array.from(raw.note.trim()).slice(0, 200).join('')
  }
  if (typeof raw.at === 'string' && Number.isFinite(Date.parse(raw.at))) {
    trace.at = Array.from(raw.at.trim()).slice(0, 40).join('')
  }
  return trace
}

/**
 * 与 KERNEL 对话：读当前数据快照构造摘要，注入有界对话历史，返回自然语言回答。
 * Slice G.1：模型可请求联网检索（Sogou→360→Bing），服务端检索后回喂同一会话正式作答。
 * 本轮扩展：模型可请求调取实体完整记录（entityQueries），命中后回喂；随后可产出 edit 修改建议。
 * 最多两轮额外交互（实体调取 / 联网检索各一次），同一 opencode 会话。
 * @param {Array<{ role: 'user'|'assistant', content: string }>} messages 已由路由裁剪的有界历史（末条为用户）
 * @returns {Promise<{ reply: string, searched: string[], focused: string[], editRequest: { kind: string, id: string, fields: object, label: string } | null, model: string | null, ms: number }>}
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
  const withRetry = async (text) => {
    try {
      return await promptChatOnce(sessionID, system, text)
    } catch (err) {
      console.warn(`[ai] chat 单次失败（${err?.message ?? err}），重试一次`)
      return await promptChatOnce(sessionID, system, text)
    }
  }
  let outcome = await withRetry(userText)
  let searched = []
  let focused = []
  let entityRoundDone = false
  let searchRoundDone = false
  let lastReply = outcome.reply
  // 最多两轮额外交互：优先实体调取，其次联网检索；各最多一次
  for (let round = 0; round < 2; round += 1) {
    const entityQueries = entityRoundDone ? null : tryParseEntityRequest(lastReply)
    if (entityQueries !== null) {
      entityRoundDone = true
      const resolved = resolveEntities(snapshot, entityQueries)
      focused = resolved.titles
      const section =
        resolved.section !== ''
          ? resolved.section
          : '【实体记录】未找到与请求匹配的记录，请据现有摘要作答或向用户说明。'
      outcome = await withRetry(
        `${section}\n\n请基于以上记录回答用户的最后一条消息；若用户要求修改，只输出 {"edit":{...}} JSON；否则正常用文字回答。`,
      )
      lastReply = outcome.reply
      continue
    }
    const searchQueries = searchRoundDone ? null : tryParseSearchRequest(lastReply)
    if (searchQueries !== null) {
      searchRoundDone = true
      const search = await buildSearchSection(searchQueries)
      if (search.ok) {
        outcome = await withRetry(
          `${search.section}\n\n请基于以上检索结果，正式回答用户最后一条「用户：」的问题；用中文 markdown 组织，简洁直接。`,
        )
        searched = search.queries
      } else {
        outcome = await withRetry(
          '联网检索未成功。请基于常识保守回答，并明确注明无法确认最新信息；不要编造日期与事实。',
        )
      }
      lastReply = outcome.reply
      continue
    }
    break
  }
  const traceRequest = tryParseTraceRequest(lastReply)
  const editRequest = traceRequest === null ? tryParseEditRequest(lastReply) : null
  const reply =
    traceRequest !== null
      ? `识别为一条踪迹：「${traceRequest.title}」。确认后记入踪迹。`
      : editRequest !== null
        ? editRequest.label || '已生成修改建议，请确认后生效。'
        : lastReply
  const model = modelOf(outcome.res)
  const ms = Date.now() - t0
  console.log(
    `[ai] chat 完成 ${ms}ms（${model ?? '未知模型'}${searched.length > 0 ? ` · 检索${searched.length}条` : ''}${focused.length > 0 ? ` · 调取${focused.length}条` : ''}${editRequest !== null ? ' · 修改建议' : ''}${traceRequest !== null ? ' · 踪迹提案' : ''}）`,
  )
  return { reply, searched, focused, editRequest, traceRequest, model, ms }
}

/** 构造「把回答整理成笔记」系统提示词（Slice G.1；聚焦用户要求、事实数字不变、不得编造） */
function buildChatNoteSystem() {
  return `你是 KERNEL 的笔记整理器。把用户提供的【回答】按「整理要求」整理为一条独立笔记，只输出一个 JSON 对象：{"title":"…","body":"…"}，不要 markdown 代码块、不要解释、不要多余文字。
要求：
- title：≤40 字，概括主题的名词短语（不要「笔记」后缀、不要套话）。
- body：中文 markdown 正文（可用小标题 / 列表 / 加粗 / 引用），聚焦整理要求（如「这个点」指回答中的某一部分时，只保留该部分并整理清楚）。
- 事实与数字不得改动、不得编造；保持精炼，不设固定字数。`
}

/**
 * 由「对话回答 + 整理要求」生成笔记草稿（Slice G.1）：AI 整理失败 / 解析失败时
 * 回退为确定性兜底（首行标题 + 原文正文），绝不抛错。
 * @returns {Promise<{ title: string, body: string, model: string | null, ms: number, fallback: boolean }>}
 */
export async function draftChatNote(instruction, answer) {
  const t0 = Date.now()
  const fallback = () => {
    const firstLine =
      String(answer)
        .split('\n')
        .map((line) => line.replace(/^[#>*\-\s]+/, '').trim())
        .find((line) => line !== '') ?? '对话要点'
    return {
      title: Array.from(firstLine).slice(0, 40).join(''),
      body: String(answer).trim(),
      model: null,
      ms: Date.now() - t0,
      fallback: true,
    }
  }
  const sessionID = await createSession('kernel:chat-note')
  const system = buildChatNoteSystem()
  const userText = `整理要求：${instruction}\n\n【回答】\n${answer}`
  try {
    const res = await promptOnce(sessionID, system, userText)
    const cleaned = extractText(res)
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/, '')
      .trim()
    const obj = JSON.parse(cleaned)
    const title = Array.from(String(obj?.title ?? '').trim()).slice(0, 40).join('')
    const body = String(obj?.body ?? '').trim()
    if (title === '' || body === '') return fallback()
    return { title, body, model: modelOf(res), ms: Date.now() - t0, fallback: false }
  } catch (err) {
    console.warn(`[ai] chat.note 整理失败，回退确定性：${err?.message ?? err}`)
    return fallback()
  }
}

/* ---------------------------------------------------------------------------
 * 任务快速新建 AI 补全（v0.5 · Slice H）：只填标题 → 建议可补全字段
 * 纪律：AI 只出建议，绝不自动落盘；应用走既有 /api/tasks/:id/update 白名单。
 * ------------------------------------------------------------------------- */

/** 输入标题硬上限（超长截断；有界输入） */
export const TASK_DRAFT_MAX_TITLE_CHARS = 200

/** 构造任务补全系统提示词（注入当前本地时间 + 系统现状摘要） */
function buildTaskDraftSystem(digest, contextNames = []) {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `你是 KERNEL 个人事务系统的任务补全器。用户只给了一个任务标题，请推断可安全补全的字段，只输出一个 JSON 对象：不要 markdown 代码块、不要解释、不要多余文字。
可用字段（凡拿不准就省略该键，绝不编造）：
- contexts: 字符串数组，只能从 [${contextRuleText(contextNames)}] 中选（无把握则省略）
- energy: "low" | "medium" | "high"
- importance: 0 | 1 | 2 | 3（整数；0 = 最低 / 可略过的输入）
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
  const system = buildTaskDraftSystem(buildDigest(snapshot), contextNamesOf(snapshot))
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
 * 笔记 AI 蒸馏（v0.5 · Slice M，见 ADR-0020）：把笔记压缩到目标层级
 * 纪律：AI 只产出「草稿文本」，绝不自动落盘；应用由用户确认后经
 *       POST /api/notes/:id/update（body 追加 + distillLevel）写入。
 * ------------------------------------------------------------------------- */

/** 蒸馏输入正文硬上限（超长截断；有界输入） */
export const NOTE_DISTILL_MAX_BODY_CHARS = 6000
/** 蒸馏输出文本硬上限（与 noteDistillSchema 对齐） */
export const NOTE_DISTILL_MAX_TEXT_CHARS = 1200

/** 层级中文名（与前端 DISTILL_LEVEL_LABEL 同口径） */
const NOTE_DISTILL_LEVEL_LABEL = { 1: '划线', 2: '摘要', 3: '永久笔记' }
/** 各层指令（渐进压缩：L1 挑原句 → L2 自述摘要 → L3 可复用提炼） */
const NOTE_DISTILL_LEVEL_RULE = {
  1: 'L1 划线：从正文中挑出最关键的原句（可原文摘录），最多 5 条，每条一行；不改写、不点评。',
  2: 'L2 摘要：用自己的话把正文压缩成一段摘要，保留核心事实与结论，删去旁枝与重复；不编造。',
  3: 'L3 永久笔记：提炼为一条可复用的永久笔记——一个清晰的主张（第一句）+ 2–4 条支撑要点；脱离原文也能独立理解。',
}

/** 构造蒸馏系统提示词（注入目标层级定义 + 硬性规则） */
function buildNoteDistillSystem(targetLevel) {
  return `你是 KERNEL 个人知识库的「渐进蒸馏」助手。用户会给你一篇笔记，请把它压缩到 L${targetLevel}（${NOTE_DISTILL_LEVEL_LABEL[targetLevel]}）。
只输出一个 JSON 对象：不要 markdown 代码块、不要解释、不要多余文字。
- text: 压缩后的正文（字符串；中文为主，目标 ≤300 字，最多不超过 1200 字）
- reason: 一句话说明你的压缩依据（可选）

当前目标层级：
${targetLevel}. ${NOTE_DISTILL_LEVEL_RULE[targetLevel]}

规则：
1. 保守压缩：只保留笔记中真实存在的信息，绝不编造事实、数字或结论；拿不准的细节宁可省略。
2. 保留关键事实（人名 / 数字 / 结论 / 待办）。
3. 如果正文已经包含「## 蒸馏 → Lx」小节，请基于它上方的内容重新生成目标层级，不要照抄旧蒸馏小节。
4. 输出纯文本正文，不要加「以下是」「摘要：」之类的前后缀，也不要再用 Markdown 标题包裹。`
}

/** 构造蒸馏用户输入（标题 / 类型 / 层级上下文 + 截断后的正文） */
function buildNoteDistillInput(note, targetLevel) {
  const body = typeof note.body === 'string' ? note.body : ''
  const clipped =
    body.length > NOTE_DISTILL_MAX_BODY_CHARS
      ? `${body.slice(0, NOTE_DISTILL_MAX_BODY_CHARS)}…（正文过长已截断）`
      : body
  const current = typeof note.distillLevel === 'number' ? note.distillLevel : 0
  return `笔记标题：${note.title}
笔记类型：${note.type}
当前层级：L${current}
目标层级：L${targetLevel}（${NOTE_DISTILL_LEVEL_LABEL[targetLevel]}）

【笔记正文】
${clipped}`
}

/** 解析 + 校验单次蒸馏响应；返回 { ok, draft } 或 { ok:false, reason } */
function tryParseNoteDistill(res) {
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
    return { ok: true, draft: noteDistillSchema.parse(obj) }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/** 单会话内「prompt → 解析 → 一次重试」；失败抛错 */
async function promptNoteDistillWithRetry(sessionID, system, userText) {
  let res = await promptOnce(sessionID, system, userText)
  let parsed = tryParseNoteDistill(res)
  if (!parsed.ok) {
    console.warn(`[ai] note.distill 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象（形如 {"text":"..."}），不要任何多余文字。`,
    )
    parsed = tryParseNoteDistill(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, draft: parsed.draft }
}

/**
 * 笔记 AI 蒸馏：把笔记正文压缩到 targetLevel（调用方已 clamp 到 1–3）。
 * @param {{ title: string, type: string, body: string, distillLevel?: number }} note 已读取的笔记
 * @param {number} targetLevel 1–3
 * @returns {Promise<{ text: string, reason: string, model: string | null, ms: number }>}
 */
export async function draftNoteDistill(note, targetLevel) {
  const t0 = Date.now()
  const system = buildNoteDistillSystem(targetLevel)
  const sessionID = await createSession('kernel:note-distill')
  const { res, draft } = await promptNoteDistillWithRetry(
    sessionID,
    system,
    buildNoteDistillInput(note, targetLevel),
  )
  const text =
    draft.text.length > NOTE_DISTILL_MAX_TEXT_CHARS
      ? draft.text.slice(0, NOTE_DISTILL_MAX_TEXT_CHARS)
      : draft.text
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(`[ai] note.distill L${targetLevel} 完成 ${ms}ms（${model ?? '未知模型'}）`)
  return { text, reason: draft.reason ?? '', model, ms }
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
 * AI 整理（v0.5 · Slice N8）：无归属任务 → 先归入高度相关的现有项目，再把剩余条目建议为新项目
 * 纪律：与聚类立项同源——确定性预分组限定成员、AI 按编号引用（无法编造 id）、只出建议不落盘；
 *       应用经 POST /api/projects/organize-apply（服务端一次写入 + 审计），撤销精确 / 尽力复原。
 * ------------------------------------------------------------------------- */

/** 归并入现有项目的条数上限（N8.1 放宽：5 → 8，尽量收纳全部可规划项） */
export const ORGANIZE_MAX_ASSIGNMENTS = 8
/** 新项目提案上限（N8.1 放宽：3 → 5） */
export const ORGANIZE_MAX_CLUSTERS = 5
/** N8.1：AI 新项目簇最少成员数（2；单条多步事务另行放行，见 postValidateOrganize） */
export const ORGANIZE_MIN_CLUSTER_ENTRIES = 2
/** 单条归并建议可含的任务条目上限 */
const ORGANIZE_MAX_ENTRIES_PER_ASSIGNMENT = 10
/** 现有项目可被归入的状态（已完成 / 归档项目不作为归并目标；导出供 index.mjs 应用前校验） */
export const ORGANIZE_PROJECT_STATUS = new Set(['active', 'onHold', 'someday'])

/** 构造 AI 整理系统提示词（注入当前本地时间；N8.1：三分类 + 全覆盖 + 自主立项判断） */
function buildOrganizeSystem() {
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${WEEKDAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`
  return `你是 KERNEL 个人事务系统的「整理器」。你会看到编号候选条目（1..N，含任务与未澄清条目）、用户的【现有项目】与确定性【提示组】。

先在心里对每个候选做出判断，归入三类之一：
【A · 归并到现有项目】候选与某个现有项目存在具体归属关系（同一课程 / 同一活动或赛事 / 同一组织的一件事 / 同一委托方 / 同一人的同一事务，或它本身就是该项目完成定义里的一步）→ 输出归并建议，reason 写出这条可核对的联系。
【B · 建议新项目】若干候选（≥2）确实属于同一件「需要多步推进的新事务」→ 编成新项目建议；单条候选若本身明确是多步事务（准备考核 / 组织活动 / 开发交付 / 长期训练），也可自行判断单独立项——此时 outcome 与 reason 必须写清。
【C · 不规划】单步即可完成的事务（买 / 交 / 发 / 查 / 去一趟）→ 正确地不输出。

目标：遍历全部候选，但凡能合理规划的都要给出归属（不漏），且每条建议都能写出可核对的 reason（不硬塞）。仅「领域相近、都是学习类、时间相近」不算具体联系。

判断示例：
- 正例 · 归并：「投递 Demo 实验室招新简历」→「demo 实验室考核准备」（它就是完成定义里「简历按时投递」的一步）
- 正例 · 归并：「学生组织第二轮面试（做面试官）」「监督学生组织推文」→「学生组织部门相关事宜」（同一组织的连续事务）
- 反例 · 不归并：「背四级单词」→「算法训练」（仅领域相近，无具体联系）
- 正例 · 新项目：「数据结构作业 1 / 2 / 3」→「数据结构课程作业」；单条「筹备迎新晚会」可单独立项（多步事务）
- 反例 · 不规划：「取快递」「回复确认邮件」（单步即可完成）

只输出一个 JSON 对象：{"assignments":[{"project":"p-0001","entries":[3,7],"reason":"…"}],"clusters":[{"entries":[1,2,5],"title":"…","outcome":"…","reason":"…","areaId":"a-0001","tags":["topic:X"]}]}，不要 markdown 代码块、不要解释、不要多余文字。

规则：
1. entries 只能引用 1..N 的整数编号，不得编造、不得重复；同一条目不得同时出现于 assignments 与 clusters（assignments 优先），也不得在两个 clusters 中重复。
2. assignments 最多 8 条；project 只能原样照抄【现有项目】列出的 id；每个项目最多一条建议；每条最多 10 个条目（仅任务类编号）。
3. clusters 最多 5 条；≥2 条成员即可成簇（须含 ≥1 条任务）；单条任务成簇仅限「本身是多步事务」且必须给出 outcome 与 reason；title ≤20 字名词短语（不要「各类任务」「待整理」「TODOs」等套话）；outcome 说明「怎样算完成」；reason 说明共同线索或立项依据。
4. areaId 仅引用【区域】已有 id（无把握省略）；tags 优先复用【标签】已有名，确无合适时可用「topic:名称」（≤12 字），每条最多 5 个。
5. 项目名不得与【现有项目】标题重复；不得编造条目不存在的细节。
6. 无需整理时输出 {"assignments":[],"clusters":[]}。
现在是 ${stamp}。`
}

/** 构造 AI 整理摘要（编号候选 + 可归入的现有项目 + 确定性预分组提示 + 区域 / 标签 / 上下文） */
function buildOrganizeDigest(snapshot, candidates, groups) {
  const positionOfId = new Map(candidates.map((c, index) => [c.id, index + 1]))
  const lines = candidates.map((c, index) => {
    if (c.kind === 'task') {
      const tagText = (c.tags ?? []).length > 0 ? ` ｜ 标签: ${(c.tags ?? []).join(', ')}` : ''
      return `${index + 1}. [任务 ${c.id}] ${String(c.title ?? '')}${tagText}`
    }
    const preview = Array.from(String(c.title ?? '')).slice(0, 80).join('')
    return `${index + 1}. [条目 ${c.id}] ${preview}`
  })
  const projects = (snapshot.projects ?? [])
    .filter((p) => ORGANIZE_PROJECT_STATUS.has(p.status))
    .map((p) => {
      const outcome = String(p.outcome ?? '').trim()
      // N8.1：占位完成定义（默认值 / 空）不作为语义信号
      const outcomeText =
        outcome === '' || outcome.startsWith('完成定义待整理')
          ? '（未填写，参考标题与标签判断）'
          : outcome
      return `${p.id} · ${p.title} ｜ 完成定义: ${outcomeText} ｜ 标签: ${(p.tags ?? []).join(', ')} ｜ 状态: ${p.status}`
    })
  const hints = groups.map((members, index) => {
    const nums = members.map((m) => positionOfId.get(m.id)).filter((n) => Number.isInteger(n))
    return `提示 ${index + 1}（${nums.length} 项）：${nums.join(', ')}`
  })
  const areas = (snapshot.areas ?? []).map((a) => `${a.id} · ${a.title}`)
  const tags = (snapshot.tags ?? []).map((t) => t.name)
  const contexts = contextNamesOf(snapshot)
  let out = `【候选条目】\n${lines.join('\n') || '（无）'}\n`
  out += `【现有项目】（仅这些 id 可作为归并目标）\n${projects.join('\n') || '（无）'}\n`
  if (hints.length > 0) out += `【提示组】\n${hints.join('\n')}\n`
  out += `【区域】\n${areas.join('\n') || '（无）'}\n`
  out += `【标签】\n${tags.join(', ') || '（无）'}\n`
  out += `【上下文】\n${contexts.join(', ') || '（无）'}`
  return out.trim()
}

/** 解析 + 校验单次整理响应；返回 { ok, draft } 或 { ok:false, reason } */
function tryParseOrganizeDraft(res) {
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
    return { ok: true, draft: organizeDraftSchema.parse(obj) }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/** 单会话内「prompt → 解析 → 一次重试」；失败抛错 */
async function promptOrganizeWithRetry(sessionID, system, digest) {
  let res = await promptOnce(sessionID, system, digest)
  let parsed = tryParseOrganizeDraft(res)
  if (!parsed.ok) {
    console.warn(`[ai] organize.draft 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象（形如 {"assignments":[],"clusters":[]}），不要任何多余文字。`,
    )
    parsed = tryParseOrganizeDraft(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, draft: parsed.draft }
}

/**
 * 整理草稿后校验（导出供单测 / 冒烟）：编号 → 候选展开（模型无法编造 id）；
 * assignments 目标须为现有且状态可归入的项目，仅保留任务、去重、同项目合并、每条截断 ≤10；
 * clusters ≥2 成员且含任务（N8.1；单条多步任务可单独立项——须补 outcome + reason）、不得撞现有项目名；共享 claimed 保证条目不复用（assignments 优先）。
 * 覆盖兜底（确定性 fallback clusters）由 draftOrganize 追加，本函数不做兜底。
 * @returns {{ assignments: Array, clusters: Array }}
 */
export function postValidateOrganize(raw, candidates, snapshot) {
  const projectById = new Map((snapshot.projects ?? []).map((p) => [p.id, p]))
  const areaIds = new Set((snapshot.areas ?? []).map((a) => a.id))
  const tagNames = new Set((snapshot.tags ?? []).map((t) => t.name))
  const projectTitles = new Set((snapshot.projects ?? []).map((p) => String(p.title ?? '').trim()))
  const claimed = new Set()

  // 编号 → 候选（丢弃非整数 / 越界；按候选去重；onlyTask 时仅取任务类）
  const expand = (entries, onlyTask) => {
    const out = []
    const seen = new Set()
    for (const n of Array.isArray(entries) ? entries : []) {
      if (!Number.isInteger(n) || n < 1 || n > candidates.length) continue
      const c = candidates[n - 1]
      if (onlyTask && c.kind !== 'task') continue
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
    }
    return out
  }

  // 阶段 A：归并入现有项目（assignments 优先认领条目）
  const assignments = []
  const assignByProject = new Map()
  for (const rawA of Array.isArray(raw?.assignments) ? raw.assignments : []) {
    const project = projectById.get(String(rawA?.project ?? ''))
    if (project === undefined || !ORGANIZE_PROJECT_STATUS.has(project.status)) continue
    let item = assignByProject.get(project.id)
    if (item === undefined) {
      if (assignments.length >= ORGANIZE_MAX_ASSIGNMENTS) continue
      item = {
        projectId: project.id,
        projectTitle: String(project.title ?? ''),
        taskIds: [],
        reason: '',
      }
      assignByProject.set(project.id, item)
      assignments.push(item)
    }
    if (item.reason === '') item.reason = String(rawA?.reason ?? '').trim().slice(0, 300)
    // 只认领实际保留的条目；超出上限（≤10）的条目留待 clusters 使用
    for (const m of expand(rawA?.entries, true)) {
      if (item.taskIds.length >= ORGANIZE_MAX_ENTRIES_PER_ASSIGNMENT) break
      if (claimed.has(m.id)) continue
      claimed.add(m.id)
      item.taskIds.push(m.id)
    }
  }

  // 阶段 B：建议新项目（使用阶段 A 未认领的条目）
  const clusters = []
  const clusterTitles = new Set()
  for (const rawC of Array.isArray(raw?.clusters) ? raw.clusters : []) {
    if (clusters.length >= ORGANIZE_MAX_CLUSTERS) break
    const members = expand(rawC?.entries, false).filter((m) => !claimed.has(m.id))
    const taskIds = members.filter((m) => m.kind === 'task').map((m) => m.id)
    const inboxIds = members.filter((m) => m.kind === 'inbox').map((m) => m.id)
    // N8.1：≥2 成员成簇；单条任务允许单独立项，但必须给出完成定义与理由（多步事务门槛）
    const enoughMembers = members.length >= ORGANIZE_MIN_CLUSTER_ENTRIES
    const singleSeed =
      members.length === 1 &&
      members[0].kind === 'task' &&
      typeof rawC?.outcome === 'string' &&
      rawC.outcome.trim() !== '' &&
      typeof rawC?.reason === 'string' &&
      rawC.reason.trim().length >= 6
    if ((!enoughMembers && !singleSeed) || taskIds.length === 0) continue
    const title = Array.from(String(rawC?.title ?? '').trim())
      .slice(0, CLUSTER_TITLE_MAX_CHARS)
      .join('')
    if (title === '' || projectTitles.has(title) || clusterTitles.has(title)) continue
    const item = {
      title,
      reason: String(rawC?.reason ?? '').trim().slice(0, 300),
      taskIds,
      inboxIds,
      tags: cleanTagSuggestions(rawC?.tags, tagNames),
    }
    if (typeof rawC?.outcome === 'string' && rawC.outcome.trim() !== '') {
      item.outcome = rawC.outcome.trim().slice(0, 200)
    }
    if (typeof rawC?.areaId === 'string' && areaIds.has(rawC.areaId)) {
      item.areaId = rawC.areaId
    }
    for (const m of members) claimed.add(m.id)
    clusterTitles.add(title)
    clusters.push(item)
  }
  return { assignments, clusters }
}

/** 确定性命名：组内最高频标签的可读后缀；无标签则取首条标题前 16 字 */
function fallbackGroupName(members) {
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
    name = best.startsWith('@')
      ? best.slice(1)
      : best.includes(':')
        ? best.slice(best.indexOf(':') + 1)
        : best
  }
  if (name === '') name = Array.from(members[0].title).slice(0, 16).join('')
  return name
}

/**
 * 覆盖兜底：预分组中任务成员未被采纳的组，以确定性命名补足新项目提案（≤ ORGANIZE_MAX_CLUSTERS）。
 * 这些候选没有 AI 命名，仍可被用户逐条忽略；任务全在 coveredTaskIds 内的组跳过。
 */
function fallbackOrganizeClusters(groups, coveredTaskIds, coveredInboxIds) {
  const out = []
  for (const members of groups) {
    if (out.length >= ORGANIZE_MAX_CLUSTERS) break
    const taskIds = members
      .filter((m) => m.kind === 'task' && !coveredTaskIds.has(m.id))
      .map((m) => m.id)
    if (taskIds.length === 0) continue
    const inboxIds = members
      .filter((m) => m.kind === 'inbox' && !coveredInboxIds.has(m.id))
      .map((m) => m.id)
    if (taskIds.length + inboxIds.length < CLUSTER_MIN_MEMBERS) continue
    out.push({
      title: `归纳：${fallbackGroupName(members)}`.slice(0, CLUSTER_TITLE_MAX_CHARS),
      reason: '按共同标签 / 关键词自动归纳（AI 命名不可用）',
      taskIds,
      inboxIds,
      tags: [],
    })
  }
  return out
}

/**
 * AI 整理草稿：收集候选 → 确定性预分组 → AI 两阶段（归并已有项目 + 建议新项目）→ 后校验 + 兜底。
 * 不写任何数据；无候选时直接返回空（不调用 AI）；AI 失败 / 解析失败降级为确定性兜底，绝不抛错。
 * @returns {Promise<{ assignments: Array, clusters: Array, model: string | null, ms: number, candidates: number, unplanned: number }>}
 */
export async function draftOrganize(snapshot) {
  const t0 = Date.now()
  const candidates = collectClusterCandidates(snapshot)
  if (candidates.length === 0) {
    return { assignments: [], clusters: [], model: null, ms: Date.now() - t0, candidates: 0, unplanned: 0 }
  }
  const groups = pregroupCandidates(candidates)
  const system = buildOrganizeSystem()
  const digest = buildOrganizeDigest(snapshot, candidates, groups)
  const sessionID = await createSession('kernel:organize-draft')
  let raw = { assignments: [], clusters: [] }
  let model = null
  try {
    const result = await promptOrganizeWithRetry(sessionID, system, digest)
    raw = result.draft
    model = modelOf(result.res)
  } catch (err) {
    console.warn(`[ai] organize.draft AI 整理失败，回退确定性兜底：${err?.message ?? err}`)
    raw = { assignments: [], clusters: [] }
    model = null
  }
  const validated = postValidateOrganize(raw, candidates, snapshot)
  // 覆盖兜底：AI 未覆盖（或被校验丢弃）的预分组，用确定性命名补上；正常时不会触发。
  const coveredTaskIds = new Set([
    ...validated.assignments.flatMap((a) => a.taskIds),
    ...validated.clusters.flatMap((c) => c.taskIds),
  ])
  const coveredInboxIds = new Set(validated.clusters.flatMap((c) => c.inboxIds))
  const clusters = [...validated.clusters]
  for (const item of fallbackOrganizeClusters(groups, coveredTaskIds, coveredInboxIds)) {
    if (clusters.length >= ORGANIZE_MAX_CLUSTERS) break
    clusters.push(item)
  }
  // N8.1：未纳入统计（最终提案之外仍未被覆盖的候选数，供 UI 如实展示「都考虑过了」）
  const finalCovered = new Set([
    ...validated.assignments.flatMap((a) => a.taskIds),
    ...clusters.flatMap((c) => [...c.taskIds, ...c.inboxIds]),
  ])
  const unplanned = candidates.filter((c) => !finalCovered.has(c.id)).length
  const ms = Date.now() - t0
  console.log(
    `[ai] organize.draft 完成 ${ms}ms（${model ?? '失败'} · ${validated.assignments.length} 归并 / ${clusters.length} 新项目 / ${unplanned} 未纳入 / ${candidates.length} 候选）`,
  )
  return { assignments: validated.assignments, clusters, model, ms, candidates: candidates.length, unplanned }
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
 * 报告分节解析（Slice U）：把 summary 拆成七段，供服务端「接下来」指针去重；
 * 前端同规则解析见 src/lib/reviewReport.ts（两处刻意保持一致，勿单边改动）。
 * Slice N6「回顾人话化」：规范 label 改为友好标题（周/月各自形态），
 * 同时收录全部旧标题别名，保证旧归档（如 rev-0001）仍可解析渲染。
 * 兼容「结论速览：…」与「一、结论速览」两种标题写法。
 * ------------------------------------------------------------------------- */

const REVIEW_SECTION_ALIASES = [
  { label: '这周怎么样', aliases: ['这周怎么样', '结论速览'] },
  { label: '这个月怎么样', aliases: ['这个月怎么样'] },
  { label: '干了些什么', aliases: ['干了些什么', '本期数据解读', '数据解读'] },
  { label: '和上周比', aliases: ['和上周比', '趋势与对比', '趋势对比'] },
  { label: '和上个月比', aliases: ['和上个月比'] },
  { label: '哪里卡住了', aliases: ['哪里卡住了', '问题诊断'] },
  { label: '值得保持的', aliases: ['值得保持的', '值得保留'] },
  { label: '接下来', aliases: ['接下来', '下期行动'] },
  { label: '需要留意的', aliases: ['需要留意的', '风险预警'] },
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
 * 「接下来」去重（Slice U/N6）：把 summary 第 6 段整段替换为一行指针
 * 「接下来：见决策区（N 条）。」，完整 if-then 只留在 decisions，杜绝逐字重复。
 * decisions 为空时不动（避免把唯一的行动记录也抹掉）。旧标题「下期行动」经别名归一后同样命中。
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
      if (heading.label === '接下来') start = i
    } else {
      end = i
      break
    }
  }
  if (start === -1) return text
  const pointer = `接下来：见决策区（${count} 条）。`
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
 * 审计动作名 → 人话活动名（Slice N6「回顾人话化」）。
 * 目的：喂给模型的摘要绝不出现 `xxx.yyy` 英文点号动作名，避免模型照抄成系统术语。
 * 未知动作统一归入「其他整理操作」。
 */
const REVIEW_ACTIVITY_LABELS = {
  'task.create': '新建任务',
  'task.update': '调整任务',
  'task.complete': '完成任务',
  'task.reopen': '重开任务',
  'task.remove': '删除任务',
  'task.touch': '更新任务',
  'note.create': '记录笔记',
  'note.update': '修改笔记',
  'note.remove': '删除笔记',
  'resource.create': '收录资料',
  'resource.update': '整理资料',
  'resource.remove': '删除资料',
  'project.create': '立项',
  'project.update': '推进项目',
  'project.touch': '更新项目',
  'project.trash': '归档项目',
  'project.remove': '删除项目',
  'course.create': '录入课程',
  'course.update': '调整课程',
  'course.remove': '删除课程',
  'tag.create': '新增标签',
  'tag.rename': '重命名标签',
  'tag.merge': '合并标签',
  'tag.remove': '删除标签',
  'tag.backfill': '登记标签',
  'habit.create': '新建习惯',
  'habit.checkin': '习惯打卡',
  'habit.uncheckin': '取消打卡',
  'habit.update': '调整习惯',
  'habit.remove': '删除习惯',
  'event.create': '安排日程',
  'event.update': '调整日程',
  'event.remove': '取消日程',
  'area.create': '新建区域',
  'area.update': '调整区域',
  'area.remove': '删除区域',
  'goal.create': '设定目标',
  'goal.update': '调整目标',
  'goal.remove': '删除目标',
  'inbox.capture': '捕捉',
  'inbox.upload': '投递文件',
  'inbox.apply': '整理收件箱',
  'inbox.clarify': '澄清条目',
  'inbox.discard': '丢弃条目',
  'inbox.remove': '删除条目',
  'review.create': '生成回顾',
  'review.update': '更新回顾',
  'review.remove': '删除回顾',
  'term.update': '设置学期',
  'config.update': '更新设置',
}

/**
 * 把审计 action 计数映射为人话活动名并聚合：
 * 同名（映射后）合并、未知动作合并为「其他整理操作」，按次数降序、最多 limit 行。
 * 纯函数，导出供自测复用。`counts` 为 Map<action, count>。
 */
export function humanizeActivityCounts(counts, limit = 8) {
  const byLabel = new Map()
  for (const [action, count] of counts) {
    const name = REVIEW_ACTIVITY_LABELS[action] ?? '其他整理操作'
    byLabel.set(name, (byLabel.get(name) ?? 0) + count)
  }
  return [...byLabel.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => `${name} ×${count}`)
}

/**
 * 构造紧凑中文回顾摘要（指标 + 与上次对照 + 完成/逾期/停滞清单 + 习惯 + 活动 + 阈值）。
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
  const recentLabel = monthly ? '这个月怎么样' : '这周怎么样'
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
  const activityLines = humanizeActivityCounts(counts)

  const lines = [
    `【周期】本${scope} ${periodLabel} · 窗口 ${shortDate(periodStart)} → ${shortDate(now)}（已走完 ${elapsedDays} 天，本机时区）`,
    `【${label}概况】捕捉 ${metrics.captured} · 新增 ${metrics.created} · 完成 ${metrics.completed} · 逾期 ${metrics.overdue}`,
    `【与上次对照（同等已走时长）】完成 ${metrics.completed} 件（上次 ${prevMetrics.completed} 件）· 新增 ${metrics.created} 条（上次 ${prevMetrics.created} 条）· 逾期 ${metrics.overdue} 条（上次 ${prevMetrics.overdue} 条）· 捕捉 ${metrics.captured} 条（上次 ${prevMetrics.captured} 条）`,
    `【${label}完成（${completed.length}，标题优先 · 括号补 id）】\n${completed.join('\n') || '（无）'}`,
    `【当前逾期（${overdue.length}）】\n${overdue.join('\n') || '（无）'}`,
    `【停滞项目（≥14 天未更新，共 ${stale.length}）】\n${stale.join('\n') || '（无）'}`,
    `【可处置停滞项目 id】${staleList.map((p) => p.id).join(', ') || '（无）'}`,
    `【习惯（近 7 天 / 上 7 天 / 连续未达标周数）】\n${habits.join('\n') || '（无）'}`,
    `【${label}做过的事】\n${activityLines.join('\n') || '（无）'}`,
    `【阈值常量（仅供你判断，不要照抄进正文）】逾期 = 任务截止时间已过且状态为 next/waiting/scheduled；停滞 = active 项目 ≥14 天未更新；习惯未达标 = 近 7 天命中数 < 目标数`,
  ]
  if (elapsedDays < 7) {
    lines.push(
      `【窗口说明】本期窗口尚未走完（已 ${elapsedDays} 天，未满 7 天）；对照窗口为上一${scope}的同期等长片段（${shortDate(prevStart)} → ${shortDate(prevEnd)}）。请在「${recentLabel}」或「需要留意的」里自然说明窗口不完整、结论仅供参考，禁止以「窗口仅 N 天」作为结论开场。`,
    )
  }
  return lines.join('\n\n')
}

/**
 * 构造回顾系统提示词（指令式 JSON；Slice L 七段报告 / Slice N6「回顾人话化」）。
 * 角色改为「懂得主人情况的真诚朋友」，七段为友好标题；summary 为多段纯文本，
 * 恰好七段；decisions 为 1–3 条 if-then 行动；staleAdvice 语义不变。
 * 硬性规则保证：只用摘要数字 / 对象、每个判断带证据、对比说人话（禁「基准 / 环比 / 同比」）、
 * 禁套话与工程术语、禁 `xxx.yyy` 英文动作名、行动含时间与完成标准。
 */
function buildReviewSystem(digest, scope) {
  const monthly = scope === '月'
  const recentLabel = monthly ? '这个月怎么样' : '这周怎么样'
  const compareLabel = monthly ? '和上个月比' : '和上周比'
  const prevWord = monthly ? '上个月' : '上周'
  return `你是主人的复盘搭档——像一个了解情况的真诚朋友，写一份给主人本人看的本${scope}复盘便签。说人话、有温度；可以有情绪和主观判断，但每个判断都要踩在摘要事实上。
只输出一个 JSON 对象：不要 markdown、不要解释、不要多余文字。字段：

- summary：中文纯文本，恰好 7 段，段与段之间用一个换行分隔。每段以「标题：」开头（标题后接中文冒号）。全篇不超过 800 字。七段依次为：
  1. ${recentLabel}：一句话说出本${scope}的整体感觉 + 关键数字自然融入
  2. 干了些什么：把数字讲成具体的事
  3. ${compareLabel}：用大白话说变化
  4. 哪里卡住了：一层因果（现象 → 原因）
  5. 值得保持的：具体表扬本${scope}在起作用的做法
  6. 接下来：只写一行指针，固定为「接下来：见决策区（N 条）。」（N = decisions 条数，1–3）。完整 if-then 行动全部放进 decisions，正文此段不再重复。
  7. 需要留意的：逾期 / 停滞的具体对象（优先标题、必要时括号补 id）
- decisions：1–3 条中文 if-then 行动（每条一行、含时间与完成标准；正文第 6 段只留指针，完整行动在此）
- staleAdvice：数组，可空：{ projectId, action: 'archive'|'migrate'|'reactivate', reason }，仅针对摘要中列出的停滞项目

【本${scope}数据摘要】
${digest}

每段怎么写（照做）：
- ${recentLabel}：先给一句有温度的判断，再把关键数字自然嵌进去。例：「比${prevWord}多完成 2 件，开了个好头」。情绪词（充满干劲 / 踏实 / 稳 / 有点散 / 开了个好头）可以用，但必须紧挨着事实支撑。
- 干了些什么：把数字讲成事，例：「把 12 门课全录进去了」「给 6 件事开了头」。
- ${compareLabel}：说人话，例：「比${prevWord}多 3 件」「和${prevWord}差不多」「从 0 到 3」。
- 哪里卡住了：一层因果、正常人的话，例：「开的事多、收回来的少，属于搭架子的阶段」。
- 值得保持的：具体表扬（做了什么 + 起了什么作用），例：「每天把收件箱清空，周报不用再补」。
- 接下来：固定一行指针，不展开。
- 需要留意的：点出逾期 / 停滞的具体对象（标题优先）。

硬性规则（违反即不合格）：
1. 只能使用摘要中出现的数字、日期、标题、id；禁止编造任何数字或对象。
2. 每个判断都要有具体数字或具体对象作为证据。
3. 对比一律用大白话（「比${prevWord}多 / 少」「和${prevWord}差不多」「从 0 到 3」）；禁止出现「基准」「环比」「同比」这些词，也禁止「（上周同期 0 条，+8，基准 0）」这种括号堆数字。
4. 禁止套话与工程术语：「显著 / 一定程度 / 多方面 / 持续发力 / 闭环 / 赋能 / 值得注意 / 综上所述 / 整体向好 / WIP / 水位 / 收口 / 审计 / 字段 / API / schema / 测试」等一律不许出现；也不允许出现「xxx.yyy」形式的英文点号动作名。
5. 短句、主动语态；说人话，不要仪表盘腔。
6. 证据不足就写「数据不足」，不要硬凑。
7. 行动必须 if-then，且含 何时 + 完成标准（全部写在 decisions）。
8. 允许（并鼓励）指出不确定性；不夸大。
9. 叙述优先用对象标题（摘要清单已是「标题（id）」）；id 只在 decisions 的行动里为绑定对象时以括号补充，可选。
10. 百分比只在基准数字 ≥5 时使用；基准是 0–4 时只写绝对变化（「从 0 到 3」可以），禁止硬算百分比。
11. 若摘要含【窗口说明】（窗口未满 7 天），在「${recentLabel}」或「需要留意的」里自然说明窗口不完整；禁止以「窗口仅 N 天」开场。

对照示例（字母仅示形；写作时必须替换成摘要里的真实数字）：
弱（禁止）："本${scope}整体推进顺利，效率显著提升，需持续发力。" / "结论速览：本周捕获 8 条、新增 6 条，均高于上周同期的 0 条（基准 0）。"
强（合格）："${recentLabel}：充实的开局——比${prevWord}多完成 2 件、新增 6 条待办，课表和系统都搭起来了；还没有收成，但架子立住了。"

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
  // 「接下来」去重（Slice U/N6）：第 6 段改为指针，完整行动只在 decisions（杜绝逐字重复）
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

/* ---------------------------------------------------------------------------
 * 课表解析 / 导入（v0.5 · Slice H1）：课表来源（xlsx / 截图 / 粘贴文本）→ 课程草稿
 * 纪律：AI 只出「课程草稿」，绝不自动落盘；导入由用户确认后走 POST /api/courses/import。
 *       真二进制 .xls（OLE2）无法直读 → 引导「另存为 .xlsx / 截图 / 粘贴文本」。
 * ------------------------------------------------------------------------- */

/** 课表来源最大课程数（与 timetableDraftSchema / coursesImportSchema 对齐） */
export const TIMETABLE_MAX_COURSES = 30

/**
 * 构造课表解析系统提示词（Slice H1）。规则逐字固定；截图投递时前置图片说明。
 * @param {{ isImage?: boolean }} opts
 */
export function buildTimetableSystem(opts = {}) {
  const imagePrefix =
    opts.isImage === true
      ? '本条是一个【截图投递】条目：附件为课表截图，请直接读取图片内容并解析。\n'
      : ''
  return `${imagePrefix}你是 KERNEL 个人事务系统的课表解析器。输入是一份学生课表（表格文本、截图或粘贴内容）。
只输出一个 JSON 对象：{ "courses": [ ... ] }，不要 markdown 代码块、不要解释、不要多余文字。

规则：
1. 提取所有真实课程，最多 30 门；宁缺毋滥——无法确定「星期 + 节次」的条目不要输出。
2. 每门课程字段：{ "title": 课程名（≤40 字，必填）, "teacher": 教师（可选）, "location": 默认地点（可选）, "sessions": [ { "dayOfWeek": 1-7, "startPeriod": n, "endPeriod": n, "weeks": [..]（可选）, "location": 该时段地点（可选，与默认不同时才写） } ], "notes": 备注（可选） }
3. dayOfWeek：周一=1 … 周日=7，按星期列判断。
4. 节次：表格标了「1-2节 / 第3-4节」直接用其数字；按行排列时用行首节次数字（第 N 节 = N）；合并单元格（课程名跨多行/多节）→ 用一个 session 覆盖整个跨度（startPeriod..endPeriod）。
5. weeks：把「1-16周 / 1-16 / 单周 / 双周 / 1-8,10-16」等写法转成升序数字数组（单周 = 奇数周、双周 = 偶数周）；「全周 / 每周 / 不标注」→ 省略 weeks；无法确定 → 省略 weeks 而不是猜。
6. 教师、地点按表格内容填入；忽略姓名 / 学号 / 学期 / 标题行 / 节次表头 / 空行 / 寄语等非课程内容。
7. 同一门课有多个时段（不同天 / 不同节次）→ 合并到同一门课程的 sessions 数组。`
}

/**
 * 解析 + 校验单次课表响应；返回 { ok:true, courses } 或 { ok:false, reason }。
 * 镜像 tryParseActions：剥代码围栏 → JSON.parse → timetableDraftSchema。
 */
export function tryParseTimetable(res) {
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
    return { ok: true, courses: timetableDraftSchema.parse(obj).courses }
  } catch (err) {
    return { ok: false, reason: `字段校验失败（${describeError(err)}）` }
  }
}

/**
 * 课表草稿单会话「prompt → 解析 → 一次重试」；失败抛错（镜像 promptWithRetry，输出形状不同）。
 * emit 存在时在重试前发出 { kind:'retry', reason }（流式路径用；为空时行为与现状一致）。
 */
async function promptTimetableWithRetry(sessionID, system, userText, extraParts = [], emit = null) {
  let res = await promptOnce(sessionID, system, userText, extraParts)
  let parsed = tryParseTimetable(res)
  if (!parsed.ok) {
    if (emit) emit({ kind: 'retry', reason: parsed.reason })
    console.warn(`[ai] timetable.draft 首次失败（${parsed.reason}），重试一次`)
    res = await promptOnce(
      sessionID,
      system,
      `上次输出无法解析（${parsed.reason}）。请只输出一个合法 JSON 对象（形如 {"courses":[...]}），不要任何多余文字。`,
      extraParts,
    )
    parsed = tryParseTimetable(res)
    if (!parsed.ok) throw new Error(`AI 输出无法解析：${parsed.reason}`)
  }
  return { res, courses: parsed.courses }
}

/** 取整数（非整数 / 非数返回 null） */
function asInt(value) {
  const n = Number(value)
  return Number.isInteger(n) ? n : null
}

/**
 * 课表课程清洗（Slice H1）：确定性、绝不抛错。
 * - ≤30 门；title trim（空丢弃；≤80）；teacher / location（≤60）、notes（≤500）trim 空则删键；
 * - 时段：dayOfWeek 1..7、start/endPeriod 1..20 否则丢弃该时段；end < start → 交换；
 *   weeks → 1..60 整数，去重升序，空则删键；location trim 空则删键；
 * - 无剩余时段的课程丢弃。
 * 导出供单测 / 探测复用。
 * @param {unknown} rawCourses
 * @returns {object[]} 清洗后的课程数组
 */
export function cleanTimetableCourses(rawCourses) {
  const out = []
  for (const raw of Array.isArray(rawCourses) ? rawCourses : []) {
    if (out.length >= TIMETABLE_MAX_COURSES) break
    if (raw === null || typeof raw !== 'object') continue
    const title = Array.from(String(raw.title ?? '').trim()).slice(0, 80).join('')
    if (title === '') continue
    const course = { title }
    const teacher = Array.from(String(raw.teacher ?? '').trim()).slice(0, 60).join('')
    if (teacher !== '') course.teacher = teacher
    const location = Array.from(String(raw.location ?? '').trim()).slice(0, 60).join('')
    if (location !== '') course.location = location
    const notes = Array.from(String(raw.notes ?? '').trim()).slice(0, 500).join('')
    if (notes !== '') course.notes = notes

    const sessions = []
    for (const rawSession of Array.isArray(raw.sessions) ? raw.sessions : []) {
      if (rawSession === null || typeof rawSession !== 'object') continue
      const day = asInt(rawSession.dayOfWeek)
      if (day === null || day < 1 || day > 7) continue
      let start = asInt(rawSession.startPeriod)
      let end = asInt(rawSession.endPeriod)
      if (start === null || start < 1 || start > 20) continue
      if (end === null || end < 1 || end > 20) continue
      if (end < start) {
        const tmp = start
        start = end
        end = tmp
      }
      const session = { dayOfWeek: day, startPeriod: start, endPeriod: end }
      if (Array.isArray(rawSession.weeks)) {
        const weeks = Array.from(
          new Set(rawSession.weeks.map((w) => asInt(w)).filter((w) => w !== null && w >= 1 && w <= 60)),
        ).sort((a, b) => a - b)
        if (weeks.length > 0) session.weeks = weeks
      }
      if (typeof rawSession.location === 'string') {
        const sessionLocation = Array.from(rawSession.location.trim()).slice(0, 60).join('')
        if (sessionLocation !== '') session.location = sessionLocation
      }
      sessions.push(session)
    }
    if (sessions.length === 0) continue
    course.sessions = sessions
    out.push(course)
  }
  return out
}

/**
 * 课表草稿（Slice H1）：把课表来源（xlsx / 截图 / 粘贴文本）解析为课程草稿。
 * 前置护栏：真二进制 .xls（OLE2）等不可直读附件 → 抛 status 400，引导「另存为 .xlsx / 截图 / 粘贴文本」。
 * 截图条目补 file part（复用 buildImagePart）。绝不落盘、无审计。
 * @param {{ id: string, content: string, file?: { name: string, mime?: string } }} item
 * @returns {Promise<{ courses: object[], model: string | null, ms: number }>}
 */
export async function draftTimetable(item) {
  const t0 = Date.now()
  const hasFile = item?.file !== undefined && item?.file !== null
  const isImage = isImageFile(item)
  const fileSection = await buildFileSection(item)
  if (hasFile && !isImage && fileSection.includes(FILE_UNREADABLE_HINT)) {
    throw Object.assign(
      new Error('无法直读该文件内容（旧版 .xls / 扫描件等）：请「另存为 .xlsx」、截图或粘贴文本后再试'),
      { status: 400 },
    )
  }
  const imageParts = isImage ? await buildImageParts(item) : []
  const system = buildTimetableSystem({ isImage })
  const sessionID = await createSession('kernel:timetable-draft')
  const userText = fileSection === '' ? item.content : `${item.content}\n\n${fileSection}`
  const extraParts = imageParts
  const { res, courses } = await promptTimetableWithRetry(sessionID, system, userText, extraParts)
  const clean = cleanTimetableCourses(courses)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(
    `[ai] timetable.draft ${item?.id ?? ''} 完成 ${ms}ms（${model ?? '未知模型'} · ${clean.length} 门课）`,
  )
  return { courses: clean, model, ms }
}

/**
 * 流式课表草稿（v0.5 · Slice H1.6）：先订阅事件流，边解析边 emit 过程事件。
 * 结构逐字镜像 parseInboxItemStream（订阅在前 → sessionID 过滤泵 → safeEmit → finally 收尾）。
 * @param {{ id: string, content: string, file?: { name: string, mime?: string } }} item
 * @param {(event: object) => void} emit
 * 事件：{kind:'status',status} | {kind:'delta',field,delta} |
 *       {kind:'retry',reason} | {kind:'suggestion',courses,model,ms} | {kind:'error',message}
 * 说明：不可读附件护栏与任何失败都只 emit error，绝不抛出（SSE 路由由事件收尾）。
 */
export async function draftTimetableStream(item, emit) {
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
    const hasFile = item?.file !== undefined && item?.file !== null
    const isImage = isImageFile(item)
    const fileSection = await buildFileSection(item)
    // 与同步 draftTimetable 同护栏：不可直读附件 → 只 emit error（不抛错，不再 400）
    if (hasFile && !isImage && fileSection.includes(FILE_UNREADABLE_HINT)) {
      safeEmit({
        kind: 'error',
        message: '无法直读该文件内容（旧版 .xls / 扫描件等）：请「另存为 .xlsx」、截图或粘贴文本后再试',
      })
      return
    }
    const imageParts = isImage ? await buildImageParts(item) : []
    const system = buildTimetableSystem({ isImage })
    sessionID = await createSession('kernel:timetable-draft')
    const userText = fileSection === '' ? item.content : `${item.content}\n\n${fileSection}`
    const extraParts = imageParts
    const { res, courses } = await promptTimetableWithRetry(sessionID, system, userText, extraParts, safeEmit)
    const clean = cleanTimetableCourses(courses)
    const model = modelOf(res)
    const ms = Date.now() - t0
    safeEmit({ kind: 'suggestion', courses: clean, model, ms })
    console.log(
      `[ai] timetable.draft-stream ${item?.id ?? ''} 完成 ${ms}ms（${model ?? '未知模型'} · ${clean.length} 门课）`,
    )
  } catch (err) {
    console.error(`[ai] timetable.draft-stream ${item?.id ?? ''} 失败：`, err?.message ?? err)
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
