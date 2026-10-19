#!/usr/bin/env node
/**
 * 语法门禁：对 server/ 与 scripts/ 下所有 .mjs 运行 `node --check`。
 * 只查语法，不做类型检查；类型由 `npm run build`（tsc -b）负责。
 */
import { readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { execFileSync } from 'node:child_process'

const ROOT = process.cwd()
const SKIP = new Set(['node_modules', '.git', '.qa', 'dist', '.vite'])
const ROOTS = ['server', 'scripts']

/** @type {string[]} */
const files = []

function walk(dir) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (SKIP.has(entry.name)) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full)
      continue
    }
    if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(full)
  }
}

for (const root of ROOTS) {
  const full = join(ROOT, root)
  try {
    if (statSync(full).isDirectory()) walk(full)
  } catch {
    /* 目录不存在则跳过 */
  }
}

let failed = 0
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    failed += 1
    const stderr = error && typeof error === 'object' && 'stderr' in error ? String(error.stderr) : ''
    console.error(`[syntax] FAIL ${relative(ROOT, file)}`)
    if (stderr.trim() !== '') console.error(stderr.trim())
  }
}

console.log(`[syntax] ${files.length - failed}/${files.length} passed`)
process.exit(failed === 0 ? 0 : 1)
