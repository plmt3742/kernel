// KERNEL · Skeleton（克制，仅用于确有异步感之处）
interface SkeletonProps {
  lines?: number
  height?: number
}

export function Skeleton({ lines = 3, height = 14 }: SkeletonProps) {
  return (
    <div className="k-stack" aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="k-skel" style={{ height, width: i === lines - 1 ? '60%' : '100%' }} />
      ))}
    </div>
  )
}
