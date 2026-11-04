// KERNEL · 资料详情页（笔记 / 资料；编辑回到资料页弹窗）
import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, FileText, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shell/PageHeader'
import { useToast } from '@/context/ToastContext'
import {
  getAreaById,
  getNoteById,
  getProjectById,
  getResourceById,
} from '@/lib/data'
import { openPath, restoreEntity, trashEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision } from '@/lib/hooks'
import {
  NOTE_TYPE_LABEL,
  RESOURCE_KIND_LABEL,
  RESOURCE_STATUS_LABEL,
  tagLabel,
} from '@/lib/format'
import { formatDateTime, formatRelative } from '@/lib/date'

type PreviewKind = 'image' | 'pdf' | 'text' | 'table' | 'markdown' | 'unsupported'

interface PreviewText {
  text: string
  ext: string
  truncated: boolean
}

const PREVIEW_IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'])
const PREVIEW_TEXT_EXTS = new Set(['txt', 'json', 'csv', 'log', 'docx', 'pptx'])
const PREVIEW_TABLE_EXTS = new Set(['xlsx'])
const PREVIEW_MARKDOWN_EXTS = new Set(['md', 'markdown'])
const PREVIEW_OFFICE_EXTS = new Set(['docx', 'pptx', 'xlsx'])

export function LibraryDetailPage() {
  useDataRevision()
  const { kind, id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()

  const note = kind === 'notes' && id !== undefined ? getNoteById(id) : undefined
  const resource = kind === 'resources' && id !== undefined ? getResourceById(id) : undefined
  const title = note?.title ?? resource?.title
  const [previewText, setPreviewText] = useState<PreviewText | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [previewAssetError, setPreviewAssetError] = useState(false)
  const resourcePath = resource?.path
  const resourceExt =
    resourcePath !== undefined ? (resourcePath.split('.').pop() ?? '').toLowerCase() : ''
  const previewKind: PreviewKind =
    resourcePath === undefined
      ? 'unsupported'
      : PREVIEW_IMAGE_EXTS.has(resourceExt)
        ? 'image'
        : resourceExt === 'pdf'
          ? 'pdf'
          : PREVIEW_TABLE_EXTS.has(resourceExt)
            ? 'table'
            : PREVIEW_MARKDOWN_EXTS.has(resourceExt)
              ? 'markdown'
              : PREVIEW_TEXT_EXTS.has(resourceExt)
                ? 'text'
                : 'unsupported'
  const resourceId = resource?.id
  const previewUrl = resourceId !== undefined ? `/api/resources/${resourceId}/file` : ''

  useEffect(() => {
    if (resourceId === undefined) return
    if (previewKind !== 'text' && previewKind !== 'table' && previewKind !== 'markdown') return
    const controller = new AbortController()
    setPreviewText(null)
    setPreviewError('')
    void fetch(`/api/resources/${resourceId}/text`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        return (await response.json()) as PreviewText
      })
      .then((data) => setPreviewText(data))
      .catch((err: unknown) => {
        if (!(err instanceof DOMException && err.name === 'AbortError')) {
          setPreviewError('无法读取文件内容，请打开文件查看。')
        }
      })
    return () => controller.abort()
  }, [previewKind, resourceId])

  useEffect(() => {
    setPreviewAssetError(false)
  }, [resourceId])

  const tableRows = useMemo(() => {
    if (previewKind !== 'table' || previewText === null) return []
    return previewText.text
      .split(/\r?\n/)
      .filter((row) => row.trim() !== '')
      .map((row) => row.split('\t'))
  }, [previewKind, previewText])

  const previewLabel =
    previewKind === 'image'
      ? '图片'
      : previewKind === 'pdf'
        ? 'PDF · 浏览器预览'
        : previewKind === 'table'
          ? `.${resourceExt} · 提取表格`
          : previewKind === 'markdown'
            ? 'Markdown'
            : previewKind === 'text'
              ? PREVIEW_OFFICE_EXTS.has(resourceExt)
                ? `.${resourceExt} · 提取文本`
                : '文本'
              : '暂不支持预览'

  if (title === undefined || (kind !== 'notes' && kind !== 'resources')) {
    return (
      <div className="gh-page">
        <PageHeader
          breadcrumb={[{ label: 'KERNEL', to: '/' }, { label: '资料', to: '/library' }, { label: '未找到' }]}
          title="记录不存在"
          description="它可能已被删除，或链接已失效。"
        />
        <Link to="/library" className="gh-btn">
          返回资料
        </Link>
      </div>
    )
  }

  const ownerId = note?.id ?? resource?.id ?? ''
  const areaId = note?.areaId ?? resource?.areaId
  const projectId = note?.projectId
  const area = areaId !== undefined ? getAreaById(areaId) : undefined
  const project = projectId !== undefined ? getProjectById(projectId) : undefined
  const tags = note?.tags ?? resource?.tags ?? []

  const remove = (): void => {
    void (async () => {
      try {
        await trashEntity(kind, ownerId)
        navigate('/library')
        toast('已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity(kind, ownerId).catch((err) => {
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

  const openResource = (): void => {
    const filePath = resource?.path
    if (filePath === undefined) return
    void (async () => {
      try {
        await openPath(filePath)
        toast('已用默认程序打开')
      } catch (err) {
        toast(`打开失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  return (
    <div className="gh-page">
      <PageHeader
        breadcrumb={[
          { label: 'KERNEL', to: '/' },
          { label: '资料', to: '/library' },
          { label: kind === 'notes' ? '笔记' : '资料', to: '/library' },
          { label: title },
        ]}
        title={title}
        description={
          note !== undefined
            ? `${NOTE_TYPE_LABEL[note.type]} · ${area?.title ?? '未分区'}`
            : `${RESOURCE_KIND_LABEL[resource?.kind ?? 'article']} · ${RESOURCE_STATUS_LABEL[resource?.status ?? 'unread']}`
        }
        meta={
          <b>
            {formatDateTime(note?.updatedAt ?? resource?.addedAt ?? new Date().toISOString())} ·{' '}
            {formatRelative(note?.updatedAt ?? resource?.addedAt ?? new Date().toISOString())}
          </b>
        }
        actions={
          <>
            {resourcePath !== undefined && (
              <button type="button" className="gh-btn" onClick={openResource}>
                <FileText size={14} strokeWidth={1.8} aria-hidden />
                打开文件
              </button>
            )}
            <Link
              to={kind === 'notes' ? `/library?note=${ownerId}` : `/library?resource=${ownerId}`}
              className="gh-btn"
            >
              <Pencil size={14} strokeWidth={1.8} aria-hidden />
              编辑
            </Link>
            <button type="button" className="gh-btn gh-btn--danger" onClick={remove}>
              <Trash2 size={14} strokeWidth={1.8} aria-hidden />
              删除
            </button>
          </>
        }
      />

      <div className="gh-detail-grid">
        <div className="gh-detail-main">
          {resourcePath !== undefined && (
            <section className="gh-card k-inline-preview" aria-label="文件预览">
              <div className="gh-card__head k-inline-preview__head">
                <span>预览</span>
                <span className="k-inline-preview__label">{previewLabel}</span>
              </div>
              <div className="gh-card__body k-inline-preview__body">
                {previewKind === 'image' && !previewAssetError && (
                  <img
                    className="k-preview-media"
                    src={previewUrl}
                    alt={`${title} 预览`}
                    onError={() => setPreviewAssetError(true)}
                  />
                )}
                {previewKind === 'image' && previewAssetError && (
                  <p className="k-preview-error">无法加载预览，请打开文件查看。</p>
                )}
                {previewKind === 'pdf' && (
                  <iframe
                    className="k-preview-frame"
                    src={previewUrl}
                    title={`${title} 预览`}
                  />
                )}
                {(previewKind === 'text' ||
                  previewKind === 'table' ||
                  previewKind === 'markdown') && (
                  <>
                    {previewError !== '' ? (
                      <p className="k-preview-error">{previewError}</p>
                    ) : previewText === null ? (
                      <p className="k-preview-note">正在读取…</p>
                    ) : previewKind === 'table' ? (
                      tableRows.length === 0 ? (
                        <p className="k-preview-note">没有可显示的表格内容。</p>
                      ) : (
                        <div className="k-inline-preview__table-wrap">
                          <table className="k-inline-preview__table">
                            <tbody>
                              {tableRows.map((row, rowIndex) => (
                                <tr key={rowIndex}>
                                  {row.map((cell, cellIndex) => (
                                    <td key={cellIndex}>{cell}</td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    ) : previewKind === 'markdown' ? (
                      <div className="k-note-read k-inline-preview__markdown">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>
                          {previewText.text}
                        </ReactMarkdown>
                      </div>
                    ) : (
                      <pre className="k-detail-raw k-preview-text">{previewText.text}</pre>
                    )}
                    {previewText?.truncated === true && (
                      <p className="k-preview-note">内容过长，仅显示前一段。</p>
                    )}
                  </>
                )}
                {previewKind === 'unsupported' && (
                  <div className="k-preview-fallback">
                    <p>
                      {resourceExt !== ''
                        ? `浏览器不能直接预览 .${resourceExt} 格式。`
                        : '浏览器不能直接预览该格式。'}
                    </p>
                    {resource !== undefined &&
                      resource.content !== undefined &&
                      resource.content.trim() !== '' && (
                        <>
                          <p className="k-preview-note">已提取的原文：</p>
                          <pre className="k-detail-raw k-preview-text">{resource.content}</pre>
                        </>
                      )}
                    <p className="k-preview-note">可以打开文件查看。</p>
                  </div>
                )}
              </div>
            </section>
          )}
          {note !== undefined ? (
            <section className="gh-card">
              <div className="gh-card__head">正文</div>
              <div className="gh-card__body k-note-read">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{note.body}</ReactMarkdown>
              </div>
            </section>
          ) : (
            <section className="gh-card">
              <div className="gh-card__head">简介</div>
              <div className="gh-card__body">
                <p className="gh-readme">{resource?.note ?? '暂无简介。'}</p>
                {resource?.content !== undefined && resource.content.trim() !== '' && (
                  <div className="gh-readme" style={{ marginTop: 16 }}>
                    {resource.content}
                  </div>
                )}
                {resource?.url !== undefined && (
                  <p style={{ marginTop: 16 }}>
                    <a href={resource.url} target="_blank" rel="noreferrer" className="gh-link">
                      {resource.url}
                    </a>
                  </p>
                )}
              </div>
            </section>
          )}
        </div>

        <aside className="gh-detail-side">
          <section className="gh-card">
            <div className="gh-card__head">信息</div>
            <div className="gh-about">
              <div className="gh-about__row">
                <span>类型</span>
                <b>{note !== undefined ? NOTE_TYPE_LABEL[note.type] : RESOURCE_KIND_LABEL[resource?.kind ?? 'article']}</b>
              </div>
              {resourcePath !== undefined && (
                <div className="gh-about__row">
                  <span>文件</span>
                  <b className="gh-about__path" title={resourcePath}>
                    {resourcePath.split(/[\\/]/).pop() ?? resourcePath}
                  </b>
                </div>
              )}
              <div className="gh-about__row">
                <span>状态</span>
                <b>{note !== undefined ? `L${note.distillLevel}` : RESOURCE_STATUS_LABEL[resource?.status ?? 'unread']}</b>
              </div>
              <div className="gh-about__row">
                <span>区域</span>
                <b>{area?.title ?? '—'}</b>
              </div>
              <div className="gh-about__row">
                <span>项目</span>
                {project !== undefined ? (
                  <Link to={`/projects/${project.id}`} className="gh-about__link">
                    {project.title}
                  </Link>
                ) : (
                  <b>—</b>
                )}
              </div>
              <div className="gh-about__row">
                <span>更新</span>
                <b>{formatRelative(note?.updatedAt ?? resource?.addedAt ?? new Date().toISOString())}</b>
              </div>
              <div className="gh-about__row">
                <span>标签</span>
                <span className="gh-about__tags">
                  {tags.length > 0
                    ? tags.map((tag) => (
                        <span key={tag} className="gh-badge gh-badge--neutral">
                          {tagLabel(tag)}
                        </span>
                      ))
                    : '—'}
                </span>
              </div>
            </div>
          </section>
          <Link to="/library" className="gh-btn">
            <ExternalLink size={14} strokeWidth={1.8} aria-hidden />
            返回资料列表
          </Link>
        </aside>
      </div>
    </div>
  )
}
