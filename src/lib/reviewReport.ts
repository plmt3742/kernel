// KERNEL · 回顾报告分节解析（Slice U · 阅读视图）
// 把 summary 拆成七段（结论速览 → … → 风险预警），供回顾页「阅读视图」安静分栏渲染。
// 兼容「结论速览：…」与「一、结论速览」两种标题写法；纯文本，无 dangerouslySetInnerHTML。
// 与 server/ai.mjs 的同名解析规则刻意保持一致（服务端用它做「下期行动」去重），勿单边改动。

export interface ReportSection {
  /** 规范标题（别名已归一，如「本期数据解读」→「数据解读」） */
  label: string
  /** 段正文（保留多行，行间以 \n 连接） */
  body: string
}

/** 七段规范标题 + 可识别别名（与 server/ai.mjs REVIEW_SECTION_ALIASES 对应） */
const SECTION_ALIASES: ReadonlyArray<{ label: string; aliases: readonly string[] }> = [
  { label: '结论速览', aliases: ['结论速览'] },
  { label: '数据解读', aliases: ['本期数据解读', '数据解读'] },
  { label: '趋势与对比', aliases: ['趋势与对比', '趋势对比'] },
  { label: '问题诊断', aliases: ['问题诊断'] },
  { label: '值得保留', aliases: ['值得保留'] },
  { label: '下期行动', aliases: ['下期行动'] },
  { label: '风险预警', aliases: ['风险预警'] },
]

/** 别名按长度降序，保证「本期数据解读」优先于「数据解读」匹配 */
const ALIAS_INDEX: ReadonlyArray<{ alias: string; label: string }> = SECTION_ALIASES.flatMap(
  (entry) => entry.aliases.map((alias) => ({ alias, label: entry.label })),
).sort((a, b) => b.alias.length - a.alias.length)

/** 去掉行首序号（「一、」「（二）」「1.」「1)」等） */
function stripSectionNumbering(line: string): string {
  return line.replace(/^[（(]?(?:[一二三四五六七八九十]+|\d+)[）)]?\s*[、.．:：)）]?\s*/, '')
}

interface HeadingMatch {
  label: string
  body: string
}

/** 识别分节标题行；返回 { label, body } 或 null */
function matchHeading(line: string): HeadingMatch | null {
  const raw = line.trim()
  if (raw === '') return null
  const stripped = stripSectionNumbering(raw).trim()
  for (const { alias, label } of ALIAS_INDEX) {
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
 * 拆解报告正文：`intro` 为首个标题之前的文字，`sections` 为各段。
 * 无法识别任何标题时 `sections` 为空，由调用方回退为整段渲染。
 */
export function parseReviewSummary(text: string): { intro: string; sections: ReportSection[] } {
  const lines = text.split(/\r?\n/)
  const sections: ReportSection[] = []
  const intro: string[] = []
  let current: ReportSection | null = null
  for (const line of lines) {
    const heading = matchHeading(line)
    if (heading !== null) {
      current = { label: heading.label, body: heading.body }
      sections.push(current)
      continue
    }
    const trimmed = line.trim()
    if (trimmed === '') continue
    if (current === null) intro.push(trimmed)
    else current.body = current.body === '' ? trimmed : `${current.body}\n${trimmed}`
  }
  return { intro: intro.join('\n'), sections }
}

/** 段正文按换行拆成自然段（供逐段渲染，保留阅读留白） */
export function sectionParagraphs(body: string): string[] {
  return body
    .split(/\n+/)
    .map((para) => para.trim())
    .filter((para) => para !== '')
}
