// KERNEL · 设置 SETTINGS（P2）：主题 / 数据统计 / AI 状态 / 关于 / 原型态说明
import { useState } from 'react'
import { Panel } from '@/components/Panel'
import { useTheme } from '@/context/ThemeContext'
import { useToast } from '@/context/ToastContext'
import { getSnapshot } from '@/lib/data'
import { getDataRecordCount } from '@/lib/derive'
import { resetProto } from '@/lib/proto'

const PHILOSOPHY: Array<{ n: string; text: string }> = [
  { n: '01', text: '文件即数据库，opencode 即大脑，网页即驾驶舱。' },
  { n: '02', text: '身份与领域是交叉筛选标签，不是目录分区。' },
  { n: '03', text: '一切分类有界，迁移即重决策，每个存量都有排泄口。' },
  { n: '04', text: '周回顾是心跳：短、可视、可自动化。' },
]

export function Settings() {
  const { theme, setTheme } = useTheme()
  const { toast } = useToast()
  const [protoCleared, setProtoCleared] = useState(false)
  const snapshot = getSnapshot()
  const total = getDataRecordCount(snapshot)

  const rows: Array<{ label: string; value: number }> = [
    { label: '收件箱 INBOX', value: snapshot.inbox.length },
    { label: '任务 TASKS', value: snapshot.tasks.length },
    { label: '项目 PROJECTS', value: snapshot.projects.length },
    { label: '区域 AREAS', value: snapshot.areas.length },
    { label: '目标 GOALS', value: snapshot.goals.length },
    { label: '习惯 HABITS', value: snapshot.habits.length },
    { label: '事件 EVENTS', value: snapshot.events.length },
    { label: '笔记 NOTES', value: snapshot.notes.length },
    { label: '资料 RESOURCES', value: snapshot.resources.length },
    { label: '回顾 REVIEWS', value: snapshot.reviews.length },
  ]

  const handleReset = (): void => {
    resetProto()
    setProtoCleared(true)
    toast('原型态：本地覆盖数据已清除')
  }

  return (
    <div className="k-view">
      <div className="k-settings__grid">
        <Panel index="01" title="主题" en="THEME">
          <div className="k-view__actions">
            <button
              type="button"
              className={theme === 'light' ? 'k-btn is-solid' : 'k-btn'}
              onClick={() => setTheme('light')}
              aria-pressed={theme === 'light'}
            >
              亮 · LIGHT
            </button>
            <button
              type="button"
              className={theme === 'dark' ? 'k-btn is-solid' : 'k-btn'}
              onClick={() => setTheme('dark')}
              aria-pressed={theme === 'dark'}
            >
              暗 · DARK
            </button>
          </div>
          <p className="k-view__intro">
            默认「柔暗夜色」，可切换亮色；选择后写入 localStorage（键 <code>kernel-theme</code>），首帧前生效以防闪烁。
          </p>
        </Panel>

        <Panel index="02" title="AI 集成" en="OPENCODE">
          <div className="k-between">
            <span className="k-panel__cn">状态 · OFFLINE</span>
            <span className="k-pill is-accent">待接入 v0.5</span>
          </div>
          <p className="k-view__intro">
            计划链路：网页 → 本地 Node 服务（唯一写者）→ <code>opencode serve</code>（仅 127.0.0.1:4096）→
            结果写回 <code>data/</code> 并经 SSE 推进度。详见 <code>docs/02-ARCHITECTURE.md §6.3</code>。
          </p>
          <p className="k-view__intro">
            v0.3 仅做 UI 预留（AI 建议卡、命令面板入口）；opencode 永不直接暴露到局域网。
          </p>
        </Panel>

        <Panel
          index="03"
          title="数据统计"
          en="DATA"
          actions={<span className="u-label k-muted">{total} 条记录</span>}
        >
          <table className="k-table">
            <thead>
              <tr>
                <th>实体</th>
                <th>数量</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td className="k-mono">{row.value}</td>
                </tr>
              ))}
              <tr>
                <td>合计 TOTAL</td>
                <td className="k-mono k-accent">{total}</td>
              </tr>
            </tbody>
          </table>
          <p className="k-view__intro">
            合计 = 10 类实体记录 {total - 2} 条 + 配置 1 + 标签注册表 1；均为文件式 JSON（一记录一文件）。
          </p>
        </Panel>

        <Panel index="04" title="关于 KERNEL" en="ABOUT">
          <div className="k-philosophy">
            {PHILOSOPHY.map((line) => (
              <p className="k-philosophy__line" key={line.n}>
                <span className="k-philosophy__n">{line.n}</span>
                {line.text}
              </p>
            ))}
          </div>
          <dl className="k-dl">
            <dt>版本</dt>
            <dd className="k-mono">v0.3.0</dd>
            <dt>内核隐喻</dt>
            <dd>进程 = 任务/项目 · 内存 = 资料/知识 · I/O = 收件箱 · 调度器 = 日程 · 检索 = 命令面板 · GC = 回顾</dd>
            <dt>数据版本</dt>
            <dd className="k-mono">{snapshot.config.version}</dd>
            <dt>所有者</dt>
            <dd>{snapshot.config.owner}</dd>
          </dl>
        </Panel>
      </div>

      <Panel index="05" title="原型态说明" en="PROTOTYPE">
        <div className="k-proto-note">
          <p className="k-view__intro">
            v0.3 是前端高保真原型：数据只读自 <code>data/</code>，用户操作写入 localStorage 覆盖层，界面标注「原型态」。
          </p>
          <dl className="k-proto-list">
            <div className="k-proto-list__row">
              <dt>任务完成</dt>
              <dd>真实可用：写入 <code>kernel:proto:done</code>，总览 / 任务 / 抽屉同步反映。</dd>
            </div>
            <div className="k-proto-list__row">
              <dt>收件箱捕捉</dt>
              <dd>真实可用：写入 <code>kernel:proto:inbox</code>；澄清动作仅演示并提示。</dd>
            </div>
            <div className="k-proto-list__row">
              <dt>快速新建任务</dt>
              <dd>真实可用：写入 <code>kernel:proto:tasks</code>。</dd>
            </div>
            <div className="k-proto-list__row">
              <dt>澄清 / 迁移 / 归档</dt>
              <dd>演示动作 + 提示，v0.4 起持久化写入 <code>data/</code>。</dd>
            </div>
            <div className="k-proto-list__row">
              <dt>AI 能力</dt>
              <dd>占位，v0.5 接入 opencode。</dd>
            </div>
          </dl>
          <div className="k-view__actions">
            <button type="button" className="k-btn" onClick={handleReset} disabled={protoCleared}>
              {protoCleared ? '已清除本地覆盖' : '清除原型态本地数据'}
            </button>
          </div>
        </div>
      </Panel>
    </div>
  )
}
