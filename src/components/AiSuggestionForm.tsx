// KERNEL · AI 建议可编辑字段表单（v0.5 · Slice O；Slice V 起按 target 条件渲染）
// 任务快速新建弹窗 / 收件箱建议卡共用：受控、宽松两列网格（≤640px 单列），全部走既有 token 组件类。
// 只负责呈现与回调，不做提交；字段值的换算见 src/lib/aiForm.ts。
// 纪律（F19/F31）：只渲染「服务端 clarify 真正会应用」的字段（矩阵见 CLARIFY_FIELD_MATRIX），
//   绝不展示一个提交后被静默丢弃的输入框。
import { useId, type ReactNode } from 'react'
import { getAreas, getSnapshot, getTags } from '@/lib/data'
import {
  ENERGY_LABEL,
  ENERGY_OPTIONS,
  IMPORTANCE_OPTIONS,
  importanceLabel,
  tagLabel,
} from '@/lib/format'
import { ALL_CLARIFY_FIELDS, type AiSuggestionFormValues, type ClarifyFieldKey } from '@/lib/aiForm'

interface AiSuggestionFormProps {
  values: AiSuggestionFormValues
  onChange: (patch: Partial<AiSuggestionFormValues>) => void
  /** 标题输入框自动聚焦（任务弹窗打开时使用） */
  autoFocusTitle?: boolean
  /** 提交中 / 只读时禁用全部控件 */
  disabled?: boolean
  /** 可见字段集（Slice V · F19/F31）；缺省为任务全字段，收件箱建议卡按 target 传入矩阵 */
  fields?: readonly ClarifyFieldKey[]
}

export function AiSuggestionForm({
  values,
  onChange,
  autoFocusTitle = false,
  disabled = false,
  fields = ALL_CLARIFY_FIELDS,
}: AiSuggestionFormProps): ReactNode {
  const uid = useId()
  const fieldId = (key: string): string => `k-ai-${key}-${uid}`
  const projects = getSnapshot().projects
  const areas = getAreas()
  const contextNames = getTags()
    .filter((tag) => tag.namespace === 'context')
    .map((tag) => tag.name)
  // 标签补全（Slice Y · F13）：从注册表取全部标签（名称 + 中文标签），安静提供 datalist
  const tagItems = getTags()
  const contextListId = fieldId('contexts-list')
  const tagListId = fieldId('tags-list')
  const show = (key: ClarifyFieldKey): boolean => fields.includes(key)

  return (
    <div className="k-ai-form">
      {show('title') && (
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
      )}

      {show('outcome') && (
        <div className="k-field k-ai-form__full">
          <label className="k-field__label u-label" htmlFor={fieldId('outcome')}>
            完成定义
          </label>
          <input
            id={fieldId('outcome')}
            className="k-input"
            type="text"
            value={values.outcome}
            placeholder="怎样算完成（如：决赛名单与分工落定）"
            disabled={disabled}
            onChange={(event) => onChange({ outcome: event.target.value })}
          />
        </div>
      )}

      {show('note') && (
        <div className="k-field k-ai-form__full">
          <label className="k-field__label u-label" htmlFor={fieldId('note')}>
            简介
          </label>
          <textarea
            id={fieldId('note')}
            className="k-textarea"
            rows={2}
            value={values.note}
            placeholder="1–3 句小结，作为资料详情页简介"
            disabled={disabled}
            onChange={(event) => onChange({ note: event.target.value })}
          />
        </div>
      )}

      {show('url') && (
        <div className="k-field k-ai-form__full">
          <label className="k-field__label u-label" htmlFor={fieldId('url')}>
            链接
          </label>
          <input
            id={fieldId('url')}
            className="k-input"
            type="url"
            value={values.url}
            placeholder="https://…"
            disabled={disabled}
            onChange={(event) => onChange({ url: event.target.value })}
          />
        </div>
      )}

      {show('contexts') && (
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor={fieldId('contexts')}>
            上下文（逗号分隔）
          </label>
          <input
            id={fieldId('contexts')}
            className="k-input"
            type="text"
            list={contextListId}
            value={values.contexts}
            placeholder={contextNames.map(tagLabel).join(', ')}
            disabled={disabled}
            onChange={(event) => onChange({ contexts: event.target.value })}
          />
          <datalist id={contextListId}>
            {contextNames.map((name) => (
              <option key={name} value={name}>
                {tagLabel(name)}
              </option>
            ))}
          </datalist>
        </div>
      )}

      {show('tags') && (
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor={fieldId('tags')}>
            标签（逗号分隔）
          </label>
          <input
            id={fieldId('tags')}
            className="k-input"
            type="text"
            list={tagListId}
            value={values.tags}
            disabled={disabled}
            onChange={(event) => onChange({ tags: event.target.value })}
          />
          <datalist id={tagListId}>
            {tagItems.map((tag) => (
              <option key={tag.id} value={tag.name}>
                {tag.label}
              </option>
            ))}
          </datalist>
        </div>
      )}

      {show('energy') && (
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
      )}

      {show('importance') && (
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
            {IMPORTANCE_OPTIONS.map((n) => (
              <option key={n} value={String(n)}>
                {importanceLabel(n)}
              </option>
            ))}
          </select>
        </div>
      )}

      {show('estimateMin') && (
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
      )}

      {show('dueAt') && (
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
      )}

      {show('startAt') && (
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor={fieldId('startAt')}>
            开始
          </label>
          <input
            id={fieldId('startAt')}
            className="k-input"
            type="datetime-local"
            value={values.startAt}
            disabled={disabled}
            onChange={(event) => onChange({ startAt: event.target.value })}
          />
        </div>
      )}

      {show('endAt') && (
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor={fieldId('endAt')}>
            结束
          </label>
          <input
            id={fieldId('endAt')}
            className="k-input"
            type="datetime-local"
            value={values.endAt}
            disabled={disabled}
            onChange={(event) => onChange({ endAt: event.target.value })}
          />
        </div>
      )}

      {show('location') && (
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor={fieldId('location')}>
            地点
          </label>
          <input
            id={fieldId('location')}
            className="k-input"
            type="text"
            value={values.location}
            placeholder="如：行政楼 302"
            disabled={disabled}
            onChange={(event) => onChange({ location: event.target.value })}
          />
        </div>
      )}

      {show('projectId') && (
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
      )}

      {show('areaId') && (
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
      )}
    </div>
  )
}
