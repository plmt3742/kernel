// KERNEL · 项目列表（GitHub 式：过滤 tabs + 项目行 + 右侧进度；点击进入项目页）
import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Search, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'
import { PageHeader } from '@/components/shell/PageHeader'
import { ProjectDraftModal } from '@/components/ProjectDraftModal'
import { OrganizeProposalCard } from '@/components/OrganizeProposalCard'
import { useToast } from '@/context/ToastContext'
import { getAreaById, getProjectProgress, getSnapshot, getTaskById } from '@/lib/data'
import { trashEntity, type OrganizeAssignment, type OrganizeCluster } from '@/lib/mutations'
import {
  applyOrganizeSelection,
  dismissOrganize,
  getOrganizeState,
  runOrganizeNow,
  undoOrganizeApply,
  useOrganizeState,
} from '@/lib/organize'
import { errorText } from '@/lib/api'
import { useDataRevision } from '@/lib/hooks'
import { PROJECT_STATUS_LABEL, tagLabel } from '@/lib/format'
import { humanizeDay } from '@/lib/date'
import type { Project } from '@/types'

const STATUS_ORDER: Project['status'][] = ['active', 'onHold', 'someday', 'done', 'archived']
const STATUS_FILTERS: Array<{ value: Project['status'] | 'all'; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'active', label: '进行中' },
  { value: 'onHold', label: '暂停' },
  { value: 'someday', label: '将来' },
  { value: 'done', label: '已完成' },
  { value: 'archived', label: '已归档' },
]

function statusClass(status: Project['status']): string {
  if (status === 'active') return 'gh-badge--green'
  if (status === 'done') return 'gh-badge--neutral'
  return ''
}

export function Projects() {
  useDataRevision()
  const navigate = useNavigate()
  const { toast } = useToast()
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<Project['status'] | 'all'>('all')
  const [draftTitle, setDraftTitle] = useState<string | null>(null)
  const projects = getSnapshot().projects
  const organize = useOrganizeState()

  useEffect(() => {
    const id = searchParams.get('project')
    if (id !== null && projects.some((project) => project.id === id)) {
      navigate(`/projects/${id}`, { replace: true })
    }
  }, [searchParams, projects, navigate])

  const activeCount = projects.filter((project) => project.status === 'active').length
  const needle = query.trim().toLowerCase()
  const filtered = projects
    .filter((project) => status === 'all' || project.status === status)
    .filter((project) => {
      if (needle === '') return true
      return [project.title, project.outcome, ...project.tags]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    })
    .sort((a, b) => {
      const rank = STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status)
      return rank !== 0 ? rank : b.updatedAt.localeCompare(a.updatedAt)
    })

  const handleCreated = (project: Project): void => {
    setDraftTitle(null)
    toast('已创建项目 · 撤销', {
      action: {
        label: '撤销',
        onClick: () => {
          void trashEntity('projects', project.id).catch((err) => {
            toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
          })
        },
      },
    })
  }

  const handleOrganizeRun = async (): Promise<void> => {
    const ok = await runOrganizeNow()
    const state = getOrganizeState()
    if (!ok) {
      toast(`整理失败：${state.error || '请稍后重试'}`, { tone: 'error' })
    } else if (state.assignments.length === 0 && state.clusters.length === 0) {
      toast('暂无可整理项')
    }
  }

  const handleOrganizeApply = (
    assignments: OrganizeAssignment[],
    clusters: OrganizeCluster[],
  ): void => {
    void (async () => {
      try {
        const result = await applyOrganizeSelection(assignments, clusters)
        toast(`已整理 ${result.assignedTotal} 项 · 撤销`, {
          action: {
            label: '撤销',
            onClick: () => {
              void undoOrganizeApply(result).catch((err) => {
                toast(`撤销失败：${errorText(err)}`, { tone: 'error' })
              })
            },
          },
        })
      } catch (err) {
        toast(`应用失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }

  return (
    <div className="gh-page">
      <PageHeader
        breadcrumb={[{ label: 'KERNEL', to: '/' }, { label: '项目' }]}
        title="项目"
        description="需要多个步骤才能做完的事。看状态、下一步和进度。"
        meta={
          <>
            <b>{activeCount} 进行中</b>
            <span>共 {projects.length} 个</span>
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="gh-btn"
              onClick={() => {
                void handleOrganizeRun()
              }}
              disabled={organize.busy || organize.applying}
            >
              <Sparkles size={14} strokeWidth={1.8} aria-hidden />
              {organize.busy || organize.applying ? '整理中…' : 'AI 整理'}
            </button>
            <button
              type="button"
              className="gh-btn gh-btn--primary"
              onClick={() => setDraftTitle('')}
            >
              <Plus size={14} strokeWidth={1.8} aria-hidden />
              新建项目
            </button>
          </>
        }
        tabs={
          <>
            {STATUS_FILTERS.map((item) => (
              <button
                key={item.value}
                type="button"
                className={clsx('gh-tab', status === item.value && 'is-active')}
                aria-pressed={status === item.value}
                onClick={() => setStatus(item.value)}
              >
                {item.label}
                {item.value === 'all' && <span className="gh-tab__count">{projects.length}</span>}
                {item.value !== 'all' && (
                  <span className="gh-tab__count">
                    {projects.filter((project) => project.status === item.value).length}
                  </span>
                )}
              </button>
            ))}
          </>
        }
      />

      <div className="gh-toolbar">
        <label className="gh-search-input">
          <Search size={14} strokeWidth={1.8} aria-hidden />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索项目、完成定义或标签…"
            aria-label="搜索项目"
          />
        </label>
        <span className="gh-toolbar__count">
          {filtered.length} / {projects.length}
        </span>
      </div>

      <OrganizeProposalCard
        assignments={organize.assignments}
        clusters={organize.clusters}
        busy={organize.busy}
        applying={organize.applying}
        onApply={handleOrganizeApply}
        onRerun={() => {
          void handleOrganizeRun()
        }}
        onDismiss={dismissOrganize}
      />

      {filtered.length === 0 ? (
        <div className="gh-empty">
          <b>没有匹配的项目</b>
          <span>{needle === '' ? '切换状态标签，或新建一个项目。' : `没有匹配「${query.trim()}」的项目。`}</span>
        </div>
      ) : (
        <div className="gh-project-list">
          {filtered.map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              onOpen={() => navigate(`/projects/${project.id}`)}
            />
          ))}
        </div>
      )}

      <ProjectDraftModal
        open={draftTitle !== null}
        initialTitle={draftTitle ?? ''}
        onClose={() => setDraftTitle(null)}
        onCreated={handleCreated}
      />
    </div>
  )
}

function ProjectRow({ project, onOpen }: { project: Project; onOpen: () => void }) {
  const progress = getProjectProgress(project.id)
  const area = project.areaId !== undefined ? getAreaById(project.areaId) : undefined
  const nextAction = project.nextActionId !== undefined ? getTaskById(project.nextActionId) : undefined
  const pct = Math.round(progress.ratio * 100)
  return (
    <button type="button" className="gh-project-row" onClick={onOpen}>
      <span className="gh-project-row__main">
        <span className="gh-project-row__titleline">
          <span className="gh-project-row__title">{project.title}</span>
          <span className={clsx('gh-badge', statusClass(project.status))}>
            {PROJECT_STATUS_LABEL[project.status]}
          </span>
          {area !== undefined && <span className="gh-badge gh-badge--neutral">{area.title}</span>}
        </span>
        <span className="gh-project-row__desc">{project.outcome}</span>
        <span className="gh-project-row__meta">
          {nextAction !== undefined ? (
            <>
              <span>下一步</span>
              <b>{nextAction.title}</b>
            </>
          ) : (
            <span>未设置下一步</span>
          )}
          {project.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="gh-project-row__tag">
              {tagLabel(tag)}
            </span>
          ))}
        </span>
      </span>
      <span className="gh-project-row__side">
        <span className="gh-project-row__progress" aria-label={`进度 ${pct}%`}>
          <i style={{ width: `${pct}%` }} />
        </span>
        <span className="gh-project-row__numbers">
          {progress.done} / {progress.total} · {pct}%
        </span>
        <span className="gh-project-row__time">
          {project.dueAt !== undefined ? `截止 ${humanizeDay(project.dueAt)}` : `更新 ${humanizeDay(project.updatedAt)}`}
        </span>
      </span>
    </button>
  )
}
