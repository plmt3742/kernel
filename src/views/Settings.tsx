// KERNEL · 设置 SETTINGS（P2）：左分类导航 + 右单区面板
// 结构取自设计稿 v2 · settings-b「侧导航」：导航决定右面板渲染的唯一分区，默认「外观」。
import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
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
  getLanStatus,
  getNotifyStatus,
  hydrateFromServer,
  saveNotifyConfig,
  sendTestNotify,
  setAiKey,
  startLanAccess,
  stopLanAccess,
  updateAiAutomation,
} from '@/lib/mutations'
import { api, errorText } from '@/lib/api'
import { formatTime } from '@/lib/date'
import type { AiAutomation, LanStatus, NotifyStatus } from '@/types'

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
  | 'mobile'
  | 'tags'
  | 'areas'
  | 'goals'
  | 'data'
  | 'trash'
  | 'service'
  | 'about'

type SectionGroup = 'general' | 'ai' | 'content' | 'data' | 'system'

const GROUPS: Array<{ id: SectionGroup; cn: string; en: string }> = [
  { id: 'general', cn: '常规', en: 'GENERAL' },
  { id: 'ai', cn: 'AI', en: 'AI' },
  { id: 'content', cn: '内容', en: 'CONTENT' },
  { id: 'data', cn: '数据', en: 'DATA' },
  { id: 'system', cn: '系统', en: 'SYSTEM' },
]

const SECTIONS: Array<{ id: SectionId; cn: string; en: string; group: SectionGroup }> = [
  { id: 'appearance', cn: '外观', en: 'APPEARANCE', group: 'general' },
  { id: 'notify', cn: '通知', en: 'WECHAT', group: 'general' },
  { id: 'mobile', cn: '手机访问', en: 'LAN', group: 'general' },
  { id: 'ai', cn: 'AI 集成', en: 'OPENCODE', group: 'ai' },
  { id: 'automation', cn: '自动处理', en: 'AUTOMATION', group: 'ai' },
  { id: 'tags', cn: '标签管理', en: 'TAGS', group: 'content' },
  { id: 'areas', cn: '区域', en: 'AREAS', group: 'content' },
  { id: 'goals', cn: '目标', en: 'GOALS', group: 'content' },
  { id: 'data', cn: '数据统计', en: 'DATA', group: 'data' },
  { id: 'trash', cn: '回收站', en: 'TRASH', group: 'data' },
  { id: 'service', cn: '数据服务', en: 'SERVICE', group: 'data' },
  { id: 'about', cn: '关于', en: 'ABOUT', group: 'system' },
]

const SECTION_DESC: Record<SectionId, string> = {
  appearance: '主题、动效与界面偏好。切换会记在本机，下次打开仍然生效。',
  notify: '企业微信群机器人日报与到期提醒；只出站，不接入个人微信。',
  mobile: '同一 WiFi 下用手机浏览器打开；按需开启，用完可以关闭。',
  ai: '本机 opencode、模型与 DeepSeek API Key。AI 只出建议，写入前确认。',
  automation: 'AI 解析完成后，是否自动应用创建类的低风险动作。',
  tags: '标签的登记、重命名、合并与清理；写入时自动登记。',
  areas: '长期责任范围与判断标准；项目、任务、资料可以挂在区域下。',
  goals: '阶段目标与关键结果；项目可以对齐到目标。',
  data: '实体计数、数据位置与维护操作。数据是文件，可直接备份。',
  trash: '已删除的记录；可以恢复，或彻底删除。',
  service: '本机数据服务的状态与最近写入活动。',
  about: '版本、产品介绍、使用指南与项目链接。',
}

export function Settings() {
  useDataRevision()
  const { theme, setTheme } = useTheme()
  const source = useDataSource()
  const ai = useAiHealth()
  const { toast } = useToast()
  // 深链（Slice X）：?section=areas|goals 直达分区；?area=/?goal= 打开对应编辑弹窗
  // （习惯已迁出为独立页 /habits，?section=habits / ?habit= 不再由设置页处理）
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const params = useParams()
  const rawSection = params.section ?? searchParams.get('section')
  const section: SectionId =
    rawSection !== null && rawSection !== undefined && SECTIONS.some((item) => item.id === rawSection)
      ? (rawSection as SectionId)
      : 'appearance'
  const setSection = (next: SectionId): void => {
    navigate(`/settings/${next}`)
  }
  const currentSection = SECTIONS.find((item) => item.id === section) ?? SECTIONS[0]
  const currentIndex = SECTIONS.findIndex((item) => item.id === section) + 1
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

  const [lanStatus, setLanStatus] = useState<LanStatus | null>(null)
  const [lanBusy, setLanBusy] = useState(false)
  const [lanError, setLanError] = useState('')

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

  useEffect(() => {
    if (section !== 'mobile') return
    let cancelled = false
    setLanError('')
    getLanStatus()
      .then((status) => {
        if (!cancelled) setLanStatus(status)
      })
      .catch((err) => {
        if (!cancelled) setLanError(errorText(err))
      })
    return () => {
      cancelled = true
    }
  }, [section])

  const toggleLan = (): void => {
    if (lanBusy || source !== 'server') return
    setLanBusy(true)
    setLanError('')
    const action = lanStatus?.running === true ? stopLanAccess : startLanAccess
    void action()
      .then((status) => {
        setLanStatus(status)
        toast(status.running ? '手机访问已开启' : '手机访问已关闭')
      })
      .catch((err) => {
        setLanError(errorText(err))
        toast(`手机访问操作失败：${errorText(err)}`, { tone: 'error' })
      })
      .finally(() => setLanBusy(false))
  }

  const copyLanUrl = (url: string): void => {
    const clipboard = navigator.clipboard
    if (clipboard === undefined) {
      toast('当前环境不支持自动复制，请手动选中地址')
      return
    }
    void clipboard
      .writeText(url)
      .then(() => toast('地址已复制'))
      .catch(() => toast('复制失败，请手动选中地址', { tone: 'error' }))
  }

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
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
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
      <header className="set__pagehead">
        <div className="set__pagehead-main">
          <p className="set__crumb">
            <span>KERNEL</span>
            <i>/</i>
            <span>设置</span>
            <i>/</i>
            <b>{currentSection.cn}</b>
          </p>
          <h1 className="set__title">设置</h1>
          <p className="set__lede">
            外观、AI、通知、手机访问和数据都在这里。会改动数据的操作，都会先问你。
          </p>
        </div>
        <div className="set__status" aria-label="本机状态">
          <div className="set__status-row">
            <span>数据服务</span>
            <b className={source === 'server' ? 'is-on' : source === 'offline' ? 'is-off' : ''}>
              <i aria-hidden />
              {source === 'server' ? '在线' : source === 'offline' ? '离线' : '连接中'}
            </b>
          </div>
          <div className="set__status-row">
            <span>AI</span>
            <b className={ai.status === 'online' ? 'is-on' : ai.status === 'offline' ? 'is-off' : ''}>
              <i aria-hidden />
              {ai.status === 'online' ? '在线' : ai.status === 'offline' ? '离线' : '检测中'}
            </b>
          </div>
          <div className="set__status-row">
            <span>版本</span>
            <b className="set__status-version">v1.1.0</b>
          </div>
          <div className="set__status-foot">
            <span>{total} 条记录</span>
            <span>仅存本机</span>
          </div>
        </div>
      </header>

      <div className="set__layout">
        <aside className="set__rail" aria-label="设置索引">
          <div className="set__rail-head">
            <span>设置索引</span>
            <em>INDEX</em>
          </div>
          {GROUPS.map((group) => (
            <div className="set__nav-group" key={group.id}>
              <p className="set__nav-label">
                <span>{group.cn}</span>
                <em>{group.en}</em>
              </p>
              {SECTIONS.filter((item) => item.group === group.id).map((item) => {
                const index = SECTIONS.findIndex((entry) => entry.id === item.id) + 1
                const active = section === item.id
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={active ? 'set__nav-item is-active' : 'set__nav-item'}
                    aria-current={active ? 'page' : undefined}
                    onClick={() => setSection(item.id)}
                  >
                    <span className="set__nav-n">{String(index).padStart(2, '0')}</span>
                    <span className="set__nav-cn">{item.cn}</span>
                    <span className="set__nav-en">{item.en}</span>
                  </button>
                )
              })}
            </div>
          ))}
          <div className="set__rail-foot">
            <span>LOCAL ONLY</span>
            <span>v1.1.0</span>
          </div>
        </aside>

        <div className="set__mobile-nav">
          <label htmlFor="set-section">设置分类</label>
          <select
            id="set-section"
            value={section}
            onChange={(event) => setSection(event.target.value as SectionId)}
          >
            {GROUPS.map((group) => (
              <optgroup label={`${group.cn} / ${group.en}`} key={group.id}>
                {SECTIONS.filter((item) => item.group === group.id).map((item) => (
                  <option value={item.id} key={item.id}>
                    {String(SECTIONS.findIndex((entry) => entry.id === item.id) + 1).padStart(2, '0')} ·{' '}
                    {item.cn} · {item.en}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <main className="set__main">
          <header className="set__sectionhead">
            <div className="set__sectionhead-top">
              <span className="set__section-n">{String(currentIndex).padStart(2, '0')}</span>
              <span className="set__section-en">{currentSection.en}</span>
            </div>
            <h2 className="set__section-title">{currentSection.cn}</h2>
            <p className="set__section-desc">{SECTION_DESC[section]}</p>
          </header>
          <div className="set__body" key={section}>
          {section === 'appearance' && (
            <Panel
              title="主题"
              en="THEME"
              actions={<span className="k-pill">当前 · {theme === 'dark' ? '暗' : '亮'}</span>}
            >
              <div className="set__theme-grid">
                <button
                  type="button"
                  className={theme === 'dark' ? 'set__theme is-active' : 'set__theme'}
                  onClick={() => setTheme('dark')}
                  aria-pressed={theme === 'dark'}
                >
                  <span className="set__theme-preview is-dark" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="set__theme-label">
                    <b>暗 · DARK</b>
                    <em>{theme === 'dark' ? '当前' : '选择'}</em>
                  </span>
                </button>
                <button
                  type="button"
                  className={theme === 'light' ? 'set__theme is-active' : 'set__theme'}
                  onClick={() => setTheme('light')}
                  aria-pressed={theme === 'light'}
                >
                  <span className="set__theme-preview is-light" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className="set__theme-label">
                    <b>亮 · LIGHT</b>
                    <em>{theme === 'light' ? '当前' : '选择'}</em>
                  </span>
                </button>
              </div>
              <p className="k-view__intro">
                默认使用深色外观。切换后会记住你的选择，下次打开仍然生效。
              </p>
              <dl className="k-dl">
                <dt>减少动效</dt>
                <dd>{reducedMotion ? '跟随系统 · 已开启' : '跟随系统'}</dd>
                <dt>语言</dt>
                <dd>中文</dd>
              </dl>
            </Panel>
          )}

          {section === 'ai' && (
            <Panel title="连接与模型" en="CONNECTION">
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
              title="自动处理"
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
                    AI 只给建议，你点「应用」后才会保存。最稳妥，适合不想让 AI 直接改数据的时候。
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
                默认是「先确认」：AI 只出建议，你点了才保存。「自动」只处理新建这类低风险动作，随时可以撤销或切回。
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
              title="推送通道"
              en="CHANNEL"
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

          {section === 'mobile' && (
            <Panel
              title="局域网"
              en="LAN"
              actions={
                <span
                  className={['k-svc-pill', lanStatus?.running ? 'is-ok' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  {lanStatus?.running ? '已开启' : '未开启'}
                </span>
              }
            >
              <div className="k-lan__head">
                <div>
                  <p className="k-panel__cn">同一 WiFi，一键开启</p>
                  <p className="k-view__intro">
                    开启后，手机和电脑连同一个 WiFi，用手机浏览器打开下面的地址。数据服务仍只监听
                    127.0.0.1；仅建议在可信 WiFi 下临时开启。
                  </p>
                </div>
                <button
                  type="button"
                  className={lanStatus?.running ? 'k-btn is-danger' : 'k-btn is-solid'}
                  onClick={toggleLan}
                  disabled={lanBusy || source !== 'server'}
                >
                  {lanBusy ? '处理中…' : lanStatus?.running ? '关闭手机访问' : '一键开启手机访问'}
                </button>
              </div>
              {lanError !== '' && <p className="k-lan__error">{lanError}</p>}
              {lanStatus?.running === true && (
                <div className="k-lan">
                  <p className="k-view__intro">
                    <b>手机打开</b>（电脑和手机同一 WiFi）：
                  </p>
                  <ul className="k-lan__urls">
                    {lanStatus.urls.map((url) => (
                      <li key={url}>
                        <code>{url}</code>
                        <button type="button" className="k-btn" onClick={() => copyLanUrl(url)}>
                          复制
                        </button>
                      </li>
                    ))}
                  </ul>
                  <p className="k-view__intro k-muted">
                    端口 {lanStatus.port}；手机通过前端代理访问，数据服务 4097
                    仍只监听本机。首次开启若弹出防火墙提示，请允许 Node.js 的「专用网络」。
                  </p>
                </div>
              )}
              <div className="k-lan__steps">
                <p>
                  <b>连同一个 WiFi</b>
                  <span>手机和电脑在同一网络；校园网 / 访客网络可能隔离设备。</span>
                </p>
                <p>
                  <b>打不开时</b>
                  <span>Windows 防火墙允许 Node.js 的「专用网络」；关闭后重新开启。</span>
                </p>
                <p>
                  <b>关闭</b>
                  <span>点上面的按钮，或退出应用；不会改动任何数据。</span>
                </p>
              </div>
              {source !== 'server' && (
                <p className="k-lan__error">数据服务离线，无法开启手机访问。</p>
              )}
            </Panel>
          )}

          {section === 'tags' && <TagManager />}

          {section === 'areas' && <AreaManager focusId={focusArea} />}

          {section === 'goals' && <GoalManager focusId={focusGoal} />}

          {section === 'data' && (
            <Panel
              title="实体计数"
              en="ENTITIES"
              actions={<span className="u-label k-muted">{total} 条记录</span>}
            >
              <div className="set__stats">
                {rows.map((row) => (
                  <div className="set__stat" key={row.label}>
                    <span>{row.label}</span>
                    <b>{row.value}</b>
                  </div>
                ))}
                <div className="set__stat is-total">
                  <span>合计 TOTAL</span>
                  <b>{total}</b>
                </div>
              </div>
              <p className="set__note">
                10 类实体记录 {total - 2} 条 + 配置 1 + 标签注册表 1；均为文件式 JSON（一记录一文件）。
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
            <Panel title="本机服务" en="SERVICE">
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
            <Panel title="产品信息" en="PRODUCT">
              <div className="k-about__hero">
                <p className="k-about__kicker">KERNEL / LOCAL FIRST</p>
                <h3 className="k-about__title">去繁化简</h3>
                <p className="k-about__lede">
                  课表、任务、日程、项目、笔记、资料、习惯、踪迹和回顾，都在一处。数据存在本机，AI
                  只给建议，写入由你确认。
                </p>
                <div className="k-view__actions">
                  <a
                    className="k-btn is-solid"
                    href="/site/index.html"
                    target="_blank"
                    rel="noreferrer"
                  >
                    产品介绍 →
                  </a>
                  <a className="k-btn" href="/guide.html" target="_blank" rel="noreferrer">
                    使用指南
                  </a>
                </div>
              </div>

              <div className="k-about__grid">
                <dl className="k-dl">
                  <dt>版本</dt>
                  <dd className="k-mono">v1.1.0</dd>
                  <dt>记录</dt>
                  <dd>{total} 条</dd>
                  <dt>数据位置</dt>
                  <dd>
                    <code>data/</code>
                  </dd>
                  <dt>所有者</dt>
                  <dd>{snapshot.config.owner}</dd>
                </dl>
                <div className="k-about__principles">
                  {[
                    { n: '01', text: '数据放在本机文件里' },
                    { n: '02', text: 'AI 只建议，写入前确认' },
                    { n: '03', text: '每周回看一次' },
                  ].map((line) => (
                    <p key={line.n}>
                      <span>{line.n}</span>
                      {line.text}
                    </p>
                  ))}
                </div>
              </div>

              <p className="k-about__links">
                <a
                  href="https://github.com/plmt3742/kernel"
                  target="_blank"
                  rel="noreferrer"
                >
                  GitHub
                </a>
                <span>·</span>
                <a
                  href="https://github.com/plmt3742/kernel/releases"
                  target="_blank"
                  rel="noreferrer"
                >
                  安装包
                </a>
                <span>·</span>
                <a
                  href="https://github.com/plmt3742/kernel/blob/main/LICENSE"
                  target="_blank"
                  rel="noreferrer"
                >
                  MIT License
                </a>
                <span>·</span>
                <button
                  type="button"
                  className="k-about__linkbtn"
                  onClick={() => setSection('mobile')}
                >
                  手机访问
                </button>
              </p>
            </Panel>
          )}
          </div>
        </main>
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
