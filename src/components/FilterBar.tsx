// KERNEL · FilterBar（横向 chip 组；"全部"重置；选中反转）
import { TagPill } from '@/components/TagPill'

export interface FilterChip {
  value: string
  label: string
}

export interface FilterGroup {
  key: string
  label: string
  chips: FilterChip[]
}

interface FilterBarProps {
  groups: FilterGroup[]
  selected: Record<string, string>
  onSelect: (key: string, value: string) => void
}

export function FilterBar({ groups, selected, onSelect }: FilterBarProps) {
  return (
    <div className="k-filterbar">
      {groups.map((group) => {
        const current = selected[group.key] ?? ''
        return (
          <div className="k-filterrow" key={group.key}>
            <span className="k-filterrow__label u-label">{group.label}</span>
            <div className="k-filterrow__chips">
              <TagPill selected={current === ''} onClick={() => onSelect(group.key, '')}>
                全部
              </TagPill>
              {group.chips.map((chip) => (
                <TagPill
                  key={chip.value}
                  selected={current === chip.value}
                  onClick={() => onSelect(group.key, current === chip.value ? '' : chip.value)}
                >
                  {chip.label}
                </TagPill>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
