// KERNEL · AI 建议可编辑字段表单（v0.5 · Slice O）
// 任务快速新建弹窗 / 收件箱建议卡共用：受控、宽松两列网格（≤640px 单列），全部走既有 token 组件类。
// 只负责呈现与回调，不做提交；字段值的换算见 src/lib/aiForm.ts。
import { useId, type ReactNode } from 'react'
import { getAreas, getSnapshot, getTags } from '@/lib/data'
import { ENERGY_LABEL, tagLabel } from '@/lib/format'
import type { AiSuggestionFormValues } from '@/lib/aiForm'

interface AiSuggestionFormProps {
  values: AiSuggestionFormValues
  onChange: (patch: Partial<AiSuggestionFormValues>) => void
  /** 标题输入框自动聚焦（任务弹窗打开时使用） */
  autoFocusTitle?: boolean
  /** 提交中 / 只读时禁用全部控件 */
  disabled?: boolean
}

const ENERGY_OPTIONS = ['low', 'medium', 'high'] as const

export function AiSuggestionForm({
  values,
  onChange,
  autoFocusTitle = false,
  disabled = false,
}: AiSuggestionFormProps): ReactNode {
  const uid = useId()
  const fieldId = (key: string): string => `k-ai-${key}-${uid}`
  const projects = getSnapshot().projects
  const areas = getAreas()
  const contextNames = getTags()
    .filter((tag) => tag.namespace === 'context')
    .map((tag) => tag.name)

  return (
    <div className="k-ai-form">
      <div className="k-field k-ai-form__full">
        <label className="k-field__label u-label" htmlFor={fieldId('title')}>
          标题
        </label>
        <input
          id={fieldId('title')}
          className="k-input"
          type="text"
          value={values.title}
          autoFocus={autoFocusTitle}
          disabled={disabled}
          onChange={(event) => onChange({ title: event.target.value })}
        />
      </div>

      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={fieldId('contexts')}>
          上下文（逗号分隔）
        </label>
        <input
          id={fieldId('contexts')}
          className="k-input"
          type="text"
          value={values.contexts}
          placeholder={contextNames.map(tagLabel).join(', ')}
          disabled={disabled}
          onChange={(event) => onChange({ contexts: event.target.value })}
        />
      </div>

      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={fieldId('tags')}>
          标签（逗号分隔）
        </label>
        <input
          id={fieldId('tags')}
          className="k-input"
          type="text"
          value={values.tags}
          disabled={disabled}
          onChange={(event) => onChange({ tags: event.target.value })}
        />
      </div>

      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={fieldId('energy')}>
          能量
        </label>
        <select
          id={fieldId('energy')}
          className="k-select"
          value={values.energy}
          disabled={disabled}
          onChange={(event) => onChange({ energy: event.target.value })}
        >
          <option value="">—</option>
          {ENERGY_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {ENERGY_LABEL[value]}
            </option>
          ))}
        </select>
      </div>

      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={fieldId('importance')}>
          重要性
        </label>
        <select
          id={fieldId('importance')}
          className="k-select"
          value={values.importance}
          disabled={disabled}
          onChange={(event) => onChange({ importance: event.target.value })}
        >
          <option value="">—</option>
          {[1, 2, 3].map((n) => (
            <option key={n} value={String(n)}>
              {n} / 3
            </option>
          ))}
        </select>
      </div>

      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={fieldId('estimateMin')}>
          预估（分钟）
        </label>
        <input
          id={fieldId('estimateMin')}
          className="k-input"
          type="number"
          min={1}
          value={values.estimateMin}
          disabled={disabled}
          onChange={(event) => onChange({ estimateMin: event.target.value })}
        />
      </div>

      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={fieldId('dueAt')}>
          截止
        </label>
        <input
          id={fieldId('dueAt')}
          className="k-input"
          type="datetime-local"
          value={values.dueAt}
          disabled={disabled}
          onChange={(event) => onChange({ dueAt: event.target.value })}
        />
      </div>

      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={fieldId('projectId')}>
          项目
        </label>
        <select
          id={fieldId('projectId')}
          className="k-select"
          value={values.projectId}
          disabled={disabled}
          onChange={(event) => onChange({ projectId: event.target.value })}
        >
          <option value="">—</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.title}
            </option>
          ))}
        </select>
      </div>

      <div className="k-field">
        <label className="k-field__label u-label" htmlFor={fieldId('areaId')}>
          区域
        </label>
        <select
          id={fieldId('areaId')}
          className="k-select"
          value={values.areaId}
          disabled={disabled}
          onChange={(event) => onChange({ areaId: event.target.value })}
        >
          <option value="">—</option>
          {areas.map((area) => (
            <option key={area.id} value={area.id}>
              {area.title}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
