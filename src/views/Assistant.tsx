// KERNEL · 助手独立页（读库 / 联网 / 确认后写入；上下文侧栏）
import { Link } from 'react-router-dom'
import { OverviewChat } from '@/components/OverviewChat'
import { getInboxCount, getNotes, getResources, getTasks, getTodayEvents, getTraces } from '@/lib/data'
import { useAiHealth, useDataRevision } from '@/lib/hooks'

export function Assistant() {
  useDataRevision()
  const ai = useAiHealth()
  const openTasks = getTasks().filter((task) => task.status !== 'done' && task.status !== 'dropped').length
  const knowledge = getNotes().length + getResources().length
  const today = getTodayEvents().length
  const traces = getTraces().length

  return (
    <div className="gh-page gh-assistant">
      <div className="gh-detail-grid">
        <div className="gh-detail-main">
          <section className="gh-card">
            <div className="gh-card__head">
              <span>对话</span>
              <span className="gh-card__muted">
                {ai.status === 'online' ? '在线 · 先看再改' : ai.status === 'offline' ? '离线' : '检查中'}
              </span>
            </div>
            <div className="gh-card__body">
              <OverviewChat />
            </div>
          </section>
        </div>

        <aside className="gh-detail-side" aria-label="助手上下文">
          <section className="gh-card">
            <div className="gh-card__head">它能看到什么</div>
            <div className="gh-status-list">
              <Link to="/tasks" className="gh-status-row">
                <span>未完成任务</span>
                <b>{openTasks}</b>
              </Link>
              <Link to="/library" className="gh-status-row">
                <span>笔记与资料</span>
                <b>{knowledge}</b>
              </Link>
              <Link to="/calendar" className="gh-status-row">
                <span>今日日程</span>
                <b>{today}</b>
              </Link>
              <Link to="/traces" className="gh-status-row">
                <span>踪迹记录</span>
                <b>{traces}</b>
              </Link>
              <Link to="/inbox" className="gh-status-row">
                <span>待澄清</span>
                <b>{getInboxCount()}</b>
              </Link>
            </div>
          </section>

          <section className="gh-card">
            <div className="gh-card__head">它怎么处理</div>
            <div className="gh-about">
              <div className="gh-about__row">
                <span>读取</span>
                <b>不改原文</b>
              </div>
              <div className="gh-about__row">
                <span>回答</span>
                <b>回答会说明依据</b>
              </div>
              <div className="gh-about__row">
                <span>写入</span>
                <b>先问你</b>
              </div>
            </div>
          </section>

          <section className="gh-card">
            <div className="gh-card__head">模型</div>
            <div className="gh-about">
              <div className="gh-about__row">
                <span>通道</span>
                <b>本机 opencode</b>
              </div>
              <div className="gh-about__row">
                <span>模型</span>
                <b>{ai.model ?? 'deepseek-flash'}</b>
              </div>
              <div className="gh-about__row">
                <span>联网</span>
                <b>需要时才检索</b>
              </div>
              <div className="gh-about__row">
                <span>会话</span>
                <b>只在这台电脑上</b>
              </div>
            </div>
          </section>

          <p className="gh-empty gh-empty--inset">
            <span>需要保存时，它会先把结果给你看；你点确认，它才写入。</span>
          </p>
        </aside>
      </div>
    </div>
  )
}
