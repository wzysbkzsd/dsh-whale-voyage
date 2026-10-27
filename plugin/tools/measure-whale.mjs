/**
 * 鲸鱼特征测量：对参考图/生成图做像素级特征提取，输出可对比的量化指标。
 *
 * 指标：
 *   bbox 宽高比、体色中位、描边色中位、
 *   眼睛（暗簇：数量/相对尺寸/质心位置）、鼻点（前端小暗簇）、
 *   腮红（橙簇：位置/颜色）、蓝白分界高度（3 个横向采样点）
 *
 * 用法：node tools/measure-whale.mjs <image...>
 */
import sharp from 'sharp'

for (const file of process.argv.slice(2)) {
  const { data, info } = await sharp(file).flatten({ background: '#ffffff' }).raw().toBuffer({ resolveWithObject: true })
  const { width: W, height: H, channels: C } = info
  const idx = (x, y) => (y * W + x) * C
  const px = (x, y) => { const i = idx(x, y); return [data[i], data[i + 1], data[i + 2], data[i + 3]] }

  /* 体色掩膜：深蓝占优（b-r>50 且 b>140）——排除青绿水池/浪花（b-r 小） */
  const isBody = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false
    const i = idx(x, y)
    if (data[i + 3] < 100) return false
    return data[i + 2] - data[i] > 50 && data[i + 2] > 140
  }
  let minX = W, maxX = -1, minY = H, maxY = -1
  const bodyLums = { r: [], g: [], b: [] }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!isBody(x, y)) continue
    if (x < minX) minX = x; if (x > maxX) maxX = x
    if (y < minY) minY = y; if (y > maxY) maxY = y
    const [r, g, b] = px(x, y)
    bodyLums.r.push(r); bodyLums.g.push(g); bodyLums.b.push(b)
  }
  if (maxX < 0) { console.log(`${file}: 无体色像素`); continue }
  const med = (a) => a.sort((x, y) => x - y)[Math.floor(a.length / 2)]
  const bodyRGB = [med(bodyLums.r), med(bodyLums.g), med(bodyLums.b)]
  const BW = maxX - minX + 1, BH = maxY - minY + 1

  /* 暗簇分析：lum<330 的连通域；贴 bbox 边的大域=描边，内部域=五官 */
  const isDark = (x, y) => {
    if (!inB(x, y)) return false
    const i = idx(x, y)
    return data[i + 3] > 100 && data[i] + data[i + 1] + data[i + 2] < 330
  }
  const inB = (x, y) => x >= 0 && y >= 0 && x < W && y < H
  const seen = new Uint8Array(W * H)
  const outline = [], features = []
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const p = y * W + x
    if (seen[p] || !isDark(x, y)) continue
    const stk = [p]; seen[p] = 1; const cell = [p]
    let touchesEdge = false
    let fx0 = x, fx1 = x, fy0 = y, fy1 = y
    while (stk.length) {
      const q = stk.pop(); const cx = q % W, cy = (q - cx) / W
      if (cx <= minX + 1 || cx >= maxX - 1 || cy <= minY + 1 || cy >= maxY - 1) touchesEdge = true
      if (cx < fx0) fx0 = cx; if (cx > fx1) fx1 = cx; if (cy < fy0) fy0 = cy; if (cy > fy1) fy1 = cy
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy
        if (!inB(nx, ny)) continue
        const np = ny * W + nx
        if (seen[np] || !isDark(nx, ny)) continue
        seen[np] = 1; stk.push(np); cell.push(np)
      }
    }
    const feat = { size: cell.length, x0: fx0, x1: fx1, y0: fy0, y1: fy1, nx: ((fx0 + fx1) / 2 - minX) / BW, ny: ((fy0 + fy1) / 2 - minY) / BH }
    if (touchesEdge && cell.length > BW * BH * 0.02) outline.push(feat)
    else if (cell.length >= 12) features.push({ ...feat, cell })
  }
  features.sort((a, b) => b.size - a.size)
  /* 五官描述：最大的 1-2 个=眼睛，小而靠前=鼻点候选 */
  const eye = features[0]
  const eye2 = features.find((f) => f !== eye && f.size >= eye.size * 0.35 && Math.abs(f.ny - eye.ny) < 0.15)
  const nose = features.find((f) => f !== eye && f !== eye2 && f.size < 400 && f.nx < eye.nx)
  /* 腮红：橙色簇（r-b>40 且 r>150）取最大 */
  const seenB = new Uint8Array(W * H)
  let blush = null
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const p = y * W + x
    if (seenB[p]) continue
    const i0 = idx(x, y)
    if (data[i0 + 3] < 100) continue
    const r = data[i0], g = data[i0 + 1], b = data[i0 + 2]
    if (!(r - b > 40 && r > 150 && g < r && g > b)) continue
    const stk = [p]; seenB[p] = 1; const cell = [p]
    let cx0 = x, cx1 = x, cy0 = y, cy1 = y
    while (stk.length) {
      const q = stk.pop(); const cx = q % W, cy = (q - cx) / W
      if (cx < cx0) cx0 = cx; if (cx > cx1) cx1 = cx; if (cy < cy0) cy0 = cy; if (cy > cy1) cy1 = cy
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy
        if (!inB(nx, ny)) continue
        const np = ny * W + nx
        if (seenB[np]) continue
        const j = np * C
        const rr = data[j], gg = data[j + 1], bb = data[j + 2]
        if (data[j + 3] < 100 || !(rr - bb > 40 && rr > 150 && gg < rr && gg > bb)) continue
        seenB[np] = 1; stk.push(np); cell.push(np)
      }
    }
    if (cell.length > 60 && (!blush || cell.length > blush.size)) blush = { size: cell.length, nx: ((cx0 + cx1) / 2 - minX) / BW, ny: ((cy0 + cy1) / 2 - minY) / BH }
  }
  /* 蓝白分界高度：体宽 30%/50%/70% 三列，自上向下从体色转奶白（r>b）的相对高度 */
  const boundary = []
  for (const fx of [0.3, 0.5, 0.7]) {
    const x = Math.round(minX + BW * fx)
    let seenBody = 0, found = null
    for (let y = minY; y <= maxY; y++) {
      const [r, g, b2, a] = px(x, y)
      if (a < 100) continue
      if (isBody(x, y)) { seenBody++; continue }
      /* 蓝色像素累计足够之后，第一段奶白（r>b）即蓝白分界 */
      if (seenBody > BH * 0.12 && r > b2 + 10 && r > 150) { found = y; break }
    }
    boundary.push(found === null ? null : +((found - minY) / BH).toFixed(2))
  }
  console.log(`${file.split('/').pop()}  bbox比 ${BW}x${BH}(${(BW / BH).toFixed(2)})  体色 rgb(${bodyRGB.join(',')})  眼(相对) size${eye ? (eye.size / (BW * BH) * 1000).toFixed(1) : '-'}‰ nx${eye ? eye.nx.toFixed(2) : '-'} ny${eye ? eye.ny.toFixed(2) : '-'}${eye2 ? ` +眼2 size${(eye2.size / (BW * BH) * 1000).toFixed(1)}‰ nx${eye2.nx.toFixed(2)}` : ''}  鼻点${nose ? `✓ nx${nose.nx.toFixed(2)} ny${nose.ny.toFixed(2)} size${nose.size}` : '✗缺失'}  腮红${blush ? `✓ nx${blush.nx.toFixed(2)} ny${blush.ny.toFixed(2)}` : '✗'}  分界y ${boundary.join('/')}`)
  console.log(`   内部暗簇明细: ${features.slice(0, 5).map((f) => `size${f.size}@nx${f.nx.toFixed(2)},ny${f.ny.toFixed(2)}`).join('  ')}`)
}
