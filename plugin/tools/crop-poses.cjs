/**
 * 角色姿态切图（连通域掩膜法）。
 *
 * 为什么这样做：多姿态各自独立生成会得到风格、比例、色调都不同的形象（用户可
 * 直接感知为"不是同一头鲸"）；用 CSS 旋转硬凑同一张图则姿态不成立。正解是一次
 * 生成完整角色设定图（多姿态同处一图），再按连通域切分——同图内的姿态天然一致。
 *
 * 关键点：相邻姿态的外接矩形会互相重叠，因此不能简单 extract 矩形，必须"仅保留
 * 目标连通域自身的像素"；同时需回填被轮廓包围的背景色区域（奶白肚皮）。
 *
 * 用法：node tools/crop-poses.cjs
 */
const path = require('path')
const sharp = require('sharp')

const ROOT = path.resolve(__dirname, '..', '..')
const SRC = path.join(ROOT, 'assets/concept/whale-sheet-v2-official-blue.png')
const OUT = path.join(ROOT, 'plugin/web/art')
const TARGET_HEIGHT = 220
const BG_TOLERANCE = 34
const MIN_AREA = 12000

async function main() {
  const { data, info } = await sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const W = info.width, H = info.height, C = info.channels
  const at = (x, y) => (y * W + x) * C
  const bg = [data[at(2, 2)], data[at(2, 2) + 1], data[at(2, 2) + 2]]
  const isFg = (x, y) => {
    const i = at(x, y)
    return Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2]) > BG_TOLERANCE
  }

  // 连通域标记（4 邻域）
  const label = new Int32Array(W * H).fill(-1)
  const comps = []
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const p0 = y * W + x
      if (label[p0] !== -1 || !isFg(x, y)) continue
      const id = comps.length
      let minX = x, maxX = x, minY = y, maxY = y, area = 0
      const stack = [[x, y]]
      label[p0] = id
      while (stack.length > 0) {
        const [cx, cy] = stack.pop()
        area += 1
        if (cx < minX) minX = cx
        if (cx > maxX) maxX = cx
        if (cy < minY) minY = cy
        if (cy > maxY) maxY = cy
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
          const p = ny * W + nx
          if (label[p] !== -1 || !isFg(nx, ny)) continue
          label[p] = id
          stack.push([nx, ny])
        }
      }
      comps.push({ id, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, area })
    }
  }

  // 按设定图版式归类：最大者为漂浮主体；上半区左右两个为下潜与喷水；中右为睡眠
  const big = comps.filter((c) => c.area > MIN_AREA).sort((a, b) => b.area - a.area)
  const named = {}
  for (const c of big) {
    const cx = (c.x + c.w / 2) / W
    const cy = (c.y + c.h / 2) / H
    if (named.float === undefined && c.w > W * 0.3) { named.float = c; continue }
    if (cy > 0.72) continue // 表情头像行
    if (named.dive === undefined && cy < 0.45 && cx < 0.75) { named.dive = c; continue }
    if (named.surface === undefined && cy < 0.45) { named.surface = c; continue }
    if (named.sleep === undefined && cy >= 0.45) { named.sleep = c; continue }
  }
  if (named.float === undefined) throw new Error('未能定位主体姿态，请检查设定图或阈值')

  for (const [name, c] of Object.entries(named)) {
    const pad = 8
    const left = Math.max(0, c.x - pad)
    const top = Math.max(0, c.y - pad)
    const width = Math.min(W - left, c.w + pad * 2)
    const height = Math.min(H - top, c.h + pad * 2)

    // 仅保留本连通域像素，邻近姿态一律透明
    const out = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const sx = left + x, sy = top + y
        const si = at(sx, sy)
        const di = (y * width + x) * 4
        out[di] = data[si]
        out[di + 1] = data[si + 1]
        out[di + 2] = data[si + 2]
        out[di + 3] = label[sy * W + sx] === c.id ? 255 : 0
      }
    }

    // 从边界洪水填充标记"真外部"，其余透明像素属内部空洞（肚皮/眼白），回填为不透明
    const outside = new Uint8Array(width * height)
    const q = []
    for (let x = 0; x < width; x += 1) q.push([x, 0], [x, height - 1])
    for (let y = 0; y < height; y += 1) q.push([0, y], [width - 1, y])
    while (q.length > 0) {
      const [x, y] = q.pop()
      if (x < 0 || y < 0 || x >= width || y >= height) continue
      const p = y * width + x
      if (outside[p] === 1) continue
      if (out[p * 4 + 3] === 255) continue // 撞到本体轮廓即止
      outside[p] = 1
      q.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1])
    }
    for (let p = 0; p < width * height; p += 1) {
      if (out[p * 4 + 3] === 0 && outside[p] === 0) out[p * 4 + 3] = 255
    }

    const file = path.join(OUT, `pose-sheet-${name}.png`)
    const buf = await sharp(out, { raw: { width, height, channels: 4 } }).png().toBuffer()
    await sharp(buf).trim().resize({ height: TARGET_HEIGHT, fit: 'inside' }).png().toFile(file)
    const meta = await sharp(file).metadata()
    console.log(`pose-sheet-${name}.png  ${meta.width}x${meta.height}`)
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })

/*
 * 注意：切完必须紧接着跑 tools/wipe-dive-spout.cjs。
 * 设定图给每个姿态都画了头顶小水柱，深潜姿态转向后水柱会跑到身侧，读起来像从身上漏水。
 * 重新切图会把它带回来，务必补跑那一步。
 */
