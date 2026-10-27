#!/usr/bin/env node
/**
 * 鲸立绘头部后处理 v5：描边泛洪圈定鲸体 + 局部相对亮度找孔 + 亮体色借色填充。
 *
 * 四代的失效链条，全部记录在案：
 *   v1 绝对色判据漏掉 navy 孔；v2 借色方向不全；v3 整行中位数被水面拉高，
 *   11330px 巨簇误填（涂改痕迹）；v4 的 isWhale 放宽到任意蓝像素后，
 *   填充的四向搜索 1-2px 内就锚上相邻孔像素——**用孔色填孔色**，填了等于没填。
 *
 * v5 的关键铁律：
 *   ① 鲸体圈定：封闭深棕描边（暗且 b-r<28 的墙）挡住边界泛洪，内部+蓝占优=鲸体
 *   ② 孔检测：比**局部窗**（±80x±50，孔宽的 2.5 倍，防中位数被孔自己污染）
 *      的 P70 亮度暗 25% 的蓝块——与绝对亮度无关
 *   ③ 簇门槛 120px：蜡笔纹理的微小凹陷（<120px）一个都不碰，保住颗粒感
 *   ④ **借色源必须是亮体色**（isWhale 且不在 dark 掩膜内）——孔像素永远不能
 *      作为填充源，这是 v4 失效的直接教训
 *   ⑤ ≥200px 的大孔额外外扩 2px 融掉自带描边内圈，不留棕色圈环
 *   ⑥ 尺寸护栏：簇宽 ≤12% 高 ≤8% 画布，机制上禁止巨型区域误填
 *
 * 用法：node tools/fix-whale-head.mjs <in.png> <out.png>
 */
import sharp from 'sharp'

const args = process.argv.slice(2)
const [inPath, outPath] = args
const MIN_CLUSTER = Math.max(24, Number(args.find((a) => a.startsWith('--min='))?.split('=')[1]) || 120)
const DARK_FACTOR = Math.min(0.95, Math.max(0.6, Number(args.find((a) => a.startsWith('--dark='))?.split('=')[1]) || 0.75))
if (!inPath || !outPath) { console.error('usage: node tools/fix-whale-head.mjs <in> <out>'); process.exit(1) }

const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H, channels: C } = info
const idx = (x, y) => (y * W + x) * C
const lum = (x, y) => { const i = idx(x, y); return data[i] + data[i + 1] + data[i + 2] }
const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H

/* ① 描边墙 + 边界泛洪。
   墙掩膜做 2px 膨胀（形态学闭运算）：描边抗锯齿处一两像素的缺口会让
   边界泛洪漏进鲸体内部（实测 scene-opensea 整只鲸被判成外部、检测全灭），膨胀把缺口闭上 */
const wallRaw = new Uint8Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (data[idx(x, y) + 3] < 100) continue
  const i = idx(x, y)
  if (data[i] + data[i + 1] + data[i + 2] < 420 && data[i + 2] - data[i] < 28) wallRaw[y * W + x] = 1
}
const wall = new Uint8Array(W * H)
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  if (!wallRaw[y * W + x]) continue
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const nx = x + dx, ny = y + dy
    if (inB(nx, ny)) wall[ny * W + nx] = 1
  }
}
const outside = new Uint8Array(W * H)
const st = []
for (let x = 0; x < W; x++) { for (const y of [0, H - 1]) { const p = y * W + x; if (!wall[y * W + x] && !outside[p]) { outside[p] = 1; st.push(p) } } }
for (let y = 0; y < H; y++) { for (const x of [0, W - 1]) { const p = y * W + x; if (!wall[y * W + x] && !outside[p]) { outside[p] = 1; st.push(p) } } }
while (st.length) {
  const p = st.pop(); const cx = p % W, cy = (p - cx) / W
  for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const nx = cx + dx, ny = cy + dy
    if (!inB(nx, ny)) continue
    const np = ny * W + nx
    if (outside[np] || wall[ny * W + nx]) continue
    outside[np] = 1; st.push(np)
  }
}
/* 鲸体 = 描边内部 + 蓝占优（含深色鲸；孔也在其中，所以填充源必须另行排除孔） */
const isWhale = (x, y) => {
  if (!inB(x, y)) return false
  const p = y * W + x
  if (outside[p] || data[idx(x, y) + 3] < 100) return false
  const i = idx(x, y)
  return data[i + 2] - data[i] > 25
}

const headBottom = Math.round(H * 0.5)
/* ② 局部相对亮度找孔 */
const dark = new Uint8Array(W * H)
for (let y = 0; y <= headBottom; y++) for (let x = 0; x < W; x++) {
  if (!isWhale(x, y)) continue
  const samples = []
  for (let dy = -50; dy <= 50; dy += 4) for (let dx = -80; dx <= 80; dx += 4) {
    const nx = x + dx, ny = y + dy
    if (isWhale(nx, ny)) samples.push(lum(nx, ny))
  }
  if (samples.length < 120) continue
  samples.sort((a, b) => a - b)
  const i = idx(x, y)
  if (data[i + 2] - data[i] > 25 && lum(x, y) < samples[Math.floor(samples.length * 0.7)] * DARK_FACTOR) dark[y * W + x] = 1
}
/* ③ 簇闸门：≥120px、尺寸受限、四边带 ≥3 边在鲸内部 */
const seen = new Uint8Array(W * H)
const fill = new Uint8Array(W * H)
const bigClusters = []
let clusters = 0, spotPx = 0
for (let y = 0; y <= headBottom; y++) for (let x = 0; x < W; x++) {
  const p = y * W + x
  if (seen[p] || !dark[p]) continue
  const st2 = [p]; seen[p] = 1; const cell = [p]
  let x0 = x, x1 = x, y0 = y, y1 = y
  while (st2.length) {
    const q = st2.pop(); const cx = q % W, cy = (q - cx) / W
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx + dx, ny = cy + dy
      if (!inB(nx, ny)) continue
      const np = ny * W + nx
      if (seen[np] || !dark[np]) continue
      seen[np] = 1; st2.push(np); cell.push(np)
    }
  }
  if (cell.length < MIN_CLUSTER) continue
  if (x1 - x0 > W * 0.12 || y1 - y0 > H * 0.08) continue
  const band = (bx0, by0, bx1, by1) => {
    let n = 0, w = 0
    for (let yy = by0; yy <= by1; yy++) for (let xx = bx0; xx <= bx1; xx++) {
      if (!inB(xx, yy)) continue
      if (xx >= x0 && xx <= x1 && yy >= y0 && yy <= y1 && dark[yy * W + xx]) continue
      n++
      const np = yy * W + xx
      if (!outside[np] && data[idx(xx, yy) + 3] >= 100) w++
    }
    return n >= 8 ? w / n : -1
  }
  const bands = [band(x0-4, y0-4, x1+4, y0-1), band(x0-4, y1+1, x1+4, y1+4), band(x0-4, y0, x0-1, y1), band(x1+1, y0, x1+4, y1)]
  if (bands.filter((r) => r >= 0.5).length < 3) continue
  clusters++
  spotPx += cell.length
  for (const q of cell) fill[q] = 1
  if (cell.length >= 200) bigClusters.push({ x0, x1, y0, y1 })
  /* 区域生长：孔的柔和渐变晕圈（比体色暗 10-20%）在严格阈值外，
     以核心为种子长入比局部 P70 暗 8% 以内的相邻鲸体，把整个孔连晕圈融掉 */
  const cap = Math.min(cell.length * 4, 4000)
  const gx1 = Math.min(W - 1, x1 + 8), gy1 = Math.min(H - 1, y1 + 8)
  const gx0 = Math.max(0, x0 - 8), gy0 = Math.max(0, y0 - 8)
  const growSt = [...cell]; const grownSet = new Set(cell)
  while (growSt.length && grownSet.size < cap) {
    const q = growSt.pop(); const cx = q % W, cy = (q - cx) / W
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx + dx, ny = cy + dy
      if (nx < gx0 || nx > gx1 || ny < gy0 || ny > gy1) continue
      const np = ny * W + nx
      if (grownSet.has(np) || fill[np]) continue
      if (outside[np]) continue
      const samples = []
      for (let wy = -50; wy <= 50; wy += 4) for (let wx = -80; wx <= 80; wx += 4) {
        const sx = nx + wx, sy = ny + wy
        if (isWhale(sx, sy) && !grownSet.has(sy * W + sx)) samples.push(lum(sx, sy))
      }
      if (samples.length < 120) continue
      samples.sort((a, b) => a - b)
      if (lum(nx, ny) >= samples[Math.floor(samples.length * 0.7)] * 0.92) continue
      grownSet.add(np); growSt.push(np)
    }
  }
  for (const q of grownSet) fill[q] = 1
}
/* ④ 填充：借色源 = 亮体色（isWhale 且不在 dark 掩膜）——孔像素绝不作源 */
let filled = 0
const fillSrc = (x, y) => {
  let sr = 0, sg = 0, sb = 0, sw = 0
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let d = 1; d <= 90; d++) {
      const nx = x + dx * d, ny = y + dy * d
      if (!inB(nx, ny)) break
      if (!isWhale(nx, ny)) continue
      if (dark[ny * W + nx]) continue // 孔像素与深斑不能当源（v4 的直接教训）
      if (fill[ny * W + nx]) continue // 已填充像素也不能当源，只锚原始亮体色
      const i = idx(nx, ny), w = 1 / d
      sr += data[i] * w; sg += data[i + 1] * w; sb += data[i + 2] * w; sw += w
      break
    }
  }
  if (!sw) return null
  return [sr / sw, sg / sw, sb / sw]
}
for (let y = 0; y <= headBottom; y++) for (let x = 0; x < W; x++) {
  const p = y * W + x
  if (!fill[p]) continue
  const c = fillSrc(x, y)
  if (!c) continue
  const i = idx(x, y)
  data[i] = Math.round(c[0]); data[i + 1] = Math.round(c[1]); data[i + 2] = Math.round(c[2]); data[i + 3] = 255
  filled++
}
/* ⑤ 大孔外扩 2px 融掉自带描边内圈（源=亮体色或已填核心） */
let rimPx = 0
const rim = new Uint8Array(W * H)
for (const b of bigClusters) {
  for (let yy = b.y0 - 2; yy <= b.y1 + 2; yy++) for (let xx = b.x0 - 2; xx <= b.x1 + 2; xx++) {
    if (!inB(xx, yy)) continue
    const p = yy * W + xx
    if (fill[p] || outside[p] || data[idx(xx, yy) + 3] < 100) continue
    let near = false
    for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
      const nx = xx + dx, ny = yy + dy
      if (inB(nx, ny) && fill[ny * W + nx]) { near = true; break }
    }
    if (near) rim[p] = 1
  }
}
for (let y = 0; y <= headBottom; y++) for (let x = 0; x < W; x++) {
  const p = y * W + x
  if (!rim[p]) continue
  let sr = 0, sg = 0, sb = 0, sw = 0
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let d = 1; d <= 90; d++) {
      const nx = x + dx * d, ny = y + dy * d
      if (!inB(nx, ny)) break
      if (outside[nx + nx * 0]) continue
      const np = ny * W + nx
      if (outside[np] || rim[np]) continue
      if (!isWhale(nx, ny) && !fill[np]) continue
      if (dark[np] && !fill[np]) continue
      const i = idx(nx, ny), w = 1 / d
      sr += data[i] * w; sg += data[i + 1] * w; sb += data[i + 2] * w; sw += w
      break
    }
  }
  if (!sw) continue
  const i = idx(x, y)
  data[i] = Math.round(sr / sw); data[i + 1] = Math.round(sg / sw); data[i + 2] = Math.round(sb / sw); data[i + 3] = 255
  rimPx++
}
console.log(`clusters ${clusters}, spot ${spotPx} px, rim ${rimPx} px, filled ${filled + rimPx} px`)

await sharp(data, { raw: { width: W, height: H, channels: C } })
  
  .png().toFile(outPath)
console.log('-> ' + outPath)
