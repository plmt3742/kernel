// KERNEL · 全局顶栏（GitHub 式：品牌 / 搜索 / 新建 / 收件箱 / AI / 主题 / 头像）
import { Link } from 'react-router-dom'
import { Inbox, LayoutGrid, Moon, Plus, Search, Sun } from 'lucide-react'
import { clsx } from 'clsx'
import { useTheme } from '@/context/ThemeContext'
import { getConfig, getInboxCount, profileAvatarUrl, profileMonogram } from '@/lib/data'
import { useAiHealth, useDataRevision } from '@/lib/hooks'

interface AppHeaderProps {
  onOpenMenu: () => void
  onOpenPalette: () => void
}

function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  return /Mac|iPhone|iPad|iPod/.test(navigator.platform)
}

export function AppHeader({ onOpenMenu, onOpenPalette }: AppHeaderProps) {
  const { theme, toggle } = useTheme()
  useDataRevision()
  const ai = useAiHealth()
  const config = getConfig()
  const avatarUrl = profileAvatarUrl(config.avatarPath)
  const inbox = getInboxCount()
  const mac = isMacPlatform()
  const aiLabel = ai.status === 'online' ? 'AI 在线' : ai.status === 'offline' ? 'AI 离线' : 'AI'

  return (
    <header className="gh-header">
      <button
        type="button"
        className="gh-header__menu"
        onClick={onOpenMenu}
        aria-label="返回开始菜单"
        title="返回开始菜单"
      >
        <LayoutGrid size={18} strokeWidth={1.8} aria-hidden />
      </button>

      <Link to="/" className="gh-brand" aria-label="KERNEL 总览">
        <span className="gh-brand__mark" aria-hidden>
          K
        </span>
        <span className="gh-brand__name">KERNEL</span>
      </Link>

      <button
        type="button"
        className="gh-search"
        onClick={onOpenPalette}
        aria-label="搜索或跳转"
      >
        <Search size={15} strokeWidth={1.8} aria-hidden />
        <span className="gh-search__text">搜索或跳转…</span>
        <kbd className="gh-kbd">{mac ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <div className="gh-header__spacer" />

      <div className="gh-header__actions">
        <button
          type="button"
          className="gh-iconbtn gh-new"
          onClick={onOpenPalette}
          aria-label="新建 / 命令"
          title="新建 / 命令"
        >
          <Plus size={17} strokeWidth={1.8} aria-hidden />
        </button>

        <Link
          to="/inbox"
          className="gh-iconbtn gh-inbox"
          aria-label={`收件箱，${inbox} 条待澄清`}
          title="收件箱"
        >
          <Inbox size={17} strokeWidth={1.8} aria-hidden />
          {inbox > 0 && <span className="gh-count">{inbox > 99 ? '99+' : inbox}</span>}
        </Link>

        <span
          className={clsx(
            'gh-ai',
            ai.status === 'online' && 'is-online',
            ai.status === 'offline' && 'is-offline',
          )}
          title={ai.model !== null ? `AI 在线 · ${ai.model}` : 'AI 状态由本机 opencode 决定'}
        >
          <i aria-hidden />
          <span>{aiLabel}</span>
        </span>

        <button
          type="button"
          className="gh-iconbtn"
          onClick={toggle}
          aria-label={theme === 'dark' ? '切换到亮色主题' : '切换到暗色主题'}
          title={theme === 'dark' ? '亮色' : '暗色'}
        >
          {theme === 'dark' ? <Sun size={17} strokeWidth={1.8} aria-hidden /> : <Moon size={17} strokeWidth={1.8} aria-hidden />}
        </button>

        <Link to="/profile" className="gh-avatar" aria-label="个人页" title="个人页">
          {avatarUrl !== null ? (
            <img src={avatarUrl} alt="" />
          ) : (
            <span aria-hidden>{profileMonogram(config.owner)}</span>
          )}
        </Link>
      </div>
    </header>
  )
}
