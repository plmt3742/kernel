// KERNEL · 长图 AI 预览分片（本切片）：把大图 / 长截图按纵向切成 ≤6 张 JPEG，
// 供数据服务作为多个图片 part 送入 AI 解析（防止单张超大图超时）。
// 纪律：本模块纯客户端、只读本地 File；任何失败一律返回空数组（绝不抛出），
// 调用方据此回退为「原图单 part」路径，切片失败不阻断投递。
const PREVIEW_MIN_BYTES = 400 * 1024
const MAX_SIDE = 1600
const TILE_HEIGHT = 1600
const MAX_TILES = 6
const JPEG_QUALITY = 0.82

/**
 * 把一张大图 / 长图按纵向切分为 ≤6 张 JPEG 分片（长边 ≤1600、单张高 ≤1600、质量 0.82）。
 * 小图（≤400KB）/ 非图片 / 解码失败 / 画布不可用一律返回 []，由调用方回退原图单 part。
 */
export async function sliceImageForAi(file: File): Promise<Blob[]> {
  if (!file.type.startsWith('image/')) return []
  if (file.size <= PREVIEW_MIN_BYTES) return []

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file)

    // 先按长边压缩；若纵向仍超过 MAX_TILES 张，再等比缩小到刚好塞进 MAX_TILES 张
    let scale = Math.min(1, MAX_SIDE / bitmap.width)
    if ((bitmap.height * scale) / TILE_HEIGHT > MAX_TILES) {
      scale *= (MAX_TILES * TILE_HEIGHT) / (bitmap.height * scale)
    }
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))
    const tileCount = Math.ceil(h / TILE_HEIGHT)

    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    if (ctx === null) return []

    const tiles: Blob[] = []
    for (let i = 0; i < tileCount; i += 1) {
      const sy = i * TILE_HEIGHT
      const sh = Math.min(TILE_HEIGHT, h - sy)
      if (sh <= 0) break

      canvas.width = w
      canvas.height = sh
      ctx.clearRect(0, 0, w, sh)
      // 目标像素 → 原图源矩形（除以 scale 还原），缩放到目标尺寸
      ctx.drawImage(
        bitmap,
        0,
        Math.round(sy / scale),
        bitmap.width,
        Math.round(sh / scale),
        0,
        0,
        w,
        sh,
      )

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
      )
      if (blob === null) break
      tiles.push(blob)
    }
    return tiles
  } catch {
    return []
  } finally {
    if (bitmap !== null) bitmap.close()
  }
}
