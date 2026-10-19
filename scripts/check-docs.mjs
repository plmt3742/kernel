#!/usr/bin/env node
/**
 * 文档义务门禁：把 AGENTS.md 的「文档义务」变成可执行检查。
 *
 * 用法：
 *   node scripts/check-docs.mjs                  # 工作区（HEAD 对比 + 未跟踪文件）
 *   node scripts/check-docs.mjs --staged         # 暂存区
 *   node scripts/check-docs.mjs --range <rev>    # CI：git diff <rev>
 *
 * 检查项：
 *   1. 代码 / 脚本 / 配置变更 → CHANGELOG.md + TASK_BOOK.md
 *   2. server/schemas.mjs 变更 → docs/04-DATA-MODEL.md
 *   3. 新增目录 / 关键文件 → docs/05-FILE-TREE.md
 *   4. docs/*.md 变更 → docs/README.md
 *   5. 新 ADR → docs/README.md 登记 + 编号不重复
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'

const ROOT = process.cwd()
const args = process.argv.slice(2)

function argValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

function git(gitArgs) {
  return execFileSync('git', gitArgs, { cwd: ROOT, encoding: 'utf8' })
}

function toLines(text) {
  return text.split(/\r?\n/).filter((line) => line !== '')
}

function changedFiles(diffFilter) {
  if (args.includes('--staged')) {
    return toLines(git(['diff', '--cached', '--name-only', `--diff-filter=${diffFilter}`]))
  }
  const range = argValue('--range')
  if (range !== undefined) {
    return toLines(git(['diff', '--name-only', `--diff-filter=${diffFilter}`, range]))
  }
  const tracked = toLines(git(['diff', '--name-only', `--diff-filter=${diffFilter}`, 'HEAD']))
  if (diffFilter.includes('A')) {
    const untracked = toLines(git(['ls-files', '--others', '--exclude-standard']))
    return [...new Set([...tracked, ...untracked])]
  }
  return tracked
}

const files = changedFiles('ACMR')
const added = new Set(changedFiles('A'))
const set = new Set(files)
const errors = []

function requireFile(file, message) {
  if (!set.has(file)) errors.push(message)
}

const codeChanged = files.some(
  (file) =>
    /^(src|server|scripts|installer)\//.test(file) ||
    file === 'package.json' ||
    file === 'vite.config.ts' ||
    file === 'tsconfig.json',
)

if (codeChanged) {
  requireFile('CHANGELOG.md', '代码 / 脚本 / 配置变更必须更新 CHANGELOG.md')
  requireFile('TASK_BOOK.md', '代码 / 脚本 / 配置变更必须更新 TASK_BOOK.md')
}

if (set.has('server/schemas.mjs')) {
  requireFile('docs/04-DATA-MODEL.md', 'server/schemas.mjs 变更必须同步 docs/04-DATA-MODEL.md')
}

const structuralAdded = [...added].filter((file) => {
  if (/^(scripts|installer|\.github)\//.test(file)) return true
  if (!file.includes('/')) {
    return !['README.md', 'CHANGELOG.md', 'TASK_BOOK.md', 'AGENTS.md'].includes(file)
  }
  return false
})

if (structuralAdded.length > 0) {
  requireFile(
    'docs/05-FILE-TREE.md',
    `新增目录 / 关键文件必须更新 docs/05-FILE-TREE.md（${structuralAdded.join(', ')}）`,
  )
}

const docsChanged = files.filter((file) => /^docs\/[^/]+\.md$/.test(file) && file !== 'docs/README.md')
if (docsChanged.length > 0) {
  requireFile('docs/README.md', `docs/ 文档变更必须同步 docs/README.md（${docsChanged.join(', ')}）`)
}

const adrDir = 'docs/decisions'
const adrFiles = existsSync(adrDir)
  ? readdirSync(adrDir).filter((name) => /^\d{4}-.+\.md$/.test(name))
  : []
const newAdrs = [...added].filter((file) => /^docs\/decisions\/\d{4}-.+\.md$/.test(file))

for (const file of newAdrs) {
  const match = file.match(/^docs\/decisions\/(\d{4})-/)
  if (match === null) continue
  const number = match[1]
  const sameNumber = adrFiles.filter((name) => name.startsWith(`${number}-`))
  if (sameNumber.length > 1) {
    errors.push(`ADR 编号重复：${number}（${sameNumber.join(', ')}）`)
  }
  const indexFile = 'docs/README.md'
  const indexText = existsSync(indexFile) ? readFileSync(indexFile, 'utf8') : ''
  const indexName = file.replace(/^docs\//, '')
  if (!indexText.includes(indexName)) {
    errors.push(`新 ADR 未登记到 docs/README.md：${file}`)
  }
}

if (errors.length > 0) {
  for (const message of errors) console.error(`[docs] FAIL ${message}`)
  console.log(`[docs] files=${files.length} errors=${errors.length}`)
  process.exit(1)
}

console.log(`[docs] files=${files.length} errors=0`)
