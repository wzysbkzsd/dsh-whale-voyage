#!/usr/bin/env node
/**
 * 立绘透明化：奶油底 → 透明底（洪水填充，只清与边角底色连通的背景，
 * 不碰鲸身奶白肚皮——肚皮与背景同色但与边缘不连通，因此保留）。
 * 用法：node tools/make-transparent.mjs <in.png> <out.png>
 */
import sharp from 'sharp'

const [inPath, outPath] = process.argv.slice(2)
if (typeof inPath !== 'string' || typeof outPath !== 'string') {
  console.error('用法: node tools/make-transparent.mjs <in.png> <out.png>')
  process.exit(1)
}

const { data, info } = await sharp(inPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const W = info.width, H = info.height, C = info.channels
const idx = (x, y) => (y * W + x) * C

// 以四角均色为背景基准
const corners = [[0, 0], [W - 1, 0], [0, H - 1], [W - 1, H - 1]].map(([x, y]) => {
  const i = idx(x, y)
  return [data[i], data[i + 1], data[i + 2]]
})
const bg = corners.reduce((a, c) => a.map((v, i) => v + c[i] / corners.length), [0, 0, 0])

const near = (i) => {
  const d = Math.hypot(data[i] - bg[0], data[i + 1] - bg[1], data[i + 2] - bg[2])
  return d < 38
}

const visited = new Uint8Array(W * H)
const queue = []
for (let x = 0; x < W; x += 1) { queue.push([x, 0], [x, H - 1]) }
for (let y = 0; y < H; y += 1) { queue.push([0, y], [W - 1, y]) }

while (queue.length > 0) {
  const [x, y] = queue.pop()
  if (x < 0 || y < 0 || x >= W || y >= H) continue
  const p = y * W + x
  if (visited[p] === 1) continue
  visited[p] = 1
  const i = p * C
  if (!near(i)) continue
  data[i + 3] = 0
  queue.push([x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1])
}

await sharp(data, { raw: { width: W, height: H, channels: C } }).png().toFile(outPath)

// 自检：输出中心像素应不透明（鲸身），角应透明
const after = await sharp(outPath).raw().toBuffer({ resolveWithObject: true })
const a = after.data
const cx = idx(Math.floor(W / 2), Math.floor(H * 0.55)) + 3
const cornerA = idx(2, 2) + 3
console.log(`${outPath}: 中心 alpha=${a[cx]}(应255) 角 alpha=${a[cornerA]}(应0) 尺寸=${W}x${H}`)
