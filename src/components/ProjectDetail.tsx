// KERNEL · 项目详情渲染（字段网格 / 状态快捷切换 / 标签 / 关联 / 任务清单）
// 项目抽屉（Projects 页）与总览「就地弹窗」（Overview）共用，避免字段逻辑重复。
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
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
  /** 点击任务行 → 打开该任务详情（Slice R3；缺省时行不可点但其余动作不变） */
  onOpenTask?: (id: string) => void
  /** 安静 quick-add：回车 → 打开草稿确认弹窗（Slice R3；**非**即时写入） */
  onQuickAddTask?: (title: string) => void
  /** 状态快捷切换（N8.2，可选；缺省不渲染）——写入与撤销由弹窗层注入（含 toast） */
  onSetStatus?: (status: Project['status']) => void
}

export function ProjectDetail({
  project,
  onToggleTask,
  onOpenTask,
  onQuickAddTask,
  onSetStatus,
}: ProjectDetailProps) {
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
      {onSetStatus !== undefined && <StatusSegmented status={project.status} onSelect={onSetStatus} />}
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
                onOpen={(id) => onOpenTask?.(id)}
              />
            ))}
          </div>
        )}
        {onQuickAddTask !== undefined && <AddTaskInline onAdd={onQuickAddTask} />}
      </div>
    </div>
  )
}

/** 项目内安静 quick-add（Slice R3）：回车 → 交由上层打开草稿确认弹窗（确认前零落盘） */
function AddTaskInline({ onAdd }: { onAdd: (title: string) => void }) {
  const [title, setTitle] = useState('')
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const value = title.trim()
    if (value === '') return
    onAdd(value)
    setTitle('')
  }
  return (
    <form className="k-inline-add" onSubmit={submit}>
      <Plus size={14} strokeWidth={1.5} className="k-muted" aria-hidden />
      <input
        className="k-inline-add__input"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder="添加任务到本项目，回车确认"
        aria-label="添加任务到本项目"
      />
    </form>
  )
}

/** 状态快捷切换顺序：进行中 → 暂停 → 将来 → 已完成（「已归档」走编辑表单，不在项目页显示） */
const QUICK_STATUS: Project['status'][] = ['active', 'onHold', 'someday', 'done']

/** 状态快捷切换：安静 segmented（复用 .k-lib__seg 轨道 + TagPill 选中反转，与日程同款） */
function StatusSegmented({
  status,
  onSelect,
}: {
  status: Project['status']
  onSelect: (status: Project['status']) => void
}) {
  return (
    <div className="k-detail-block k-quickset">
      <span className="k-detail-block__label u-label">状态 · 快捷切换</span>
      <div className="k-lib__seg k-quickset__seg" role="group" aria-label="项目状态">
        {QUICK_STATUS.map((value) => (
          <TagPill key={value} selected={value === status} onClick={() => onSelect(value)}>
            {PROJECT_STATUS_LABEL[value]}
          </TagPill>
        ))}
      </div>
      <p className="k-quickset__hint k-muted">点选即保存 · 可撤销；「已归档」在编辑表单中设置</p>
    </div>
  )
}
