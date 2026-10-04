// KERNEL · 关联区块（抽屉内）：把实体的出链 + 入链渲染为安静的可点击芯片。
// 设计：复用 TagPill 芯片语言，仅 token；空关联不渲染；键盘可达（真实按钮）。
import { useNavigate } from 'react-router-dom'
import { TagPill } from '@/components/TagPill'
import { getRelations, type RefKind, type RelationKind } from '@/lib/relations'

/** 关联目标 → 路由；区域 / 目标无独立页面，深链到设置页对应分区并打开其编辑弹窗（Slice X · F8） */
const PATH_OF: Partial<Record<RefKind, (id: string) => string>> = {
  task: (id) => `/tasks?task=${id}`,
  project: (id) => `/projects?project=${id}`,
  note: (id) => `/library?note=${id}`,
  resource: (id) => `/library?resource=${id}`,
  event: (id) => `/calendar?event=${id}`,
  area: (id) => `/settings?section=areas&area=${id}`,
  goal: (id) => `/settings?section=goals&goal=${id}`,
  inbox: () => '/inbox',
}

interface RelationsProps {
  kind: RelationKind
  id: string
}

export function Relations({ kind, id }: RelationsProps) {
  const navigate = useNavigate()
  const { outbound, inbound } = getRelations(kind, id)
  const refs = [...outbound, ...inbound]

  if (refs.length === 0) return null

  return (
    <div className="k-detail-block k-relations">
      <span className="k-detail-block__label u-label">关联</span>
      <div className="k-hstack">
        {refs.map((item) => {
          const path = PATH_OF[item.kind]
          const key = `${item.kind}-${item.id}-${item.label}`
          // Slice N4：芯片 body 只留「标签 + 标题」——实体冷编号（i-0001 / t-0001）移入 tooltip，
          // 不再可见；标题温和 clamp（≤3 行）由 .k-relations__title 兜底，防超长标题撑版。
          const body = (
            <>
              <span className="k-muted">{item.label}</span>
              <span className="k-relations__title">{item.title}</span>
            </>
          )
          const title = `${item.label} · ${item.title} · ${item.id}`
          return path !== undefined ? (
            <TagPill
              key={key}
              title={title}
              onClick={() => navigate(path(item.id), { viewTransition: true })}
            >
              {body}
            </TagPill>
          ) : (
            <TagPill key={key} title={title}>
              {body}
            </TagPill>
          )
        })}
      </div>
    </div>
  )
}
