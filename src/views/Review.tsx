// KERNEL · 回顾 REVIEW（Slice F）：周 / 月回顾卡并列一栏（置于能量分析之上）+ 动画弹窗报告 +
// AI 逐周期解析（周 / 月）+ 停滞项目独立一栏 + 编辑 → 保存 → 撤销删除的闭环。
// 语义沿用 Slice C：AI 只出草稿；确认后经 /api/reviews 落盘（审计 review.create）；撤销即删除。
import { useState } from 'react'
import type { ReactNode } from 'react'
import { Panel } from '@/components/Panel'
import { Modal } from '@/components/Modal'
import { TrendLine } from '@/components/charts/TrendLine'
import { EnergyBars } from '@/components/charts/EnergyBars'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { getProjectById, getReviews, getStaleProjects } from '@/lib/data'
import { getEnergyDistribution, getWeeklyCompletionSeries } from '@/lib/derive'
import { daysFromToday, isoWeekKey, toMonthKey } from '@/lib/date'
import { errorText } from '@/lib/api'
import { useDataRevision } from '@/lib/hooks'
import {
  generateReviewDraft,
  removeReview,
  saveReview,
  updateEntity,
  type ReviewDraft,
  type StaleAdvice,
} from '@/lib/mutations'
import type { Project, Review, ReviewMetrics, ReviewType } from '@/types'

// 指标瓦片定义：数值取自 report.metrics；accent 仅用于「逾期」信号。
// `migrated` 当前生成流程不产出，缺省时显示 '—'。
const METRIC_LABELS: Array<{
  key: keyof ReviewMetrics
  label: string
  foot: string
  accent?: boolean
}> = [
  { key: 'captured', label: '捕获', foot: '进入收件箱' },
  { key: 'created', label: '新增', foot: '转任务 / 项目' },
  { key: 'completed', label: '完成', foot: '本期闭环' },
  { key: 'overdue', label: '逾期', foot: '需前置处理', accent: true },
  { key: 'migrated', label: '迁移', foot: '改期 / 重决策' },
]

/** 停滞处置建议 → 中文动作 */
const ADVICE_ACTION_LABEL: Record<StaleAdvice['action'], string> = {
  archive: '归档',
  migrate: '迁移',
  reactivate: '重启',
}

/** 周期文案（中 / 英微标签 / 空态 / 窗口说明） */
const CYCLE_META: Record<ReviewType, { en: string; window: string; empty: string }> = {
  weekly: {
    en: 'WEEKLY',
    window: '周一 → 今天',
    empty: '尚无周回顾 · 点「AI 解析」生成一份本周报告。',
  },
  monthly: {
    en: 'MONTHLY',
    window: '本月 1 日 → 今天',
    empty: '尚无月回顾 · 点「AI 解析」生成一份本月报告。',
  },
}
const SCOPE_LABEL: Record<ReviewType, string> = { weekly: '周回顾', monthly: '月回顾' }

type DraftPhase = 'idle' | 'loading' | 'draft' | 'error' | 'saving'

interface CycleRuntime {
  phase: DraftPhase
  draft: ReviewDraft | null
  errorMsg: string
}

const IDLE_RUNTIME: CycleRuntime = { phase: 'idle', draft: null, errorMsg: '' }

/** 卡片当前应展示的报告：内存草稿优先，其次该周期最新已保存回顾 */
type Preview = { draft: ReviewDraft } | { saved: Review } | null

export function Review() {
  const { toast } = useToast()
  useDataRevision()
  const [runtimes, setRuntimes] = useState<Record<ReviewType, CycleRuntime>>({
    weekly: IDLE_RUNTIME,
    monthly: IDLE_RUNTIME,
  })
  const [openKind, setOpenKind] = useState<ReviewType | null>(null)
  const [editSummary, setEditSummary] = useState('')
  const [editDecisions, setEditDecisions] = useState('')

  const now = new Date()
  const reviews = getReviews()
  const sortedReviews = [...reviews].sort((a, b) => b.date.localeCompare(a.date))
  const savedReview = (kind: ReviewType): Review | undefined =>
    sortedReviews.find((review) => review.type === kind)
  const staleProjects = getStaleProjects(14)
  const weeklySeries = getWeeklyCompletionSeries()
  const energy = getEnergyDistribution()
  const energyTotal = energy.reduce((sum, item) => sum + item.value, 0)
  const currentKey: Record<ReviewType, string> = {
    weekly: isoWeekKey(now),
    monthly: toMonthKey(now),
  }

  const setRuntime = (kind: ReviewType, next: CycleRuntime): void => {
    setRuntimes((prev) => ({ ...prev, [kind]: next }))
  }

  const previewOf = (kind: ReviewType): Preview => {
    const draft = runtimes[kind].draft
    if (draft !== null) return { draft }
    const saved = savedReview(kind)
    return saved === undefined ? null : { saved }
  }

  const openModal = (kind: ReviewType): void => {
    const preview = previewOf(kind)
    if (preview === null) return
    if ('draft' in preview) {
      setEditSummary(preview.draft.summary)
      setEditDecisions(preview.draft.decisions.join('\n'))
    }
    setOpenKind(kind)
  }

  const runDraft = (kind: ReviewType): void => {
    setRuntime(kind, { phase: 'loading', draft: null, errorMsg: '' })
    void (async () => {
      try {
        const result = await generateReviewDraft(kind)
        setRuntime(kind, { phase: 'draft', draft: result, errorMsg: '' })
      } catch (err) {
        setRuntime(kind, { phase: 'error', draft: null, errorMsg: errorText(err) })
      }
    })()
  }

  const onSave = (kind: ReviewType): void => {
    const summary = editSummary.trim()
    if (summary === '') return
    const decisions = editDecisions
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    setRuntime(kind, { ...runtimes[kind], phase: 'saving' })
    void (async () => {
      try {
        const review = await saveReview(summary, decisions, kind)
        toast(kind === 'weekly' ? '已保存周回顾' : '已保存月回顾', {
          action: {
            label: '撤销',
            onClick: () => {
              void removeReview(review.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
        setOpenKind(null)
        setRuntime(kind, IDLE_RUNTIME)
      } catch (err) {
        setRuntime(kind, { ...runtimes[kind], phase: 'draft' })
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 停滞项目重决策（Slice E2.5）：归档 = status archived；迁移 = touch（空 patch bump updatedAt）
  const archiveProject = (project: Project): void => {
    void (async () => {
      try {
        await updateEntity('projects', project.id, { status: 'archived' })
        toast('已归档 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void updateEntity('projects', project.id, { status: 'active' }).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`归档失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  const migrateProject = (project: Project): void => {
    void (async () => {
      try {
        await updateEntity('projects', project.id, {})
        toast('已重决策：继续推进')
      } catch (err) {
        toast(`迁移失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  /* ------------------------------- 卡片 ------------------------------- */

  const renderCycle = (kind: ReviewType): ReactNode => {
    const meta = CYCLE_META[kind]
    const runtime = runtimes[kind]
    const preview = previewOf(kind)
    const draft = preview !== null && 'draft' in preview ? preview.draft : null
    const report: ReviewDraft | Review | null =
      preview === null ? null : 'draft' in preview ? preview.draft : preview.saved
    const hasReport = report !== null
    const loading = runtime.phase === 'loading'
    const periodKey = report?.periodKey ?? currentKey[kind]

    return (
      <article
        className={draft !== null ? 'k-cycle is-draft' : 'k-cycle'}
        key={kind}
        onClick={() => {
          if (hasReport && !loading) openModal(kind)
        }}
      >
        <header className="k-cycle__head">
          <div>
            <span className="k-cycle__kicker u-label">周期 · {periodKey}</span>
            <h2 className="k-cycle__title">{SCOPE_LABEL[kind]}</h2>
          </div>
          <div className="k-cycle__meta">
            <span className="u-label">{meta.en}</span>
            <span className="u-label k-muted">{meta.window}</span>
          </div>
        </header>

        {hasReport ? (
          <>
            <div className="k-review__metrics k-cycle__metrics">
              {METRIC_LABELS.map((metric) => (
                <div
                  className={metric.accent === true ? 'k-stat k-stat--accent' : 'k-stat'}
                  key={metric.key}
                >
                  <span className="k-stat__label">{metric.label}</span>
                  <span className="k-stat__value">{report.metrics[metric.key] ?? '—'}</span>
                </div>
              ))}
            </div>
            <p className="k-cycle__summary">{report.summary}</p>
          </>
        ) : (
          <p
            className={
              runtime.phase === 'error' ? 'k-cycle__empty k-review__error' : 'k-cycle__empty'
            }
          >
            {loading ? '正在汇总数据生成报告…（约 10 秒）' : runtime.errorMsg !== '' ? runtime.errorMsg : meta.empty}
          </p>
        )}

        {hasReport && runtime.phase === 'error' && (
          <p className="k-cycle__empty k-review__error">{runtime.errorMsg}</p>
        )}

        <footer className="k-cycle__foot">
          <button
            type="button"
            className="k-btn k-btn--sm"
            onClick={(event) => {
              event.stopPropagation()
              runDraft(kind)
            }}
            disabled={loading}
          >
            {loading ? 'AI 解析中…' : hasReport ? '重新生成' : 'AI 解析'}
          </button>
          {hasReport && !loading && (
            <button
              type="button"
              className="k-btn k-btn--sm is-solid"
              onClick={(event) => {
                event.stopPropagation()
                openModal(kind)
              }}
            >
              查阅报告
            </button>
          )}
        </footer>
      </article>
    )
  }

  /* ------------------------------- 弹窗 ------------------------------- */

  const renderModal = (kind: ReviewType): ReactNode => {
    const preview = previewOf(kind)
    if (preview === null) return null
    const draft = 'draft' in preview ? preview.draft : null
    const report: ReviewDraft | Review = 'draft' in preview ? preview.draft : preview.saved
    const runtime = runtimes[kind]
    const saving = runtime.phase === 'saving'
    const canSave = editSummary.trim() !== '' && !saving

    return (
      <Modal
        key={kind}
        open={openKind === kind}
        onClose={() => setOpenKind(null)}
        kicker={`${SCOPE_LABEL[kind]} · ${report.periodKey}`}
        title={`${SCOPE_LABEL[kind]}报告`}
        className="k-modal--report"
        footer={
          draft !== null ? (
            <>
              <button
                type="button"
                className="k-btn"
                onClick={() => runDraft(kind)}
                disabled={saving}
              >
                重新生成
              </button>
              <button
                type="button"
                className="k-btn is-solid"
                onClick={() => onSave(kind)}
                disabled={!canSave}
              >
                {saving ? '保存中…' : '保存回顾'}
              </button>
            </>
          ) : (
            <button type="button" className="k-btn" onClick={() => setOpenKind(null)}>
              关闭
            </button>
          )
        }
      >
        <div className="k-review__metrics">
          {METRIC_LABELS.map((metric) => (
            <div
              className={metric.accent === true ? 'k-stat k-stat--accent' : 'k-stat'}
              key={metric.key}
            >
              <span className="k-stat__label">{metric.label}</span>
              <span className="k-stat__value">{report.metrics[metric.key] ?? '—'}</span>
              <span className="k-stat__foot">{metric.foot}</span>
            </div>
          ))}
        </div>

        <div className="k-review__field">
          <label className="k-review__label" htmlFor={`review-summary-${kind}`}>
            摘要 · SUMMARY
          </label>
          {draft !== null ? (
            <textarea
              id={`review-summary-${kind}`}
              className="k-review__ta"
              rows={5}
              value={editSummary}
              onChange={(event) => setEditSummary(event.target.value)}
              placeholder="本期推进与问题…"
            />
          ) : (
            <p className="k-report__summary">{report.summary}</p>
          )}
        </div>

        <div className="k-review__field">
          <label className="k-review__label" htmlFor={`review-decisions-${kind}`}>
            决策 · DECISIONS（每行一条）
          </label>
          {draft !== null ? (
            <textarea
              id={`review-decisions-${kind}`}
              className="k-review__ta"
              rows={4}
              value={editDecisions}
              onChange={(event) => setEditDecisions(event.target.value)}
              placeholder="迁移 / 聚焦 / 处置…"
            />
          ) : report.decisions.length === 0 ? (
            <p className="k-muted">本期无决策记录。</p>
          ) : (
            <div className="k-stack">
              {report.decisions.map((decision, index) => (
                <p className="k-decision" key={decision}>
                  <span className="u-mono k-accent">{String(index + 1).padStart(2, '0')}</span>
                  {decision}
                </p>
              ))}
            </div>
          )}
        </div>

        {draft !== null && draft.staleAdvice.length > 0 && (
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
      </Modal>
    )
  }

  return (
    <div className="k-view">
      {/* 顶栏：周期说明 + 当前周期胶囊 */}
      <div className="k-review__top">
        <p className="k-view__intro">
          周回顾是系统的心跳：短、可视、可自动化。当前周期 {currentKey.weekly} · {currentKey.monthly}。
        </p>
        <div className="k-review__periods">
          <span className="k-pill">{currentKey.weekly}</span>
          <span className="k-pill is-ghost">{currentKey.monthly}</span>
        </div>
      </div>

      {/* 栏 1：周 / 月回顾卡并列（位于能量分析之上）；点击卡片弹窗查阅 */}
      <section className="k-review__cycles" aria-label="回顾周期">
        {renderCycle('weekly')}
        {renderCycle('monthly')}
      </section>

      {/* 栏 2：能量分析（前）与本周期完成（后） */}
      <div className="k-review__charts">
        <Panel
          title="能量分析"
          en="ENERGY"
          actions={<span className="u-label k-muted">未完成 {energyTotal}</span>}
        >
          <EnergyBars data={energy} />
          <p className="k-view__intro">
            单色 + 图案区分：高能量为唯一强调序列，低能量为斜纹填充。
          </p>
        </Panel>

        <Panel
          title="本周完成"
          en="COMPLETION"
          actions={<span className="u-label k-muted">周一 → 周日</span>}
        >
          <TrendLine data={weeklySeries} />
        </Panel>
      </div>

      {/* 栏 3：停滞项目（独立一栏） */}
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
                      onClick={() => migrateProject(project)}
                    >
                      迁移
                    </button>
                    <button
                      type="button"
                      className="k-btn k-btn--sm"
                      onClick={() => archiveProject(project)}
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

      {renderModal('weekly')}
      {renderModal('monthly')}
    </div>
  )
}
