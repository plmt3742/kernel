// KERNEL · TaskRow（完成动效：划线 + 塌缩；完成/待办由调用方决定过滤）
import { AlertTriangle } from 'lucide-react'
import { clsx } from 'clsx'
import type { Task } from '@/types'
import { Checkbox } from '@/components/Checkbox'
import { TagPill } from '@/components/TagPill'
import { ENERGY_LABEL } from '@/lib/format'
import { humanizeDay, isPast } from '@/lib/date'

interface TaskRowProps {
  task: Task
  done: boolean
  onToggle: (id: string) => void
  onOpen: (id: string) => void
  why?: string[]
}

export function TaskRow({ task, done, onToggle, onOpen, why }: TaskRowProps) {
  const overdue = task.dueAt !== undefined && !done && isPast(task.dueAt)
  return (
    <div className={clsx('k-task', done && 'is-done')}>
      <Checkbox checked={done} onToggle={() => onToggle(task.id)} label={`完成：${task.title}`} />
      <button
        type="button"
        className="k-task__open"
        onClick={() => onOpen(task.id)}
        aria-label={`查看任务：${task.title}`}
      >
        <span className="k-task__titlewrap">
          <span className="k-task__title">{task.title}</span>
          <span className="k-task__strike" aria-hidden />
        </span>
        <span className="k-task__meta">
          {task.contexts.map((context) => (
            <TagPill key={context} ghost>
              {context}
            </TagPill>
          ))}
          <span className="k-task__energy">{ENERGY_LABEL[task.energy]}能</span>
          {task.dueAt !== undefined && (
            <span className={clsx('k-task__due', overdue && 'is-overdue')}>
              {overdue && <AlertTriangle size={11} strokeWidth={1.5} aria-hidden />}
              {overdue ? '逾期 ' : '截止 '}
              {humanizeDay(task.dueAt)}
            </span>
          )}
          {why !== undefined && why.length > 0 && (
            <span className="k-task__why">
              {why.map((label) => (
                <TagPill key={label} ghost>
                  {label}
                </TagPill>
              ))}
            </span>
          )}
        </span>
      </button>
    </div>
  )
}
