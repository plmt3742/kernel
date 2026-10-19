#!/usr/bin/env node
/**
 * 隐私门禁：检查本次变更中是否出现密钥、本机绝对路径、data/、.qa/ 等禁止提交内容。
 *
 * 用法：
 *   node scripts/check-privacy.mjs                  # 工作区（HEAD 对比 + 未跟踪文件）
 *   node scripts/check-privacy.mjs --staged         # 暂存区（pre-commit）
 *   node scripts/check-privacy.mjs --range <rev>    # CI：git diff <rev>
 *   node scripts/check-privacy.mjs --files <paths>  # 只扫指定文件全文
 *
 * 退出码：发现 error 为 1；只有 warning 为 0。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

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

function changedFiles() {
  if (args.includes('--staged')) {
    return toLines(git(['diff', '--cached', '--name-only', '--diff-filter=ACMR']))
  }
  const range = argValue('--range')
  if (range !== undefined) {
    return toLines(git(['diff', '--name-only', '--diff-filter=ACMR', range]))
  }
  const filesIndex = args.indexOf('--files')
  if (filesIndex >= 0) {
    return args.slice(filesIndex + 1).filter((value) => !value.startsWith('--'))
  }
  const tracked = toLines(git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']))
  const untracked = toLines(git(['ls-files', '--others', '--exclude-standard']))
  return [...new Set([...tracked, ...untracked])]
}

function isUntracked(file) {
  try {
    const out = git(['ls-files', '--others', '--exclude-standard', '--', file])
    return out.trim() !== ''
  } catch {
    return false
  }
}

function linesToScan(file) {
  if (args.includes('--files') || isUntracked(file)) {
    try {
      return toLines(readFileSync(file, 'utf8'))
    } catch {
      return []
    }
  }
  let diff = ''
  if (args.includes('--staged')) {
    diff = git(['diff', '--cached', '--unified=0', '--', file])
  } else {
    const range = argValue('--range')
    diff = range !== undefined
      ? git(['diff', '--unified=0', range, '--', file])
      : git(['diff', '--unified=0', 'HEAD', '--', file])
  }
  return toLines(diff)
    .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
    .map((line) => line.slice(1))
}

const forbiddenPaths = [
  [/^data\//, 'data/ 是本地数据，禁止提交'],
  [/^\.qa\//, '.qa/ 是本地证据，禁止提交'],
  [/(^|\/)node_modules\//, 'node_modules 禁止提交'],
  [/(^|\/)\.env(?!\.example)(\.[^/]*)?$/, '.env 实值禁止提交（.env.example 允许）'],
  [/(^|\/)secrets\.json$/, 'secrets.json 禁止提交'],
]

const secretRules = [
  [/sk-[A-Za-z0-9_-]{20,}/, '疑似 API Key（sk-）'],
  [/ghp_[A-Za-z0-9]{20,}/, '疑似 GitHub PAT（ghp_）'],
  [/github_pat_[A-Za-z0-9_]{20,}/, '疑似 GitHub fine-grained PAT'],
  [/AKIA[0-9A-Z]{16}/, '疑似 AWS Access Key'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, '私钥'],
  [/xox[baprs]-[A-Za-z0-9-]{10,}/, '疑似 Slack token'],
]

const localPathRules = [
  [/\b[A-Za-z]:\\Users\\[^\\\s"']+/, '本机用户目录路径'],
  [/\b[A-Za-z]:\\AIworkspace\\/, '本机工作区路径'],
  [/\b[A-Za-z]:\\KERNEL\b/, '本机安装目录路径'],
]

const warningRules = [
  [/\b1[3-9]\d{9}\b/, '疑似手机号'],
]

const files = changedFiles()
let errors = 0
let warnings = 0

for (const file of files) {
  for (const [pattern, message] of forbiddenPaths) {
    if (pattern.test(file)) {
      console.error(`[privacy] FAIL ${file}: ${message}`)
      errors += 1
    }
  }
  if (!/\.(md|txt|json|jsonl|mjs|cjs|js|ts|tsx|yml|yaml|html|css|ps1|vbs|cmd|iss|example)$/i.test(file)) {
    continue
  }
  const lines = linesToScan(file)
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (line.includes('\0')) continue
    for (const [pattern, message] of secretRules) {
      if (pattern.test(line)) {
        console.error(`[privacy] FAIL ${file}:${i + 1}: ${message}（值已隐藏）`)
        errors += 1
      }
    }
    for (const [pattern, message] of localPathRules) {
      if (pattern.test(line)) {
        console.error(`[privacy] FAIL ${file}:${i + 1}: ${message}（值已隐藏）`)
        errors += 1
      }
    }
    for (const [pattern, message] of warningRules) {
      if (pattern.test(line)) {
        console.warn(`[privacy] WARN ${file}:${i + 1}: ${message}（确认是否为测试数据）`)
        warnings += 1
      }
    }
  }
}

console.log(`[privacy] files=${files.length} errors=${errors} warnings=${warnings}`)
process.exit(errors === 0 ? 0 : 1)
