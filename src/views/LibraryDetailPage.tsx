// KERNEL · 资料详情页（笔记 / 资料；编辑回到资料页弹窗）
import { Link, useNavigate, useParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shell/PageHeader'
import { useToast } from '@/context/ToastContext'
import {
  getAreaById,
  getNoteById,
  getProjectById,
  getResourceById,
} from '@/lib/data'
import { restoreEntity, trashEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision } from '@/lib/hooks'
import {
  NOTE_TYPE_LABEL,
  RESOURCE_KIND_LABEL,
  RESOURCE_STATUS_LABEL,
  tagLabel,
} from '@/lib/format'
import { formatDateTime, formatRelative } from '@/lib/date'

export function LibraryDetailPage() {
  useDataRevision()
  const { kind, id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()

  const note = kind === 'notes' && id !== undefined ? getNoteById(id) : undefined
  const resource = kind === 'resources' && id !== undefined ? getResourceById(id) : undefined
  const title = note?.title ?? resource?.title

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
