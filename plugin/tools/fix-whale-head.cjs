#!/usr/bin/env node
/**
 * 鲸立绘头部后处理：清除头顶呼吸孔开口/斑点 + 校色。
 *
 * ImageGen 无视 "no blowhole" 指令是常态，生成后统一跑本工具：
 *   ① 头顶区域（上 1/3）内的深色簇（呼吸孔开口腔、斑点）全部清除，
 *      填充方式：逐列从簇顶向下用上方最近体色延伸（无色块感）
 *   ② 全图饱和度校正，贴合 #4D6BFE 的鲜艳度
 *
 * 用法：node tools/fix-whale-head.mjs <in.png> <out.png>
 */
import sharp from 'sharp'

const [inPath, outPath] = process.argv.slice(2)
if (!inPath || !outPath) { console.error('用法: node tools/fix-whale-head.mjs <in> <out>'); process.exit(1) }

const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const { width: W, height: H, channels: C } = info
const at = (x, y) => { const i = (y * W + x) * C; return [data[i], data[i+1], data[i+2], data[i+3]] }
const set = (x, y, r, g, b, a) => { const i = (y * W + x) * C; data[i] = r; data[i+1] = g; data[i+2] = b; data[i+3] = a }

/* ① 头顶区深色簇清除（呼吸孔开口、斑点）。头顶区 = 上 40% 高度。 */
const headBottom = Math.round(H * 0.4)
const isDark = (x, y) => {
  const [r, g, b, a] = at(x, y)
  if (a < 100) return false
  return r < 115 && g < 115 && b < 150
}
const seen = new Uint8Array(W * H)
let cleared = 0
for (let y = 0; y <= headBottom; y++) for (let x = 0; x < W; x++) {
  const i = y * W + x
  if (seen[i] || !isDark(x, y)) continue
  const st = [i]; seen[i] = 1; const cell = [i]
  while (st.length) {
    const p = st.pop(); const cx = p % W, cy = (p - cx) / W
    for (const [nx, ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]) {
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
      const q = ny * W + nx
      if (seen[q] || !isDark(nx, ny)) continue
      seen[q] = 1; st.push(q); cell.push(q)
    }
  }
  // 排除描边大簇（描边与头轮廓连通时面积巨大）：只清面积 < H*0.6 的簇
  if (cell.length > H * 0.6) continue
  const cols = {}
  for (const p of cell) { const cx = p % W, cy = (p - cx) / W; (cols[cx] = cols[cx] || []).push(cy) }
  for (const cxS of Object.keys(cols)) {
    const cx = Number(cxS)
    const ys = cols[cx].sort((a, b) => a - b)
    let src = null
    for (let yy = ys[0] - 1; yy >= 0; yy--) {
      const [r, g, b, a] = at(cx, yy)
      if (a > 240 && b > 130 && b - r > 20 && !(r < 115 && g < 115)) { src = [r, g, b]; break }
    }
    if (!src) continue
    for (const yy of ys) { set(cx, yy, src[0], src[1], src[2], 255); cleared++ }
  }
}

/* ② 校色：饱和度贴合 #4D6BFE 鲜艳度 */
const out = await sharp(data, { raw: { width: W, height: H, channels: C } })
  .modulate({ saturation: 1.28, brightness: 1.02 })
  .png().toFile(outPath)
console.log(`头顶深色簇清除 ${cleared} px，校色完成 → ${outPath}`)
