// KERNEL · 项目 PROJECTS（P1）：状态分组纵向列表 + 行内进度 + 详情抽屉
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus, Sparkles } from 'lucide-react'
import { ProjectDetailModal } from '@/components/ProjectDetailModal'
import { ProjectDraftModal } from '@/components/ProjectDraftModal'
import { OrganizeProposalCard } from '@/components/OrganizeProposalCard'
import { MeterBar } from '@/components/MeterBar'
import { TagPill } from '@/components/TagPill'
import { EmptyState } from '@/components/EmptyState'
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
import { createUiStore, str, useUiStore } from '@/lib/uiState'
import { PROJECT_STATUS_EN, PROJECT_STATUS_LABEL, tagLabel } from '@/lib/format'
import { humanizeDay } from '@/lib/date'
import type { Project } from '@/types'

/** 行密度：active 完整；onHold/someday 紧凑（隐藏下一步）；done 最紧凑 */
type RowVariant = 'active' | 'compact' | 'done'

interface ProjectGroupSpec {
  status: Project['status']
  cn: string
  en: string
  variant: RowVariant
}

const GROUPS: ProjectGroupSpec[] = [
  { status: 'active', cn: '进行中', en: PROJECT_STATUS_EN.active, variant: 'active' },
  { status: 'onHold', cn: '暂停', en: PROJECT_STATUS_EN.onHold, variant: 'compact' },
  { status: 'someday', cn: '将来', en: PROJECT_STATUS_EN.someday, variant: 'compact' },
  { status: 'done', cn: '已完成', en: PROJECT_STATUS_EN.done, variant: 'done' },
]

/* ---------------------------------------------------------------------------
 * 项目页界面状态保留（Slice Z · F29，见 ADR-0022）：快速新建输入草稿持久化。
 * ------------------------------------------------------------------------- */
interface ProjectUiState {
  quick: string
}

const PROJECT_UI_KEY = 'kernel.ui.projects.v1'

function parseProjectUi(raw: unknown): ProjectUiState | null {
  if (typeof raw !== 'object' || raw === null) return null
  return { quick: str((raw as Record<string, unknown>).quick) }
}

const projectUiStore = createUiStore<ProjectUiState>(PROJECT_UI_KEY, { quick: '' }, {
  parse: parseProjectUi,
})

export function Projects() {
  useDataRevision()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [drawerId, setDrawerId] = useState<string | null>(null)
  // 快速新建输入（Slice Z · F29）：来自模块级 store（跨路由 + 刷新保留）
  const projectUi = useUiStore(projectUiStore)
  const quick = projectUi.quick
  const setQuick = (value: string): void => {
    projectUiStore.set((state) => ({ ...state, quick: value }))
  }
  // 草稿确认弹窗（Slice R1）：回车后打开，AI 补全完成定义 / 区域 / 标签，确认才写入
  const [draftTitle, setDraftTitle] = useState<string | null>(null)
  const projects = getSnapshot().projects
  // 「AI 整理」模块级状态（跨路由存活）：提案 / 运行态 / 应用态；确认前绝不落盘
  const organize = useOrganizeState()

  // 深链直达项目弹窗：/projects?project=p-0002
  useEffect(() => {
    const id = searchParams.get('project')
    if (id !== null && projects.some((project) => project.id === id)) {
      setDrawerId(id)
    }
  }, [searchParams, projects])

  const closeDrawer = (): void => {
    setDrawerId(null)
    if (searchParams.get('project') !== null) {
      setSearchParams({}, { replace: true })
    }
  }

  // 快速新建项目（Slice R1 · 草稿确认）：回车 → 弹窗（AI 补全完成定义 / 区域 / 标签）→
  // 点「创建项目」才写入；确认前零落盘。撤销走回收站。
  const handleQuickAdd = (): void => {
    const value = quick.trim()
    if (value === '') return
    setDraftTitle(value)
    setQuick('')
  }

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

  // AI 整理 · 手动运行（工具条按钮）：忽略时段 / 当日 / 锁；成功即使空也记录今日
  const handleOrganizeRun = async (): Promise<void> => {
    const ok = await runOrganizeNow()
    const state = getOrganizeState()
    if (!ok) {
      toast(`整理失败：${state.error || '请稍后重试'}`, { tone: 'error' })
    } else if (state.assignments.length === 0 && state.clusters.length === 0) {
      toast('暂无可整理项')
    }
  }

  // AI 整理 · 应用勾选（归并 + 新项目一次写入）；toast 撤销 → 精确复原
  const handleOrganizeApply = (assignments: OrganizeAssignment[], clusters: OrganizeCluster[]): void => {
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

  // 跨分组连续编号（与设计稿一致：进行中 01–09、将来 10 …）
  const indexById = new Map<string, number>()
  let seq = 0
  for (const group of GROUPS) {
    for (const project of projects) {
      if (project.status === group.status) {
        seq += 1
        indexById.set(project.id, seq)
      }
    }
  }

  return (
    <div className="k-view">
      <p className="k-view__intro">
        项目是"需要多个步骤达成"的结果承诺。纵向一览按状态分组，每行内嵌完成定义、下一步行动与任务进度。
      </p>

      {/* 快速新建（镜像任务页）：回车创建，写入 data/projects；同行右侧「AI 整理」 */}
      <div className="k-projects__toolbar">
        <div className="k-quickadd">
          <Plus size={16} strokeWidth={1.5} className="k-muted" aria-hidden />
          <input
            className="k-quickadd__input"
            value={quick}
            onChange={(event) => setQuick(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleQuickAdd()
            }}
            placeholder="新建项目，回车创建（写入 data/projects）"
            aria-label="快速新建项目"
          />
          <span className="u-label k-muted">ENTER</span>
        </div>
        <button
          type="button"
          className="k-pill is-ghost k-projects__organize"
          onClick={() => {
            void handleOrganizeRun()
          }}
          disabled={organize.busy || organize.applying}
        >
          <Sparkles size={14} strokeWidth={1.5} aria-hidden />
          {organize.busy || organize.applying ? '整理中…' : 'AI 整理'}
        </button>
      </div>

      {/* AI 整理建议卡：两段提案 + 逐行勾选；确认前零落盘 */}
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

      {projects.length === 0 ? (
        <div className="k-plist__empty">
          <EmptyState title="暂无项目" hint="还没有任何项目。从收件箱澄清，或直接创建一个。" guide />
        </div>
      ) : (
        <div className="k-plist">
          {GROUPS.map((group) => {
            const items = projects.filter((project) => project.status === group.status)
            return (
              <section
                className={`k-group k-plist__group k-plist__group--${group.variant}`}
                key={group.status}
              >
                <header className="k-group__head">
                  <span className="k-group__title">
                    {group.cn} <span className="u-label k-muted">{group.en}</span>
                  </span>
                  <span className="k-panel__idx u-mono">{String(items.length).padStart(2, '0')}</span>
                </header>
                {items.length === 0 ? (
                  <div className="k-plist__empty">
                    <EmptyState title="暂无项目" />
                  </div>
                ) : (
                  items.map((project) => (
                    <ProjectRow
                      key={project.id}
                      project={project}
                      index={indexById.get(project.id) ?? 0}
                      variant={group.variant}
                      onOpen={setDrawerId}
                    />
                  ))
                )}
              </section>
            )
          })}
        </div>
      )}

      {/* 项目详情居中弹窗（Slice K）：与总览就地弹窗共用同一组件，动作一致 */}
      <ProjectDetailModal projectId={drawerId} onClose={closeDrawer} />

      {/* 新建项目草稿确认弹窗（Slice R1）：确认前零落盘 */}
      <ProjectDraftModal
        open={draftTitle !== null}
        initialTitle={draftTitle ?? ''}
        onClose={() => setDraftTitle(null)}
        onCreated={handleCreated}
      />
    </div>
  )
}

interface ProjectRowProps {
  project: Project
  index: number
  variant: RowVariant
  onOpen: (id: string) => void
}

function ProjectRow({ project, index, variant, onOpen }: ProjectRowProps) {
  const progress = getProjectProgress(project.id)
  const area = project.areaId !== undefined ? getAreaById(project.areaId) : undefined
  const nextAction = project.nextActionId !== undefined ? getTaskById(project.nextActionId) : undefined
  const pct = Math.round(progress.ratio * 100)
  const tag = project.tags[0]

  return (
    <button
      type="button"
      className={`k-plist__row k-plist__row--${variant}`}
      onClick={() => onOpen(project.id)}
    >
      <span className="k-plist__idx u-mono">{String(index).padStart(2, '0')}</span>
      <span className="k-plist__main">
        <span className="k-plist__titleline">
          <span className="k-plist__title">{project.title}</span>
          <TagPill ghost={project.status !== 'active'}>{PROJECT_STATUS_LABEL[project.status]}</TagPill>
          {area !== undefined && <TagPill ghost>{area.title}</TagPill>}
          {tag !== undefined && <TagPill ghost>{tagLabel(tag)}</TagPill>}
        </span>
        <span className="k-plist__outcome">{project.outcome}</span>
        {nextAction !== undefined && (
          <span className="k-plist__next">
            <span className="u-label k-muted">下一步</span>
            <span>{nextAction.title}</span>
          </span>
        )}
      </span>
      <span className="k-plist__side">
        <span className="k-plist__meter">
          <MeterBar
            value={progress.done}
            max={Math.max(1, progress.total)}
            label="进度"
            caption={`${progress.done} / ${progress.total} · ${pct}%`}
          />
        </span>
        <span className="k-plist__due u-mono k-muted">
          {project.dueAt !== undefined ? `截止 ${humanizeDay(project.dueAt)}` : '未设截止'}
        </span>
      </span>
    </button>
  )
}
