// KERNEL · EntityEditForm（抽屉内联编辑表单 · Slice E2）
// 由字段规格驱动：文本 / 多行 / 数字 / 下拉 / 日期时间 / 逗号列表；提交时按类型归一化为 API patch。
// 字段为空时的语义：日期时间 / 数字 → null（清除）；可清除文本/下拉 → null；其余文本/下拉跳过（不覆盖）。
import { useState, type FormEvent } from 'react'
import { toDate, toISODateTime } from '@/lib/date'

export type EditFieldType = 'text' | 'textarea' | 'number' | 'select' | 'datetime' | 'list'

export interface EditFieldOption {
  value: string
  label: string
}

export interface EditFieldSpec {
  key: string
  label: string
  type: EditFieldType
  options?: EditFieldOption[]
  placeholder?: string
  /** 允许空值清除（可选字段）；下拉会自动补一项「—」 */
  clearable?: boolean
  /** 文本 / 下拉的值为数字（如 importance）：提交时转为 number */
  numeric?: boolean
}

interface EntityEditFormProps {
  fields: EditFieldSpec[]
  initial: Record<string, unknown>
  saving: boolean
  onSubmit: (patch: Record<string, unknown>) => void
  onCancel: () => void
}

/** ISO → datetime-local 值（本机时区，精确到分钟） */
function toLocalInput(value: unknown): string {
  if (typeof value !== 'string' || value === '') return ''
  const d = toDate(value)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 逗号列表 → 字符串（用于初始值） */
function listToText(value: unknown): string {
  return Array.isArray(value) ? value.map((item) => String(item)).join(', ') : ''
}

function initialFieldValue(field: EditFieldSpec, source: Record<string, unknown>): string {
  const value = source[field.key]
  if (field.type === 'list') return listToText(value)
  if (field.type === 'datetime') return toLocalInput(value)
  if (value === undefined || value === null) return ''
  return String(value)
}

export function EntityEditForm({
  fields,
  initial,
  saving,
  onSubmit,
  onCancel,
}: EntityEditFormProps) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {}
    for (const field of fields) out[field.key] = initialFieldValue(field, initial)
    return out
  })

  const setValue = (key: string, value: string): void => {
    setValues((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const patch: Record<string, unknown> = {}
    for (const field of fields) {
      const raw = values[field.key] ?? ''
      if (field.type === 'list') {
        patch[field.key] = raw
          .split(',')
          .map((part) => part.trim())
          .filter((part) => part !== '')
        continue
      }
      if (field.type === 'datetime') {
        patch[field.key] = raw === '' ? null : toISODateTime(new Date(raw))
        continue
      }
      if (field.type === 'number') {
        const trimmed = raw.trim()
        patch[field.key] = trimmed === '' ? null : Number(trimmed)
        continue
      }
      if (field.type === 'textarea') {
        patch[field.key] = raw
        continue
      }
      const trimmed = raw.trim()
      if (trimmed === '') {
        if (field.clearable === true) patch[field.key] = null
        continue
      }
      patch[field.key] = field.numeric === true ? Number(trimmed) : trimmed
    }
    onSubmit(patch)
  }

  return (
    <form className="k-form" onSubmit={handleSubmit}>
      {fields.map((field) => {
        const id = `k-edit-${field.key}`
        const value = values[field.key] ?? ''
        return (
          <div className="k-field" key={field.key}>
            <label className="k-field__label u-label" htmlFor={id}>
              {field.label}
            </label>
            {field.type === 'textarea' ? (
              <textarea
                id={id}
                className="k-textarea"
                value={value}
                rows={5}
                placeholder={field.placeholder}
                onChange={(event) => setValue(field.key, event.target.value)}
              />
            ) : field.type === 'select' ? (
              <select
                id={id}
                className="k-select"
                value={value}
                onChange={(event) => setValue(field.key, event.target.value)}
              >
                {field.clearable === true && <option value="">—</option>}
                {(field.options ?? []).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id={id}
                className="k-input"
                type={
                  field.type === 'number'
                    ? 'number'
                    : field.type === 'datetime'
                      ? 'datetime-local'
                      : 'text'
                }
                value={value}
                placeholder={field.placeholder}
                onChange={(event) => setValue(field.key, event.target.value)}
              />
            )}
          </div>
        )
      })}
      <div className="k-form__actions">
        <button type="submit" className="k-btn is-solid" disabled={saving}>
          {saving ? '保存中…' : '保存'}
        </button>
        <button type="button" className="k-btn" onClick={onCancel} disabled={saving}>
          取消
        </button>
      </div>
    </form>
  )
}
