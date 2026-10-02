// KERNEL · 数字滚动（reduced motion 下直接显示终值）
import { animate, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'
import { EASE_ENTER } from '@/lib/motion'

interface CountUpProps {
  value: number
  duration?: number
  className?: string
}

export function CountUp({ value, duration = 0.9, className }: CountUpProps) {
  const reduce = useReducedMotion()
  const [display, setDisplay] = useState(0)

  useEffect(() => {
    if (reduce) {
      setDisplay(value)
      return
    }
    const controls = animate(0, value, {
      duration,
      ease: EASE_ENTER,
      onUpdate: (latest: number) => setDisplay(Math.round(latest)),
    })
    return () => controls.stop()
  }, [value, duration, reduce])

  return <span className={className}>{display}</span>
}
