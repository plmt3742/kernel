// KERNEL · 踪迹 TRACES
// 「我刚刚做了什么」的时间戳条目流（对齐社交平台「我的朋友圈」版式）：
// 动态（左日期 + 右内容 + 图片宫格）⇄ 时间线（紧凑列表）双风格，偏好经界面 store 持久化；
// 顶部发布器（一句话 + 可附图片，回车 / 点「记录」即写入）；删除走回收站（toast 可撤销）。
// 数据只读来自快照；写入 / 图片上传一律经数据服务。
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useSearchParams } from 'react-router-dom'
import { Paperclip } from 'lucide-react'
import { useToast } from '@/context/ToastContext'
import { TagPill } from '@/components/TagPill'
import {
  TraceDetailModal,
  TraceLightbox,
  TraceRefChip,
  type TraceLightboxTarget,
} from '@/components/TraceDetailModal'
import { errorText } from '@/lib/api'
import { getAreas, getProjects, getTraces, traceImageUrl } from '@/lib/data'
import { daysFromToday, formatTime, toDate, toISODateString } from '@/lib/date'
import { tagLabel } from '@/lib/format'
import { useDataRevision } from '@/lib/hooks'
import { createTrace, restoreEntity, trashEntity, uploadTraceImage } from '@/lib/mutations'
import { createUiStore, oneOf, str, useUiStore } from '@/lib/uiState'
import type { Trace } from '@/types'

/** 显示档位：动态（朋友圈版式）/ 时间线（紧凑列表） */
type TraceView = 'feed' | 'timeline'
const TRACE_VIEWS: readonly TraceView[] = ['feed', 'timeline']

/* ---------------------------------------------------------------------------
 * 界面状态保留（Slice Z 精神）：显示风格 + 标签筛选 + 搜索词经模块级 store
 * 跨路由存活并持久化；只存界面状态，绝不存实体数据。
 * ------------------------------------------------------------------------- */
const tracesUiStore = createUiStore<{ view: TraceView; tag: string; query: string }>(
  'kernel.ui.traces.v1',
  { view: 'feed', tag: '', query: '' },
  {
    parse: (raw) => {
      if (typeof raw !== 'object' || raw === null) return null
      const value = raw as Record<string, unknown>
      return {
        view: oneOf(value.view, TRACE_VIEWS, 'feed'),
        tag: str(value.tag),
        query: str(value.query),
      }
    },
  },
)

const TITLE_MAX = 80
const IMAGE_MAX = 9
const IMAGE_MAX_BYTES = 8 * 1024 * 1024
const MONTHS = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月']

/** 图片上传受限并发上限（T8）；与 Inbox 同款 mapLimit 模式 */
const UPLOAD_CONCURRENCY = 3

/**
 * 受限并发映射（保持结果顺序）：至多 limit 个 worker 同时消费队列，
 * 结果按原始下标回填，避免读写成乱序。
 */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= items.length) break
      results[index] = await fn(items[index], index)
    }
  })
  await Promise.all(workers)
  return results
}

/** 日期标记（动态流分组用）：今天 / 昨天 → 词；其余 → 大「日」+ 小「月」（跨年补年份）。 */
function dateParts(at: string): { big: string; small: string; word: boolean } {
  const d = toDate(at)
  if (Number.isNaN(d.getTime())) return { big: '—', small: '', word: true }
  const diff = daysFromToday(at)
  if (diff === 0) return { big: '今天', small: '', word: true }
  if (diff === -1) return { big: '昨天', small: '', word: true }
  const sameYear = d.getFullYear() === new Date().getFullYear()
  const small = sameYear ? (MONTHS[d.getMonth()] ?? '') : `${d.getFullYear()}年${d.getMonth() + 1}月`
  return { big: String(d.getDate()), small, word: false }
}

/** 日标题：今天 / 昨天 / M月D日（跨年补年份；时间线分节与动态流无障碍标签共用） */
function dayLabelOf(at: string): string {
  const d = toDate(at)
  if (Number.isNaN(d.getTime())) return '未知日期'
  const diff = daysFromToday(at)
  if (diff === 0) return '今天'
  if (diff === -1) return '昨天'
  const md = `${d.getMonth() + 1}月${d.getDate()}日`
  return d.getFullYear() === new Date().getFullYear() ? md : `${d.getFullYear()}年${md}`
}

interface TraceGroup {
  key: string
  /** 文本日期（今天 / 昨天 / M月D日；跨年带年份）；时间线分节与无障碍标签用 */
  label: string
  /** 动态流分组的可视日期标记（大日 + 小月） */
  mark: { big: string; small: string; word: boolean }
  items: Trace[]
}

/** 按自然日分组（输入已按 at 倒序） */
function groupByDay(list: Trace[]): TraceGroup[] {
  const groups: TraceGroup[] = []
  let currentKey: string | null = null
  for (const trace of list) {
    const key = toISODateString(trace.at)
    if (key !== currentKey) {
      groups.push({ key, label: dayLabelOf(trace.at), mark: dateParts(trace.at), items: [] })
      currentKey = key
    }
    groups[groups.length - 1].items.push(trace)
  }
  return groups
}

interface Attachment {
  file: File
  url: string
}

export function Traces(): ReactNode {
  const { toast } = useToast()
  useDataRevision()
  const ui = useUiStore(tracesUiStore)
  const view = ui.view
  const [params] = useSearchParams()
  const focusId = params.get('trace')

  const [draft, setDraft] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [saving, setSaving] = useState(false)
  const [hit, setHit] = useState<string | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<TraceLightboxTarget | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  // 使卸载清理能拿到最新附件（避免闭包过期）
  const attachmentsRef = useRef<Attachment[]>([])
  attachmentsRef.current = attachments

  const traces = getTraces()
  const sorted = useMemo(() => [...traces].sort((a, b) => b.at.localeCompare(a.at)), [traces])
  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const trace of traces) for (const tag of trace.tags) set.add(tag)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [traces])

  // 筛选（T5）：标签 + 大小写不敏感子串（title / note / tags）
  const filtered = useMemo(() => {
    const needle = ui.query.trim().toLowerCase()
    return sorted.filter((trace) => {
      if (ui.tag !== '' && !trace.tags.includes(ui.tag)) return false
      if (needle === '') return true
      const hay = `${trace.title}\n${trace.note ?? ''}\n${trace.tags.join(' ')}`.toLowerCase()
      return hay.includes(needle)
    })
  }, [sorted, ui.tag, ui.query])
  const groups = useMemo(() => groupByDay(filtered), [filtered])

  // 卸载时回收对象 URL
  useEffect(() => {
    return () => {
      for (const item of attachmentsRef.current) URL.revokeObjectURL(item.url)
    }
  }, [])

  // 深链 ?trace=<id>：滚动定位 + 短暂高亮（减少动效时改用瞬时跳转，T9）
  useEffect(() => {
    if (focusId === null || focusId === '') return
    setHit(focusId)
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const timer = window.setTimeout(() => {
      document
        .getElementById(`trace-${focusId}`)
        ?.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' })
      window.setTimeout(() => setHit(null), 2400)
    }, 60)
    return () => window.clearTimeout(timer)
  }, [focusId])

  const addFiles = (files: File[]): void => {
    const next: Attachment[] = []
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      if (file.size > IMAGE_MAX_BYTES) {
        toast(`「${file.name}」超过 8MB，已跳过`, { tone: 'error' })
        continue
      }
      next.push({ file, url: URL.createObjectURL(file) })
    }
    if (next.length === 0) return
    setAttachments((prev) => [...prev, ...next].slice(0, IMAGE_MAX))
  }

  const onPickFiles = (event: ChangeEvent<HTMLInputElement>): void => {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    addFiles(files)
  }

  const onPaste = (event: ClipboardEvent<HTMLFormElement>): void => {
    const files: File[] = []
    for (const item of Array.from(event.clipboardData.items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (file !== null) files.push(file)
      }
    }
    if (files.length > 0) {
      event.preventDefault()
      addFiles(files)
    }
  }

  const removeAttachment = (url: string): void => {
    setAttachments((prev) => {
      const target = prev.find((item) => item.url === url)
      if (target !== undefined) URL.revokeObjectURL(target.url)
      return prev.filter((item) => item.url !== url)
    })
  }

  const clearAttachments = (): void => {
    setAttachments((prev) => {
      for (const item of prev) URL.revokeObjectURL(item.url)
      return []
    })
  }

  // 写入：图片受限并发上传 → 建踪迹 → toast「撤销」= 入回收站（T8）
  const submitRecord = (): void => {
    const title = draft.trim()
    if (title === '' || saving) return
    const pending = attachments
    setSaving(true)
    void (async () => {
      try {
        const names = await mapLimit(pending, UPLOAD_CONCURRENCY, (item) =>
          uploadTraceImage(item.file),
        )
        const created = await createTrace({
          title,
          images: names.length > 0 ? names : undefined,
        })
        setDraft('')
        clearAttachments()
        toast('已记入踪迹', {
          action: {
            label: '撤销',
            onClick: () => {
              void trashEntity('traces', created.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`记录失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setSaving(false)
      }
    })()
  }

  const onRecord = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    submitRecord()
  }

  const onDelete = (trace: Trace): void => {
    void (async () => {
      try {
        await trashEntity('traces', trace.id)
        toast('已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('traces', trace.id).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`删除失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  // 行键盘可用（T4）：标题是真实按钮，::after 拉伸覆盖整行 →
  // 鼠标点整行开详情、键盘 Tab 到标题回车开详情；删除 / 图片 / 芯片 z-index 置顶不受遮罩影响。
  const renderImages = (trace: Trace): ReactNode => {
    const images = trace.images ?? []
    if (images.length === 0) return null
    const count = Math.min(images.length, IMAGE_MAX)
    return (
      <div className={`k-trace__imgs is-n${count}`}>
        {images.slice(0, IMAGE_MAX).map((name) => (
          <button
            key={name}
            type="button"
            className="k-trace__imgbtn"
            aria-label={`查看图片 ${name}`}
            onClick={(event) => {
              event.stopPropagation()
              setLightbox({ url: traceImageUrl(name), at: trace.at })
            }}
          >
            <img src={traceImageUrl(name)} alt="" loading="lazy" />
          </button>
        ))}
      </div>
    )
  }

  return (
    <div className="k-view k-traces">
      {/* 说明：本页是用户自记的留痕，与个人页的系统动作时间线区分（T10） */}
      <p className="k-view__intro">我自己记下的留痕；系统自动记录的动作见「个人」页。</p>

      {/* 工具条：风格切换 + 计数 */}
      <div className="k-traces__bar">
        <div className="k-lib__seg" role="group" aria-label="显示风格">
          <button
            type="button"
            className={view === 'feed' ? 'k-pill is-selected' : 'k-pill'}
            aria-pressed={view === 'feed'}
            onClick={() => tracesUiStore.set((prev) => ({ ...prev, view: 'feed' }))}
          >
            动态
          </button>
          <button
            type="button"
            className={view === 'timeline' ? 'k-pill is-selected' : 'k-pill'}
            aria-pressed={view === 'timeline'}
            onClick={() => tracesUiStore.set((prev) => ({ ...prev, view: 'timeline' }))}
          >
            时间线
          </button>
        </div>
        <span className="u-label k-muted">
          {filtered.length === traces.length
            ? `${traces.length} 条踪迹`
            : `${filtered.length} / ${traces.length} 条踪迹`}
        </span>
      </div>

      {/* 筛选条：标签分段槽 + 搜索框 */}
      {traces.length > 0 && (
        <div className="k-traces__filters">
          <div className="k-lib__seg k-traces__tagfilter" role="group" aria-label="标签筛选">
            <TagPill
              selected={ui.tag === ''}
              onClick={() => tracesUiStore.set((prev) => ({ ...prev, tag: '' }))}
            >
              全部
            </TagPill>
            {allTags.map((tag) => (
              <TagPill
                key={tag}
                selected={ui.tag === tag}
                onClick={() =>
                  tracesUiStore.set((prev) => ({ ...prev, tag: prev.tag === tag ? '' : tag }))
                }
              >
                {tagLabel(tag)}
              </TagPill>
            ))}
          </div>
          <div className="k-traces__search">
            <input
              className="k-input"
              type="search"
              value={ui.query}
              placeholder="搜索踪迹…"
              aria-label="搜索踪迹"
              onChange={(event) =>
                tracesUiStore.set((prev) => ({ ...prev, query: event.target.value }))
              }
            />
          </div>
        </div>
      )}

      {/* 发布器：一句话 + 可附图片；回车 / 点「记录」写入 */}
      <form className="k-trace-composer" onSubmit={onRecord} onPaste={onPaste}>
        <textarea
          className="k-trace-composer__input"
          rows={2}
          maxLength={TITLE_MAX}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            // IME 组字中不提交（中文输入法回车确认候选词）
            if (event.nativeEvent.isComposing) return
            event.preventDefault()
            submitRecord()
          }}
          placeholder="我刚刚做了…（可附图片，回车记录）"
          aria-label="记录我刚刚做了什么"
        />
        {attachments.length > 0 && (
          <div className="k-trace-composer__previews">
            {attachments.map((item) => (
              <div className="k-trace-composer__thumb" key={item.url}>
                <img src={item.url} alt="" />
                <button
                  type="button"
                  className="k-trace-composer__thumb-del"
                  aria-label="移除图片"
                  onClick={() => removeAttachment(item.url)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="k-trace-composer__foot">
          <button
            type="button"
            className="k-trace-composer__attach"
            onClick={() => fileRef.current?.click()}
            disabled={attachments.length >= IMAGE_MAX}
          >
            <Paperclip size={15} strokeWidth={1.5} aria-hidden />
            {attachments.length > 0 ? `图片 ${attachments.length}/${IMAGE_MAX}` : '图片'}
          </button>
          <input
            ref={fileRef}
            className="k-trace-composer__file"
            type="file"
            accept="image/*"
            multiple
            onChange={onPickFiles}
          />
          <span className="k-trace-composer__spacer" />
          <button type="submit" className="k-btn is-solid" disabled={saving || draft.trim() === ''}>
            {saving ? '记录中…' : '记录'}
          </button>
        </div>
      </form>

      {traces.length === 0 ? (
        <p className="k-traces__empty">还没有踪迹 · 干完一件事，上来记一笔</p>
      ) : filtered.length === 0 ? (
        <p className="k-traces__empty">没有匹配的踪迹</p>
      ) : view === 'feed' ? (
        <div className="k-traces__feed">
          {groups.map((group) => (
            <div className="k-traces__day" key={group.key}>
              {/* 一天的日期只出现一次（分组标记）；无障碍读 group.label */}
              <h3 className="k-traces__daymark" aria-label={group.label}>
                <span
                  className={
                    group.mark.word ? 'k-traces__daymark-main is-word' : 'k-traces__daymark-main'
                  }
                  aria-hidden
                >
                  {group.mark.big}
                </span>
                {group.mark.small !== '' && (
                  <span className="k-traces__daymark-sub u-label" aria-hidden>
                    {group.mark.small}
                  </span>
                )}
              </h3>
              <div className="k-traces__dayitems">
                {group.items.map((trace) => {
                  const area =
                    trace.areaId !== undefined
                      ? getAreas().find((item) => item.id === trace.areaId)
                      : undefined
                  const project =
                    trace.projectId !== undefined
                      ? getProjects().find((item) => item.id === trace.projectId)
                      : undefined
                  return (
                    <article
                      key={trace.id}
                      id={`trace-${trace.id}`}
                      className={hit === trace.id ? 'k-trace is-target' : 'k-trace'}
                    >
                      <div className="k-trace__main">
                        <p className="k-trace__title">
                          <button
                            type="button"
                            className="k-trace__open"
                            onClick={() => setDetailId(trace.id)}
                          >
                            {trace.title}
                          </button>
                        </p>
                        {trace.note !== undefined && trace.note !== '' && (
                          <p className="k-trace__note">{trace.note}</p>
                        )}
                        {renderImages(trace)}
                        <div className="k-trace__foot">
                          {trace.tags.map((tag) => (
                            <TagPill key={tag}>{tagLabel(tag)}</TagPill>
                          ))}
                          {area !== undefined && <TraceRefChip id={area.id} title={area.title} />}
                          {project !== undefined && (
                            <TraceRefChip id={project.id} title={project.title} />
                          )}
                          <span className="u-label k-muted">{formatTime(trace.at)}</span>
                          <button
                            type="button"
                            className="k-trace__del"
                            onClick={(event) => {
                              event.stopPropagation()
                              onDelete(trace)
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                    </article>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="k-traces__feed">
          {groups.map((group) => (
            <Fragment key={group.key}>
              <div className="k-act__daylabel u-label">{group.label}</div>
              {group.items.map((trace) => (
                <div
                  key={trace.id}
                  id={`trace-${trace.id}`}
                  className={hit === trace.id ? 'k-act__row is-target' : 'k-act__row'}
                >
                  <span className="k-act__time k-mono">{formatTime(trace.at)}</span>
                  <span className="k-act__label">
                    {trace.images !== undefined && trace.images.length > 0 && (
                      <img
                        className="k-trace__thumb"
                        src={traceImageUrl(trace.images[0])}
                        alt=""
                        loading="lazy"
                      />
                    )}
                    <button
                      type="button"
                      className="k-trace__open"
                      onClick={() => setDetailId(trace.id)}
                    >
                      {trace.title}
                    </button>
                  </span>
                  <button
                    type="button"
                    className="k-trace__del"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDelete(trace)
                    }}
                  >
                    删除
                  </button>
                </div>
              ))}
            </Fragment>
          ))}
        </div>
      )}

      <TraceDetailModal traceId={detailId} onClose={() => setDetailId(null)} />
      <TraceLightbox target={lightbox} onClose={() => setLightbox(null)} />
    </div>
  )
}
