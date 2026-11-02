// KERNEL · 踪迹详情页（内容 / 图片 / 标签 / 关联；编辑走既有弹窗）
import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ExternalLink, Pencil, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/shell/PageHeader'
import { TraceDetailModal } from '@/components/TraceDetailModal'
import { useToast } from '@/context/ToastContext'
import { getAreaById, getProjectById, getTraces, traceImageUrl } from '@/lib/data'
import { restoreEntity, trashEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision } from '@/lib/hooks'
import { tagLabel } from '@/lib/format'
import { formatDateTime, formatRelative } from '@/lib/date'

export function TraceDetailPage() {
  useDataRevision()
  const { id } = useParams()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [editing, setEditing] = useState(false)
  const trace = id !== undefined ? getTraces().find((item) => item.id === id) : undefined

  if (trace === undefined) {
    return (
      <div className="gh-page">
        <PageHeader
          breadcrumb={[{ label: 'KERNEL', to: '/' }, { label: '踪迹', to: '/traces' }, { label: '未找到' }]}
          title="踪迹不存在"
          description="它可能已被删除，或链接已失效。"
        />
        <Link to="/traces" className="gh-btn">
          返回踪迹
        </Link>
      </div>
    )
  }

  const area = trace.areaId !== undefined ? getAreaById(trace.areaId) : undefined
  const project = trace.projectId !== undefined ? getProjectById(trace.projectId) : undefined

  const removeTrace = (): void => {
    void (async () => {
      try {
        await trashEntity('traces', trace.id)
        navigate('/traces')
        toast('踪迹已移入回收站 · 撤销', {
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

  return (
    <div className="gh-page">
      <PageHeader
        breadcrumb={[
          { label: 'KERNEL', to: '/' },
          { label: '踪迹', to: '/traces' },
          { label: trace.title },
        ]}
        title={trace.title}
        description={trace.note}
        meta={
          <>
            <b>{formatDateTime(trace.at)}</b>
            <span>{formatRelative(trace.at)}</span>
          </>
        }
        actions={
          <>
            <button type="button" className="gh-btn" onClick={() => setEditing(true)}>
              <Pencil size={14} strokeWidth={1.8} aria-hidden />
              编辑
            </button>
            <button type="button" className="gh-btn gh-btn--danger" onClick={removeTrace}>
              <Trash2 size={14} strokeWidth={1.8} aria-hidden />
              删除
            </button>
          </>
        }
      />

      <div className="gh-detail-grid">
        <div className="gh-detail-main">
          <section className="gh-card">
            <div className="gh-card__head">内容</div>
            <div className="gh-card__body">
              <p className="gh-readme">{trace.note !== undefined && trace.note !== '' ? trace.note : '没有更多内容。'}</p>
              {trace.images !== undefined && trace.images.length > 0 && (
                <div className="gh-trace-images">
                  {trace.images.map((name) => (
                    <a key={name} href={traceImageUrl(name)} target="_blank" rel="noreferrer">
                      <img src={traceImageUrl(name)} alt="" loading="lazy" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>

        <aside className="gh-detail-side">
          <section className="gh-card">
            <div className="gh-card__head">信息</div>
            <div className="gh-about">
              <div className="gh-about__row">
                <span>时间</span>
                <b>{formatDateTime(trace.at)}</b>
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
                <span>标签</span>
                <span className="gh-about__tags">
                  {trace.tags.length > 0
                    ? trace.tags.map((tag) => (
                        <span key={tag} className="gh-badge gh-badge--neutral">
                          {tagLabel(tag)}
                        </span>
                      ))
                    : '—'}
                </span>
              </div>
            </div>
          </section>
          <Link to="/traces" className="gh-btn">
            <ExternalLink size={14} strokeWidth={1.8} aria-hidden />
            返回踪迹列表
          </Link>
        </aside>
      </div>

      {editing && <TraceDetailModal traceId={trace.id} onClose={() => setEditing(false)} />}
    </div>
  )
}
