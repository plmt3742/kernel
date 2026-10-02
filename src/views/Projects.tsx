// KERNEL · 项目 PROJECTS（P1）：四列看板 + 卡片进度 + 详情抽屉
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
import type { Project, ProjectStatus, Task } from '@/types'

const COLUMNS: Array<{ status: ProjectStatus; cn: string; en: string }> = [
  { status: 'active', cn: '进行中', en: PROJECT_STATUS_EN.active },
  { status: 'onHold', cn: '暂停', en: PROJECT_STATUS_EN.onHold },
  { status: 'someday', cn: '将来', en: PROJECT_STATUS_EN.someday },
  { status: 'done', cn: '已完成', en: PROJECT_STATUS_EN.done },
]

export function Projects() {
  useDataRevision()
  const toggleTask = useUndoableToggle()
  const [drawerId, setDrawerId] = useState<string | null>(null)
  const projects = getSnapshot().projects

  const selected = drawerId !== null ? projects.find((p) => p.id === drawerId) : undefined

  return (
    <div className="k-view">
      <p className="k-view__intro">
        项目是"需要多个步骤达成"的结果承诺。看板按状态分列，卡片内嵌下一步行动与任务进度。
      </p>

      <div className="k-kanban">
        {COLUMNS.map((column) => {
          const items = projects.filter((project) => project.status === column.status)
          return (
            <section className="k-kanban__col" key={column.status}>
              <header className="k-kanban__head">
                <span className="k-panel__cn">
                  {column.cn} <span className="u-label k-muted">{column.en}</span>
                </span>
                <span className="k-panel__idx u-mono">{String(items.length).padStart(2, '0')}</span>
              </header>
              {items.length === 0 ? (
                <EmptyState index="00" title="空列" hint="该状态下暂无项目。" />
              ) : (
                items.map((project) => (
                  <ProjectCard key={project.id} project={project} onOpen={setDrawerId} />
                ))
              )}
            </section>
          )
        })}
      </div>

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

interface ProjectCardProps {
  project: Project
  onOpen: (id: string) => void
}

function ProjectCard({ project, onOpen }: ProjectCardProps) {
  const progress = getProjectProgress(project.id)
  const area = getAreaById(project.areaId)
  const nextAction = project.nextActionId !== undefined ? getTaskById(project.nextActionId) : undefined

  return (
    <button type="button" className="k-pcard" onClick={() => onOpen(project.id)}>
      <span className="k-pcard__title">{project.title}</span>
      <span className="k-pcard__outcome">{project.outcome}</span>
      {nextAction !== undefined && (
        <span className="k-pcard__next">
          <span className="u-label k-muted">下一步</span>
          <span>{nextAction.title}</span>
        </span>
      )}
      <MeterBar
        value={progress.done}
        max={Math.max(1, progress.total)}
        label="进度"
        caption={`${progress.done} / ${progress.total}`}
      />
      <span className="k-pcard__foot">
        {area !== undefined && <span className="k-mono">{area.title}</span>}
        {project.dueAt !== undefined && <span className="k-mono">{humanizeDay(project.dueAt)}</span>}
        {project.tags.slice(0, 1).map((tag) => (
          <TagPill key={tag} ghost>
            {tagLabel(tag)}
          </TagPill>
        ))}
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
        <dd>{project.outcome}</dd>
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
