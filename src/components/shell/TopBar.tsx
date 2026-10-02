// KERNEL · TopBar（章节索引 + 大标题，瑞士式；右侧命令入口 + 主题切换）
import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Command, Moon, Sun } from 'lucide-react'
import { navByPath } from '@/lib/nav'
import { useTheme } from '@/context/ThemeContext'

interface TopBarProps {
  onOpenPalette: () => void
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

export function TopBar({ onOpenPalette }: TopBarProps) {
  const location = useLocation()
  const { theme, toggle } = useTheme()
  const [isMac] = useState(isMacPlatform)
  const nav = navByPath(location.pathname)

  return (
    <header className="k-topbar">
      <div className="k-topbar__inner">
        <div className="k-topbar__id">
          <h1 className="k-topbar__title">{nav?.cn ?? '未找到'}</h1>
          <span className="k-topbar__en u-label">{nav?.en ?? 'NOT FOUND'}</span>
        </div>
        <div className="k-topbar__tools">
          <button type="button" className="k-btn" onClick={onOpenPalette} aria-label="打开命令面板">
            <Command size={15} strokeWidth={1.5} aria-hidden />
            <span className="u-label">命令</span>
            <kbd className="k-kbd">{isMac ? '⌘K' : 'Ctrl K'}</kbd>
          </button>
          <button
            type="button"
            className="k-iconbtn"
            onClick={toggle}
            aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
            title={theme === 'dark' ? '亮色' : '暗色'}
          >
            {theme === 'dark' ? (
              <Sun size={16} strokeWidth={1.5} aria-hidden />
            ) : (
              <Moon size={16} strokeWidth={1.5} aria-hidden />
            )}
          </button>
        </div>
      </div>
    </header>
  )
}
