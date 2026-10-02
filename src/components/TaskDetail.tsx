// KERNEL · 任务详情渲染（备注 / 字段网格 / 标签 / 关联）
// 任务抽屉（Tasks 页）与总览「就地弹窗」（Overview）共用，避免字段逻辑重复。
import { TagPill } from '@/components/TagPill'
import { Relations } from '@/components/Relations'
import { getAreaById, getProjectById } from '@/lib/data'
import { ENERGY_LABEL, TASK_STATUS_LABEL, tagLabel } from '@/lib/format'
import { formatDateTime, formatRelative, humanizeDay } from '@/lib/date'
import type { Task } from '@/types'

export function TaskDetail({ task }: { task: Task }) {
  return (
    <div className="k-detail-grid">
      {/* 主内容区：可读内容（备注）优先；无备注则不渲染，不造假数据 */}
      {task.notes !== undefined && (
        <div className="k-detail-block">
          <span className="k-detail-block__label u-label">备注</span>
          <p className="k-detail-note">{task.notes}</p>
        </div>
      )}
      {/* 元数据区：2 列紧凑字段网格（dt/dd 成对） */}
      <dl className="k-dl">
        <dt>状态</dt>
        <dd>{TASK_STATUS_LABEL[task.status]}</dd>
        <dt>能量</dt>
        <dd>{ENERGY_LABEL[task.energy]}</dd>
        <dt>重要性</dt>
        <dd>{task.importance} / 3</dd>
        <dt>上下文</dt>
        <dd>{task.contexts.map(tagLabel).join(' · ') || '—'}</dd>
        <dt>区域</dt>
        <dd>
          {task.areaId !== undefined ? (getAreaById(task.areaId)?.title ?? task.areaId) : '—'}
        </dd>
        <dt>项目</dt>
        <dd>
          {task.projectId !== undefined
            ? (getProjectById(task.projectId)?.title ?? task.projectId)
            : '—'}
        </dd>
        <dt>截止</dt>
        <dd>
          {task.dueAt !== undefined
            ? `${formatDateTime(task.dueAt)} · ${humanizeDay(task.dueAt)}`
            : '—'}
        </dd>
        <dt>预估</dt>
        <dd>{task.estimateMin !== undefined ? `${task.estimateMin} 分钟` : '—'}</dd>
        <dt>创建</dt>
        <dd>{formatRelative(task.createdAt)}</dd>
      </dl>
      {/* 标签区：主内容之后扫描 */}
      {task.tags.length > 0 && (
        <div className="k-detail-block">
          <span className="k-detail-block__label u-label">标签</span>
          <div className="k-hstack">
            {task.tags.map((tag) => (
              <TagPill key={tag}>{tagLabel(tag)}</TagPill>
            ))}
          </div>
        </div>
      )}
      <Relations kind="task" id={task.id} />
    </div>
  )
}
