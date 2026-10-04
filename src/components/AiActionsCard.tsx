// KERNEL · 收件箱 AI 一揽子处置卡（v0.5 · Slice R1，见 ADR-0015）
// 呈现一个条目解析出的多个动作（task / note / resource / project）：
//   · 每行可勾选（纳入 / 排除）+ 可逐条编辑该 kind 真正会落盘的字段（ACTION_FIELD_MATRIX）；
//   · 「全部应用（N 项）」→ 一次写入（先建项目、再落实体、自动挂接）；「重新解析」/「忽略」保留。
// 纪律：确认前绝不落盘；本组件只产出 onApply(actions)，由 Inbox 调 applyInbox。
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Sparkles } from 'lucide-react'
import { Checkbox } from '@/components/Checkbox'
import { TagPill } from '@/components/TagPill'
import { AiSuggestionForm } from '@/components/AiSuggestionForm'
import { getAreaById, getProjectById } from '@/lib/data'
import { ACTION_FIELD_MATRIX, actionToForm, formToAction, type AiSuggestionFormValues } from '@/lib/aiForm'
import { getActionEditCache, getFactsNote, setActionEditCache } from '@/lib/inboxAi'
import { tagLabel } from '@/lib/format'
import type { AiAction, AiActionKind } from '@/lib/mutations'

const KIND_LABEL: Record<AiActionKind, string> = {
  task: '任务',
  note: '笔记',
  resource: '资料',
  project: '新建项目',
  event: '日程',
}

interface AiActionsCardProps {
  actions: AiAction[]
  /** 公告要点（Slice N0）：假日日期等硬信息；缺省空数组，有值时在动作列表上方安静成块 */
  facts?: string[]
  /** 把要点存为一条笔记（Slice N0）；未提供则不显示「存为要点笔记」。
   *  Slice N0.5：扩展签名并回传 itemId，供保存态 / 撤销恢复与缓存登记 */
  onSaveFacts?: (facts: string[], itemId?: string) => Promise<void>
  /** 应用当前（可能编辑 / 勾选过的）动作 */
  onApply: (actions: AiAction[]) => void
  onRetry: () => void
  retryDisabled: boolean
  onClear: () => void
  /** 来源条目 id（Slice Y · F32）：用于在重新解析（卸载重建）间恢复用户编辑 */
  itemId?: string
}

export function AiActionsCard({
  actions,
  facts = [],
  onSaveFacts,
  onApply,
  onRetry,
  retryDisabled,
  onClear,
  itemId,
}: AiActionsCardProps): ReactNode {
  // 勾选默认（Slice N0）：有适用条件的动作默认不纳入（由用户主动勾选）；无条件动作为纳入
  const [included, setIncluded] = useState<boolean[]>(() =>
    actions.map((action) => !action.condition),
  )
  // Slice Y · F32：重新解析会把活跃相位切到 parsing（本组件卸载重建）。
  // 从模块级 actionEditCache 按 itemId 恢复用户值 / 已改字段（kind 对齐才复用）。
  const cachedEntry = itemId !== undefined ? getActionEditCache(itemId) : undefined
  const cacheCompatible =
    cachedEntry !== undefined &&
    cachedEntry.kinds.length === actions.length &&
    cachedEntry.kinds.every((kind, index) => kind === actions[index].kind)
  const [values, setValues] = useState<AiSuggestionFormValues[]>(() =>
    cacheCompatible && cachedEntry !== undefined ? cachedEntry.values : actions.map(actionToForm),
  )
  const [editing, setEditing] = useState<number | null>(null)
  // Slice N0.5：「存为要点笔记」保存进行中态（防重复点击 + 可见反馈）
  const [savingFacts, setSavingFacts] = useState(false)
  const navigate = useNavigate()

  const touchedRef = useRef<Set<string>[]>(
    cacheCompatible && cachedEntry !== undefined
      ? cachedEntry.touched
      : actions.map(() => new Set<string>()),
  )
  const prevValuesRef = useRef<AiSuggestionFormValues[]>(values)
  const prevKindsRef = useRef<AiActionKind[]>(actions.map((a) => a.kind))

  const persistEdits = (
    nextValues: AiSuggestionFormValues[],
    nextTouched: Set<string>[],
    kinds: AiActionKind[],
  ): void => {
    if (itemId === undefined) return
    setActionEditCache(itemId, { kinds, values: nextValues, touched: nextTouched })
  }

  // 建议变化（重新解析 / 缓存切换）→ 重置勾选与编辑态；已手改字段按 kind 对齐保留
  useEffect(() => {
    const prevValues = prevValuesRef.current
    const prevKinds = prevKindsRef.current
    const prevTouched = touchedRef.current
    const kinds = actions.map((action) => action.kind)
    const nextTouched = actions.map((action, index) =>
      prevKinds[index] === action.kind ? (prevTouched[index] ?? new Set<string>()) : new Set<string>(),
    )
    const merged = actions.map((action, index) => {
      const base = actionToForm(action)
      const touched = nextTouched[index]
      const prev = prevValues[index]
      if (
        prevKinds[index] !== action.kind ||
        touched === undefined ||
        touched.size === 0 ||
        prev === undefined
      ) {
        return base
      }
      const out: AiSuggestionFormValues = { ...base }
      for (const key of touched) {
        const typedKey = key as keyof AiSuggestionFormValues
        out[typedKey] = prev[typedKey]
      }
      return out
    })
    touchedRef.current = nextTouched
    prevValuesRef.current = merged
    prevKindsRef.current = kinds
    persistEdits(merged, nextTouched, kinds)
    // 重置勾选同样套用条件默认：有条件的动作不勾选；缓存仅恢复「已改字段」，不恢复勾选态
    setIncluded(actions.map((action) => !action.condition))
    setValues(merged)
    setEditing(null)
    // 仅在 actions 引用变化时重建；用户编辑经 patchValues 同步进 refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actions])

  const includedCount = included.filter(Boolean).length

  // 要点块（Slice N0）：安静小标题 + 逐条正文 + 「存为要点笔记」；无要点则不渲染
  // Slice N0.5：按钮三态——已存（深链查看）/ 进行中（保存中… + disabled）/ 默认（可保存）
  const savedNoteId = itemId !== undefined ? getFactsNote(itemId) : undefined
  const factsBlock =
    facts.length > 0 ? (
      <div className="ic-facts">
        <span className="ic-facts__head">要点 · {facts.length}</span>
        <ul className="ic-facts__list">
          {facts.map((fact, index) => (
            <li className="ic-facts__item" key={`${index}-${fact}`}>
              {fact}
            </li>
          ))}
        </ul>
        {onSaveFacts !== undefined &&
          (savedNoteId !== undefined ? (
            <button
              type="button"
              className="k-pill is-ghost ic-facts__btn is-saved"
              onClick={() => navigate(`/library?note=${savedNoteId}`, { viewTransition: true })}
            >
              已存为要点笔记 · 查看
            </button>
          ) : (
            <button
              type="button"
              className="k-pill is-ghost ic-facts__btn"
              disabled={savingFacts}
              onClick={() => {
                const save = onSaveFacts
                setSavingFacts(true)
                void (async () => {
                  try {
                    await save(facts, itemId)
                  } finally {
                    setSavingFacts(false)
                  }
                })()
              }}
            >
              {savingFacts ? '保存中…' : '存为要点笔记'}
            </button>
          ))}
      </div>
    ) : null

  const patchValues = (index: number, patch: Partial<AiSuggestionFormValues>): void => {
    const set = touchedRef.current[index] ?? new Set<string>()
    for (const key of Object.keys(patch)) set.add(key)
    touchedRef.current[index] = set
    setValues((prev) => {
      const next = prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry))
      prevValuesRef.current = next
      persistEdits(next, touchedRef.current, prevKindsRef.current)
      return next
    })
  }

  const toggleInclude = (index: number): void => {
    setIncluded((prev) => prev.map((flag, i) => (i === index ? !flag : flag)))
  }

  const apply = (): void => {
    const out = actions
      .map((action, index) => ({ action, index }))
      .filter(({ index }) => included[index])
      .map(({ action, index }) => formToAction(action, values[index]))
    if (out.length === 0) return
    onApply(out)
  }

  if (actions.length === 0) {
    return (
      <>
        {factsBlock}
        <div className="ic-ai__head">
          <span className="k-pill is-ghost">无需创建</span>
          <span className="ic-ai__title">AI 判断这条内容没有可落位的动作</span>
        </div>
        <p className="ic-ai__reason">可直接「忽略」；若判断有误，可「重新解析」。</p>
        <div className="ic-ai__actions">
          <button type="button" className="k-pill is-ghost" disabled={retryDisabled} onClick={onRetry}>
            重新解析
          </button>
          <button type="button" className="k-btn" onClick={onClear}>
            忽略
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="ic-ai__head">
        <span className="k-pill">
          <Sparkles size={12} strokeWidth={1.5} aria-hidden /> AI 一揽子
        </span>
        <span className="ic-ai__title">{actions.length} 项动作 · 确认后一次落位</span>
      </div>

      {factsBlock}

      <ul className="ic-actions">
        {actions.map((action, index) => {
          const fields = ACTION_FIELD_MATRIX[action.kind]
          const form = values[index]
          const isEditing = editing === index
          const project =
            action.projectId !== undefined ? getProjectById(action.projectId) : undefined
          const area = action.areaId !== undefined ? getAreaById(action.areaId) : undefined
          const isIncluded = included[index]
          return (
            <li className={isIncluded ? 'ic-action' : 'ic-action is-excluded'} key={`${action.kind}-${index}`}>
              <div className="ic-action__head">
                <Checkbox
                  checked={isIncluded}
                  onToggle={() => toggleInclude(index)}
                  label={`纳入：${action.title}`}
                />
                <span className={`k-pill ic-action__kind is-${action.kind}`}>{KIND_LABEL[action.kind]}</span>
                <span className="ic-action__title">
                  {/* F32：显示当前表单值（= 用户已改标题或解析标题），使重新解析后的保留可见 */}
                  {form.title.trim() || action.title}
                </span>
                <button
                  type="button"
                  className="k-pill is-ghost"
                  aria-expanded={isEditing}
                  onClick={() => setEditing(isEditing ? null : index)}
                >
                  {isEditing ? '收起编辑' : '编辑'}
                </button>
              </div>

              {/* 适用条件（Slice N0）：安静小字标注，仅出现在有条件的动作上 */}
              {action.condition !== undefined &&
                action.condition !== null &&
                action.condition.trim() !== '' && (
                  <p className="ic-action__condition">适用：{action.condition}</p>
                )}

              {isEditing ? (
                <AiSuggestionForm
                  values={form}
                  onChange={(patch) => patchValues(index, patch)}
                  fields={fields}
                />
              ) : (
                <div className="ic-action__meta">
                  {action.kind === 'project' && action.outcome !== undefined && (
                    <span className="ic-action__outcome">{action.outcome}</span>
                  )}
                  {action.linkToNewProject === true && (
                    <span className="k-pill is-ghost">将挂到本批次新项目</span>
                  )}
                  {project !== undefined && <span className="k-pill">挂到 {project.title}</span>}
                  {area !== undefined && <span className="k-pill">归入 {area.title}</span>}
                  {(action.tags ?? []).map((tag) => (
                    <TagPill key={tag}>{tagLabel(tag)}</TagPill>
                  ))}
                  {(action.contexts ?? []).map((ctx) => (
                    <TagPill key={ctx} ghost>
                      {ctx}
                    </TagPill>
                  ))}
                  {action.duplicateOf !== undefined && (
                    <span className="ic-ai__dup">疑似重复 {action.duplicateOf}</span>
                  )}
                </div>
              )}
              {action.note !== undefined && action.note !== '' && !isEditing && (
                <p className="ic-action__note">{action.note}</p>
              )}
              {action.reason !== '' && !isEditing && (
                <p className="ic-action__reason">{action.reason}</p>
              )}
            </li>
          )
        })}
      </ul>

      <div className="ic-ai__actions">
        <button
          type="button"
          className="k-btn is-solid"
          disabled={includedCount === 0}
          onClick={apply}
        >
          全部应用（{includedCount} 项）
        </button>
        <button
          type="button"
          className="k-pill is-ghost"
          disabled={retryDisabled}
          onClick={onRetry}
          title="丢弃本条缓存，重新请求一次解析"
        >
          重新解析
        </button>
        <button type="button" className="k-btn" onClick={onClear}>
          忽略
        </button>
      </div>
    </>
  )
}
