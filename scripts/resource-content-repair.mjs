// KERNEL · 维护脚本 · 存量资料原文回填
// 用途：为历史资源补回可选字段 content（原文）——早期资源只存 ≤120 字 AI 小结（note），
//       原文留在产生它的收件箱条目（data/inbox/<i>.json .content）里，本脚本据此回填。
// 默认预演（不落盘）；加 --apply 落盘。复用 store.repairResourceContents()，写盘仍走单写者 serialize 队列。
// 用法：node scripts/resource-content-repair.mjs [--apply]
// 说明：建议服务停用时运行；本脚本不启动服务，不触碰端口 / 安装目录。
// 范围：只扫实时资料（不含回收站）；收件箱链接兼容 linkedIds 与旧单数 linkedId；
//       已有非空 content 跳过（'' / 纯空白视作未设置）；文件来源（kind:'file' 或带 path）跳过；
//       回填值逐字保留（不 trim），不 bump updatedAt（修复 ≠ 用户编辑）。
import { repairResourceContents } from '../server/store.mjs'

const apply = process.argv.includes('--apply')
const { findings, repaired } = await repairResourceContents({ dryRun: !apply })

if (findings.length === 0) {
  console.log('[resource-content] 未发现可回填原文的存量资料')
} else {
  console.log(
    apply ? '[resource-content] 回填资料原文：' : '[resource-content] 发现可回填资料（预演，未落盘）：',
  )
  for (const f of findings) {
    console.log(`  · ${f.id} ← 收件箱 ${f.inboxId}`)
  }
}
console.log(
  apply
    ? `[resource-content] 已回填 ${repaired} 条资料（共 ${findings.length} 处）`
    : `[resource-content] 预演：发现 ${findings.length} 条可回填；加 --apply 落盘`,
)
