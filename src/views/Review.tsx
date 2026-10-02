// KERNEL · 回顾 REVIEW（P1）：周期摘要 + 周回顾流程 + 单色图表 + 停滞项目重决策
import { useState } from 'react'
import { Panel } from '@/components/Panel'
import { Drawer } from '@/components/Drawer'
import { TrendBars } from '@/components/charts/TrendBars'
import { EnergyBars } from '@/components/charts/EnergyBars'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { getReviews, getStaleProjects } from '@/lib/data'
import { getEnergyDistribution, getWeeklyCompletionSeries } from '@/lib/derive'
import { REVIEW_TYPE_LABEL } from '@/lib/format'
import { daysFromToday } from '@/lib/date'
import type { Review } from '@/types'

const STEPS: Array<{ num: string; title: string; desc: string }> = [
  { num: '①', title: '清空收件箱', desc: '把未澄清项处理到阈值以下' },
  { num: '②', title: '审视项目', desc: '确认每个活跃项目都有明确的下一步' },
  { num: '③', title: '统计', desc: '回看本周完成 / 新增 / 逾期 / 迁移' },
  { num: '④', title: '决策', desc: '对停滞项重决策：迁移或归档' },
  { num: '⑤', title: '完成', desc: '写下本周摘要与下周聚焦' },
]

const METRIC_LABELS: Array<{ key: keyof Review['metrics']; label: string; accent?: boolean }> = [
  { key: 'captured', label: '捕获' },
  { key: 'created', label: '新增' },
  { key: 'completed', label: '完成' },
  { key: 'overdue', label: '逾期', accent: true },
  { key: 'migrated', label: '迁移' },
]

export function Review() {
  const { toast } = useToast()
  const [flowOpen, setFlowOpen] = useState(false)
  const [step, setStep] = useState(0)

  const reviews = getReviews()
  const weekly = reviews.find((review) => review.type === 'weekly')
  const monthly = reviews.find((review) => review.type === 'monthly')
  const staleProjects = getStaleProjects(14)
  const weeklySeries = getWeeklyCompletionSeries()
  const energy = getEnergyDistribution()

  const finishFlow = (): void => {
    setFlowOpen(false)
    setStep(0)
    toast('原型态：周回顾流程为视觉演示，v0.6 起自动汇总指标并落盘')
  }

  return (
    <div className="k-view">
      <div className="k-between">
        <p className="k-view__intro">周回顾是系统的心跳：短、可视、可自动化。当前周期 2026-W40 · 9 月。</p>
        <button type="button" className="k-btn is-solid" onClick={() => setFlowOpen(true)}>
          开始周回顾
        </button>
      </div>

      <div className="k-review__periods">
        {weekly !== undefined && <ReviewCard review={weekly} />}
        {monthly !== undefined && <ReviewCard review={monthly} />}
        {weekly === undefined && monthly === undefined && (
          <EmptyState index="00" title="暂无回顾记录" hint="完成一次周回顾后，摘要会出现在这里。" />
        )}
      </div>

      <Panel index="03" title="本周指标" en="METRICS">
        {weekly !== undefined ? (
          <div className="k-review__metrics">
            {METRIC_LABELS.map((metric) => (
              <div className="k-met" key={metric.key}>
                <span className={metric.accent === true ? 'k-met__num is-accent' : 'k-met__num'}>
                  {weekly.metrics[metric.key]}
                </span>
                <span className="u-label k-muted">{metric.label}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="k-muted">—</p>
        )}
      </Panel>

      <div className="k-review__charts">
        <Panel index="04" title="本周完成" en="COMPLETION">
          <TrendBars data={weeklySeries} unit="" />
        </Panel>
        <Panel index="05" title="能量分布" en="ENERGY">
          <EnergyBars data={energy} />
          <p className="k-view__intro">
            单色 + 图案区分：高能量为唯一强调序列，低能量为斜纹填充。
          </p>
        </Panel>
      </div>

      <Panel
        index="06"
        title="停滞项目"
        en="STALE · ≥14 天未更新"
        actions={<span className="u-label k-muted">{staleProjects.length}</span>}
      >
        {staleProjects.length === 0 ? (
          <EmptyState index="06" title="无停滞项目" hint="所有活跃项目近期都有更新。" />
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

      <Drawer
        open={flowOpen}
        onClose={() => setFlowOpen(false)}
        kicker="周回顾 · 2026-W40"
        title="开始周回顾"
        footer={
          <>
            <button
              type="button"
              className="k-btn"
              onClick={() => setStep((prev) => Math.max(0, prev - 1))}
              disabled={step === 0}
            >
              上一步
            </button>
            {step < STEPS.length - 1 ? (
              <button
                type="button"
                className="k-btn is-solid"
                onClick={() => setStep((prev) => Math.min(STEPS.length - 1, prev + 1))}
              >
                下一步
              </button>
            ) : (
              <button type="button" className="k-btn is-solid" onClick={finishFlow}>
                完成
              </button>
            )}
          </>
        }
      >
        <div className="k-steps">
          {STEPS.map((item, index) => (
            <button
              type="button"
              className={[
                'k-step',
                index === step ? 'is-active' : '',
                index < step ? 'is-done' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              key={item.num}
              onClick={() => setStep(index)}
            >
              <span className="k-step__num">{item.num}</span>
              <span className="k-step__body">
                <span>{item.title}</span>
                <span className="k-muted u-label">{item.desc}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="k-view__intro" style={{ marginTop: 'var(--space-5)' }}>
          当前步骤：{STEPS[step].title} —— {STEPS[step].desc}。此流程为原型态演示，v0.6 起自动汇总指标、生成停滞清单并建议迁移。
        </p>
      </Drawer>
    </div>
  )
}

function ReviewCard({ review }: { review: Review }) {
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
    </div>
  )
}
