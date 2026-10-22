// KERNEL · 设置 SETTINGS（P2）：左分类导航 + 右单区面板
// 结构取自设计稿 v2 · settings-b「侧导航」：导航决定右面板渲染的唯一分区，默认「外观」。
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Panel } from '@/components/Panel'
import { Modal } from '@/components/Modal'
import { TagManager } from '@/components/TagManager'
import { AreaManager, GoalManager } from '@/components/DimensionManagers'
import { AiActivityFeed } from '@/components/AiActivityFeed'
import { isWorkspaceBlank } from '@/components/StartHereCard'
import { TrashPanel } from '@/views/Trash'
import { useTheme } from '@/context/ThemeContext'
import { useToast } from '@/context/ToastContext'
import { getConfig, getSnapshot } from '@/lib/data'
import { getDataRecordCount } from '@/lib/derive'
import { useAiHealth, useDataRevision, useDataSource } from '@/lib/hooks'
import {
  getNotifyStatus,
  hydrateFromServer,
  saveNotifyConfig,
  sendTestNotify,
  setAiKey,
  updateAiAutomation,
} from '@/lib/mutations'
import { api, errorText } from '@/lib/api'
import { formatTime } from '@/lib/date'
import type { AiAutomation, NotifyStatus } from '@/types'

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
  | 'notify'
  | 'tags'
  | 'areas'
  | 'goals'
  | 'data'
  | 'trash'
  | 'service'
  | 'about'

const SECTIONS: Array<{ id: SectionId; cn: string; en: string }> = [
  { id: 'appearance', cn: '外观', en: 'APPEARANCE' },
  { id: 'ai', cn: 'AI 集成', en: 'OPENCODE' },
  { id: 'automation', cn: 'AI 自动化', en: 'AUTOMATION' },
  { id: 'notify', cn: '通知', en: 'WECHAT' },
  { id: 'tags', cn: '标签管理', en: 'TAGS' },
  { id: 'areas', cn: '区域', en: 'AREAS' },
  { id: 'goals', cn: '目标', en: 'GOALS' },
  { id: 'data', cn: '数据统计', en: 'DATA' },
  { id: 'trash', cn: '回收站', en: 'TRASH' },
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

  const [notifyStatus, setNotifyStatus] = useState<NotifyStatus | null>(null)
  const [webhookDraft, setWebhookDraft] = useState('')
  const [inboundTokenDraft, setInboundTokenDraft] = useState('')
  const [digestTime, setDigestTime] = useState('08:00')
  const [dueMinutes, setDueMinutes] = useState('30')
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [testBusy, setTestBusy] = useState(false)

  const applyNotifyStatus = (status: NotifyStatus): void => {
    setNotifyStatus(status)
    setDigestTime(status.dailyDigestTime)
    setDueMinutes(String(status.dueReminderMinutes))
  }

  useEffect(() => {
    if (section !== 'notify') return
    let cancelled = false
    getNotifyStatus()
      .then((status) => {
        if (!cancelled) applyNotifyStatus(status)
      })
      .catch((err) => {
        if (!cancelled) toast(`读取通知状态失败：${errorText(err)}`, { tone: 'error' })
      })
    return () => {
      cancelled = true
    }
  }, [section])

  const saveNotify = (): void => {
    const minutes = Number(dueMinutes)
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) {
      toast('到期提醒需为 1–1440 分钟', { tone: 'error' })
      return
    }
    if (notifyBusy) return
    const input: {
      dailyDigestTime: string
      dueReminderMinutes: number
      webhookUrl?: string
      inboundToken?: string
    } = { dailyDigestTime: digestTime, dueReminderMinutes: minutes }
    const webhook = webhookDraft.trim()
    const token = inboundTokenDraft.trim()
    if (webhook !== '') input.webhookUrl = webhook
    if (token !== '') input.inboundToken = token
    setNotifyBusy(true)
    void (async () => {
      try {
        const result = await saveNotifyConfig(input)
        applyNotifyStatus(result.status)
        setWebhookDraft('')
        setInboundTokenDraft('')
        toast('通知配置已保存')
      } catch (err) {
        toast(`保存失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setNotifyBusy(false)
      }
    })()
  }

  const clearWebhook = (): void => {
    if (notifyBusy) return
    setNotifyBusy(true)
    void (async () => {
      try {
        const result = await saveNotifyConfig({ webhookUrl: '' })
        applyNotifyStatus(result.status)
        toast('已清除 webhook')
      } catch (err) {
        toast(`清除失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setNotifyBusy(false)
      }
    })()
  }

  const clearInboundToken = (): void => {
    if (notifyBusy) return
    setNotifyBusy(true)
    void (async () => {
      try {
        const result = await saveNotifyConfig({ inboundToken: '' })
        applyNotifyStatus(result.status)
        toast('已清除入站 token')
      } catch (err) {
        toast(`清除失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setNotifyBusy(false)
      }
    })()
  }

  const testNotify = (): void => {
    if (testBusy || notifyStatus?.configured !== true) return
    setTestBusy(true)
    void (async () => {
      try {
        await sendTestNotify()
        toast('测试推送已发送')
        applyNotifyStatus(await getNotifyStatus())
      } catch (err) {
        toast(`测试推送失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setTestBusy(false)
      }
    })()
  }

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

  // 示例数据 / 清空所有数据（ADR-0041 Phase 3）：维护脚本（seed / reset）经数据服务执行；
  // 成功后整体水合，使统计与各视图即时刷新。清空需显式勾选确认（见 Modal）。
  const [demoBusy, setDemoBusy] = useState(false)
  const [seedOpen, setSeedOpen] = useState(false)
  const [resetOpen, setResetOpen] = useState(false)
  const [resetAck, setResetAck] = useState(false)
  // 是否空工作区（运行时派生；载入示例数据仅空工作区可用）
  const workspaceBlank = isWorkspaceBlank()

  const closeSeed = (): void => {
    if (demoBusy) return
    setSeedOpen(false)
  }

  const closeReset = (): void => {
    if (demoBusy) return
    setResetOpen(false)
    setResetAck(false)
  }

  const loadDemoData = (): void => {
    if (demoBusy) return
    setDemoBusy(true)
    void (async () => {
      try {
        await api.post<{ ok: boolean }>('/api/demo/seed', { confirm: true })
        await hydrateFromServer()
        setSeedOpen(false)
        toast('已载入示例数据')
      } catch (err) {
        toast(`载入失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setDemoBusy(false)
      }
    })()
  }

  const resetAllData = (): void => {
    if (demoBusy || !resetAck) return
    setDemoBusy(true)
    void (async () => {
      try {
        await api.post<{ ok: boolean }>('/api/demo/reset', { confirm: true })
        await hydrateFromServer()
        setResetOpen(false)
        setResetAck(false)
        toast('已清空全部数据（已自动备份）')
      } catch (err) {
        toast(`清空失败：${errorText(err)}`, { tone: 'error' })
      } finally {
        setDemoBusy(false)
      }
    })()
  }

  const snapshot = getSnapshot()
  const total = getDataRecordCount(snapshot)
  const notifyLastError = notifyStatus?.lastError ?? ''

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
        按分类浏览设置：外观、AI 集成、AI 自动化、通知、标签管理、区域、目标、数据统计、回收站、数据服务、关于。左侧选中分类决定右侧面板内容。
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

          {section === 'notify' && (
            <Panel
              title="通知"
              en="WECHAT"
              actions={
                <span
                  className={['k-svc-pill', notifyStatus?.configured ? 'is-ok' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {notifyStatus?.configured ? '已配置' : '未配置'}
                </span>
              }
            >
              <p className="k-view__intro">
                企业微信群机器人 webhook（Phase 1 仅出站）：每日简报 + 任务到期提醒。个人微信非官方协议不接入；
                数据服务与 opencode 仅监听本机。
              </p>

              <div className="k-between">
                <span className="k-panel__cn">企业微信 webhook</span>
                <span className="u-label k-muted">{notifyStatus?.webhookHost || '未配置'}</span>
              </div>
              <div className="k-field">
                <input
                  type="password"
                  className="k-input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…（留空保持不变）"
                  aria-label="企业微信 webhook URL"
                  value={webhookDraft}
                  disabled={notifyBusy}
                  onChange={(event) => setWebhookDraft(event.target.value)}
                />
                {notifyStatus?.configured && (
                  <div className="k-view__actions">
                    <button
                      type="button"
                      className="k-btn is-danger"
                      onClick={clearWebhook}
                      disabled={notifyBusy}
                    >
                      清除 webhook
                    </button>
                  </div>
                )}
              </div>
              <p className="k-view__intro k-muted">
                URL 只存本机 <code>data/meta/secrets.json</code>，不回显、不入库；留空保存表示保持不变。
              </p>

              <div className="k-between">
                <span className="k-panel__cn">入站 token（Phase 2 预留）</span>
                <span className="u-label k-muted">
                  {notifyStatus?.hasInboundToken ? '已配置' : '未配置'}
                </span>
              </div>
              <div className="k-field">
                <input
                  type="password"
                  className="k-input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="Bearer token（留空保持不变）"
                  aria-label="微信入站 token"
                  value={inboundTokenDraft}
                  disabled={notifyBusy}
                  onChange={(event) => setInboundTokenDraft(event.target.value)}
                />
                {notifyStatus?.hasInboundToken && (
                  <div className="k-view__actions">
                    <button
                      type="button"
                      className="k-btn is-danger"
                      onClick={clearInboundToken}
                      disabled={notifyBusy}
                    >
                      清除 token
                    </button>
                  </div>
                )}
              </div>
              <p className="k-view__intro k-muted">
                用于 <code>POST /api/wechat/inbound</code> 的 Bearer token；仅本机可调用，Phase 2 中继直接使用。
              </p>

              <div className="k-settings__divider" aria-hidden />

              <div className="k-between">
                <span className="k-panel__cn">简报 / 到期提醒</span>
                <span className="u-label k-muted">服务端定时器</span>
              </div>
              <div className="k-field">
                <label className="u-label" htmlFor="notify-digest-time">
                  每日简报时间
                </label>
                <input
                  id="notify-digest-time"
                  type="time"
                  className="k-input"
                  value={digestTime}
                  disabled={notifyBusy}
                  onChange={(event) => setDigestTime(event.target.value)}
                />
              </div>
              <div className="k-field">
                <label className="u-label" htmlFor="notify-due-minutes">
                  到期提前分钟
                </label>
                <input
                  id="notify-due-minutes"
                  type="number"
                  min={1}
                  max={1440}
                  className="k-input"
                  value={dueMinutes}
                  disabled={notifyBusy}
                  onChange={(event) => setDueMinutes(event.target.value)}
                />
              </div>
              <div className="k-view__actions">
                <button type="button" className="k-btn is-solid" onClick={saveNotify} disabled={notifyBusy}>
                  {notifyBusy ? '保存中…' : '保存'}
                </button>
                <button
                  type="button"
                  className="k-btn"
                  onClick={testNotify}
                  disabled={testBusy || notifyStatus?.configured !== true}
                >
                  {testBusy ? '发送中…' : '测试推送'}
                </button>
              </div>

              <div className="k-settings__divider" aria-hidden />
              <p className="k-view__intro k-muted">
                最近发送：{notifyStatus?.lastSendAt ? formatTime(notifyStatus.lastSendAt) : '—'} · 最近简报：
                {notifyStatus?.lastDigestAt ? formatTime(notifyStatus.lastDigestAt) : '—'} · 待重试：
                {notifyStatus?.pendingFailures ?? 0}
              </p>
              {notifyLastError !== '' && (
                <p className="k-view__intro k-muted">最近错误：{notifyLastError}</p>
              )}
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

              <div className="k-settings__divider" aria-hidden />

              {/* 示例数据 / 维护（ADR-0041 Phase 3）：载入示例仅在空工作区；清空需勾选确认并先自动备份 */}
              <div className="k-between">
                <span className="k-panel__cn">示例数据 / 维护</span>
                <span className="u-label k-muted">DEMO · MAINTENANCE</span>
              </div>
              <p className="k-view__intro">
                空工作区可一键载入约 150 条示例记录（任务 / 项目 / 日程 / 笔记 / 资料 / 习惯 / 踪迹 / 回顾），
                用于快速体验。之后可在本区「清空所有数据」中清除（清空前会自动备份）。
              </p>
              <div className="k-view__actions">
                <button
                  type="button"
                  className="k-btn is-solid"
                  onClick={() => setSeedOpen(true)}
                  disabled={demoBusy || !workspaceBlank}
                >
                  载入示例数据
                </button>
                <button
                  type="button"
                  className="k-btn is-danger"
                  onClick={() => {
                    setResetAck(false)
                    setResetOpen(true)
                  }}
                  disabled={demoBusy}
                >
                  清空所有数据
                </button>
              </div>
              {!workspaceBlank && (
                <p className="k-view__intro k-muted">仅空工作区可载入（当前已有记录）。</p>
              )}
            </Panel>
          )}

          {section === 'trash' && <TrashPanel />}

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
                <dt>使用指南</dt>
                <dd>
                  <a
                    className="k-empty__guide"
                    href="/guide.html"
                    target="_blank"
                    rel="noreferrer"
                  >
                    打开使用指南 →
                  </a>
                </dd>
              </dl>
            </Panel>
          )}
        </div>
      </div>

      {/* 示例数据 / 清空确认弹窗（自适应 portal 到 body；确认前零写入） */}
      <Modal
        open={seedOpen}
        onClose={closeSeed}
        kicker="DEMO"
        title="载入示例数据"
        footer={
          <div className="k-modal__foot-actions">
            <button type="button" className="k-btn" onClick={closeSeed} disabled={demoBusy}>
              取消
            </button>
            <button
              type="button"
              className="k-btn is-solid"
              onClick={loadDemoData}
              disabled={demoBusy}
            >
              {demoBusy ? '载入中…' : '确认载入'}
            </button>
          </div>
        }
      >
        <p className="k-view__intro">
          将在空工作区写入约 150 条示例记录（任务 / 项目 / 日程 / 笔记 / 资料 / 习惯 / 踪迹 / 回顾）。
          这是演示数据，可随时在本区「清空所有数据」中移除。
        </p>
      </Modal>

      <Modal
        open={resetOpen}
        onClose={closeReset}
        kicker="DANGER"
        title="清空所有数据"
        footer={
          <div className="k-modal__foot-actions">
            <button type="button" className="k-btn" onClick={closeReset} disabled={demoBusy}>
              取消
            </button>
            <button
              type="button"
              className="k-btn is-danger"
              onClick={resetAllData}
              disabled={demoBusy || !resetAck}
            >
              {demoBusy ? '清空中…' : '确认清空'}
            </button>
          </div>
        }
      >
        <p className="k-view__intro">
          将清空全部实体、回收站、附件与审计日志（保留应用设置），并<b>先自动备份</b>到{' '}
          <code>.qa/backups/</code>。此操作不可在界面内撤销。
        </p>
        <label className="k-field__check">
          <input
            type="checkbox"
            checked={resetAck}
            disabled={demoBusy}
            onChange={(event) => setResetAck(event.target.checked)}
          />
          <span>我确认清空全部数据（将先自动备份到 .qa/backups/）</span>
        </label>
      </Modal>
    </div>
  )
}
