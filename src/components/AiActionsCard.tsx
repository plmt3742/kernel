// KERNEL · 收件箱 AI 一揽子处置卡（v0.5 · Slice R1，见 ADR-0015）
// 呈现一个条目解析出的多个动作（task / note / resource / project）：
//   · 每行可勾选（纳入 / 排除）+ 可逐条编辑该 kind 真正会落盘的字段（ACTION_FIELD_MATRIX）；
//   · 「全部应用（N 项）」→ 一次写入（先建项目、再落实体、自动挂接）；「重新解析」/「忽略」保留。
// 纪律：确认前绝不落盘；本组件只产出 onApply(actions)，由 Inbox 调 applyInbox。
import { useEffect, useState, type ReactNode } from 'react'
import { Sparkles } from 'lucide-react'
import { Checkbox } from '@/components/Checkbox'
import { TagPill } from '@/components/TagPill'
import { AiSuggestionForm } from '@/components/AiSuggestionForm'
import { getAreaById, getProjectById } from '@/lib/data'
import { ACTION_FIELD_MATRIX, actionToForm, formToAction, type AiSuggestionFormValues } from '@/lib/aiForm'
import { tagLabel } from '@/lib/format'
import type { AiAction, AiActionKind } from '@/lib/mutations'

const KIND_LABEL: Record<AiActionKind, string> = {
  task: '任务',
  note: '笔记',
  resource: '资料',
  project: '新建项目',
}

interface AiActionsCardProps {
  actions: AiAction[]
  /** 应用当前（可能编辑 / 勾选过的）动作 */
  onApply: (actions: AiAction[]) => void
  onRetry: () => void
  retryDisabled: boolean
  onClear: () => void
}

export function AiActionsCard({
  actions,
  onApply,
  onRetry,
  retryDisabled,
  onClear,
}: AiActionsCardProps): ReactNode {
  const [included, setIncluded] = useState<boolean[]>(() => actions.map(() => true))
  const [values, setValues] = useState<AiSuggestionFormValues[]>(() => actions.map(actionToForm))
  const [editing, setEditing] = useState<number | null>(null)

  // 建议变化（重新解析 / 缓存切换）→ 重置勾选与编辑态
  useEffect(() => {
    setIncluded(actions.map(() => true))
    setValues(actions.map(actionToForm))
    setEditing(null)
  }, [actions])

  const includedCount = included.filter(Boolean).length

  const patchValues = (index: number, patch: Partial<AiSuggestionFormValues>): void => {
    setValues((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)))
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
                  {isEditing ? form.title.trim() || '（未命名）' : action.title}
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
