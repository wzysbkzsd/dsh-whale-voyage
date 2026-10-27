/**
 * tools/normalize-poses.mjs
 * 归一化姿态立绘：把多张独立美术图统一为「同一画布 + 鲸身同高 + 底部对齐」，
 * 解决因原图宽高比不同导致页面里鲸鱼大小不一、下潜姿态偏高偏下的问题。
 *
 * 用法：node tools/normalize-poses.mjs
 * 读取 plugin/web/art/ 下 8 张 pose-sheet-*.png（透明底），覆盖同名文件。
 * 目标参数：targetH 鲸身高度、canvasW/H 画布、bottomPad 底部留白。
 */
import sharp from 'sharp'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ART_DIR = path.resolve(__dirname, '../web/art')

const FILES = [
  'pose-sheet-float.png',
  'pose-sheet-float-lv0.png',
  'pose-sheet-float-lv1.png',
  'pose-sheet-float-lv2.png',
  'pose-sheet-float-lv3.png',
  'pose-sheet-dive.png',
  'pose-sheet-surface.png',
  'pose-sheet-sleep.png',
]

const TARGET_H = 320      // 鲸身目标高度（px）
const CANVAS_W = 520      // 统一画布宽
const CANVAS_H = 440      // 统一画布高（顶部留白约 96px，底部留白 24px）
const BOTTOM_PAD = 24     // 鲸身底边距画布底边
const MARGIN_X = 40       // 画布左右最小留白

/** 计算非透明像素包围盒 */
async function bbox(p) {
  const { data, info } = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  const { width: w, height: h } = info
  let x0 = w, y0 = h, x1 = -1, y1 = -1
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 10) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  return { x0, y0, x1: x1 + 1, y1: y1 + 1, w, h }
}

async function main() {
  const report = []
  for (const f of FILES) {
    const src = path.join(ART_DIR, f)
    if (!fs.existsSync(src)) { console.log(`  ⚠ 缺失 ${f}`); continue }
    const b = await bbox(src)
    const bw = b.x1 - b.x0
    const bh = b.y1 - b.y0
    let scale = TARGET_H / bh
    if (bw * scale > CANVAS_W - 2 * MARGIN_X) scale = (CANVAS_W - 2 * MARGIN_X) / bw
    const outW = Math.max(1, Math.round(bw * scale))
    const outH = Math.max(1, Math.round(bh * scale))
    const left = Math.round((CANVAS_W - outW) / 2)
    const top = CANVAS_H - BOTTOM_PAD - outH

    const crop = await sharp(src)
      .extract({ left: b.x0, top: b.y0, width: bw, height: bh })
      .resize(outW, outH, { fit: 'fill' })
      .png()
      .toBuffer()
    const tmp = src + '.norm.tmp.png'
    await sharp({
      create: { width: CANVAS_W, height: CANVAS_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    }).composite([{ input: crop, left, top }]).png().toFile(tmp)
    fs.renameSync(tmp, src)

    // 验证：归一化后 bbox（高度应≈TARGET_H，底边应≈CANVAS_H-BOTTOM_PAD）
    const nb = await bbox(src)
    const nh = nb.y1 - nb.y0
    const bottomY = nb.y1 - 1
    report.push(`${f.padEnd(30)} 原图 ${b.w}x${b.h} 鲸身 ${bw}x${bh} → 归一后 ${CANVAS_W}x${CANVAS_H} 鲸身高 ${nh} 底边 y=${bottomY}（期望≈${TARGET_H} / ${CANVAS_H - BOTTOM_PAD}）`)
  }
  console.log(report.join('\n'))
}

main().catch((e) => { console.error(e); process.exit(1) })
