// KERNEL · 设置 SETTINGS（P2）：主题 / 数据服务 / 数据统计 / AI 状态 / 关于
import { useEffect, useState } from 'react'
import { Panel } from '@/components/Panel'
import { useTheme } from '@/context/ThemeContext'
import { getSnapshot } from '@/lib/data'
import { getDataRecordCount } from '@/lib/derive'
import { useDataRevision, useDataSource } from '@/lib/hooks'
import { api } from '@/lib/api'
import { formatTime } from '@/lib/date'

interface ActivityEntry {
  ts: string
  action: string
  entity: string
  id: string
}

const PHILOSOPHY: Array<{ n: string; text: string }> = [
  { n: '01', text: '文件即数据库，opencode 即大脑，网页即驾驶舱。' },
  { n: '02', text: '身份与领域是交叉筛选标签，不是目录分区。' },
  { n: '03', text: '一切分类有界，迁移即重决策，每个存量都有排泄口。' },
  { n: '04', text: '周回顾是心跳：短、可视、可自动化。' },
]

export function Settings() {
  useDataRevision()
  const { theme, setTheme } = useTheme()
  const source = useDataSource()
  const [activity, setActivity] = useState<ActivityEntry[]>([])
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

  // 最近活动（审计日志尾部；仅在线时拉取）
  useEffect(() => {
    if (source !== 'server') {
      setActivity([])
      return
    }
    let cancelled = false
    api
      .get<{ items: ActivityEntry[] }>('/api/activity?limit=8')
      .then((res) => {
        if (!cancelled) setActivity(res.items)
      })
      .catch(() => {
        if (!cancelled) setActivity([])
      })
    return () => {
      cancelled = true
    }
  }, [source])

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
            结果写回 <code>data/</code> 并经 SSE 推进度。详见 <code>docs/02-ARCHITECTURE.md</code>。
          </p>
          <p className="k-view__intro">
            v0.4 数据服务已就位；AI 仍为 UI 预留（AI 建议卡、命令面板入口），v0.5 接入。opencode 永不直接暴露到局域网。
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
            <dd className="k-mono">v0.4.0</dd>
            <dt>内核隐喻</dt>
            <dd>进程 = 任务/项目 · 内存 = 资料/知识 · I/O = 收件箱 · 调度器 = 日程 · 检索 = 命令面板 · GC = 回顾</dd>
            <dt>数据版本</dt>
            <dd className="k-mono">{snapshot.config.version}</dd>
            <dt>所有者</dt>
            <dd>{snapshot.config.owner}</dd>
          </dl>
        </Panel>
      </div>

      <Panel index="05" title="数据服务" en="DATA SERVICE">
        <div className="k-between">
          <span className="k-panel__cn">
            {source === 'server' ? '状态 · ONLINE' : source === 'offline' ? '状态 · OFFLINE' : '状态 · 连接中'}
          </span>
          <span
            className={[
              'k-svc-pill',
              source === 'server' ? 'is-ok' : '',
              source === 'offline' ? 'is-off' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            127.0.0.1:4097
          </span>
        </div>
        <p className="k-view__intro">
          v0.4 起所有写入（完成 / 捕捉 / 澄清 / 快速新建）经本地 Node 数据服务（唯一写者）：
          Zod 校验 + 原子写入 + 审计日志 <code>data/activity.jsonl</code>。服务仅监听 127.0.0.1，永不暴露局域网。
        </p>
        {source === 'server' ? (
          activity.length === 0 ? (
            <p className="k-muted">暂无活动记录。</p>
          ) : (
            <div className="k-activity">
              {activity.map((entry) => (
                <div className="k-activity__row" key={`${entry.ts}-${entry.action}-${entry.id}`}>
                  <span className="k-mono k-muted">{formatTime(entry.ts)}</span>
                  <span className="k-mono">{entry.action}</span>
                  <span className="k-mono k-muted">{entry.id}</span>
                </div>
              ))}
            </div>
          )
        ) : (
          <p className="k-view__intro k-muted">
            数据服务离线：界面以只读方式浏览，写入操作会收到失败提示。启动方式：<code>npm run dev</code>。
          </p>
        )}
      </Panel>
    </div>
  )
}
