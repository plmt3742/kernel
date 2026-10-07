// KERNEL · 维护脚本 · 存量悬空引用修复（ADR-0043 §2.6）
// 默认预演（不落盘）；加 --apply 落盘。复用 store.pruneDanglingRefs()，只清 detach 边；
// keep 边（sourceInboxId / linkedId / appliedTagIds / reviews.stale*）永不改写。
// 用法：node scripts/refs-repair.mjs [--apply]
// 说明：建议服务停用时运行；本脚本不启动服务，写盘仍走单写者 serialize 队列。
import { pruneDanglingRefs } from '../server/store.mjs'

const apply = process.argv.includes('--apply')
const { findings, cleared } = await pruneDanglingRefs({ dryRun: !apply })

if (findings.length === 0) {
  console.log('[refs] 未发现悬空引用')
} else {
  console.log(apply ? '[refs] 清除悬空引用：' : '[refs] 发现悬空引用（预演，未落盘）：')
  for (const f of findings) {
    const where = f.trashed === true ? '回收站' : '实时'
    console.log(`  · ${where} ${f.kind}/${f.id} · ${f.field} → 缺失 ${f.missingTarget}`)
  }
}
console.log(
  apply
    ? `[refs] 已修复 ${cleared} 条记录（共 ${findings.length} 处悬空引用）`
    : `[refs] 预演：发现 ${findings.length} 处悬空引用；加 --apply 落盘`,
)
