// KERNEL · 项目详情渲染（字段网格 / 标签 / 关联 / 任务清单）
// 项目抽屉（Projects 页）与总览「就地弹窗」（Overview）共用，避免字段逻辑重复。
import { Link } from 'react-router-dom'
import { TagPill } from '@/components/TagPill'
import { TaskRow } from '@/components/TaskRow'
import { Relations } from '@/components/Relations'
import { getAreaById, getProjectProgress, getTaskById, getTasksByProject } from '@/lib/data'
import { isTaskDone } from '@/lib/mutations'
import { PROJECT_STATUS_LABEL, tagLabel } from '@/lib/format'
import { humanizeDay } from '@/lib/date'
import type { Project, Task } from '@/types'

interface ProjectDetailProps {
  project: Project
  onToggleTask: (task: Task) => void
}

export function ProjectDetail({ project, onToggleTask }: ProjectDetailProps) {
  const tasks = getTasksByProject(project.id)
  const progress = getProjectProgress(project.id)
  const area = getAreaById(project.areaId)
  const nextAction = project.nextActionId !== undefined ? getTaskById(project.nextActionId) : undefined
  return (
    <div className="k-detail-grid">
      <dl className="k-dl">
        <dt>完成定义</dt>
        <dd className="k-dl__wide">{project.outcome}</dd>
        <dt>状态</dt>
        <dd>{PROJECT_STATUS_LABEL[project.status]}</dd>
        <dt>区域</dt>
        <dd>{area?.title ?? project.areaId}</dd>
        <dt>下一步</dt>
        <dd>
          {nextAction !== undefined ? (
            <Link to={`/tasks?task=${nextAction.id}`} viewTransition>
              {nextAction.title}
            </Link>
          ) : (
            '—'
          )}
        </dd>
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
      <Relations kind="project" id={project.id} />
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
