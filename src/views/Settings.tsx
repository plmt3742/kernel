// KERNEL · 设置 SETTINGS（P2）：左分类导航 + 右单区面板
// 结构取自设计稿 v2 · settings-b「侧导航」：导航决定右面板渲染的唯一分区，默认「外观」。
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Panel } from '@/components/Panel'
import { TagManager } from '@/components/TagManager'
import { AreaManager, GoalManager } from '@/components/DimensionManagers'
import { AiActivityFeed } from '@/components/AiActivityFeed'
import { useTheme } from '@/context/ThemeContext'
import { useToast } from '@/context/ToastContext'
import { getConfig, getSnapshot } from '@/lib/data'
import { getDataRecordCount } from '@/lib/derive'
import { useAiHealth, useDataRevision, useDataSource } from '@/lib/hooks'
import { setAiKey, updateAiAutomation } from '@/lib/mutations'
import { api, errorText } from '@/lib/api'
import { formatTime } from '@/lib/date'
import type { AiAutomation } from '@/types'

interface ActivityEntry {
  ts: string
  action: string
  entity: string
  id: string
}

/** 设置分类：左导航与右面板共用同一组 id，保证单区渲染 */
type SectionId =
  | 'appearance'
  | 'ai'
  | 'automation'
  | 'tags'
  | 'areas'
  | 'goals'
  | 'data'
  | 'service'
  | 'about'

const SECTIONS: Array<{ id: SectionId; cn: string; en: string }> = [
  { id: 'appearance', cn: '外观', en: 'APPEARANCE' },
  { id: 'ai', cn: 'AI 集成', en: 'OPENCODE' },
  { id: 'automation', cn: 'AI 自动化', en: 'AUTOMATION' },
  { id: 'tags', cn: '标签管理', en: 'TAGS' },
  { id: 'areas', cn: '区域', en: 'AREAS' },
  { id: 'goals', cn: '目标', en: 'GOALS' },
  { id: 'data', cn: '数据统计', en: 'DATA' },
  { id: 'service', cn: '数据服务', en: 'SERVICE' },
  { id: 'about', cn: '关于', en: 'ABOUT' },
]

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
  const ai = useAiHealth()
  const { toast } = useToast()
  // 深链（Slice X）：?section=areas|goals 直达分区；?area=/?goal= 打开对应编辑弹窗
  // （习惯已迁出为独立页 /habits，?section=habits / ?habit= 不再由设置页处理）
  const [searchParams] = useSearchParams()
  const [section, setSection] = useState<SectionId>(() => {
    const raw = searchParams.get('section')
    return raw !== null && SECTIONS.some((item) => item.id === raw) ? (raw as SectionId) : 'appearance'
  })
  const focusArea = searchParams.get('area') ?? undefined
  const focusGoal = searchParams.get('goal') ?? undefined
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const config = getConfig()
  // AI 自动化档位（Slice R2）：旧配置缺省视作确认模式（先确认后写入）
  const automation: AiAutomation = config.aiAutomation ?? 'confirm'
  const setAutomation = (level: AiAutomation): void => {
    if (automation === level) return
    void (async () => {
      try {
        await updateAiAutomation(level)
        toast(level === 'auto' ? '已切换到自动模式' : '已切换到确认模式')
      } catch (err) {
        toast(`切换失败：${errorText(err)}`, { tone: 'error' })
      }
    })()
  }
  // DeepSeek API Key（Slice N5）：输入框始终为空，绝不回显已存 key；保存成功后清空并刷新 health
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  // 本地即时覆盖（保存 / 清除响应返回 hasKey）：先给 pill 即时反馈，health 刷新回来后归位
  const [keyOverride, setKeyOverride] = useState<boolean | null>(null)
  const keyConfigured = keyOverride ?? ai.hasKey
  // health 的 hasKey 一到（轮询 / 手动刷新）即清除本地覆盖，避免覆盖掩盖服务端真值
  useEffect(() => {
    setKeyOverride(null)
  }, [ai.hasKey])

  const saveKey = (): void => {
    const value = keyDraft.trim()
    if (value === '' || keyBusy) return
    setKeyBusy(true)
    void (async () => {
      try {
        setKeyOverride(await setAiKey(value))
        setKeyDraft('')
        ai.refresh()
        toast('已保存 API Key')
      } catch (err) {
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setKeyBusy(false)
      }
    })()
  }

  const clearKey = (): void => {
    if (keyBusy) return
    setKeyBusy(true)
    void (async () => {
      try {
        setKeyOverride(await setAiKey(''))
        ai.refresh()
        toast('已清除')
      } catch (err) {
        toast(`清除失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setKeyBusy(false)
      }
    })()
  }

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
      <p className="k-view__intro">
        按分类浏览设置：外观、AI 集成、AI 自动化、标签管理、区域、目标、数据统计、数据服务、关于。左侧选中分类决定右侧面板内容。
      </p>

      <div className="k-settings__grid">
        {/* 左分类导航：按钮原生可获得焦点 / 回车触发；aria-current 标记当前分区 */}
        <nav className="k-settings__nav" aria-label="设置分类">
          {SECTIONS.map((item) => {
            const active = section === item.id
            return (
              <button
                type="button"
                key={item.id}
                className={active ? 'k-settings__nav-item is-active' : 'k-settings__nav-item'}
                aria-current={active ? 'true' : undefined}
                onClick={() => setSection(item.id)}
              >
                <b>{item.cn}</b>
                <span>{item.en}</span>
              </button>
            )
          })}
        </nav>

        {/* 右内容面板：仅渲染当前选中分区 */}
        <div className="k-settings__content">
          {section === 'appearance' && (
            <Panel
              title="主题"
              en="THEME"
              actions={<span className="k-pill">当前 · {theme === 'dark' ? '暗' : '亮'}</span>}
            >
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
          )}

          {section === 'ai' && (
            <Panel title="AI 集成" en="OPENCODE">
              <div className="k-between">
                <span className="k-panel__cn">
                  {ai.status === 'online'
                    ? '状态 · ONLINE'
                    : ai.status === 'offline'
                      ? '状态 · OFFLINE'
                      : '状态 · 连接中'}
                </span>
                <span
                  className={[
                    'k-svc-pill',
                    ai.status === 'online' ? 'is-ok' : '',
                    ai.status === 'offline' ? 'is-off' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {ai.status === 'online'
                    ? `127.0.0.1:4096 · ${ai.model ?? 'opencode'}`
                    : ai.status === 'offline'
                      ? 'opencode 未启动'
                      : '检测中'}
                </span>
              </div>
              <p className="k-view__intro">
                AI 已接入（收件箱 AI 解析；经本地 <code>opencode serve</code>，仅 127.0.0.1:4096；模型走
                opencode 默认配置；AI 只出建议、确认后才写入；opencode 永不暴露局域网）。
              </p>
              {ai.status === 'offline' && (
                <p className="k-view__intro k-muted">
                  opencode 服务离线：<code>npm run dev</code> 会自动拉起 opencode serve，或手动{' '}
                  <code>opencode serve --port 4096</code>。
                </p>
              )}

              <div className="k-settings__divider" aria-hidden />

              {/* DeepSeek API Key（Slice N5）：与 opencode 在线状态独立；仅本机保存，绝不回显 */}
              <div className="k-between">
                <span className="k-panel__cn">DeepSeek API Key</span>
                <span
                  className={['k-svc-pill', keyConfigured ? 'is-ok' : ''].filter(Boolean).join(' ')}
                >
                  {keyConfigured ? '已配置' : '未配置'}
                </span>
              </div>
              <div className="k-field">
                <input
                  type="password"
                  className="k-input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="sk-…（粘贴后点保存）"
                  aria-label="DeepSeek API Key"
                  value={keyDraft}
                  disabled={keyBusy}
                  onChange={(event) => setKeyDraft(event.target.value)}
                />
                <div className="k-view__actions">
                  <button
                    type="button"
                    className="k-btn is-solid"
                    onClick={saveKey}
                    disabled={keyBusy || keyDraft.trim() === ''}
                  >
                    {keyBusy ? '处理中…' : '保存'}
                  </button>
                  {keyConfigured && (
                    <button
                      type="button"
                      className="k-btn is-danger"
                      onClick={clearKey}
                      disabled={keyBusy}
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>
              <p className="k-view__intro k-muted">
                仅保存在本机 <code>data/meta/secrets.json</code>，不会进入仓库；由启动器注入 opencode（
                <b>重启 opencode 后生效</b>）；不填则沿用系统环境变量 / opencode 自身登录。
              </p>
            </Panel>
          )}

          {section === 'automation' && (
            <Panel
              title="AI 自动化"
              en="AUTOMATION"
              actions={
                <span className="k-pill">{automation === 'auto' ? '自动模式' : '确认模式'}</span>
              }
            >
              <div className="k-automation" role="radiogroup" aria-label="AI 自动化档位">
                <button
                  type="button"
                  role="radio"
                  aria-checked={automation === 'confirm'}
                  className={automation === 'confirm' ? 'k-automation__opt is-active' : 'k-automation__opt'}
                  onClick={() => setAutomation('confirm')}
                >
                  <span className="k-automation__label">确认模式（默认）</span>
                  <span className="k-automation__desc">
                    AI 解析后只出建议；你点「应用」才写入。最稳妥，适合不放心自动落盘时。
                  </span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={automation === 'auto'}
                  className={automation === 'auto' ? 'k-automation__opt is-active' : 'k-automation__opt'}
                  onClick={() => setAutomation('auto')}
                >
                  <span className="k-automation__label">自动模式</span>
                  <span className="k-automation__desc">
                    捕捉后 AI 自动整理低风险内容（建任务 / 笔记 / 资料、打标签、归入项目），每条带「撤销」。绝不删除 /
                    完成 / 归档任何东西。
                  </span>
                </button>
              </div>
              <p className="k-view__intro">
                默认「确认模式」（先确认后写入）；「自动模式」需显式开启，仅自动执行创建类低风险动作，可随时撤销或切回确认模式。
              </p>
              <div className="k-settings__divider" aria-hidden />
              <div className="k-between">
                <span className="k-panel__cn">AI 动态</span>
                <span className="u-label k-muted">AI 幕后动作记录 · 最近 50 条</span>
              </div>
              <AiActivityFeed />
            </Panel>
          )}

          {section === 'tags' && <TagManager />}

          {section === 'areas' && <AreaManager focusId={focusArea} />}

          {section === 'goals' && <GoalManager focusId={focusGoal} />}

          {section === 'data' && (
            <Panel
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
          )}

          {section === 'service' && (
            <Panel title="数据服务" en="DATA SERVICE">
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
                  <p className="k-settings__empty">暂无活动记录</p>
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
          )}

          {section === 'about' && (
            <Panel title="关于 KERNEL" en="ABOUT">
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
                <dd className="k-mono">v0.5.0</dd>
                <dt>内核隐喻</dt>
                <dd>进程 = 任务/项目 · 内存 = 资料/知识 · I/O = 收件箱 · 调度器 = 日程 · 检索 = 命令面板 · GC = 回顾</dd>
                <dt>数据版本</dt>
                <dd className="k-mono">{snapshot.config.version}</dd>
                <dt>所有者</dt>
                <dd>{snapshot.config.owner}</dd>
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </div>
  )
}
