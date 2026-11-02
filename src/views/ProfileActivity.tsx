// KERNEL · 个人 · 动作时间线（独立页；只读审计）
import { PageHeader } from '@/components/shell/PageHeader'
import { ActivityTimeline } from '@/components/ActivityTimeline'
import { getDataRecordCount } from '@/lib/derive'
import { getSnapshot } from '@/lib/data'

export function ProfileActivity() {
  return (
    <div className="gh-page">
      <PageHeader
        breadcrumb={[
          { label: 'KERNEL', to: '/' },
          { label: '个人', to: '/profile' },
          { label: '动作时间线' },
        ]}
        title="动作时间线"
        description="这里是你做过的操作：新增、完成、打卡、删除和恢复。只读，不能编辑。"
        meta={
          <>
            <b>{getDataRecordCount(getSnapshot())} 条记录</b>
            <span>仅本机</span>
          </>
        }
      />
      <section className="gh-card">
        <div className="gh-card__head">全部动作</div>
        <div className="gh-card__body">
          <ActivityTimeline plain />
        </div>
      </section>
    </div>
  )
}
