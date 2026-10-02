// KERNEL · 404
import { Link } from 'react-router-dom'
import { EmptyState } from '@/components/EmptyState'

export function NotFound() {
  return (
    <div className="k-view">
      <EmptyState
        index="404"
        title="未找到该视图"
        hint="KERNEL 的一级导航只有 8 个通用循环视图：总览 / 收件箱 / 任务 / 日程 / 项目 / 资料 / 回顾 / 设置。"
        action={
          <Link to="/" viewTransition className="k-btn">
            返回总览
          </Link>
        }
      />
    </div>
  )
}
