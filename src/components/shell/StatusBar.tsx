// KERNEL · StatusBar（终端感状态条：实时时钟 / INBOX / WIP / 数据 / AI / 数据服务状态）
import { useEffect, useState } from 'react'
import { getActiveProjects, getInboxCount, getSnapshot } from '@/lib/data'
import { getDataRecordCount } from '@/lib/derive'
import { useDataSource } from '@/lib/hooks'

const INBOX_THRESHOLD = 10

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function StatusBar() {
  const [now, setNow] = useState(() => new Date())
  const source = useDataSource()

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const inbox = getInboxCount()
  const wip = getActiveProjects().length
  const total = getDataRecordCount(getSnapshot())
  const clock = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`

  return (
    <footer className="k-statusbar u-label" role="contentinfo">
      <span className="k-statusbar__cell k-statusbar__cell--ink">{clock}</span>
      <span className="k-statusbar__sep" />
      <span className="k-statusbar__cell">
        INBOX{' '}
        <b className={inbox > INBOX_THRESHOLD ? 'k-accent' : undefined}>{inbox}</b>
      </span>
      <span className="k-statusbar__sep k-statusbar__desktop-only" />
      <span className="k-statusbar__cell k-statusbar__desktop-only">WIP {wip}</span>
      <span className="k-statusbar__sep k-statusbar__desktop-only" />
      <span className="k-statusbar__cell k-statusbar__desktop-only">DATA · {total} RECORDS</span>
      <span className="k-statusbar__spacer" />
      <span className="k-statusbar__cell k-statusbar__cell--accent k-statusbar__desktop-only">
        AI: OFFLINE · 待接入 v0.5
      </span>
      <span className="k-statusbar__sep k-statusbar__desktop-only" />
      <span
        className={[
          'k-statusbar__cell',
          'k-svc-pill',
          source === 'server' ? 'is-ok' : '',
          source === 'offline' ? 'is-off' : '',
        ]
          .filter(Boolean)
          .join(' ')}
        title="数据服务（127.0.0.1:4097，唯一写入路径）"
      >
        {source === 'server' ? '数据 · 在线' : source === 'offline' ? '数据 · 离线（只读）' : '数据 · 连接中'}
      </span>
    </footer>
  )
}
