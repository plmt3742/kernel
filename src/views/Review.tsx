// KERNEL · 回顾 REVIEW（Slice F 布局 + Slice L 升级）：
// 周 / 月回顾卡并列一栏（置于能量分析之上）+ 动画弹窗报告 +
// 七段结构报告（这周怎么样 / 这个月怎么样 → … → 需要留意的）+ 每次生成自动归档（报告历史按时间查阅）+
// 编辑「保存回顾」更新同一归档记录（不重复建）+ 停滞项目独立一栏。
// 语义：AI 只出草稿；生成即自动归档（审计 review.create · auto），编辑确认后更新同一条
// （审计 review.update）；报告可删除（review.remove）。见 ADR-0013。
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Panel } from '@/components/Panel'
import { Modal } from '@/components/Modal'
import { ActivityTimeline } from '@/components/ActivityTimeline'
import { TrendLine } from '@/components/charts/TrendLine'
import { EnergyBars } from '@/components/charts/EnergyBars'
import { EmptyState } from '@/components/EmptyState'
import { useToast } from '@/context/ToastContext'
import { getProjectById, getReviews, getStaleProjects } from '@/lib/data'
import { getEnergyDistribution, getWeeklyCompletionSeries } from '@/lib/derive'
import { daysFromToday, formatDateTime, isoWeekKey, toMonthKey } from '@/lib/date'
import { errorText } from '@/lib/api'
import { useDataRevision } from '@/lib/hooks'
import { createUiStore, useUiStore } from '@/lib/uiState'
import { parseReviewSummary, sectionParagraphs } from '@/lib/reviewReport'
import {
  generateReviewDraft,
  hydrateFromServer,
  removeReview,
  saveReview,
  updateEntity,
  updateReview,
  type ReviewDraft,
  type StaleAdvice,
} from '@/lib/mutations'
import type { Project, Review, ReviewMetrics, ReviewType } from '@/types'

// 指标瓦片定义：数值取自 report.metrics；accent 仅用于「逾期」信号。
// 「迁移」瓦片已移除（Slice Y · F12，见 ADR-0021）：生成流程不产出 `migrated`，
// 瓦片长期恒显示 '—'；数据字段 `ReviewMetrics.migrated` 保留以兼容旧归档，但不再在 UI 呈现。
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

/* ---------------------------------------------------------------------------
 * 回顾页界面状态保留（Slice Z · F29，见 ADR-0022）：
 * 周 / 月卡的 AI 草稿运行态（含生成中 / 错误 / 草稿）提升到模块级 store——
 * 切路由再回来仍能看到刚生成的草稿（无需重跑）；**刻意不持久化 localStorage**：
 * 报告正文体量较大，且草稿绑定归档 reviewId，跨刷新回放风险高（见 ADR-0022）。
 * 弹窗 / 编辑缓冲区为瞬时交互态，随组件卸载关闭（不保留）。
 * ------------------------------------------------------------------------- */
interface ReviewRuntimeState {
  weekly: CycleRuntime
  monthly: CycleRuntime
}

const reviewRuntimeStore = createUiStore<ReviewRuntimeState>(
  'kernel.ui.review',
  { weekly: IDLE_RUNTIME, monthly: IDLE_RUNTIME },
  { persist: false },
)

/** 卡片当前应展示的报告：内存草稿优先，其次该周期最新已归档回顾 */
type Preview = { draft: ReviewDraft } | { saved: Review } | null

/** 弹窗状态：编辑某周期（最新可编辑）/ 只读查看某条归档 */
type ModalState =
  | { mode: 'edit'; kind: ReviewType; reviewId: string | null }
  | { mode: 'view'; reviewId: string }
  | null

/** 指标瓦片（卡片 / 弹窗共用） */
function MetricTiles({ metrics, withFoot }: { metrics: ReviewMetrics; withFoot?: boolean }): ReactNode {
  return (
    <div className="k-review__metrics">
      {METRIC_LABELS.map((metric) => (
        <div
          className={metric.accent === true ? 'k-stat k-stat--accent' : 'k-stat'}
          key={metric.key}
        >
          <span className="k-stat__label">{metric.label}</span>
          <span className="k-stat__value">{metrics[metric.key] ?? '—'}</span>
          {withFoot === true && <span className="k-stat__foot">{metric.foot}</span>}
        </div>
      ))}
    </div>
  )
}

/**
 * 报告正文·阅读视图（Slice U，纯文本，无 dangerouslySetInnerHTML）：
 * 用 `parseReviewSummary` 拆成七段，渲染为「序号 + 标题行 + 正文段落」的安静分栏，
 * 舒适行距与测度。无法识别分节（旧归档 / 手写正文）时回退为整段渲染。
 */
function ReportReadView({ text }: { text: string }): ReactNode {
  const { intro, sections } = parseReviewSummary(text)
  if (sections.length === 0) {
    const paras = sectionParagraphs(text)
    return (
      <div className="k-report__summary">
        {paras.map((para, index) => (
          <p className="k-report__para" key={`${index}-${para.slice(0, 6)}`}>
            {para}
          </p>
        ))}
      </div>
    )
  }
  return (
    <div className="k-report__sections">
      {intro !== '' && <p className="k-report__intro">{intro}</p>}
      {sections.map((section, index) => {
        const bodyParas = sectionParagraphs(section.body)
        return (
          <section className="k-report__section" key={`${index}-${section.label}`}>
            <header className="k-report__section-head">
              <span className="k-report__section-index u-mono">{String(index + 1).padStart(2, '0')}</span>
              <h3 className="k-report__section-title">{section.label}</h3>
            </header>
            <div className="k-report__section-body">
              {bodyParas.length === 0 ? (
                <p className="k-report__para k-muted">（本段无内容）</p>
              ) : (
                bodyParas.map((para, pIndex) => (
                  <p className="k-report__para" key={`${index}-${pIndex}-${para.slice(0, 6)}`}>
                    {para}
                  </p>
                ))
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}

/** 决策清单（阅读视图 / 只读弹窗共用）：安静编号 + 一行一条 if-then */
function DecisionsList({ decisions }: { decisions: string[] }): ReactNode {
  if (decisions.length === 0) return <p className="k-muted">本期无决策记录。</p>
  return (
    <div className="k-stack">
      {decisions.map((decision, index) => (
        <p className="k-decision" key={`${index}-${decision.slice(0, 6)}`}>
          <span className="u-mono k-accent">{String(index + 1).padStart(2, '0')}</span>
          {decision}
        </p>
      ))}
    </div>
  )
}

export function Review() {
  const { toast } = useToast()
  useDataRevision()
  // 运行态（Slice Z · F29）：来自模块级 store（跨路由保留；刷新即重置）
  const runtimes = useUiStore(reviewRuntimeStore)
  const setRuntimes = (
    next: ReviewRuntimeState | ((prev: ReviewRuntimeState) => ReviewRuntimeState),
  ): void => {
    reviewRuntimeStore.set(next)
  }
  const [modal, setModal] = useState<ModalState>(null)
  // 弹窗默认「阅读视图」；「编辑」进入编辑视图，「完成」回到阅读（Slice U）
  const [editing, setEditing] = useState(false)
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

  // 关闭动画期间保留最后一份内容（Modal 常挂载，open 切换以播退场）
  const lastModalRef = useRef<ModalState>(null)
  if (modal !== null) lastModalRef.current = modal
  const renderedModal = modal ?? lastModalRef.current

  const setRuntime = (kind: ReviewType, next: CycleRuntime): void => {
    setRuntimes((prev) => ({ ...prev, [kind]: next }))
  }

  const previewOf = (kind: ReviewType): Preview => {
    const draft = runtimes[kind].draft
    if (draft !== null) return { draft }
    const saved = savedReview(kind)
    return saved === undefined ? null : { saved }
  }

  /** 打开某周期的报告（最新可编辑）：种子取自内存草稿或最新归档 */
  const openEdit = (kind: ReviewType): void => {
    const preview = previewOf(kind)
    if (preview === null) return
    if ('draft' in preview) {
      setEditSummary(preview.draft.summary)
      setEditDecisions(preview.draft.decisions.join('\n'))
      setEditing(false)
      setModal({ mode: 'edit', kind, reviewId: preview.draft.reviewId ?? null })
      return
    }
    setEditSummary(preview.saved.summary)
    setEditDecisions(preview.saved.decisions.join('\n'))
    setEditing(false)
    setModal({ mode: 'edit', kind, reviewId: preview.saved.id })
  }

  /** 只读查看某条归档报告（报告历史入口）：与编辑弹窗共用阅读视图 */
  const openView = (reviewId: string): void => {
    setEditing(false)
    setModal({ mode: 'view', reviewId })
  }

  const runDraft = (kind: ReviewType): void => {
    setRuntime(kind, { phase: 'loading', draft: null, errorMsg: '' })
    void (async () => {
      try {
        const result = await generateReviewDraft(kind)
        setRuntime(kind, { phase: 'draft', draft: result, errorMsg: '' })
        // 服务端已在生成时自动归档；刷新快照让「报告历史」立即出现该条
        void hydrateFromServer()
        // 新生成 → 自动归档出新 id：若弹窗正编辑该周期，切到新记录并同步编辑区
        setEditSummary(result.summary)
        setEditDecisions(result.decisions.join('\n'))
        setModal((prev) =>
          prev !== null && prev.mode === 'edit' && prev.kind === kind
            ? { mode: 'edit', kind, reviewId: result.reviewId }
            : prev,
        )
      } catch (err) {
        setRuntime(kind, { phase: 'error', draft: null, errorMsg: errorText(err) })
      }
    })()
  }

  const onSave = (): void => {
    if (modal === null || modal.mode !== 'edit') return
    const kind = modal.kind
    const reviewId = modal.reviewId
    const summary = editSummary.trim()
    if (summary === '') return
    const decisions = editDecisions
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line !== '')
    const previous = runtimes[kind]
    setRuntime(kind, { ...previous, phase: 'saving' })
    void (async () => {
      try {
        // 已有归档 id → 更新同一条（不重复建）；否则回退到创建
        const review =
          reviewId !== null
            ? await updateReview(reviewId, summary, decisions)
            : await saveReview(summary, decisions, kind)
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
        setModal(null)
        setRuntime(kind, IDLE_RUNTIME)
      } catch (err) {
        setRuntime(kind, {
          ...previous,
          phase: previous.draft !== null ? 'draft' : 'idle',
        })
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  const onDeleteReview = (id: string): void => {
    void (async () => {
      try {
        await removeReview(id)
        setRuntimes((prev) => {
          const next = { ...prev }
          for (const kind of ['weekly', 'monthly'] as ReviewType[]) {
            if (next[kind].draft?.reviewId === id) next[kind] = IDLE_RUNTIME
          }
          return next
        })
        setModal(null)
        toast('已删除归档报告')
      } catch (err) {
        toast(`删除失败：${errorText(err)}`, { tone: 'error' })
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

  // 重启（Slice Y · F17）：AI 建议 reactivate → status active（与归档对称）
  const reactivateProject = (project: Project): void => {
    void (async () => {
      try {
        await updateEntity('projects', project.id, { status: 'active' })
        toast('已重启：继续推进')
      } catch (err) {
        toast(`重启失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 报告弹窗内「按建议处理」（Slice Y · F17）：把只读的停滞建议行接到与下方停滞栏相同的动作。
  const applyStaleAdvice = (advice: StaleAdvice): void => {
    const project = getProjectById(advice.projectId)
    if (project === undefined) {
      toast('项目不存在或已被删除', { tone: 'error' })
      return
    }
    if (advice.action === 'archive') archiveProject(project)
    else if (advice.action === 'reactivate') reactivateProject(project)
    else migrateProject(project)
  }

  /**
   * 归档报告的「迁移建议」（回顾自动化）：随报告一并持久化，历史查阅时回看 AI 的处置建议。
   * 项目仍在库中时可按建议处理（与上方会话草稿面板共用 `applyStaleAdvice`）；缺失则仅展示、按钮禁用。
   */
  const renderStaleAdviceBlock = (adviceList: StaleAdvice[], keyPrefix: string): ReactNode => {
    if (adviceList.length === 0) return null
    return (
      <div className="k-review__field">
        <span className="k-review__label">迁移建议</span>
        <div className="k-review__advice">
          {adviceList.map((advice, index) => (
            <div className="k-review__advice-row" key={`${keyPrefix}-${advice.projectId}-${index}`}>
              <span>{getProjectById(advice.projectId)?.title ?? advice.projectId}</span>
              <span className="k-muted">建议{ADVICE_ACTION_LABEL[advice.action]}</span>
              {advice.reason !== '' && <span className="k-muted">{advice.reason}</span>}
              <span className="k-view__actions">
                <button
                  type="button"
                  className="k-btn k-btn--sm"
                  onClick={() => applyStaleAdvice(advice)}
                  disabled={getProjectById(advice.projectId) === undefined}
                  title="按 AI 建议处理该项目"
                >
                  {ADVICE_ACTION_LABEL[advice.action]}
                </button>
              </span>
            </div>
          ))}
        </div>
      </div>
    )
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
        // Slice N0.6 · 交互反馈修复：仅在有报告且非生成中才挂整卡点击（→ 编辑弹窗）。
        // 此前无报告时整卡点击为静默 no-op（且空态文案已指引点「AI 解析」按钮），故直接不挂处理器。
        onClick={hasReport && !loading ? () => openEdit(kind) : undefined}
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
            <div className="k-cycle__metrics">
              <MetricTiles metrics={report.metrics} />
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
                openEdit(kind)
              }}
            >
              查看 / 编辑
            </button>
          )}
        </footer>
      </article>
    )
  }

  /* ------------------------------- 弹窗 ------------------------------- */

  const renderModal = (): ReactNode => {
    if (renderedModal === null) return null
    const saving = renderedModal.mode === 'edit' && runtimes[renderedModal.kind].phase === 'saving'

    if (renderedModal.mode === 'view') {
      const review = sortedReviews.find((item) => item.id === renderedModal.reviewId)
      return (
        <Modal
          open={modal !== null}
          onClose={() => setModal(null)}
          kicker={review === undefined ? '归档报告' : `${SCOPE_LABEL[review.type]} · ${review.periodKey}`}
          title="归档报告"
          className="k-modal--report"
          footer={
            review === undefined ? (
              <button type="button" className="k-btn" onClick={() => setModal(null)}>
                关闭
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="k-btn"
                  onClick={() => onDeleteReview(review.id)}
                >
                  删除
                </button>
                <button type="button" className="k-btn is-solid" onClick={() => setModal(null)}>
                  关闭
                </button>
              </>
            )
          }
        >
          {review === undefined ? (
            <p className="k-muted">该报告已被删除。</p>
          ) : (
            <>
              <MetricTiles metrics={review.metrics} withFoot />
              <div className="k-review__field">
                <span className="k-review__label">报告正文 · REPORT（只读）</span>
                <ReportReadView text={review.summary} />
              </div>
              <div className="k-review__field">
                <span className="k-review__label">决策 · DECISIONS</span>
                <DecisionsList decisions={review.decisions} />
              </div>
              {renderStaleAdviceBlock(review.staleAdvice ?? [], `view-${review.id}`)}
            </>
          )}
        </Modal>
      )
    }

    // mode === 'edit'
    const kind = renderedModal.kind
    const runtime = runtimes[kind]
    const draft = runtime.draft
    const report: ReviewDraft | Review | null = draft !== null ? draft : savedReview(kind) ?? null
    const editable = draft !== null || renderedModal.reviewId !== null
    const canSave = editSummary.trim() !== '' && !saving

    return (
      <Modal
        open={modal !== null}
        onClose={() => setModal(null)}
        kicker={report === null ? SCOPE_LABEL[kind] : `${SCOPE_LABEL[kind]} · ${report.periodKey}`}
        title={`${SCOPE_LABEL[kind]}报告`}
        className="k-modal--report"
        footer={
          report === null ? (
            <button type="button" className="k-btn" onClick={() => setModal(null)}>
              关闭
            </button>
          ) : editing ? (
            <>
              <button type="button" className="k-btn" onClick={() => runDraft(kind)} disabled={saving}>
                重新生成
              </button>
              <button type="button" className="k-btn" onClick={() => setEditing(false)}>
                完成
              </button>
              <button
                type="button"
                className="k-btn is-solid"
                onClick={onSave}
                disabled={!canSave}
              >
                {saving ? '保存中…' : '保存回顾'}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="k-btn" onClick={() => runDraft(kind)} disabled={saving}>
                重新生成
              </button>
              <button type="button" className="k-btn is-solid" onClick={() => setEditing(true)}>
                编辑
              </button>
            </>
          )
        }
      >
        {report === null ? (
          <p className="k-muted">报告不存在。</p>
        ) : (
          <>
            <MetricTiles metrics={report.metrics} withFoot />

            {editing ? (
              <>
                <div className="k-review__field">
                  <label className="k-review__label" htmlFor={`review-summary-${kind}`}>
                    报告正文 · REPORT（七段：这周怎么样 / 这个月怎么样 → … → 需要留意的，可编辑）
                  </label>
                  <textarea
                    id={`review-summary-${kind}`}
                    className="k-review__ta k-review__ta--report"
                    rows={14}
                    value={editSummary}
                    onChange={(event) => setEditSummary(event.target.value)}
                    placeholder="这周怎么样：…"
                    disabled={!editable}
                  />
                </div>

                <div className="k-review__field">
                  <label className="k-review__label" htmlFor={`review-decisions-${kind}`}>
                    决策 · DECISIONS（每行一条，1–3 条）
                  </label>
                  <textarea
                    id={`review-decisions-${kind}`}
                    className="k-review__ta"
                    rows={4}
                    value={editDecisions}
                    onChange={(event) => setEditDecisions(event.target.value)}
                    placeholder="如果…，那么…"
                  />
                </div>
              </>
            ) : (
              <>
                <div className="k-review__field">
                  <span className="k-review__label">报告正文 · REPORT（七段）</span>
                  <ReportReadView text={editSummary} />
                </div>
                <div className="k-review__field">
                  <span className="k-review__label">决策 · DECISIONS</span>
                  <DecisionsList
                    decisions={editDecisions
                      .split('\n')
                      .map((line) => line.trim())
                      .filter((line) => line !== '')}
                  />
                </div>
                {draft === null &&
                  report !== null &&
                  renderStaleAdviceBlock(report.staleAdvice ?? [], `edit-${kind}`)}
              </>
            )}

            {draft !== null && draft.staleAdvice.length > 0 && (
              <div className="k-review__field">
                <span className="k-review__label">停滞项目处置建议</span>
                <div className="k-review__advice">
                  {draft.staleAdvice.map((advice) => (
                    <div className="k-review__advice-row" key={advice.projectId}>
                      <span>{getProjectById(advice.projectId)?.title ?? advice.projectId}</span>
                      <span className="k-muted">建议{ADVICE_ACTION_LABEL[advice.action]}</span>
                      {advice.reason !== '' && <span className="k-muted">{advice.reason}</span>}
                      <span className="k-view__actions">
                        <button
                          type="button"
                          className="k-btn k-btn--sm"
                          onClick={() => applyStaleAdvice(advice)}
                          disabled={getProjectById(advice.projectId) === undefined}
                          title="按 AI 建议处理该项目"
                        >
                          {ADVICE_ACTION_LABEL[advice.action]}
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
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

      {/* 栏 1：周 / 月回顾卡并列（位于能量分析之上）；点击卡片弹窗查阅 / 编辑 */}
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

      {/* 栏 2.5：动作记录（Slice S）：审计日志时间线，按天分组 + 语义过滤 */}
      <ActivityTimeline />

      {/* 栏 3：报告历史（Slice L）：每次生成自动归档，按时间倒序可查阅 */}
      <Panel
        title="报告历史"
        en="REPORT ARCHIVE"
        actions={<span className="u-label k-muted">{sortedReviews.length}</span>}
      >
        {sortedReviews.length === 0 ? (
          <EmptyState
            title="暂无归档报告"
            hint="在周 / 月卡点「AI 解析」，生成的报告会自动归档到这里。"
          />
        ) : (
          <div className="k-archive">
            {sortedReviews.map((review) => (
              <button
                type="button"
                className="k-archive__row"
                key={review.id}
                onClick={() => openView(review.id)}
                aria-label={`查看归档报告：${SCOPE_LABEL[review.type]} ${review.periodKey}`}
              >
                <span className="k-archive__period">
                  {SCOPE_LABEL[review.type]} · {review.periodKey}
                </span>
                <span className="k-archive__meta k-mono">
                  {formatDateTime(review.date)}
                  {review.source === 'ai' ? ' · AI 归档' : ''}
                </span>
              </button>
            ))}
          </div>
        )}
      </Panel>

      {/* 栏 4：停滞项目（独立一栏） */}
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

      {renderModal()}
    </div>
  )
}
