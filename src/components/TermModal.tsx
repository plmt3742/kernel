// KERNEL · 学期设置弹窗（v0.5 · Slice H0）
// 开始日期（第 1 周周一）+ 总周数（1–30，缺省 16）→ POST /api/term → 整体水合。
import { useEffect, useId, useState, type FormEvent } from 'react'
import { Modal } from '@/components/Modal'
import { useToast } from '@/context/ToastContext'
import { getTerm } from '@/lib/data'
import { updateTerm } from '@/lib/mutations'
import { errorText } from '@/lib/api'

const DEFAULT_WEEKS = 16

interface TermModalProps {
  open: boolean
  onClose: () => void
}

export function TermModal({ open, onClose }: TermModalProps) {
  const uid = useId()
  const { toast } = useToast()
  const [startDate, setStartDate] = useState('')
  const [totalWeeks, setTotalWeeks] = useState(String(DEFAULT_WEEKS))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  // 每次打开从当前快照重载（弹窗关闭时不渲染，实例常驻故用 effect 复位）
  useEffect(() => {
    if (!open) return
    const term = getTerm()
    setStartDate(term?.startDate ?? '')
    setTotalWeeks(String(term?.totalWeeks ?? DEFAULT_WEEKS))
    setError('')
    setSaving(false)
  }, [open])

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault()
    const weeks = Number(totalWeeks)
    if (!Number.isInteger(weeks) || weeks < 1 || weeks > 30) {
      setError('总周数需为 1–30')
      return
    }
    setError('')
    setSaving(true)
    void (async () => {
      try {
        await updateTerm({
          ...(startDate.trim() !== '' ? { startDate: startDate.trim() } : {}),
          totalWeeks: weeks,
        })
        setSaving(false)
        onClose()
        toast('学期已更新')
      } catch (err) {
        setError(`保存失败：${errorText(err)}`)
        setSaving(false)
      }
    })()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      kicker="学期设置 · 第 1 周起算"
      title="学期设置"
      className="k-modal--compose"
      footer={
        <div className="k-modal__foot-actions">
          <button type="button" className="k-btn" onClick={onClose} disabled={saving}>
            取消
          </button>
          <button
            type="submit"
            form={`${uid}-term`}
            className="k-btn is-solid"
            disabled={saving}
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      }
    >
      <form id={`${uid}-term`} className="k-form" onSubmit={handleSubmit}>
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor={`${uid}-start`}>
            开始日期
          </label>
          <input
            id={`${uid}-start`}
            className="k-input"
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <p className="k-muted k-timetable-form__help">开始日期填第 1 周的周一</p>
        </div>
        <div className="k-field">
          <label className="k-field__label u-label" htmlFor={`${uid}-weeks`}>
            总周数
          </label>
          <input
            id={`${uid}-weeks`}
            className="k-input"
            type="number"
            min={1}
            max={30}
            value={totalWeeks}
            onChange={(event) => setTotalWeeks(event.target.value)}
          />
        </div>
        {error !== '' && (
          <p className="k-timetable-form__error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
