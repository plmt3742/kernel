// KERNEL · 项目 PROJECTS（P1）：状态分组纵向列表 + 行内进度 + 详情抽屉
import { useState } from 'react'
import { Drawer } from '@/components/Drawer'
import { MeterBar } from '@/components/MeterBar'
import { TagPill } from '@/components/TagPill'
import { EmptyState } from '@/components/EmptyState'
import { TaskRow } from '@/components/TaskRow'
import {
  getAreaById,
  getProjectProgress,
  getSnapshot,
  getTaskById,
  getTasksByProject,
} from '@/lib/data'
import { isTaskDone } from '@/lib/mutations'
import { useDataRevision, useUndoableToggle } from '@/lib/hooks'
import { PROJECT_STATUS_EN, PROJECT_STATUS_LABEL, tagLabel } from '@/lib/format'
import { humanizeDay } from '@/lib/date'
import type { Project, Task } from '@/types'

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
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const projects = getSnapshot().projects

  const selected = drawerId !== null ? projects.find((p) => p.id === drawerId) : undefined

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
        onClose={() => setDrawerId(null)}
        kicker={`项目 · ${selected?.id ?? ''} · ${selected !== undefined ? PROJECT_STATUS_LABEL[selected.status] : ''}`}
        title={selected?.title ?? ''}
      >
        {selected !== undefined && <ProjectDetail project={selected} onToggleTask={toggleTask} />}
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

interface ProjectDetailProps {
  project: Project
  onToggleTask: (task: Task) => void
}

function ProjectDetail({ project, onToggleTask }: ProjectDetailProps) {
  const tasks = getTasksByProject(project.id)
  const progress = getProjectProgress(project.id)
  const area = getAreaById(project.areaId)
  return (
    <div className="k-detail-grid">
      <dl className="k-dl">
        <dt>完成定义</dt>
        <dd className="k-dl__wide">{project.outcome}</dd>
        <dt>状态</dt>
        <dd>{PROJECT_STATUS_LABEL[project.status]}</dd>
        <dt>区域</dt>
        <dd>{area?.title ?? project.areaId}</dd>
        <dt>进度</dt>
        <dd>
          {progress.done} / {progress.total}
        </dd>
        <dt>截止</dt>
        <dd>{project.dueAt !== undefined ? humanizeDay(project.dueAt) : '—'}</dd>
      </dl>
      {project.tags.length > 0 && (
        <div className="k-detail-block">
          <span className="k-detail-block__label u-label">标签</span>
          <div className="k-hstack">
            {project.tags.map((tag) => (
              <TagPill key={tag}>{tagLabel(tag)}</TagPill>
            ))}
          </div>
        </div>
      )}
      <div className="k-detail-block">
        <span className="k-detail-block__label u-label">任务清单 · {tasks.length}</span>
        {tasks.length === 0 ? (
          <p className="k-muted">该项目暂无关联任务。</p>
        ) : (
          <div className="k-tasklist-mini">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                done={isTaskDone(task)}
                onToggle={(id) => {
                  const target = tasks.find((item) => item.id === id)
                  if (target !== undefined) onToggleTask(target)
                }}
                onOpen={() => undefined}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
