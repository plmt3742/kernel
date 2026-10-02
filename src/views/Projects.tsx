// KERNEL · 项目 PROJECTS（P1）：状态分组纵向列表 + 行内进度 + 详情抽屉
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { Drawer } from '@/components/Drawer'
import { EntityEditForm, type EditFieldSpec } from '@/components/EntityEditForm'
import { MeterBar } from '@/components/MeterBar'
import { TagPill } from '@/components/TagPill'
import { EmptyState } from '@/components/EmptyState'
import { ProjectDetail } from '@/components/ProjectDetail'
import { useToast } from '@/context/ToastContext'
import { getAreaById, getAreas, getProjectProgress, getSnapshot, getTaskById } from '@/lib/data'
import { createProject, restoreEntity, trashEntity, updateEntity } from '@/lib/mutations'
import { errorText } from '@/lib/api'
import { useDataRevision, useUndoableToggle } from '@/lib/hooks'
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

export function Projects() {
  useDataRevision()
  const toggleTask = useUndoableToggle()
  const { toast } = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [quick, setQuick] = useState('')
  const projects = getSnapshot().projects

  // 深链直达项目抽屉：/projects?project=p-0002
  useEffect(() => {
    const id = searchParams.get('project')
    if (id !== null && projects.some((project) => project.id === id)) {
      setDrawerId(id)
    }
  }, [searchParams, projects])

  // 切换抽屉时退出编辑态
  useEffect(() => {
    setEditing(false)
  }, [drawerId])

  const closeDrawer = (): void => {
    setDrawerId(null)
    if (searchParams.get('project') !== null) {
      setSearchParams({}, { replace: true })
    }
  }

  const selected = drawerId !== null ? projects.find((p) => p.id === drawerId) : undefined

  const projectFields: EditFieldSpec[] = [
    { key: 'title', label: '标题', type: 'text' },
    { key: 'outcome', label: '完成定义', type: 'textarea' },
    {
      key: 'status',
      label: '状态',
      type: 'select',
      options: (Object.keys(PROJECT_STATUS_LABEL) as Project['status'][]).map((value) => ({
        value,
        label: PROJECT_STATUS_LABEL[value],
      })),
    },
    {
      key: 'areaId',
      label: '区域',
      type: 'select',
      clearable: true,
      options: getAreas().map((area) => ({ value: area.id, label: area.title })),
    },
    {
      key: 'nextActionId',
      label: '下一步',
      type: 'select',
      clearable: true,
      options: getSnapshot()
        .tasks.filter((task) => task.status !== 'done' && task.status !== 'dropped')
        .map((task) => ({ value: task.id, label: task.title })),
    },
    {
      key: 'goalId',
      label: '目标',
      type: 'select',
      clearable: true,
      options: getSnapshot().goals.map((goal) => ({ value: goal.id, label: goal.title })),
    },
    { key: 'dueAt', label: '截止', type: 'datetime' },
    { key: 'tags', label: '标签（逗号分隔）', type: 'list' },
  ]

  const handleSave = (patch: Record<string, unknown>): void => {
    if (selected === undefined) return
    setSaving(true)
    void (async () => {
      try {
        await updateEntity('projects', selected.id, patch)
        setEditing(false)
        toast('已保存')
      } catch (err) {
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setSaving(false)
      }
    })()
  }

  const handleDelete = (): void => {
    if (selected === undefined) return
    const id = selected.id
    void (async () => {
      try {
        await trashEntity('projects', id)
        toast('已移入回收站 · 撤销', {
          action: {
            label: '撤销',
            onClick: () => {
              void restoreEntity('projects', id).catch((err) => {
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

  // 快速新建项目（镜像任务页 quick-add）：回车创建 → toast；撤销走回收站
  const handleQuickAdd = (): void => {
    const value = quick.trim()
    if (value === '') return
    void (async () => {
      try {
        const project = await createProject(value)
        setQuick('')
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
      } catch (err) {
        toast(`创建失败：${errorText(err)}`, { tone: 'error' })
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

      {/* 快速新建（镜像任务页）：回车创建，写入 data/projects */}
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
      </div>

      {projects.length === 0 ? (
        <div className="k-plist__empty">
          <EmptyState title="暂无项目" hint="还没有任何项目。从收件箱澄清，或直接创建一个。" />
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

      <Drawer
        open={selected !== undefined}
        onClose={closeDrawer}
        kicker={`项目 · ${selected?.id ?? ''} · ${selected !== undefined ? PROJECT_STATUS_LABEL[selected.status] : ''}`}
        title={selected?.title ?? ''}
        footer={
          selected !== undefined && !editing ? (
            <div className="k-drawer__foot-actions">
              <button type="button" className="k-btn k-btn--sm" onClick={() => setEditing(true)}>
                编辑
              </button>
              <button type="button" className="k-btn k-btn--sm is-danger" onClick={handleDelete}>
                删除
              </button>
            </div>
          ) : undefined
        }
      >
        {selected !== undefined &&
          (editing ? (
            <EntityEditForm
              fields={projectFields}
              initial={selected as unknown as Record<string, unknown>}
              saving={saving}
              onSubmit={handleSave}
              onCancel={() => setEditing(false)}
            />
          ) : (
            <ProjectDetail project={selected} onToggleTask={toggleTask} />
          ))}
      </Drawer>
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
  const area = getAreaById(project.areaId)
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


