// KERNEL · 首启「开始使用」清单卡（Phase 2 · ADR-0041）
// 完成态全部由当前数据快照运行时派生（绝不写入 localStorage / data），
// 三级清单沿用「捕捉 → 澄清 → 组织」的通用循环，不引入身份 / 领域分区。
import { useNavigate } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Panel } from '@/components/Panel'
import {
  getCourses,
  getEvents,
  getHabits,
  getInboxTotalCount,
  getNotes,
  getProjects,
  getResources,
  getReviews,
  getTasks,
  getTerm,
  getTraces,
} from '@/lib/data'

/**
 * 工作区是否「已开始」：任一可沉淀实体非空即视为真
 * （任务 / 日程 / 笔记 / 资料 / 课程 / 踪迹 / 习惯 / 项目）。纯派生，不落盘。
 */
export function isWorkspaceStarted(): boolean {
  return (
    getTasks().length > 0 ||
    getEvents().length > 0 ||
    getNotes().length > 0 ||
    getResources().length > 0 ||
    getCourses().length > 0 ||
    getTraces().length > 0 ||
    getHabits().length > 0 ||
    getProjects().length > 0
  )
}

/**
 * 工作区是否全空：收件箱 / 任务 / 项目 / 日程 / 习惯 / 踪迹 / 笔记 / 资料 /
 * 课程 / 回顾皆无记录。供总览做渐进披露——空工作区只保留状态条 + 开始使用 + AI。
 */
export function isWorkspaceBlank(): boolean {
  return (
    getInboxTotalCount() === 0 &&
    getTasks().length === 0 &&
    getProjects().length === 0 &&
    getEvents().length === 0 &&
    getHabits().length === 0 &&
    getTraces().length === 0 &&
    getNotes().length === 0 &&
    getResources().length === 0 &&
    getCourses().length === 0 &&
    getReviews().length === 0
  )
}

interface StartStep {
  /** 完成条件（运行时由数据派生） */
  done: boolean
  label: string
  /** 安静动作按钮文案 */
  action: string
  go: () => void
}

/** 首启清单卡：三步引导 + 使用指南外链；步骤状态同时由图形与文本表达（不只靠颜色）。 */
export function StartHereCard() {
  const navigate = useNavigate()
  const steps: StartStep[] = [
    {
      done: getTerm() !== null,
      label: '设置学期（课表按周查看）',
      action: '去设置',
      go: () => navigate('/timetable', { viewTransition: true }),
    },
    {
      done: getInboxTotalCount() > 0,
      label: '丢第一件事进收件箱',
      action: '去收件箱',
      go: () => navigate('/inbox', { viewTransition: true }),
    },
    {
      done: isWorkspaceStarted(),
      label: '澄清成任务 / 日程 / 笔记（AI 会给建议）',
      action: '去澄清',
      go: () => navigate('/inbox', { viewTransition: true }),
    },
  ]

  return (
    <section className="k-start" role="region" aria-label="开始使用">
      <Panel title="开始使用" en="GET STARTED">
        <ul className="k-start__list">
          {steps.map((step, index) => (
            <li key={step.label} className={step.done ? 'k-start__row is-done' : 'k-start__row'}>
              {/* 状态指示：已完成 → ✓；未完成 → 安静序号点 */}
              <span className={step.done ? 'k-start__mark is-done' : 'k-start__mark'} aria-hidden>
                {step.done ? <Check size={13} strokeWidth={2} /> : index + 1}
              </span>
              {/* 状态文本（视觉隐藏，仅屏幕阅读器；确保不只靠颜色传达） */}
              <span className="k-start__mark-text">{step.done ? '已完成' : '待完成'}</span>
              <span className="k-start__label">{step.label}</span>
              <span className="k-start__actions">
                <button type="button" className="k-btn k-btn--sm" onClick={step.go}>
                  {step.action}
                </button>
              </span>
            </li>
          ))}
        </ul>
        <p className="k-start__foot">
          <a className="k-empty__guide" href="/guide.html" target="_blank" rel="noreferrer">
            查看使用指南 →
          </a>
        </p>
      </Panel>
    </section>
  )
}
