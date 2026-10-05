#!/usr/bin/env node
/**
 * KERNEL · 种子数据生成器（Wave B）
 * 事实源：docs/00-DESIGN-BRIEF.md §7
 * "现在" = 2026-10-02 · 全中文 · ISO 8601 带 +08:00 偏移
 *
 * 用法：
 *   node scripts/seed.mjs           首次生成（data/ 已有数据则拒绝覆盖）
 *   node scripts/seed.mjs --force   清空并重置 data/
 */
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const DATA = join(ROOT, 'data')
const FORCE = process.argv.includes('--force')

/* ---------------------------------------------------------------------------
 * 保护：拒绝覆盖既有数据
 * ------------------------------------------------------------------------- */
function hasExistingData() {
  if (!existsSync(DATA)) return false
  for (const entry of readdirSync(DATA, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(DATA, entry.name)
    if (readdirSync(dir).some((f) => f.endsWith('.json'))) return true
  }
  return false
}

if (hasExistingData() && !FORCE) {
  console.error('[seed] 拒绝覆盖：data/ 已存在数据。如需重置请运行 `npm run seed -- --force`。')
  process.exit(1)
}
if (FORCE) {
  rmSync(DATA, { recursive: true, force: true })
}
mkdirSync(DATA, { recursive: true })

/* ---------------------------------------------------------------------------
 * 写入工具（UTF-8，无 BOM，2 空格缩进）
 * ------------------------------------------------------------------------- */
function writeRecord(folder, id, obj) {
  const dir = join(DATA, folder)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

function writeMeta(name, obj) {
  const dir = join(DATA, 'meta')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${name}.json`), JSON.stringify(obj, null, 2) + '\n', 'utf8')
}

/* ---------------------------------------------------------------------------
 * 时间常量
 * ------------------------------------------------------------------------- */
const T_BASE = '2026-09-15T10:00:00+08:00'
const T_UPD = '2026-10-02T08:30:00+08:00'

/* ---------------------------------------------------------------------------
 * 工厂函数（补全必填字段，未提供者由 JSON.stringify 丢弃可选键）
 * ------------------------------------------------------------------------- */
function area(id, title, standard, cadence, status = 'active') {
  return { id, title, standard, cadence, status }
}

function inboxItem(id, content, source, capturedAt, status = 'unprocessed', extra = {}) {
  return { id, content, source, capturedAt, status, ...extra }
}

function task(id, title, o = {}) {
  return {
    id,
    title,
    notes: o.notes,
    status: o.status ?? 'next',
    contexts: o.contexts ?? [],
    energy: o.energy ?? 'medium',
    estimateMin: o.estimateMin,
    importance: o.importance ?? 1,
    dueAt: o.dueAt,
    deferUntil: o.deferUntil,
    projectId: o.projectId,
    areaId: o.areaId,
    parentTaskId: o.parentTaskId,
    tags: o.tags ?? [],
    repeatRule: o.repeatRule,
    createdAt: o.createdAt ?? T_BASE,
    updatedAt: o.updatedAt ?? T_UPD,
    doneAt: o.doneAt,
    sourceInboxId: o.sourceInboxId,
  }
}

function project(id, title, outcome, o = {}) {
  return {
    id,
    title,
    outcome,
    status: o.status ?? 'active',
    areaId: o.areaId,
    goalId: o.goalId,
    nextActionId: o.nextActionId,
    dueAt: o.dueAt,
    tags: o.tags ?? [],
    createdAt: o.createdAt ?? T_BASE,
    updatedAt: o.updatedAt ?? T_UPD,
  }
}

function keyResult(text, target, current, unit) {
  return { text, target, current, unit }
}

function goal(id, title, horizon, o = {}) {
  return {
    id,
    title,
    horizon,
    areaId: o.areaId,
    parentGoalId: o.parentGoalId,
    keyResults: o.keyResults ?? [],
    status: o.status ?? 'active',
    targetDate: o.targetDate,
  }
}

function habit(id, title, cadence, trigger, metric, target, areaId, log) {
  return { id, title, cadence, trigger, metric, target, areaId, log }
}

function event(id, title, o) {
  return {
    id,
    title,
    startAt: o.startAt,
    endAt: o.endAt,
    allDay: o.allDay ?? false,
    location: o.location,
    areaId: o.areaId,
    projectId: o.projectId,
    tags: o.tags ?? [],
    status: o.status ?? 'confirmed',
    repeatRule: o.repeatRule,
  }
}

function note(id, title, type, body, o = {}) {
  return {
    id,
    title,
    type,
    body,
    links: o.links ?? [],
    areaId: o.areaId,
    projectId: o.projectId,
    tags: o.tags ?? [],
    distillLevel: o.distillLevel ?? 0,
    createdAt: o.createdAt ?? T_BASE,
    updatedAt: o.updatedAt ?? T_UPD,
  }
}

function resource(id, title, kind, status, o = {}) {
  return {
    id,
    title,
    url: o.url,
    kind,
    status,
    tags: o.tags ?? [],
    areaId: o.areaId,
    addedAt: o.addedAt ?? T_BASE,
    note: o.note,
  }
}

function review(id, type, periodKey, date, metrics, decisions, summary, staleProjectIds) {
  return { id, type, periodKey, date, metrics, decisions, summary, staleProjectIds }
}

/* ---------------------------------------------------------------------------
 * 习惯打卡日志生成（确定性，不依赖系统时区）
 * ------------------------------------------------------------------------- */
function lcg(seed) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function fmtDate(d) {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function genLog(days, seed, missRate, valueFn) {
  const rnd = lcg(seed)
  const end = new Date(Date.UTC(2026, 9, 2)) // 2026-10-02 UTC
  const out = []
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(end.getTime() - i * 86400000)
    if (rnd() < missRate) continue
    out.push({ date: fmtDate(d), value: valueFn(rnd) })
  }
  return out
}

/* ===========================================================================
 * 区域（§7.3 的 7 个，标准式）
 * ========================================================================= */
const areas = [
  area('a-0001', '学业', '无挂科；作业不过夜', 'weekly'),
  area('a-0002', '学生工作', '通知不过夜；同学求助当天回应', 'weekly'),
  area('a-0003', '竞赛与组织', '活动落地；结束后一周内复盘归档', 'monthly'),
  area('a-0004', '算法成长', '每周 ≥5 题；CF 稳步上分', 'weekly'),
  area('a-0005', '技术创作', '每两周至少一次可见产出', 'monthly'),
  area('a-0006', '健康作息', '23:30 前睡；每周运动 3 次', 'weekly'),
  area('a-0007', '人际与连接', '主动维护导师/同学/朋友网络', 'monthly'),
]

/* ===========================================================================
 * 项目（10）
 * ========================================================================= */
const projects = [
  project('p-0001', 'KERNEL v0.2 前端原型', '两周内交付可演示的本地优先事务内核原型', {
    areaId: 'a-0005', goalId: 'g-0005', nextActionId: 't-0021',
    tags: ['role:vibecoder', 'topic:KERNEL'], dueAt: '2026-10-16T23:59:00+08:00',
    createdAt: '2026-09-20T20:00:00+08:00',
  }),
  project('p-0002', '学生组织 10 月程序设计大赛', '12 月前成功主办一场 120 人规模的院级赛事', {
    areaId: 'a-0003', goalId: 'g-0003', nextActionId: 't-0026',
    tags: ['role:competition-head', 'topic:竞赛'], dueAt: '2026-10-18T23:59:00+08:00',
  }),
  project('p-0003', 'ACM · Codeforces 上分训练', 'CF 稳定进入 1600+，每周完成 5 题', {
    areaId: 'a-0004', goalId: 'g-0002', nextActionId: 't-0016',
    tags: ['role:acm', 'topic:算法'],
  }),
  project('p-0004', '数据结构期中冲刺', '期中考试 85+，图论与树结构零盲区', {
    areaId: 'a-0001', goalId: 'g-0001', nextActionId: 't-0001',
    tags: ['role:student', 'topic:数据结构'], dueAt: '2026-11-06T23:59:00+08:00',
  }),
  project('p-0005', 'demo 实验室面试准备', '拿到 offer 或明确差距清单', {
    areaId: 'a-0004', goalId: 'g-0002', nextActionId: 't-0012',
    tags: ['role:acm', 'topic:面试'], createdAt: '2026-09-28T20:00:00+08:00',
  }),
  project('p-0006', '班长 · 班级事务与学风建设', '本学期班级零投诉，学风评比进前三', {
    areaId: 'a-0002', goalId: 'g-0004', nextActionId: 't-0034',
    tags: ['role:monitor'],
  }),
  project('p-0007', '辅导员助理 · 值班与归档', '材料零差错，历史档案全部电子化', {
    areaId: 'a-0002', goalId: 'g-0004', nextActionId: 't-0038',
    tags: ['role:assistant'],
  }),
  project('p-0008', '健康作息与运动改造', '连续 4 周 23:30 前入睡且每周运动 3 次', {
    areaId: 'a-0006', goalId: 'g-0006', nextActionId: 't-0043',
    tags: ['role:student'], updatedAt: '2026-09-26T22:00:00+08:00',
  }),
  project('p-0009', 'Java 程序设计期末课设预备', '确定选题并完成需求与原型，预留 3 周开发期', {
    areaId: 'a-0001', goalId: 'g-0001', nextActionId: 't-0008',
    tags: ['role:student', 'topic:Java'],
  }),
  project('p-0010', '个人作品集网站', '上线一个黑白极简的作品集站点', {
    areaId: 'a-0005', status: 'someday', nextActionId: 't-0059',
    tags: ['role:vibecoder'], updatedAt: '2026-09-12T21:00:00+08:00',
  }),
]

/* ===========================================================================
 * 目标（7）
 * ========================================================================= */
const goals = [
  goal('g-0001', '本学期全科达标（无挂科）', 'term', {
    areaId: 'a-0001', targetDate: '2027-01-15T23:59:00+08:00',
    keyResults: [
      keyResult('四门主课期末 ≥80', 4, 0, '门'),
      keyResult('作业按时提交率', 100, 96, '%'),
    ],
  }),
  goal('g-0002', '算法能力进阶（CF 1600+）', 'term', {
    areaId: 'a-0004', targetDate: '2027-01-15T23:59:00+08:00',
    keyResults: [
      keyResult('Codeforces 分数', 1600, 1432, '分'),
      keyResult('每周算法题', 5, 5, '题/周'),
    ],
  }),
  goal('g-0003', '成功主办 10 月院级程序设计大赛', 'quarter', {
    areaId: 'a-0003', targetDate: '2026-10-18T23:59:00+08:00',
    keyResults: [
      keyResult('报名人数', 120, 64, '人'),
      keyResult('赛务零事故', 1, 0, '次'),
    ],
  }),
  goal('g-0004', '学生工作通知不过夜', 'term', {
    areaId: 'a-0002',
    keyResults: [keyResult('通知当日处理率', 100, 92, '%')],
  }),
  goal('g-0005', '两周内产出 KERNEL v0.2 可演示原型', 'quarter', {
    areaId: 'a-0005', targetDate: '2026-10-16T23:59:00+08:00',
    keyResults: [
      keyResult('完成视图', 4, 1, '个'),
      keyResult('种子记录', 120, 0, '条'),
    ],
  }),
  goal('g-0006', '建立稳定作息与运动习惯', 'term', {
    areaId: 'a-0006', targetDate: '2027-01-15T23:59:00+08:00',
    keyResults: [
      keyResult('每周 23:30 前入睡', 6, 4, '天'),
      keyResult('每周运动', 3, 2, '次'),
    ],
  }),
  goal('g-0007', '扩展技术人脉与导师连接', 'year', {
    areaId: 'a-0007', targetDate: '2027-06-30T23:59:00+08:00',
    keyResults: [keyResult('新增有效连接', 10, 3, '人')],
  }),
]

/* ===========================================================================
 * 习惯（5，含历史打卡供热力图）
 * ========================================================================= */
const habits = [
  habit('h-0001', '23:30 前入睡', 'daily', '洗漱后立刻关灯上床', 'bool', 1, 'a-0006',
    genLog(48, 1001, 0.18, () => 1)),
  habit('h-0002', '每日一题算法', 'daily', '晚饭后回到实验室第一件事', 'count', 1, 'a-0004',
    genLog(48, 2002, 0.22, (r) => (r() > 0.85 ? 2 : 1))),
  habit('h-0003', '每周运动三次', 'weekly', '周二 / 周四 / 周六晚七点', 'count', 3, 'a-0006',
    genLog(49, 3003, 0.34, () => 1)),
  habit('h-0004', '每日英文技术阅读 20 分钟', 'daily', '通勤路上打开 Pocket', 'minutes', 20, 'a-0001',
    genLog(40, 4004, 0.28, (r) => 15 + Math.floor(r() * 25))),
  habit('h-0005', '每日复盘 5 分钟', 'daily', '睡前打开 KERNEL 收件箱', 'bool', 1, 'a-0007',
    genLog(35, 5005, 0.2, () => 1)),
]

/* ===========================================================================
 * 任务（60）
 * ========================================================================= */
const tasks = [
  // --- 数据结构期中冲刺 p-0004 -------------------------------------------
  task('t-0001', '完成数据结构图论章节习题 P1–P12', {
    projectId: 'p-0004', areaId: 'a-0001', contexts: ['@lab'], energy: 'high',
    estimateMin: 90, importance: 3, dueAt: '2026-10-03T22:00:00+08:00',
    tags: ['role:student', 'topic:数据结构'],
  }),
  task('t-0002', '数据结构：手写 Dijkstra 与 A* 并对比性能', {
    projectId: 'p-0004', areaId: 'a-0001', contexts: ['@lab'], energy: 'high',
    estimateMin: 120, importance: 2, dueAt: '2026-10-05T22:00:00+08:00',
    tags: ['role:student', 'role:acm', 'topic:数据结构'],
  }),
  task('t-0003', '数据结构实验报告二（二叉树）提交', {
    projectId: 'p-0004', areaId: 'a-0001', contexts: ['@campus'], energy: 'medium',
    estimateMin: 60, importance: 3, dueAt: '2026-10-05T18:00:00+08:00',
    tags: ['role:student', 'topic:数据结构'],
  }),
  task('t-0004', '整理数据结构错题本（图论部分）', {
    projectId: 'p-0004', areaId: 'a-0001', contexts: ['@home'], energy: 'low',
    estimateMin: 45, importance: 2, dueAt: '2026-10-06T22:00:00+08:00',
    tags: ['role:student', 'topic:数据结构'],
  }),
  task('t-0005', '数据结构期中模拟卷限时自测', {
    projectId: 'p-0004', areaId: 'a-0001', contexts: ['@lab'], energy: 'high',
    estimateMin: 120, importance: 3, dueAt: '2026-10-08T21:00:00+08:00',
    tags: ['role:student', 'topic:数据结构'],
  }),
  task('t-0006', '向助教提交图论作业疑问清单', {
    projectId: 'p-0004', areaId: 'a-0001', contexts: ['@phone'], energy: 'low',
    estimateMin: 15, importance: 2, status: 'waiting',
    tags: ['role:student', 'topic:数据结构'],
  }),

  // --- Java 课设 p-0009 ---------------------------------------------------
  task('t-0007', 'Java 课设选题调研：图书管理 vs 个人事务内核', {
    projectId: 'p-0009', areaId: 'a-0001', contexts: ['@computer'], energy: 'medium',
    estimateMin: 60, importance: 2, tags: ['role:student', 'topic:Java'],
  }),
  task('t-0008', 'Java：复习集合框架并手写简化版 HashMap', {
    projectId: 'p-0009', areaId: 'a-0001', contexts: ['@lab'], energy: 'high',
    estimateMin: 90, importance: 2, dueAt: '2026-10-07T22:00:00+08:00',
    tags: ['role:student', 'topic:Java'],
  }),
  task('t-0009', 'Java 实验：多线程下载器 demo 完成', {
    projectId: 'p-0009', areaId: 'a-0001', contexts: ['@computer'], energy: 'high',
    estimateMin: 150, importance: 3, dueAt: '2026-10-09T22:00:00+08:00',
    tags: ['role:student', 'topic:Java'],
  }),
  task('t-0010', '提交 Java 第二次平时作业', {
    projectId: 'p-0009', areaId: 'a-0001', contexts: ['@campus'], energy: 'medium',
    estimateMin: 30, importance: 3, dueAt: '2026-09-29T18:00:00+08:00',
    tags: ['role:student', 'topic:Java'],
  }),
  task('t-0011', 'Java 课设需求文档初稿', {
    projectId: 'p-0009', areaId: 'a-0001', contexts: ['@computer'], energy: 'medium',
    estimateMin: 90, importance: 2, dueAt: '2026-10-11T22:00:00+08:00',
    tags: ['role:student', 'topic:Java'],
  }),

  // --- demo 面试 p-0005 ----------------------------------------------
  task('t-0012', '给 demo 实验室发面试确认邮件', {
    notes: '附上 KERNEL 仓库链接', status: 'next', contexts: ['@computer'],
    energy: 'low', estimateMin: 15, importance: 3,
    dueAt: '2026-10-04T18:00:00+08:00', projectId: 'p-0005', areaId: 'a-0004',
    tags: ['role:acm', 'topic:面试'],
    createdAt: '2026-10-01T21:30:00+08:00', updatedAt: '2026-10-02T09:00:00+08:00',
  }),
  task('t-0013', '复习操作系统与计算机网络八股（面试）', {
    projectId: 'p-0005', areaId: 'a-0004', contexts: ['@lab'], energy: 'high',
    estimateMin: 180, importance: 3, dueAt: '2026-10-04T22:00:00+08:00',
    tags: ['role:acm', 'role:student', 'topic:面试'],
  }),
  task('t-0014', '打磨 KERNEL 项目介绍与演示脚本（面试用）', {
    projectId: 'p-0005', areaId: 'a-0005', contexts: ['@computer'], energy: 'medium',
    estimateMin: 90, importance: 2, dueAt: '2026-10-05T12:00:00+08:00',
    tags: ['role:acm', 'role:vibecoder', 'topic:面试'],
  }),
  task('t-0015', '准备 demo 面试算法手撕题（双指针 / DP）', {
    projectId: 'p-0005', areaId: 'a-0004', contexts: ['@lab'], energy: 'high',
    estimateMin: 120, importance: 3, dueAt: '2026-10-04T22:30:00+08:00',
    tags: ['role:acm', 'topic:面试', 'topic:算法'],
  }),

  // --- ACM p-0003 ---------------------------------------------------------
  task('t-0016', 'Codeforces Round 补题（D 题）', {
    projectId: 'p-0003', areaId: 'a-0004', contexts: ['@lab'], energy: 'high',
    estimateMin: 120, importance: 2, dueAt: '2026-10-03T23:00:00+08:00',
    tags: ['role:acm', 'topic:算法'],
  }),
  task('t-0017', '完成本周算法专题：并查集', {
    projectId: 'p-0003', areaId: 'a-0004', contexts: ['@lab'], energy: 'medium',
    estimateMin: 90, importance: 2, dueAt: '2026-10-06T23:00:00+08:00',
    tags: ['role:acm', 'topic:算法'],
  }),
  task('t-0018', '记录 CF 上分日志并分析弱点', {
    projectId: 'p-0003', areaId: 'a-0004', contexts: ['@computer'], energy: 'low',
    estimateMin: 30, importance: 1, tags: ['role:acm', 'topic:算法'],
  }),
  task('t-0019', '与队友约算法训练赛时间', {
    projectId: 'p-0003', areaId: 'a-0004', contexts: ['@phone'], energy: 'low',
    estimateMin: 10, importance: 2, status: 'waiting', tags: ['role:acm'],
  }),
  task('t-0020', '提交上周 CF 罚时复盘', {
    projectId: 'p-0003', areaId: 'a-0004', contexts: ['@computer'], energy: 'low',
    estimateMin: 25, importance: 1, dueAt: '2026-10-01T23:00:00+08:00',
    tags: ['role:acm', 'topic:算法'],
  }),

  // --- KERNEL p-0001 ------------------------------------------------------
  task('t-0021', '初始化 KERNEL 前端脚手架与数据层', {
    projectId: 'p-0001', areaId: 'a-0005', contexts: ['@computer'], energy: 'high',
    estimateMin: 180, importance: 3, dueAt: '2026-10-03T23:59:00+08:00',
    tags: ['role:vibecoder', 'topic:KERNEL'],
  }),
  task('t-0022', '为 seed 数据补齐 40+ 条真实任务', {
    projectId: 'p-0001', areaId: 'a-0005', contexts: ['@computer'], energy: 'medium',
    estimateMin: 90, importance: 2, dueAt: '2026-10-03T23:59:00+08:00',
    tags: ['role:vibecoder', 'topic:KERNEL'],
  }),
  task('t-0023', '设计 KERNEL 总览页布局（DaySpine + 统计瓦片）', {
    projectId: 'p-0001', areaId: 'a-0005', contexts: ['@computer'], energy: 'high',
    estimateMin: 150, importance: 2, dueAt: '2026-10-06T23:59:00+08:00',
    tags: ['role:vibecoder', 'topic:KERNEL'],
  }),
  task('t-0024', '调研 View Transitions API 在 react-router 的用法', {
    projectId: 'p-0001', areaId: 'a-0005', contexts: ['@computer'], energy: 'low',
    estimateMin: 45, importance: 1, status: 'someday',
    tags: ['role:vibecoder', 'topic:KERNEL'],
  }),
  task('t-0025', '为 KERNEL 写一篇 v0.1 基建开发日志', {
    projectId: 'p-0001', areaId: 'a-0005', contexts: ['@computer'], energy: 'low',
    estimateMin: 60, importance: 1, status: 'someday',
    tags: ['role:vibecoder', 'topic:KERNEL'],
  }),

  // --- 学生组织 p-0002 ----------------------------------------------------
  task('t-0026', '完成程序设计大赛策划书终稿', {
    projectId: 'p-0002', areaId: 'a-0003', contexts: ['@org-room'], energy: 'high',
    estimateMin: 150, importance: 3, dueAt: '2026-10-04T23:00:00+08:00',
    tags: ['role:competition-head', 'topic:竞赛'],
  }),
  task('t-0027', '联系老师确认大赛场地与预算', {
    projectId: 'p-0002', areaId: 'a-0003', contexts: ['@campus'], energy: 'high',
    estimateMin: 45, importance: 3, status: 'waiting', dueAt: '2026-10-03T18:00:00+08:00',
    tags: ['role:competition-head', 'topic:竞赛'],
  }),
  task('t-0028', '设计大赛宣传海报（黑白极简）', {
    projectId: 'p-0002', areaId: 'a-0003', contexts: ['@computer'], energy: 'medium',
    estimateMin: 120, importance: 2, dueAt: '2026-10-05T23:00:00+08:00',
    tags: ['role:competition-head', 'topic:竞赛'],
  }),
  task('t-0029', '统计大赛报名人数并建立名单', {
    projectId: 'p-0002', areaId: 'a-0003', contexts: ['@computer'], energy: 'medium',
    estimateMin: 45, importance: 2, dueAt: '2026-10-07T23:00:00+08:00',
    tags: ['role:competition-head', 'topic:竞赛'],
  }),
  task('t-0030', '撰写大赛赛制与评分细则', {
    projectId: 'p-0002', areaId: 'a-0003', contexts: ['@org-room'], energy: 'high',
    estimateMin: 120, importance: 2, dueAt: '2026-10-06T23:00:00+08:00',
    tags: ['role:competition-head', 'topic:竞赛'],
  }),
  task('t-0031', '给学生组织成员分工并同步排期', {
    projectId: 'p-0002', areaId: 'a-0003', contexts: ['@org-room'], energy: 'medium',
    estimateMin: 60, importance: 2, dueAt: '2026-10-05T20:00:00+08:00',
    tags: ['role:competition-head', 'topic:竞赛'],
  }),
  task('t-0032', '申请大赛用机房与设备', {
    projectId: 'p-0002', areaId: 'a-0003', contexts: ['@errands'], energy: 'medium',
    estimateMin: 40, importance: 2, dueAt: '2026-10-08T18:00:00+08:00',
    tags: ['role:competition-head', 'topic:竞赛'],
  }),

  // --- 班长 p-0006 --------------------------------------------------------
  task('t-0033', '汇总班级国家助学金评议材料', {
    projectId: 'p-0006', areaId: 'a-0002', contexts: ['@campus'], energy: 'high',
    estimateMin: 120, importance: 3, dueAt: '2026-10-01T18:00:00+08:00',
    tags: ['role:monitor'],
  }),
  task('t-0034', '通知同学提交医保信息（群公告）', {
    projectId: 'p-0006', areaId: 'a-0002', contexts: ['@phone'], energy: 'medium',
    estimateMin: 15, importance: 2, dueAt: '2026-10-03T12:00:00+08:00',
    tags: ['role:monitor'],
  }),
  task('t-0035', '组织班级学风建设主题班会', {
    projectId: 'p-0006', areaId: 'a-0002', contexts: ['@campus'], energy: 'medium',
    estimateMin: 60, importance: 2, dueAt: '2026-10-09T16:00:00+08:00',
    tags: ['role:monitor'],
  }),
  task('t-0036', '跟进学业困难同学并谈心', {
    projectId: 'p-0006', areaId: 'a-0002', contexts: ['@campus'], energy: 'high',
    estimateMin: 60, importance: 3, tags: ['role:monitor'],
  }),
  task('t-0037', '更新班级通讯录与在册名单', {
    projectId: 'p-0006', areaId: 'a-0002', contexts: ['@computer'], energy: 'low',
    estimateMin: 30, importance: 1, status: 'someday', tags: ['role:monitor'],
  }),

  // --- 辅导员助理 p-0007 --------------------------------------------------
  task('t-0038', '辅导员助理值班：整理学生档案', {
    projectId: 'p-0007', areaId: 'a-0002', contexts: ['@campus'], energy: 'medium',
    estimateMin: 180, importance: 2, dueAt: '2026-10-07T17:00:00+08:00',
    tags: ['role:assistant'],
  }),
  task('t-0039', '协助录入新生信息到学工系统', {
    projectId: 'p-0007', areaId: 'a-0002', contexts: ['@computer'], energy: 'medium',
    estimateMin: 120, importance: 2, dueAt: '2026-10-08T17:00:00+08:00',
    tags: ['role:assistant'],
  }),
  task('t-0040', '汇总本周请假条并归档', {
    projectId: 'p-0007', areaId: 'a-0002', contexts: ['@campus'], energy: 'low',
    estimateMin: 45, importance: 1, dueAt: '2026-10-01T17:00:00+08:00',
    tags: ['role:assistant'],
  }),
  task('t-0041', '准备辅导员例会汇报材料', {
    projectId: 'p-0007', areaId: 'a-0002', contexts: ['@computer'], energy: 'medium',
    estimateMin: 60, importance: 2, dueAt: '2026-10-06T17:00:00+08:00',
    tags: ['role:assistant'],
  }),

  // --- 健康 p-0008 --------------------------------------------------------
  task('t-0042', '预约校医院口腔检查', {
    projectId: 'p-0008', areaId: 'a-0006', contexts: ['@errands'], energy: 'low',
    estimateMin: 20, importance: 1, status: 'someday', tags: ['role:student'],
  }),
  task('t-0043', '执行每周三次跑步计划并打卡', {
    projectId: 'p-0008', areaId: 'a-0006', contexts: ['@campus'], energy: 'medium',
    importance: 2, repeatRule: 'FREQ=WEEKLY;BYDAY=TU,TH,SA', tags: ['role:student'],
  }),
  task('t-0044', '整理宿舍并处理换季衣物', {
    projectId: 'p-0008', areaId: 'a-0006', contexts: ['@home'], energy: 'low',
    estimateMin: 60, importance: 1, status: 'someday', tags: ['role:student'],
  }),

  // --- 学业其他（无项目）--------------------------------------------------
  task('t-0045', '计算机组成原理：整理第 4 章存储层次笔记', {
    areaId: 'a-0001', contexts: ['@campus'], energy: 'medium', estimateMin: 60,
    importance: 2, status: 'scheduled', deferUntil: '2026-10-04T09:00:00+08:00',
    dueAt: '2026-10-05T22:00:00+08:00',
    tags: ['role:student', 'topic:计算机组成原理'],
  }),
  task('t-0046', '工程数学：完成线性代数第三次作业', {
    areaId: 'a-0001', contexts: ['@home'], energy: 'medium', estimateMin: 90,
    importance: 3, dueAt: '2026-09-30T22:00:00+08:00',
    tags: ['role:student', 'topic:工程数学'],
  }),
  task('t-0047', '大学英语：背诵六级核心词汇 List 8', {
    areaId: 'a-0001', contexts: ['@phone'], energy: 'low', estimateMin: 30,
    importance: 1, status: 'scheduled', deferUntil: '2026-10-04T07:30:00+08:00',
    dueAt: '2026-10-04T22:00:00+08:00', tags: ['role:student'],
  }),
  task('t-0048', '预习操作系统进程调度章节', {
    areaId: 'a-0001', contexts: ['@lab'], energy: 'medium', estimateMin: 60,
    importance: 1, status: 'scheduled', deferUntil: '2026-10-08T09:00:00+08:00',
    dueAt: '2026-10-10T22:00:00+08:00',
    tags: ['role:student', 'topic:操作系统'],
  }),
  task('t-0049', '提交计算机组成原理实验报告一', {
    areaId: 'a-0001', contexts: ['@campus'], energy: 'high', estimateMin: 60,
    importance: 3, dueAt: '2026-10-06T18:00:00+08:00',
    tags: ['role:student', 'topic:计算机组成原理'],
  }),

  // --- 人际 a-0007 --------------------------------------------------------
  task('t-0050', '给高中老师回消息约周末通话', {
    areaId: 'a-0007', contexts: ['@phone'], energy: 'low', estimateMin: 15,
    importance: 1, status: 'someday',
  }),
  task('t-0051', '约实验室学长请教研究方向', {
    areaId: 'a-0007', contexts: ['@campus'], energy: 'medium', estimateMin: 30,
    importance: 2, status: 'waiting', tags: ['role:acm'],
  }),
  task('t-0052', '整理导师联系方式与联系记录', {
    areaId: 'a-0007', contexts: ['@computer'], energy: 'low', estimateMin: 30,
    importance: 1, status: 'someday',
  }),

  // --- 已完成 / 已丢弃（覆盖全部状态）------------------------------------
  task('t-0053', '完成 KERNEL 设计总纲评审', {
    projectId: 'p-0001', areaId: 'a-0005', contexts: ['@computer'], energy: 'high',
    importance: 3, status: 'done', doneAt: '2026-10-01T22:00:00+08:00',
    tags: ['role:vibecoder', 'topic:KERNEL'],
  }),
  task('t-0054', '提交数据结构第一次作业', {
    projectId: 'p-0004', areaId: 'a-0001', contexts: ['@campus'], energy: 'medium',
    importance: 2, status: 'done', doneAt: '2026-09-28T20:00:00+08:00',
    tags: ['role:student', 'topic:数据结构'],
  }),
  task('t-0055', '发布学生组织招新推文', {
    projectId: 'p-0002', areaId: 'a-0003', contexts: ['@computer'], energy: 'medium',
    importance: 2, status: 'done', doneAt: '2026-09-30T19:00:00+08:00',
    tags: ['role:competition-head', 'topic:竞赛'],
  }),
  task('t-0056', '完成本周 CF 训练赛', {
    projectId: 'p-0003', areaId: 'a-0004', contexts: ['@lab'], energy: 'high',
    importance: 2, status: 'done', doneAt: '2026-09-29T22:30:00+08:00',
    tags: ['role:acm', 'topic:算法'],
  }),
  task('t-0057', '参加不太相关的编程讲座', {
    areaId: 'a-0005', contexts: ['@campus'], energy: 'low', importance: 0,
    status: 'dropped',
  }),
  task('t-0058', '整理旧版 KERNEL 草稿', {
    projectId: 'p-0001', areaId: 'a-0005', contexts: ['@computer'], energy: 'low',
    importance: 0, status: 'dropped', tags: ['role:vibecoder', 'topic:KERNEL'],
  }),

  // --- 作品集 p-0010（someday 项目）--------------------------------------
  task('t-0059', '设计作品集网站信息架构', {
    projectId: 'p-0010', areaId: 'a-0005', contexts: ['@computer'], energy: 'low',
    estimateMin: 60, importance: 1, status: 'someday',
    tags: ['role:vibecoder'],
  }),
  task('t-0060', '整理作品集项目截图与文案', {
    projectId: 'p-0010', areaId: 'a-0005', contexts: ['@computer'], energy: 'low',
    estimateMin: 90, importance: 1, status: 'someday',
    tags: ['role:vibecoder'],
  }),
]

/* ===========================================================================
 * 事件（20，未来两周）
 * ========================================================================= */
const events = [
  event('e-0001', '数据结构（图论）', {
    startAt: '2026-10-02T08:00:00+08:00', endAt: '2026-10-02T09:40:00+08:00',
    location: '6A-301', areaId: 'a-0001', tags: ['role:student', 'topic:数据结构'],
    repeatRule: 'FREQ=WEEKLY;BYDAY=FR',
  }),
  event('e-0002', 'Java 程序设计', {
    startAt: '2026-10-02T10:00:00+08:00', endAt: '2026-10-02T11:40:00+08:00',
    location: '6A-205', areaId: 'a-0001', tags: ['role:student', 'topic:Java'],
    repeatRule: 'FREQ=WEEKLY;BYDAY=FR',
  }),
  event('e-0003', '学生组织例会', {
    startAt: '2026-10-06T19:30:00+08:00', endAt: '2026-10-06T21:00:00+08:00',
    location: '某教室', areaId: 'a-0003', tags: ['role:competition-head'],
  }),
  event('e-0004', 'ACM 实验室训练赛', {
    startAt: '2026-10-03T19:00:00+08:00', endAt: '2026-10-03T22:00:00+08:00',
    location: '8B-机房', areaId: 'a-0004', tags: ['role:acm', 'topic:算法'],
  }),
  event('e-0005', 'Codeforces Round（Div.2）', {
    startAt: '2026-10-04T22:35:00+08:00', endAt: '2026-10-04T23:35:00+08:00',
    location: '线上', areaId: 'a-0004', tags: ['role:acm', 'topic:算法'],
  }),
  event('e-0006', '班级学风建设主题班会', {
    startAt: '2026-10-09T16:00:00+08:00', endAt: '2026-10-09T17:00:00+08:00',
    location: '6A-301', areaId: 'a-0002', projectId: 'p-0006', tags: ['role:monitor'],
  }),
  event('e-0007', '辅导员助理值班', {
    startAt: '2026-10-07T14:00:00+08:00', endAt: '2026-10-07T17:00:00+08:00',
    location: '学工办 8A-108', areaId: 'a-0002', projectId: 'p-0007',
    tags: ['role:assistant'],
  }),
  event('e-0008', 'demo 开发实验室面试约谈', {
    startAt: '2026-10-05T15:00:00+08:00', endAt: '2026-10-05T15:45:00+08:00',
    location: '某实验楼 512', areaId: 'a-0004', projectId: 'p-0005',
    tags: ['role:acm', 'topic:面试'],
  }),
  event('e-0009', '计算机组成原理', {
    startAt: '2026-10-06T08:00:00+08:00', endAt: '2026-10-06T09:40:00+08:00',
    location: '6A-401', areaId: 'a-0001',
    tags: ['role:student', 'topic:计算机组成原理'],
    repeatRule: 'FREQ=WEEKLY;BYDAY=TU',
  }),
  event('e-0010', '工程数学（线性代数）', {
    startAt: '2026-10-06T10:00:00+08:00', endAt: '2026-10-06T11:40:00+08:00',
    location: '6A-402', areaId: 'a-0001',
    tags: ['role:student', 'topic:工程数学'],
    repeatRule: 'FREQ=WEEKLY;BYDAY=TU',
  }),
  event('e-0011', '大学英语（六级强化）', {
    startAt: '2026-10-07T08:00:00+08:00', endAt: '2026-10-07T09:40:00+08:00',
    location: '6A-303', areaId: 'a-0001', tags: ['role:student'],
    repeatRule: 'FREQ=WEEKLY;BYDAY=WE',
  }),
  event('e-0012', '程序设计大赛宣讲会', {
    startAt: '2026-10-08T19:00:00+08:00', endAt: '2026-10-08T20:30:00+08:00',
    location: '学术报告厅', areaId: 'a-0003', projectId: 'p-0002',
    tags: ['role:competition-head', 'topic:竞赛'],
  }),
  event('e-0013', '学院学生会骨干培训', {
    startAt: '2026-10-10T14:00:00+08:00', endAt: '2026-10-10T16:00:00+08:00',
    location: '8A-201', areaId: 'a-0002', tags: ['role:assistant'],
  }),
  event('e-0014', '校运会长跑体测', {
    startAt: '2026-10-11T08:00:00+08:00', endAt: '2026-10-11T10:00:00+08:00',
    location: '田径场', areaId: 'a-0006', tags: ['role:student'],
  }),
  event('e-0015', '学生组织物资清点', {
    startAt: '2026-10-09T20:00:00+08:00', endAt: '2026-10-09T21:00:00+08:00',
    location: '某仓库', areaId: 'a-0003', projectId: 'p-0002',
    tags: ['role:competition-head'],
  }),
  event('e-0016', '数据结构实验课', {
    startAt: '2026-10-07T15:00:00+08:00', endAt: '2026-10-07T16:40:00+08:00',
    location: '机房 6B-201', areaId: 'a-0001', projectId: 'p-0004',
    tags: ['role:student', 'topic:数据结构'],
  }),
  event('e-0017', '期中考试动员会', {
    startAt: '2026-10-12T16:00:00+08:00', endAt: '2026-10-12T17:00:00+08:00',
    location: '6A-301', areaId: 'a-0001', tags: ['role:monitor'],
  }),
  event('e-0018', 'KERNEL 开发冲刺（个人）', {
    startAt: '2026-10-03T20:00:00+08:00', endAt: '2026-10-03T22:00:00+08:00',
    location: '宿舍', areaId: 'a-0005', projectId: 'p-0001',
    tags: ['role:vibecoder', 'topic:KERNEL'],
  }),
  event('e-0019', '技术沙龙分享（待定）', {
    startAt: '2026-10-13T19:00:00+08:00', endAt: '2026-10-13T20:00:00+08:00',
    location: '待定', areaId: 'a-0005', status: 'tentative',
    tags: ['role:vibecoder'],
  }),
  event('e-0020', '与学长的方向交流', {
    startAt: '2026-10-14T20:00:00+08:00', endAt: '2026-10-14T21:00:00+08:00',
    location: '线上', areaId: 'a-0007', status: 'cancelled', tags: ['role:acm'],
  }),
]

/* ===========================================================================
 * 笔记（13）
 * ========================================================================= */
const notes = [
  note('n-0001', '学生组织 10 月例会纪要', 'meeting',
    '# 学生组织 10 月例会纪要\n\n- 时间：2026-09-29 19:30\n- 议题：程序设计大赛筹备\n\n## 结论\n1. 大赛定于 10 月 18 日，机房 A/B。\n2. 报名目标 120 人，10 月 12 日截止。\n3. 赛制采用 ACM 赛制，3 小时 8 题。\n\n## 待办\n- 策划书终稿（负责人：我）\n- 场地与预算确认（对接老师）\n',
    { links: ['n-0003'], areaId: 'a-0003', projectId: 'p-0002', distillLevel: 1,
      tags: ['role:competition-head', 'topic:竞赛'] }),
  note('n-0002', '我的 GTD 循环设计', 'permanent',
    '# 我的 GTD 循环\n\n捕捉 → 澄清 → 组织 → 执行 → 回顾。\n\n## 关键约束\n- 收件箱水位不得超过 8 条。\n- WIP 项目同时进行不超过 4 个。\n- 每周五晚做周回顾，重决策停滞项目。\n\nKERNEL 应把这些约束可视化（排泄口思路）。\n',
    { areaId: 'a-0005', projectId: 'p-0001', distillLevel: 2,
      tags: ['role:vibecoder', 'topic:GTD', 'topic:KERNEL'] }),
  note('n-0003', '程序设计大赛赛制草案', 'memo',
    '# 赛制草案\n\n- 个人赛，3 小时，8 题。\n- 评分：AC 数优先，罚时其次。\n- 允许语言：C/C++/Java/Python。\n- 禁止联网与 AI 工具（诚信声明）。\n',
    { areaId: 'a-0003', projectId: 'p-0002', distillLevel: 2,
      tags: ['role:competition-head', 'topic:竞赛'] }),
  note('n-0004', '图论最短路径算法对比', 'literature',
    '# 最短路径算法对比\n\n| 算法 | 适用 | 复杂度 |\n|---|---|---|\n| Dijkstra | 非负权 | O((V+E)logV) |\n| Bellman-Ford | 含负权 | O(VE) |\n| A* | 有启发函数 | 取决于 h |\n\nA* 的启发函数必须可采纳（不高估），否则不最优。\n',
    { areaId: 'a-0001', projectId: 'p-0004', distillLevel: 2,
      tags: ['role:student', 'topic:数据结构', 'topic:算法'] }),
  note('n-0005', '关于「文件即数据库」的随想', 'fleeting',
    '文件即数据库的好处：可读、可 diff、可版本控制、可被 AI 直接读写。\n代价：并发写、原子性、索引查询都要自己解决。v0.3 的单写者服务是正确的方向。\n',
    { areaId: 'a-0005', projectId: 'p-0001', distillLevel: 0,
      tags: ['role:vibecoder', 'topic:KERNEL'] }),
  note('n-0006', 'demo 面试准备清单', 'meeting',
    '# demo 面试准备清单\n\n- [x] 简历更新\n- [ ] 项目讲解（KERNEL）\n- [ ] 操作系统 / 网络八股\n- [ ] 算法手撕：双指针、DP、图\n- [ ] 反问问题准备\n',
    { areaId: 'a-0004', projectId: 'p-0005', distillLevel: 1,
      tags: ['role:acm', 'topic:面试'] }),
  note('n-0007', '面试算法模板：双指针与滑动窗口', 'permanent',
    '# 双指针 / 滑动窗口模板\n\n## 同向双指针（窗口）\n维护 `[left, right)`，右扩左缩，窗口内始终满足条件。\n\n```\nleft = 0\nfor right in range(n):\n    add(arr[right])\n    while not valid():\n        remove(arr[left]); left += 1\n    update_answer()\n```\n\n适用：最短/最长子数组、无重复字符子串。\n',
    { areaId: 'a-0004', projectId: 'p-0005', distillLevel: 3,
      tags: ['role:acm', 'topic:面试', 'topic:算法'] }),
  note('n-0008', '辅导员助理材料归档 SOP', 'memo',
    '# 材料归档 SOP\n\n1. 收件：按班级建立临时目录。\n2. 命名：`YYYYMMDD-事项-班级`。\n3. 电子化：扫描 / 拍照，压缩后归档。\n4. 索引：在学工系统登记编号。\n5. 复核：与交接人核对后签字。\n',
    { areaId: 'a-0002', projectId: 'p-0007', distillLevel: 1,
      tags: ['role:assistant'] }),
  note('n-0009', '想做一个命令行版 KERNEL', 'fleeting',
    '如果 KERNEL 有 CLI，就可以在终端里 `kernel add "..."`、`kernel review`。\n核心逻辑（数据层 + GTD 状态机）应与 UI 解耦，这样 CLI/Web 共用。\n',
    { areaId: 'a-0005', projectId: 'p-0001', distillLevel: 0,
      tags: ['role:vibecoder', 'topic:KERNEL'] }),
  note('n-0010', '读《深度工作》笔记', 'literature',
    '# 深度工作\n\n深度工作 = 无干扰状态下专注的高认知活动。\n\n## 可执行\n- 每天保留 2 个 90 分钟深度块。\n- 手机放远，通知全关。\n- 用仪式感启动（泡茶 / 白噪音）。\n',
    { areaId: 'a-0006', distillLevel: 1, tags: ['topic:学习方法'] }),
  note('n-0011', '班长工作月清单', 'memo',
    '# 班长月度清单\n\n- 月初：考勤汇总、通知归档。\n- 月中：学风活动、困难同学跟进。\n- 月末：奖助学金材料、班费公示。\n',
    { areaId: 'a-0002', projectId: 'p-0006', distillLevel: 1,
      tags: ['role:monitor'] }),
  note('n-0012', 'CF 上分策略：先稳 D 再攻 E', 'permanent',
    '# CF 上分策略\n\n- D 题是上分关键：先保证 D 稳定 AC。\n- 赛前 10 分钟读全部题面，评估难度。\n- 罚时意识：先做有把握的，避免无谓提交。\n- 赛后必补题，写进错题模板。\n',
    { areaId: 'a-0004', projectId: 'p-0003', distillLevel: 3,
      tags: ['role:acm', 'topic:算法'] }),
  note('n-0013', '与学长技术交流要点', 'meeting',
    '# 与学长交流要点\n\n- 实验室方向：系统 / AI infra。\n- 建议：先做深一个项目，再谈广度。\n- 面试看重：基础 + 项目真实性。\n',
    { areaId: 'a-0007', distillLevel: 0, tags: ['role:acm', 'topic:面试'] }),
]

/* ===========================================================================
 * 资料（12）
 * ========================================================================= */
const resources = [
  resource('r-0001', 'MIT 6.006 Introduction to Algorithms', 'course', 'reading',
    { url: 'https://ocw.mit.edu/6-006', areaId: 'a-0001', tags: ['role:student', 'topic:数据结构'] }),
  resource('r-0002', '《算法（第 4 版）》Sedgewick', 'book', 'reading',
    { areaId: 'a-0004', tags: ['role:acm', 'topic:算法'] }),
  resource('r-0003', 'Codeforces', 'tool', 'reference',
    { url: 'https://codeforces.com', areaId: 'a-0004', tags: ['role:acm'] }),
  resource('r-0004', 'MDN · View Transitions API', 'article', 'reading',
    { url: 'https://developer.mozilla.org/docs/Web/API/View_Transitions_API', areaId: 'a-0005',
      tags: ['role:vibecoder', 'topic:KERNEL'] }),
  resource('r-0005', 'Vite 官方文档', 'tool', 'reference',
    { url: 'https://vite.dev', areaId: 'a-0005', tags: ['role:vibecoder'] }),
  resource('r-0006', 'Attention Is All You Need', 'paper', 'unread',
    { url: 'https://arxiv.org/abs/1706.03762', areaId: 'a-0004', tags: ['topic:AI'] }),
  resource('r-0007', 'CS61B Data Structures', 'course', 'unread',
    { url: 'https://sp21.datastructur.es', areaId: 'a-0001',
      tags: ['role:student', 'topic:数据结构'] }),
  resource('r-0008', '《人月神话》', 'book', 'read',
    { areaId: 'a-0005', tags: ['topic:工程'] }),
  resource('r-0009', 'GTD 官方指南', 'article', 'read',
    { areaId: 'a-0005', tags: ['topic:GTD'] }),
  resource('r-0010', 'Git 官方文档', 'tool', 'reference',
    { url: 'https://git-scm.com/doc', areaId: 'a-0005', tags: ['role:vibecoder'] }),
  resource('r-0011', '学生组织策划模板.docx', 'file', 'reference',
    { areaId: 'a-0003', tags: ['role:competition-head', 'topic:竞赛'] }),
  resource('r-0012', '面试八股：操作系统与计算机网络', 'article', 'reading',
    { url: 'https://example.com/interview-notes', areaId: 'a-0004',
      tags: ['role:acm', 'topic:面试'] }),
]

/* ===========================================================================
 * 收件箱（8：6 未澄清 + 1 已澄清 + 1 已丢弃）
 * ========================================================================= */
const inbox = [
  inboxItem('i-0001', '记得给班主任回电话确认助学金名单', 'manual', '2026-10-01T20:15:00+08:00'),
  inboxItem('i-0002', '同学推荐了一个 K8s 入门教程链接', 'file', '2026-10-01T21:40:00+08:00'),
  inboxItem('i-0003', '手机备忘录：买牙膏和洗衣液', 'voice', '2026-10-02T07:50:00+08:00'),
  inboxItem('i-0004', '学生组织群里的场地申请流程截图', 'notification', '2026-10-02T08:20:00+08:00'),
  inboxItem('i-0005', '想到 KERNEL 可以加一个「能量分布」图', 'manual', '2026-10-02T09:05:00+08:00'),
  inboxItem('i-0006', '学长说周五晚上可以聊聊实习方向', 'manual', '2026-10-02T09:12:00+08:00'),
  inboxItem('i-0007', '把校医院口腔检查加入日程', 'manual', '2026-09-30T19:00:00+08:00',
    'clarified', { linkedId: 't-0042', note: '已澄清为任务 t-0042' }),
  inboxItem('i-0008', '某个不靠谱的校园兼职广告', 'notification', '2026-09-29T12:30:00+08:00',
    'discarded', { note: '与目标无关，丢弃' }),
]

/* ===========================================================================
 * 踪迹（6，近 10 天）：「我刚刚做了什么」——朋友圈式活动留痕（tr-）
 * ========================================================================= */
const traces = [
  { id: 'tr-0001', title: '跑完 5 公里', at: '2026-10-05T07:20:00+08:00', tags: ['topic:跑步'], areaId: 'a-0002' },
  { id: 'tr-0002', title: '修好实验数据的散点图脚本', note: '把重复点去重之后，曲线终于顺眼了', at: '2026-10-04T22:10:00+08:00', tags: ['topic:Python'], areaId: 'a-0001' },
  { id: 'tr-0003', title: '给学弟讲完 DP 背包', at: '2026-10-04T20:05:00+08:00', tags: ['topic:算法'], areaId: 'a-0004' },
  { id: 'tr-0004', title: '把下周例会材料收尾', at: '2026-10-03T16:40:00+08:00', tags: ['role:competition-head'], areaId: 'a-0003' },
  { id: 'tr-0005', title: '看完一节线代网课', at: '2026-10-02T21:30:00+08:00', tags: ['topic:数学'], areaId: 'a-0001' },
  { id: 'tr-0006', title: '整理了书桌，扔了两袋废纸', at: '2026-09-29T18:10:00+08:00', tags: [], areaId: 'a-0002' },
]

/* ===========================================================================
 * 回顾（2：2026-W40 周回顾 + 2026-09 月回顾）
 * ========================================================================= */
const reviews = [
  review('rev-0001', 'weekly', '2026-W40', '2026-10-02T21:00:00+08:00', {
    captured: 14, created: 22, completed: 18, overdue: 5, migrated: 7,
  }, [
    '收件箱清空到 6 条以下',
    '停滞项目 p-0010 归档观察',
    '下周聚焦：数据结构期中 + 大赛落地',
  ], '本周 GTD 循环基本转起来：捕捉 14 条、完成 18 条。逾期集中在学业与助理材料，下周需前置处理。ACM 训练达标。',
    ['p-0010', 'p-0008']),
  review('rev-0002', 'monthly', '2026-09', '2026-09-30T21:30:00+08:00', {
    captured: 41, created: 63, completed: 57, overdue: 9, migrated: 12,
  }, [
    '确定 KERNEL v0.2 前端原型目标',
    'ACM 训练正式纳入周计划',
    '健康作息列为第一优先级',
  ], '九月概览：完成 57 项，新增 63 项，迁移 12 项（多为学期初事务）。学业与竞赛双线推进，健康习惯仍不稳定。',
    ['p-0010']),
]

/* ===========================================================================
 * 标签注册表
 * ========================================================================= */
const roleLabels = {
  student: '学生',
  assistant: '学生助理',
  'competition-head': '学生组织部长',
  acm: '算法实验室',
  monitor: '班长',
  vibecoder: '独立开发者',
}
const contextLabels = {
  '@lab': '实验室',
  '@campus': '校园',
  '@computer': '电脑前',
  '@phone': '手机 / 外出',
  '@errands': '跑腿办事',
  '@org-room': '组织办公室',
  '@home': '宿舍',
}
const topicLabels = {
  数据结构: '数据结构',
  算法: '算法与竞赛',
  计算机组成原理: '计算机组成原理',
  工程数学: '工程数学',
  操作系统: '操作系统',
  Java: 'Java',
  面试: '面试准备',
  竞赛: '组织竞赛',
  KERNEL: 'KERNEL 项目',
  GTD: 'GTD 方法',
  AI: '人工智能',
  工程: '软件工程',
  学习方法: '学习方法',
}

let tagSeq = 1
function tagId() {
  const n = String(tagSeq).padStart(3, '0')
  tagSeq += 1
  return `tag-${n}`
}

// 标签来源（Slice T）：种子标签带 origin/createdAt，与运行时自动登记的标签同形
const TAG_CREATED_AT = '2026-10-02T00:00:00+08:00'

const tags = [
  ...Object.entries(roleLabels).map(([name, label]) => ({
    id: tagId(), name: `role:${name}`, namespace: 'role', label, origin: 'seed', createdAt: TAG_CREATED_AT,
  })),
  ...Object.entries(contextLabels).map(([name, label]) => ({
    id: tagId(), name, namespace: 'context', label, origin: 'seed', createdAt: TAG_CREATED_AT,
  })),
  ...Object.entries(topicLabels).map(([topic, label]) => ({
    id: tagId(), name: `topic:${topic}`, namespace: 'topic', label, origin: 'seed', createdAt: TAG_CREATED_AT,
  })),
]

/* ===========================================================================
 * 引用完整性校验
 * ========================================================================= */
function fail(msg) {
  console.error(`[seed] 引用完整性错误：${msg}`)
  process.exitCode = 1
}

const ids = {
  tasks: new Set(tasks.map((x) => x.id)),
  projects: new Set(projects.map((x) => x.id)),
  areas: new Set(areas.map((x) => x.id)),
  goals: new Set(goals.map((x) => x.id)),
  habits: new Set(habits.map((x) => x.id)),
  events: new Set(events.map((x) => x.id)),
  notes: new Set(notes.map((x) => x.id)),
  resources: new Set(resources.map((x) => x.id)),
  inbox: new Set(inbox.map((x) => x.id)),
  reviews: new Set(reviews.map((x) => x.id)),
}
const allEntityIds = new Set(Object.values(ids).flatMap((s) => [...s]))
const tagNames = new Set(tags.map((t) => t.name))
const contextNames = new Set(Object.keys(contextLabels))

for (const t of tasks) {
  if (t.projectId && !ids.projects.has(t.projectId)) fail(`${t.id}.projectId → ${t.projectId}`)
  if (t.areaId && !ids.areas.has(t.areaId)) fail(`${t.id}.areaId → ${t.areaId}`)
  if (t.parentTaskId && !ids.tasks.has(t.parentTaskId)) fail(`${t.id}.parentTaskId → ${t.parentTaskId}`)
  if (t.sourceInboxId && !ids.inbox.has(t.sourceInboxId)) fail(`${t.id}.sourceInboxId → ${t.sourceInboxId}`)
  for (const c of t.contexts) if (!contextNames.has(c)) fail(`${t.id} 未定义上下文 ${c}`)
  for (const tag of t.tags) if (!tagNames.has(tag)) fail(`${t.id} 未定义标签 ${tag}`)
}
for (const p of projects) {
  if (!ids.areas.has(p.areaId)) fail(`${p.id}.areaId → ${p.areaId}`)
  if (p.goalId && !ids.goals.has(p.goalId)) fail(`${p.id}.goalId → ${p.goalId}`)
  if (p.nextActionId) {
    if (!ids.tasks.has(p.nextActionId)) fail(`${p.id}.nextActionId → ${p.nextActionId}`)
    const nt = tasks.find((t) => t.id === p.nextActionId)
    if (nt && nt.projectId !== p.id) fail(`${p.id}.nextActionId ${p.nextActionId} 不属于该项目`)
  }
  for (const tag of p.tags) if (!tagNames.has(tag)) fail(`${p.id} 未定义标签 ${tag}`)
}
for (const g of goals) {
  if (g.areaId && !ids.areas.has(g.areaId)) fail(`${g.id}.areaId → ${g.areaId}`)
  if (g.parentGoalId && !ids.goals.has(g.parentGoalId)) fail(`${g.id}.parentGoalId → ${g.parentGoalId}`)
}
for (const h of habits) {
  if (!ids.areas.has(h.areaId)) fail(`${h.id}.areaId → ${h.areaId}`)
}
for (const e of events) {
  if (e.areaId && !ids.areas.has(e.areaId)) fail(`${e.id}.areaId → ${e.areaId}`)
  if (e.projectId && !ids.projects.has(e.projectId)) fail(`${e.id}.projectId → ${e.projectId}`)
  for (const tag of e.tags) if (!tagNames.has(tag)) fail(`${e.id} 未定义标签 ${tag}`)
}
for (const n of notes) {
  if (n.areaId && !ids.areas.has(n.areaId)) fail(`${n.id}.areaId → ${n.areaId}`)
  if (n.projectId && !ids.projects.has(n.projectId)) fail(`${n.id}.projectId → ${n.projectId}`)
  for (const l of n.links) if (!ids.notes.has(l)) fail(`${n.id}.links → ${l}`)
  for (const tag of n.tags) if (!tagNames.has(tag)) fail(`${n.id} 未定义标签 ${tag}`)
}
for (const r of resources) {
  if (r.areaId && !ids.areas.has(r.areaId)) fail(`${r.id}.areaId → ${r.areaId}`)
  for (const tag of r.tags) if (!tagNames.has(tag)) fail(`${r.id} 未定义标签 ${tag}`)
}
for (const i of inbox) {
  if (i.linkedId && !allEntityIds.has(i.linkedId)) fail(`${i.id}.linkedId → ${i.linkedId}`)
}
for (const rev of reviews) {
  for (const pid of rev.staleProjectIds ?? []) {
    if (!ids.projects.has(pid)) fail(`${rev.id}.staleProjectIds → ${pid}`)
  }
}

if (process.exitCode === 1) {
  console.error('[seed] 校验失败，未写入任何数据。')
  process.exit(1)
}

/* ===========================================================================
 * 写入
 * ========================================================================= */
for (const a of areas) writeRecord('areas', a.id, a)
for (const i of inbox) writeRecord('inbox', i.id, i)
for (const t of tasks) writeRecord('tasks', t.id, t)
for (const p of projects) writeRecord('projects', p.id, p)
for (const g of goals) writeRecord('goals', g.id, g)
for (const h of habits) writeRecord('habits', h.id, h)
for (const e of events) writeRecord('events', e.id, e)
for (const tr of traces) writeRecord('traces', tr.id, tr)
for (const n of notes) writeRecord('notes', n.id, n)
for (const r of resources) writeRecord('resources', r.id, r)
for (const rev of reviews) writeRecord('reviews', rev.id, rev)

writeMeta('config', {
  name: 'KERNEL',
  owner: '某高校 · 软件工程 · 大二',
  version: '0.1.0',
  locale: 'zh-CN',
  weekStart: 'monday',
  createdAt: '2026-10-02T00:00:00+08:00',
  aiAutomation: 'confirm',
})
writeMeta('tags', { tags })

/* ===========================================================================
 * 报告
 * ========================================================================= */
const counts = {
  areas: areas.length,
  inbox: inbox.length,
  tasks: tasks.length,
  projects: projects.length,
  goals: goals.length,
  habits: habits.length,
  events: events.length,
  traces: traces.length,
  notes: notes.length,
  resources: resources.length,
  reviews: reviews.length,
  tags: tags.length,
}
const total = Object.values(counts).reduce((a, b) => a + b, 0)
console.log('[seed] 数据生成完成 →', DATA)
for (const [k, v] of Object.entries(counts)) {
  console.log(`  ${k.padEnd(10)} ${String(v).padStart(3)}`)
}
console.log(`  ${'TOTAL'.padEnd(10)} ${String(total).padStart(3)}`)
