// KERNEL · 回顾 REVIEW（P1）：周期摘要 + AI 周回顾流程 + 单色图表 + 停滞项目重决策
// v0.5 · Slice C：AI 生成草稿（指标 / 摘要 / 决策 / 停滞处置建议）→ 用户编辑 → 确认落盘（撤销即删除）。
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Panel } from '@/components/Panel'
import { Drawer } from '@/components/Drawer'
import { TrendLine } from '@/components/charts/TrendLine'
import { EnergyBars } from '@/components/charts/EnergyBars'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { getProjectById, getReviews, getStaleProjects } from '@/lib/data'
import { getEnergyDistribution, getWeeklyCompletionSeries } from '@/lib/derive'
import { REVIEW_TYPE_LABEL } from '@/lib/format'
import { daysFromToday, isoWeekKey, monthLabel } from '@/lib/date'
import { errorText } from '@/lib/api'
import {
  generateReviewDraft,
  removeReview,
  saveReview,
  type ReviewDraft,
  type StaleAdvice,
} from '@/lib/mutations'
import type { Review } from '@/types'

const STEPS: Array<{ num: string; title: string; desc: string }> = [
  { num: '①', title: '清空收件箱', desc: '把未澄清项处理到阈值以下' },
  { num: '②', title: '审视项目', desc: '确认每个活跃项目都有明确的下一步' },
  { num: '③', title: '统计', desc: '回看本周完成 / 新增 / 逾期 / 迁移' },
  { num: '④', title: '决策', desc: '对停滞项重决策：迁移或归档' },
  { num: '⑤', title: '完成', desc: '写下本周摘要与下周聚焦' },
]

// 指标瓦片定义：数值取自 review.metrics；accent 仅用于「逾期」信号。
// `migrated` 当前生成流程不产出，缺省时显示 '—'。
const METRIC_LABELS: Array<{
  key: keyof Review['metrics']
  label: string
  foot: string
  accent?: boolean
}> = [
  { key: 'captured', label: '捕获', foot: '进入收件箱' },
  { key: 'created', label: '新增', foot: '转任务 / 项目' },
  { key: 'completed', label: '完成', foot: '本周闭环' },
  { key: 'overdue', label: '逾期', foot: '需前置处理', accent: true },
  { key: 'migrated', label: '迁移', foot: '改期 / 重决策' },
]

/** 停滞处置建议 → 中文动作 */
const ADVICE_ACTION_LABEL: Record<StaleAdvice['action'], string> = {
  archive: '归档',
  migrate: '迁移',
  reactivate: '重启',
}

type DraftPhase = 'idle' | 'loading' | 'draft' | 'error' | 'saving'

export function Review() {
  const { toast } = useToast()
  const [flowOpen, setFlowOpen] = useState(false)
  const [phase, setPhase] = useState<DraftPhase>('idle')
  const [draft, setDraft] = useState<ReviewDraft | null>(null)
  const [summary, setSummary] = useState('')
  const [decisionsText, setDecisionsText] = useState('')
  const [errorMsg, setErrorMsg] = useState('')

  const now = new Date()
  const reviews = getReviews()
  // 最新回顾：按 date 倒序取每周 / 每月各一条（不再依赖目录中的第一条）
  const sortedReviews = [...reviews].sort((a, b) => b.date.localeCompare(a.date))
  const weekly = sortedReviews.find((review) => review.type === 'weekly')
  const monthly = sortedReviews.find((review) => review.type === 'monthly')
  const staleProjects = getStaleProjects(14)
  const weeklySeries = getWeeklyCompletionSeries()
  const energy = getEnergyDistribution()
  const energyTotal = energy.reduce((sum, item) => sum + item.value, 0)
  const currentWeek = isoWeekKey(now)
  const currentMonth = monthLabel(now)

  const openFlow = (): void => {
    setPhase('idle')
    setDraft(null)
    setSummary('')
    setDecisionsText('')
    setErrorMsg('')
    setFlowOpen(true)
  }

  const runDraft = (): void => {
    setPhase('loading')
    setErrorMsg('')
    void (async () => {
      try {
        const result = await generateReviewDraft()
        setDraft(result)
        setSummary(result.summary)
        setDecisionsText(result.decisions.join('\n'))
        setPhase('draft')
      } catch (err) {
        setErrorMsg(errorText(err))
        setPhase('error')
      }
    })()
  }

  const decisions = decisionsText
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
  const canSave = summary.trim() !== '' && phase !== 'saving'

  const onSave = (): void => {
    if (!canSave) return
    setPhase('saving')
    void (async () => {
      try {
        const review = await saveReview(summary.trim(), decisions)
        toast('已保存周回顾', {
          action: {
            label: '撤销',
            onClick: () => {
              void removeReview(review.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
        setFlowOpen(false)
        setPhase('idle')
      } catch (err) {
        setPhase('draft')
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  return (
    <div className="k-view">
      {/* 顶栏：周期说明 + 当前周期胶囊 */}
      <div className="k-review__top">
        <p className="k-view__intro">
          周回顾是系统的心跳：短、可视、可自动化。当前周期 {currentWeek} · {currentMonth}。
        </p>
        <div className="k-review__periods">
          {weekly !== undefined && <span className="k-pill">{weekly.periodKey}</span>}
          {monthly !== undefined && <span className="k-pill is-ghost">{monthly.periodKey}</span>}
        </div>
      </div>

      {/* 双栏仪表盘：左=指标 + 图表；右=回顾卡 + 停滞清单 + CTA。
          窄 route 容器并作单列，左栏（指标/图表）在上、右栏（回顾）在下（见设计稿移动端说明）。 */}
      <div className="k-review__dash">
        <div className="k-review__col">
          {weekly !== undefined && (
            <div className="k-review__metrics">
              {METRIC_LABELS.map((metric) => (
                <div
                  className={metric.accent === true ? 'k-stat k-stat--accent' : 'k-stat'}
                  key={metric.key}
                >
                  <span className="k-stat__label">{metric.label}</span>
                  <span className="k-stat__value">{weekly.metrics[metric.key] ?? '—'}</span>
                  <span className="k-stat__foot">{metric.foot}</span>
                </div>
              ))}
            </div>
          )}

          <Panel
            title="本周完成"
            en="COMPLETION"
            actions={<span className="u-label k-muted">周一 → 周日</span>}
          >
            <TrendLine data={weeklySeries} />
          </Panel>

          <Panel
            title="能量分布"
            en="ENERGY"
            actions={<span className="u-label k-muted">未完成 {energyTotal}</span>}
          >
            <EnergyBars data={energy} />
            <p className="k-view__intro">
              单色 + 图案区分：高能量为唯一强调序列，低能量为斜纹填充。
            </p>
          </Panel>
        </div>

        <div className="k-review__col">
          {weekly !== undefined && (
            <ReviewCard
              review={weekly}
              footer={
                <div className="k-review__cta">
                  <button type="button" className="k-btn is-solid" onClick={openFlow}>
                    开始周回顾
                  </button>
                </div>
              }
            />
          )}
          {monthly !== undefined && <ReviewCard review={monthly} />}
          {weekly === undefined && monthly === undefined && (
            <EmptyState title="暂无回顾记录" hint="完成一次周回顾后，摘要会出现在这里。" />
          )}

          <Panel
            title="停滞项目"
            en="STALE · ≥14 天未更新"
            actions={<span className="u-label k-muted">{staleProjects.length}</span>}
          >
            {staleProjects.length === 0 ? (
              <EmptyState title="无停滞项目" hint="所有活跃项目近期都有更新。" />
            ) : (
              <div className="k-stale">
                {staleProjects.map((project) => {
                  const staleDays = Math.abs(daysFromToday(project.updatedAt))
                  return (
                    <div className="k-stale__row" key={project.id}>
                      <div>
                        <div>{project.title}</div>
                        <div className="k-stale__meta k-mono">
                          {project.id} · 已停滞 {staleDays} 天 · {project.outcome}
                        </div>
                      </div>
                      <div className="k-view__actions">
                        <button
                          type="button"
                          className="k-btn k-btn--sm"
                          onClick={() => toast(`原型态：迁移「${project.title}」→ v0.6 起重决策落盘`)}
                        >
                          迁移
                        </button>
                        <button
                          type="button"
                          className="k-btn k-btn--sm"
                          onClick={() => toast(`原型态：归档「${project.title}」→ v0.6 起重决策落盘`)}
                        >
                          归档
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Panel>
        </div>
      </div>

      <Drawer
        open={flowOpen}
        onClose={() => setFlowOpen(false)}
        kicker={`周回顾 · ${currentWeek}`}
        title="开始周回顾"
        footer={
          <>
            {phase === 'idle' && (
              <button type="button" className="k-btn is-solid" onClick={runDraft}>
                AI 生成草稿
              </button>
            )}
            {phase === 'loading' && (
              <button type="button" className="k-btn is-solid" disabled>
                正在生成…
              </button>
            )}
            {phase === 'error' && (
              <button type="button" className="k-btn is-solid" onClick={runDraft}>
                重试
              </button>
            )}
            {(phase === 'draft' || phase === 'saving') && (
              <>
                <button
                  type="button"
                  className="k-btn"
                  onClick={runDraft}
                  disabled={phase === 'saving'}
                >
                  重新生成
                </button>
                <button type="button" className="k-btn is-solid" onClick={onSave} disabled={!canSave}>
                  保存回顾
                </button>
              </>
            )}
          </>
        }
      >
        {/* 五步清扫清单：保留为安静指引（不再驱动流程） */}
        <div className="k-steps">
          {STEPS.map((item) => (
            <div className="k-step is-guide" key={item.num}>
              <span className="k-step__num">{item.num}</span>
              <span className="k-step__body">
                <span>{item.title}</span>
                <span className="k-muted u-label">{item.desc}</span>
              </span>
            </div>
          ))}
        </div>

        <div className="k-review__draft">
          {phase === 'idle' && (
            <p className="k-view__intro">
              先按上方五步清扫，再让 AI 汇总本周数据生成草稿；草稿可编辑，确认后才会保存。
            </p>
          )}

          {phase === 'loading' && (
            <p className="k-review__busy" aria-live="polite">
              正在汇总本周数据并生成草稿…（约 10 秒）
            </p>
          )}

          {phase === 'error' && (
            <p className="k-review__error" role="alert">
              {errorMsg}
            </p>
          )}

          {(phase === 'draft' || phase === 'saving') && draft !== null && (
            <>
              <div className="k-review__metrics">
                {METRIC_LABELS.map((metric) => (
                  <div
                    className={metric.accent === true ? 'k-stat k-stat--accent' : 'k-stat'}
                    key={metric.key}
                  >
                    <span className="k-stat__label">{metric.label}</span>
                    <span className="k-stat__value">{draft.metrics[metric.key] ?? '—'}</span>
                    <span className="k-stat__foot">{metric.foot}</span>
                  </div>
                ))}
              </div>

              <div className="k-review__field">
                <label className="k-review__label" htmlFor="review-summary">
                  本周摘要
                </label>
                <textarea
                  id="review-summary"
                  className="k-review__ta"
                  rows={4}
                  value={summary}
                  onChange={(event) => setSummary(event.target.value)}
                  placeholder="本周推进与问题…"
                />
              </div>

              <div className="k-review__field">
                <label className="k-review__label" htmlFor="review-decisions">
                  决策（每行一条）
                </label>
                <textarea
                  id="review-decisions"
                  className="k-review__ta"
                  rows={4}
                  value={decisionsText}
                  onChange={(event) => setDecisionsText(event.target.value)}
                  placeholder="迁移 / 聚焦 / 处置…"
                />
              </div>

              {draft.staleAdvice.length > 0 && (
                <div className="k-review__field">
                  <span className="k-review__label">停滞项目处置建议</span>
                  <div className="k-review__advice">
                    {draft.staleAdvice.map((advice) => (
                      <div className="k-review__advice-row" key={advice.projectId}>
                        <span>{getProjectById(advice.projectId)?.title ?? advice.projectId}</span>
                        <span className="k-muted">建议{ADVICE_ACTION_LABEL[advice.action]}</span>
                        {advice.reason !== '' && <span className="k-muted">{advice.reason}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </Drawer>
    </div>
  )
}

function ReviewCard({ review, footer }: { review: Review; footer?: ReactNode }) {
  return (
    <div className="k-review__card">
      <div className="k-between">
        <span className="k-panel__cn">
          {review.periodKey} · {REVIEW_TYPE_LABEL[review.type]}
        </span>
        <span className="u-label k-muted">{review.type === 'weekly' ? 'WEEKLY' : 'MONTHLY'}</span>
      </div>
      <p className="k-view__intro">{review.summary}</p>
      <div className="k-detail-block">
        <span className="k-detail-block__label u-label">决策 · DECISIONS</span>
        <div className="k-stack">
          {review.decisions.map((decision, index) => (
            <p className="k-decision" key={decision}>
              <span className="u-mono k-accent">{String(index + 1).padStart(2, '0')}</span>
              {decision}
            </p>
          ))}
        </div>
      </div>
      {footer}
    </div>
  )
}
