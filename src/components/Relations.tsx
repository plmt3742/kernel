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
          const body = (
            <>
              <span className="k-muted">{item.label}</span>
              <span>{item.title}</span>
              <span className="k-mono k-muted">{item.id}</span>
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
