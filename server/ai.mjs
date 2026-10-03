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
  projectDraftSchema,
  reviewDraftSchema,
  taskDraftSchema,
  timetableDraftSchema,
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

/** 单元格引用（如 "C3" / "AA12"）的列字母 → 0-based 列号；无法解析返回 -1 */
function columnIndexFromRef(ref) {
  const letters = /^[A-Za-z]+/.exec(String(ref ?? ''))
  if (letters === null) return -1
  let index = 0
  for (const ch of letters[0].toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64)
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
只输出一个 JSON 对象：{ "actions": [ ... ] }，不要 markdown 代码块、不要解释、不要多余文字。`
    : `${isImage ? '本条是一个【截图投递】条目：附件为图片，请直接读取图片内容并解析。\n' : ''}你是 KERNEL 个人事务系统的收件箱解析器。把用户丢进来的内容拆解为「一揽子处置动作」，交给用户一次确认后全部落位。
只输出一个 JSON 对象：{ "actions": [ ... ], "facts": [ "…" ] }，不要 markdown 代码块、不要解释、不要多余文字。`
  const rules = fileMode
    ? `规则（本条带【附件】——按「资料 + 简介」处理，绝不拆分）：
1. 恰好输出 1 个动作，kind 必须为 "resource"；禁止输出 task / note / project。
2. title：资料名（≤40 字），通常取文件名或内容主题。
3. note：1–3 句、≤${AI_RESOURCE_NOTE_MAX_CHARS} 字的简约小结，作为资料详情页「简介」（概括这是什么资料、讲了什么、有什么用）。必须基于【附件】内容摘录；若内容不可读，仅据文件名保守概括，并在小结中注明「仅据文件名」。
4. tags：优先从下方【标签】选已有名；仅当确无合适已有标签时提议 "topic:名称"（≤12 字）；最多 3 个；无把握省略。areaId 仅在明确属于某区域时填。
5. 不要输出 outcome / linkToNewProject / duplicateOf 或任务专属字段。`
    : `规则：
1. 宁少而精：通常 1–4 个动作，最多 6 个。优先「资料 / 笔记 + 一句小结」；仅对明确可执行的事产出 task，绝不为凑数把同一件事拆成一堆细小任务。
2. 纯信息 / 资料类内容（链接、文章、规则、通知正文）：优先产出 1 个 resource（带 note 小结）或 1 个 note（正文含要点），不要硬拆成任务。
3. 确实无事可做（纯寒暄 / 无价值信息）时返回 { "actions": [] }。
4. 挂靠宁缺毋滥：projectId / areaId / duplicateOf 只能取摘要中列出的 id，且必须有明确依据；表面相似（例如都含「竞赛 / 比赛 / 规则」字样）不算依据；拿不准一律省略。tags 优先取摘要中已有的标签名；仅当确实没有合适已有标签、且新标签是稳定的主题词（学科 / 领域，如「线性代数」「合唱排练」）时才提出新标签，写成 "topic:名称"（≤12 字）；禁止把日期、人名、整句话或临时描述当标签。
5. 最多一个新项目：整包中 kind:"project" 至多出现 1 次，且仅当内容像一件需要多步推进的新事务（新比赛 / 新活动 / 新项目）时才产出；若属于现有项目，改填 projectId。
6. 新项目与现有项目互斥：挂现有项目就填 projectId；新建项目就用 kind:"project" + 让相关 task/note 填 linkToNewProject:true，绝不同时填 projectId 和 linkToNewProject。
7. 通知 / 公告识别：若内容像「通知 / 公告 / 群消息」（含日期、面向群体的安排、要求或须知），按三性处理后再产出：
   硬事实（放假与调课安排、时间地点、报名或截止日期等客观信息）→ 写入顶层 facts 数组，不产实体；每条一句话、必须含具体日期或关键数字、不超过 140 字，例：「国庆放假：10月1日–7日调休共7天；10月10日（周六）补课，执行10月7日（周三）教学安排」。
   需要做的事（报备、提交、申请、报名等必须完成的动作）→ 产出 kind:"task" 动作；若该义务只对部分人成立，condition 写清适用条件（不超过 30 字，如「仅出国（境）者」「仅留校学生」）；确实对所有人成立的义务可省略 condition。
   纯建议 / 提醒 / 安全须知（防蚊、饮食、防溺水宣传等）→ 默认不产出任何动作；仅当某条具体、可操作、值得保留时，才作为一条 facts 写入。
8. facts 宁少而精：最多 8 条，只保留对个人有用的硬信息；与普通学生无关的泛泛内容不要写。actions 仍遵守第 1 条（通常 1–4 个，最多 6 个）。
9. 图片条目：附件是图片时，按本条（文本规则）同样处理，多动作产出；若图片内容明显是文章 / 资料而非通知，按第 2 条产出 resource。`
  const factsHint = fileMode
    ? ''
    : `- facts: 顶层字符串数组，≤8 条；硬事实 / 值得保留的提醒，每条 ≤140 字、含具体日期或数字\n`
  const conditionHint = fileMode
    ? ''
    : `\n- condition: 仅 task 用。该义务的适用条件（≤30 字）；只对部分人成立时必填（如「仅出国（境）者」）；对所有人成立则省略`
  return `${head}

每个 action 对象字段：
${factsHint}- kind: "task" | "note" | "resource" | "project"（必填）
- title: 提炼后的标题（不超过 40 字，必填）
- note: 仅 resource 用。1–3 句、不超过 ${AI_RESOURCE_NOTE_MAX_CHARS} 字的简约小结，作为资料详情页的「简介」（概括这是什么资料、讲了什么、有什么用）；附件条目必须给出此字段
- reason: 一句话说明该动作的判断理由
- contexts: 仅 task 用，字符串数组，只能从 [${contextRuleText(contextNames)}] 中选（无把握则省略）
- energy: 仅 task 用，"low" | "medium" | "high"
- importance: 仅 task 用，0 | 1 | 2 | 3（整数；0 = 最低 / 可略过的输入）
- estimateMin: 仅 task 用，预计所需分钟数（整数，最少 1 分钟）
- dueAt: 仅 task 用，ISO8601 带时区或 null。现在是 ${stamp}${conditionHint}
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
    for (const key of ['projectId', 'areaId', 'duplicateOf', 'outcome', 'dueAt', 'estimateMin', 'energy', 'importance', 'note', 'condition']) {
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
    // note 仅 resource 有意义（Slice R2.5）：折叠空白 + 截断 ≤120，空则删除
    if (out.kind === 'resource') {
      const note = normalizeResourceNote(out.note, '')
      if (note === '') delete out.note
      else out.note = note
    } else {
      delete out.note
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
      return { ok: true, actions: parsed.actions, facts: parsed.facts }
    }
    // 向后兼容：旧式单建议形状（无顶层 facts）
    return { ok: true, actions: legacyToActions(aiSuggestionSchema.parse(obj)), facts: [] }
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
  return { res, actions: parsed.actions, facts: parsed.facts }
}

/**
 * 文件条目解析的后校验选项（Slice R2.5）：hasFile + 文件名兜底标题 + 内容可读性兜底小结。
 * 图片条目（Slice N0）附 isImage=true，使 postValidateActions 跳过「资料 + 简介」硬归一化。
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
  const imagePart = isImage ? await buildImagePart(item) : null
  const system = buildSystem(buildDigest(snapshot), hasFile, contextNamesOf(snapshot), { isImage })
  const sessionID = await createSession()
  const userText = fileSection === '' ? item.content : `${item.content}\n\n${fileSection}`
  const extraParts = imagePart === null ? [] : [imagePart]
  const { res, actions, facts } = await promptWithRetry(sessionID, system, userText, null, extraParts)
  const clean = postValidateActions(actions, snapshot, fileParseOptions(item, hasFile, fileSection))
  const cleanFactList = cleanFacts(facts)
  const model = modelOf(res)
  const ms = Date.now() - t0
  console.log(
    `[ai] inbox.parse ${item.id} 完成 ${ms}ms（${model ?? '未知模型'} · ${clean.length} 动作 · ${cleanFactList.length} 事实）`,
  )
  return { actions: clean, facts: cleanFactList, model, ms }
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
    const imagePart = isImage ? await buildImagePart(item) : null
    const system = buildSystem(buildDigest(snapshot), hasFile, contextNamesOf(snapshot), { isImage })
    sessionID = await createSession()
    const userText = fileSection === '' ? item.content : `${item.content}\n\n${fileSection}`
    const extraParts = imagePart === null ? [] : [imagePart]
    const { res, actions, facts } = await promptWithRetry(sessionID, system, userText, safeEmit, extraParts)
    const clean = postValidateActions(actions, snapshot, fileParseOptions(item, hasFile, fileSection))
    const cleanFactList = cleanFacts(facts)
    const model = modelOf(res)
    const ms = Date.now() - t0
    safeEmit({ kind: 'suggestion', actions: clean, facts: cleanFactList, model, ms })
    console.log(
      `[ai] inbox.parse-stream ${item.id} 完成 ${ms}ms（${model ?? '未知模型'} · ${clean.length} 动作 · ${cleanFactList.length} 事实）`,
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
  const imagePart = isImage ? await buildImagePart(item) : null
  const system = buildTimetableSystem({ isImage })
  const sessionID = await createSession('kernel:timetable-draft')
  const userText = fileSection === '' ? item.content : `${item.content}\n\n${fileSection}`
  const extraParts = imagePart === null ? [] : [imagePart]
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
    const imagePart = isImage ? await buildImagePart(item) : null
    const system = buildTimetableSystem({ isImage })
    sessionID = await createSession('kernel:timetable-draft')
    const userText = fileSection === '' ? item.content : `${item.content}\n\n${fileSection}`
    const extraParts = imagePart === null ? [] : [imagePart]
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
