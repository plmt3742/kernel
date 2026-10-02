// KERNEL · StatusBar（终端感状态条：实时时钟 / INBOX / WIP / 数据 / AI / PROTO）
import { useEffect, useState } from 'react'
import { getActiveProjects, getInboxCount, getSnapshot } from '@/lib/data'
import { getDataRecordCount } from '@/lib/derive'
import { useProtoInbox } from '@/lib/proto'

const INBOX_THRESHOLD = 10

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function StatusBar() {
  const [now, setNow] = useState(() => new Date())
  const protoInbox = useProtoInbox()

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const inbox = getInboxCount() + protoInbox.length
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
      <span className="k-statusbar__cell k-statusbar__cell--accent k-proto">PROTO</span>
    </footer>
  )
}
