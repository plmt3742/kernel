// 设计稿 v2 · 选型页与对比页生成器
// 用法（在 kernel 根目录）：node design-drafts/v2/_build.mjs
// 前置：previews/<name>.png 已由主会话渲染；本脚本读取各变体 HTML 顶部的概念注释，
//       生成 index.html（选型页）与 _sheets/<page>.html（三版并排对比页）。
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DIR = path.dirname(fileURLToPath(import.meta.url))

const PAGES = [
  {
    key: 'overview',
    title: '总览',
    en: 'OVERVIEW',
    note: '信息中枢：一天从哪里开始看。',
    variants: ['overview-a', 'overview-b', 'overview-c'],
  },
  {
    key: 'inbox',
    title: '收件箱',
    en: 'INBOX',
    note: '捕捉 → 澄清的处理台。',
    variants: ['inbox-a', 'inbox-b', 'inbox-c'],
  },
  {
    key: 'tasks',
    title: '任务',
    en: 'TASKS',
    note: '每日执行的主列表：扫描与定位效率是关键。',
    variants: ['tasks-a', 'tasks-b', 'tasks-c'],
  },
  {
    key: 'calendar',
    title: '日程',
    en: 'CALENDAR',
    note: '时间上下文：日 / 周 / 议程流三种视角。',
    variants: ['calendar-a', 'calendar-b', 'calendar-c'],
  },
  {
    key: 'projects',
    title: '项目',
    en: 'PROJECTS',
    note: '多步结果承诺：看板 / 列表 / 网格三种组织。',
    variants: ['projects-a', 'projects-b', 'projects-c'],
  },
  {
    key: 'library',
    title: '资料',
    en: 'LIBRARY',
    note: '知识流：列表 / 卡片 / 三栏阅读。',
    variants: ['library-a', 'library-b', 'library-c'],
  },
  {
    key: 'review',
    title: '回顾',
    en: 'REVIEW',
    note: '系统的"心跳"：叙事 / 仪表盘 / 向导。',
    variants: ['review-a', 'review-b', 'review-c'],
  },
  {
    key: 'settings',
    title: '设置',
    en: 'SETTINGS',
    note: '偏好与数据服务：卡片组 / 侧导航 / 单列流。',
    variants: ['settings-a', 'settings-b', 'settings-c'],
  },
  {
    key: 'detail',
    title: '详情面板',
    en: 'DETAIL DRAWERS',
    note: '点击卡片/行展开的抽屉（任务为基准，骨架适用于事件/项目/笔记/资料）。',
    variants: ['detail-task-a', 'detail-task-b', 'detail-task-c', 'detail-note-a', 'detail-event-a'],
  },
  {
    key: 'charts',
    title: '图表组件（监控）',
    en: 'CHART KIT',
    note: '监控图表词汇表：完成趋势 / 到期负载 / 能量分布 / 连续打卡 / 水位 / WIP / 项目推进。',
    variants: ['charts-kit'],
  },
]

const esc = (text) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** 提取变体概念注释：剥离内联样式中查找注释块，清除装饰分隔线与前缀噪音 */
async function conceptOf(name) {
  try {
    const raw = await fs.readFile(path.join(DIR, `${name}.html`), 'utf8')
    const stripped = raw.replace(/<style[\s\S]*?<\/style>/gi, '')
    const comments = [...stripped.matchAll(/<!--([\s\S]*?)-->/g)].map((m) => m[1])
    const block =
      comments.find((text) => text.includes('概念') || text.includes('变体')) ?? comments[0] ?? ''
    const lines = block
      .split('\n')
      .map((line) => line.replace(/^[\s\-─━═=*#·•]+|[\s\-─━═=*·•]+$/g, '').trim())
      .filter((line) => line.length > 0 && /[\p{L}\p{N}]/u.test(line))
      .map((line) => line.replace(/^KERNEL\s*·?\s*(设计稿\s*v2\s*·?\s*)?/u, '').trim())
    return lines.join(' · ').slice(0, 300) || '（未提取到概念注释）'
  } catch {
    return '（文件缺失）'
  }
}

/* ---------------------------------------------------------------------------
 * 自包含打包：把应用 CSS 内联进每个草案
 * 目的：双击文件（file://）也能看到完整样式；dev URL 访问同样有效。
 * 幂等：已内联的文件（无 link 标记）自动跳过；_base.html 模板保持原样。
 * ------------------------------------------------------------------------- */

const APP_CSS_FILES = ['tokens', 'base', 'shell', 'components', 'views']

async function bundleDrafts() {
  const css = {}
  for (const name of APP_CSS_FILES) {
    css[name] = await fs.readFile(path.join(DIR, '..', '..', 'src', 'styles', `${name}.css`), 'utf8')
  }
  const files = (await fs.readdir(DIR)).filter(
    (file) => file.endsWith('.html') && file !== '_base.html' && file !== 'index.html',
  )
  const bundled = []
  for (const file of files) {
    const full = path.join(DIR, file)
    let raw = await fs.readFile(full, 'utf8')
    let changed = false
    for (const name of APP_CSS_FILES) {
      const linkRe = new RegExp(`<link\\s+rel="stylesheet"\\s+href="/src/styles/${name}\\.css"\\s*/?>`, 'g')
      let next = raw.replace(linkRe, `<style data-app-css="${name}">\n${css[name]}\n</style>`)
      // 刷新已内联块：应用样式更新后，重跑本脚本即可把新 CSS 同步进全部草稿
      const inlineRe = new RegExp(`<style data-app-css="${name}">[\\s\\S]*?</style>`, 'g')
      next = next.replace(inlineRe, `<style data-app-css="${name}">\n${css[name]}\n</style>`)
      if (next !== raw) {
        raw = next
        changed = true
      }
    }
    if (raw.includes("url('/design-drafts/fonts/")) {
      raw = raw.replaceAll("url('/design-drafts/fonts/", "url('../fonts/")
      changed = true
    }
    if (changed) {
      await fs.writeFile(full, raw, 'utf8')
      bundled.push(file)
    }
  }
  return bundled
}

const exists = async (p) => {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

const pageHtml = (body) => `<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>KERNEL · 页面排版多版本选型</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; background: #0f0f10; color: #f4f4f5; font-family: "Inter Variable", Inter, "PingFang SC", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 1320px; margin: 0 auto; padding: 48px 32px 96px; }
  h1 { font-size: 30px; letter-spacing: -0.02em; margin: 0 0 8px; }
  .intro { color: #929298; font-size: 14px; line-height: 1.8; margin: 0 0 40px; }
  .intro code { background: rgba(255,255,255,.06); padding: 1px 6px; border-radius: 6px; }
  .page { margin-bottom: 56px; }
  .page h2 { font-size: 20px; margin: 0 0 4px; }
  .page .note { color: #929298; font-size: 13px; margin: 0 0 16px; }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
  .cards.five { grid-template-columns: repeat(3, 1fr); }
  .card { background: #1a1a1c; border: 1px solid rgba(255,255,255,.06); border-radius: 16px; overflow: hidden; box-shadow: 0 16px 40px rgba(0,0,0,.45); display: flex; flex-direction: column; }
  .card a.shot { display: block; border-bottom: 1px solid rgba(255,255,255,.06); }
  .card img { display: block; width: 100%; aspect-ratio: 1600 / 1000; object-fit: cover; object-position: top; }
  .card .body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 8px; }
  .card .tag { font-size: 11px; color: #929298; letter-spacing: .04em; }
  .card .name { font-size: 15px; font-weight: 600; }
  .card .concept { font-size: 12.5px; color: #a1a1aa; line-height: 1.7; }
  .card .links { display: flex; gap: 12px; font-size: 12px; margin-top: 2px; }
  .card .links a { color: #ff8a80; text-decoration: none; }
  .card .links a:hover { text-decoration: underline; }
  .sheetlink { margin-left: 12px; font-size: 12px; color: #929298; }
  .sheetlink a { color: #a1a1aa; }
  footer { color: #6e6e73; font-size: 12px; margin-top: 64px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>KERNEL · 页面排版多版本选型</h1>
  <p class="intro">
    每一项给出 3 版排版/组件编排方案（风格不变：柔暗夜色 + 柔影悬浮）。评审方式：<br />
    ① 直接打开各版本实时页面（<code>/design-drafts/v2/&lt;name&gt;.html</code>，可拖动窗口看自适应）；② 看下方预览图与三版对比页；③ 选中的组合告诉我即可落到 <code>src/</code>。<br />
    明细概念写在每个文件顶部注释；此页每张卡片的摘要即提取自该注释。
  </p>
${body}
  <footer>KERNEL 设计稿 v2 · 生成于 ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · 风格 token 与线上应用完全一致</footer>
</div>
</body>
</html>`

const cardHtml = (pageKey, name) => {
  const variantLabel = name.replace('detail-task-', 'task-').replace('detail-note-', 'note-').replace('detail-event-', 'event-')
  const letter = variantLabel.slice(-1).toUpperCase()
  return `    <div class="card">
      <a class="shot" href="./${name}.html" title="打开实时页面"><img src="./previews/${name}.png" alt="${name}" loading="lazy" /></a>
      <div class="body">
        <span class="tag">${pageKey.toUpperCase()} · 方案 ${letter}</span>
        <span class="name">${name}</span>
        <span class="concept" data-concept="${name}">{CONCEPT:${name}}</span>
        <span class="links"><a href="./${name}.html">打开实时页</a><a href="./_sheets/${pageKey}.html">三版对比</a></span>
      </div>
    </div>`
}

let index = ''
const sheets = []

for (const page of PAGES) {
  const cards = []
  const sheetCards = []
  for (const name of page.variants) {
    const concept = await conceptOf(name)
    const previewOk = await exists(path.join(DIR, 'previews', `${name}.png`))
    cards.push(
      cardHtml(page.key, name).replace(`{CONCEPT:${name}}`, esc(concept)).replace(
        `./previews/${name}.png`,
        previewOk ? `./previews/${name}.png` : `./previews/_missing.png`,
      ),
    )
    sheetCards.push(`<figure><img src="../previews/${name}.png" alt="${name}" /><figcaption><b>${name}</b><br />${esc(concept)}</figcaption></figure>`)
  }
  index += `  <section class="page">
    <h2>${page.title} <span style="color:#6e6e73;font-size:13px">${page.en}</span><span class="sheetlink">· <a href="./_sheets/${page.key}.html">三版对比页</a></span></h2>
    <p class="note">${page.note}</p>
    <div class="cards${page.variants.length > 3 ? ' five' : ''}">
${cards.join('\n')}
    </div>
  </section>\n`

  sheets.push(`<!doctype html>
<html lang="zh-CN" data-theme="dark">
<head>
<meta charset="UTF-8" /><title>${page.title} · 三版对比</title>
<style>
  body { margin: 0; background: #0f0f10; color: #f4f4f5; font-family: "Inter Variable", Inter, "PingFang SC", sans-serif; }
  .wrap { max-width: 1720px; margin: 0 auto; padding: 32px 24px 64px; }
  h1 { font-size: 22px; margin: 0 0 20px; }
  h1 a { color: #929298; font-size: 13px; margin-left: 12px; }
  .row { display: grid; grid-template-columns: repeat(${Math.min(page.variants.length, 3)}, 1fr); gap: 18px; }
  figure { margin: 0; background: #1a1a1c; border: 1px solid rgba(255,255,255,.06); border-radius: 12px; overflow: hidden; }
  figure img { display: block; width: 100%; }
  figcaption { padding: 10px 12px 14px; font-size: 12px; color: #a1a1aa; line-height: 1.7; }
</style>
</head>
<body><div class="wrap">
<h1>${page.title} · 三版对比 <a href="../index.html">← 返回选型页</a></h1>
<div class="row">${sheetCards.join('\n')}</div>
</div></body></html>`)
}

await fs.writeFile(path.join(DIR, 'index.html'), pageHtml(index), 'utf8')

await fs.mkdir(path.join(DIR, '_sheets'), { recursive: true })
for (let i = 0; i < PAGES.length; i += 1) {
  await fs.writeFile(path.join(DIR, '_sheets', `${PAGES[i].key}.html`), sheets[i], 'utf8')
}

const bundled = await bundleDrafts()
console.log('index.html 与 _sheets/ 生成完成：', PAGES.length, '组')
console.log(`自包含打包：本轮内联 ${bundled.length} 个文件${bundled.length > 0 ? `（${bundled.join(', ')}）` : '（均已内联，跳过）'}`)
