/**
 * 明信片合成 v3：页面立绘（形象 100% 一致）× AI 场景背景。
 *
 * v2 的图层工艺保留（前景层 / 水下色罩 / 水线浸入 / 光斑），v3 新增：
 *   1. 水池底座处理：float/surface 立绘自带"水面池"。水面场景保留池子
 *      （自带水线，是角色的标志性造型）；水下场景用颜色分类剥离池子
 *      （池=青绿 g 高且 |b-g| 小且 r 偏低，与深蓝体色 b-g 大、奶白 r 高可分）
 *   2. 投影：鲸体下方软椭圆暗影（径向渐变），把鲸"压"进场景
 *   3. 气泡：水下场景沿鲸尾迹生成半透明气泡（确定性伪随机，可复现）
 *   4. --rot 旋转：姿态沿场景动线倾斜（洋流滑梯、风暴跃弧）
 *   5. JPEG q92 mozjpeg（对齐画质管线）
 *
 * 用法：node tools/compose-postcard.cjs <背景> <输出> [选项]
 *   --pose float|dive|surface|sleep|float-lv0..3
 *   --strip                           剥离水池底座（水下场景用）
 *   --x N --y N --h N --flip --rot N
 *   --fg N（前景层）--deep 0..1（水下色罩）--soak 0..1（水线浸入）
 *   --water R,G,B --glow R,G,B[,A] --shadow A（投影强度0-100）--bubbles N
 */
const sharp = require('sharp')
const path = require('path')

const ART = path.join(__dirname, '..', 'web', 'art')
const args = process.argv.slice(2)
const bgPath = args[0]
const outPath = args[1]
const opt = { occludes: [], light: null, pose: 'float', x: null, y: null, h: 210, flip: false, rot: 0, fg: 0, soak: 0, deep: 0, water: null, glow: '255,255,255,40', shadow: 30, bubbles: 0, strip: false }
for (let i = 2; i < args.length; i++) {
  if (args[i] === '--pose') opt.pose = args[++i]
  else if (args[i] === '--x') opt.x = Number(args[++i])
  else if (args[i] === '--y') opt.y = Number(args[++i])
  else if (args[i] === '--h') opt.h = Number(args[++i])
  else if (args[i] === '--flip') opt.flip = true
  else if (args[i] === '--rot') opt.rot = Number(args[++i])
  else if (args[i] === '--fg') opt.fg = Number(args[++i])
  else if (args[i] === '--soak') opt.soak = Number(args[++i])
  else if (args[i] === '--deep') opt.deep = Number(args[++i])
  else if (args[i] === '--water') opt.water = args[++i]
  else if (args[i] === '--glow') opt.glow = args[++i]
  else if (args[i] === '--shadow') opt.shadow = Number(args[++i])
  else if (args[i] === '--bubbles') opt.bubbles = Number(args[++i])
  else if (args[i] === '--strip') opt.strip = true
  else if (args[i] === '--sprite') opt.sprite = args[++i]
  else if (args[i] === '--occlude') opt.occludes.push(args[++i])
  else if (args[i] === '--light') opt.light = args[++i]
}

;(async () => {
  const bgBuf = await sharp(bgPath).resize(800, 600, { fit: 'cover' }).toBuffer()
  const W = 800, H = 600

  let water = opt.water
  if (water === null) {
    const { data } = await sharp(bgBuf).resize(1, 1).raw().toBuffer({ resolveWithObject: true })
    water = `${data[0]},${data[1]},${data[2]}`
  }
  const [wr, wg, wb] = water.split(',').map(Number)

  /* 立绘：缩放 → (剥离池) → 翻转 → 旋转 */
  const whaleSrc = opt.sprite || path.join(ART, `pose-sheet-${opt.pose}.png`)
  let whale = sharp(whaleSrc)
  if (opt.strip) {
    /* 剥离水池底座：青绿池色（g 高、|b-g| 小、r 偏低）置为透明，再裁紧 */
    const { data, info } = await sharp(whaleSrc).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const { width: SW, height: SH, channels: SC } = info
    for (let p = 0; p < SW * SH; p++) {
      const i = p * SC
      const r = data[i], g = data[i + 1], b = data[i + 2]
      if (g > 185 && Math.abs(b - g) < 25 && b >= r - 12 && r < 246) data[i + 3] = 0
    }
    /* 池沿白色浪花线是暖白色（b<r），颜色判据特意不碰奶白肚皮——但它贴着池区，
       用剥除掩膜向暖白像素扩散两轮收掉它（每轮 2px，只进高亮度暖白像素） */
    const stripped = new Uint8Array(SW * SH)
    for (let p = 0; p < SW * SH; p++) if (data[p * SC + 3] === 0) stripped[p] = 1
    for (let round = 0; round < 2; round++) {
      const add = []
      for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
        const p = y * SW + x
        if (stripped[p] || data[p * SC + 3] === 0) continue
        const i = p * SC
        const r = data[i], g = data[i + 1], b = data[i + 2]
        if (r < 140 || r + g + b < 500) continue // 只吃暖白/高亮像素（浪花线），不碰描边与体色
        let near = false
        for (let dy = -2; dy <= 2 && !near; dy++) for (let dx = -2; dx <= 2; dx++) {
          const nx = x + dx, ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < SW && ny < SH && stripped[ny * SW + nx]) { near = true; break }
        }
        if (near) add.push(p)
      }
      if (!add.length) break
      for (const p of add) { data[p * SC + 3] = 0; stripped[p] = 1 }
    }
    whale = sharp(data, { raw: { width: SW, height: SH, channels: SC } }).trim()
  }
  const meta0 = await sharp(await whale.png().toBuffer()).metadata()
  whale = sharp(await whale.png().toBuffer()).resize(Math.round(meta0.width * (opt.h / meta0.height)), opt.h)
  if (opt.flip) whale = whale.flop()
  if (opt.rot !== 0) whale = whale.rotate(opt.rot, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
  let whaleBuf = await whale.png().toBuffer()
  const wMeta = await sharp(whaleBuf).metadata()
  const whaleW = wMeta.width, whaleH = wMeta.height

  let x = opt.x ?? Math.round(W * 0.30 - whaleW / 2)
  let y = opt.y ?? Math.round(H * 0.52 - whaleH / 2)
  /* sharp 合成要求层完整落在画布内——越界的站位自动钳回 */
  if (x + whaleW > W - 4) x = W - 4 - whaleW
  if (y + whaleH > H - 4) y = H - 4 - whaleH
  if (x < 4) x = 4
  if (y < 4) y = 4

  const layers = []

  /* 光斑：鲸下方柔亮椭圆 */
  const [gr, gg, gb, ga] = opt.glow.split(',').map(Number)
  layers.push({
    input: Buffer.from(
      `<svg width="${W}" height="${H}"><defs><radialGradient id="g"><stop offset="0%" stop-color="rgba(${gr},${gg},${gb},${(ga ?? 40) / 100})"/><stop offset="100%" stop-color="rgba(${gr},${gg},${gb},0)"/></radialGradient></defs><ellipse cx="${x + whaleW / 2}" cy="${y + whaleH * 0.92}" rx="${whaleW * 0.8}" ry="${Math.round(whaleH * 0.16)}" fill="url(#g)"/></svg>`,
    ),
    left: 0, top: 0,
  })

  /* 投影：鲸体下方的软暗椭圆（把鲸压进场景） */
  if (opt.shadow > 0) {
    const dk = (v) => Math.round(v * 0.45)
    layers.push({
      input: Buffer.from(
        `<svg width="${W}" height="${H}"><defs><radialGradient id="s"><stop offset="0%" stop-color="rgba(${dk(wr)},${dk(wg)},${dk(wb)},${opt.shadow / 100})"/><stop offset="100%" stop-color="rgba(${dk(wr)},${dk(wg)},${dk(wb)},0)"/></radialGradient></defs><ellipse cx="${x + whaleW / 2 + 10}" cy="${y + whaleH + 10}" rx="${whaleW * 0.55}" ry="${Math.round(whaleH * 0.09)}" fill="url(#s)"/></svg>`,
      ),
      left: 0, top: 0,
    })
  }

  /* 气泡：沿鲸尾迹的半透明圆（水下场景），确定性伪随机 */
  if (opt.bubbles > 0) {
    let Circles = ''
    for (let k = 0; k < opt.bubbles; k++) {
      const t = (k + 1) / (opt.bubbles + 1)
      const bx = Math.round(x + whaleW * (opt.flip ? 0.95 - t * 0.35 : 0.05 + t * 0.35) + ((k * 37) % 23) - 11)
      const by = Math.round(y + whaleH * (0.65 - t * 0.55) + ((k * 53) % 17) - 8)
      const r = 3 + ((k * 29) % 7)
      Circles += `<circle cx="${bx}" cy="${by}" r="${r}" fill="rgba(255,255,255,0.13)" stroke="rgba(255,255,255,0.34)" stroke-width="1"/>`
    }
    layers.push({ input: Buffer.from(`<svg width="${W}" height="${H}">${Circles}</svg>`), left: 0, top: 0 })
  }

  /* 鲸本体：水下色罩 / 水线浸入（均先裁进鲸 alpha 再叠加） */
  let finalWhale = whaleBuf
  if (opt.deep > 0) {
    const tint = Buffer.from(
      `<svg width="${whaleW}" height="${whaleH}"><defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="rgba(${wr},${wg},${wb},0)"/><stop offset="100%" stop-color="rgba(${wr},${wg},${wb},${opt.deep})"/></linearGradient></defs><rect width="${whaleW}" height="${whaleH}" fill="url(#d)"/></svg>`,
    )
    const tintMasked = await sharp(tint).composite([{ input: finalWhale, blend: 'dest-in' }]).png().toBuffer()
    finalWhale = await sharp(finalWhale).composite([{ input: tintMasked }]).png().toBuffer()
  }
  if (opt.soak > 0) {
    const lineY = Math.round(whaleH * (1 - opt.soak))
    const soak = Buffer.from(
      `<svg width="${whaleW}" height="${whaleH}">
         <defs><linearGradient id="s" x1="0" y1="0" x2="0" y2="1">
           <stop offset="0%" stop-color="rgba(${wr},${wg},${wb},0.15)"/>
           <stop offset="100%" stop-color="rgba(${wr},${wg},${wb},0.62)"/>
         </linearGradient></defs>
         <rect x="0" y="${lineY}" width="${whaleW}" height="${whaleH - lineY}" fill="url(#s)"/>
         <path d="M0 ${lineY} q ${whaleW / 4} -5 ${whaleW / 2} 0 t ${whaleW / 2} 0" stroke="rgba(255,255,255,0.75)" stroke-width="2.5" fill="none"/>
       </svg>`,
    )
    const soakMasked = await sharp(soak).composite([{ input: finalWhale, blend: 'dest-in' }]).png().toBuffer()
    finalWhale = await sharp(finalWhale).composite([{ input: soakMasked }]).png().toBuffer()
  }

  layers.push({ input: finalWhale, left: x, top: y })

  /* 遮挡：把背景的指定矩形重绘到鲸前面——鲸的局部被场景元素盖住，才算「在里面」 */
  for (const occ of opt.occludes) {
    const [ox, oy, ow, oh] = occ.split(',').map(Number)
    const occBuf = await sharp(bgBuf).extract({ left: ox, top: oy, width: ow, height: oh }).toBuffer()
    layers.push({ input: occBuf, left: ox, top: oy })
  }

  /* 场景光：以场景光源为圆心的径向光，裁进鲸体形状后以 screen 叠加——朝向光源的一侧被照亮 */
  if (opt.light) {
    const [lx, ly, rad, lr, lg, lb, la] = opt.light.split(',').map(Number)
    const lightSvg = Buffer.from(
      `<svg width="${whaleW}" height="${whaleH}"><defs><radialGradient id="l"><stop offset="0%" stop-color="rgba(${lr},${lg},${lb},${(la ?? 35) / 100})"/><stop offset="100%" stop-color="rgba(${lr},${lg},${lb},0)"/></radialGradient></defs><circle cx="${lx - x}" cy="${ly - y}" r="${rad}" fill="url(#l)"/></svg>`
    )
    const lightMasked = await sharp(lightSvg).composite([{ input: finalWhale, blend: 'dest-in' }]).png().toBuffer()
    layers.push({ input: lightMasked, left: x, top: y, blend: 'screen' })
  }

  /* 前景层：背景底部 N px 盖在鲸前面 */
  if (opt.fg > 0) {
    const fgBuf = await sharp(bgBuf).extract({ left: 0, top: H - opt.fg, width: W, height: opt.fg }).toBuffer()
    layers.push({ input: fgBuf, left: 0, top: H - opt.fg })
  }

  const composed = await sharp(bgBuf).composite(layers).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
  await sharp(composed).toFile(outPath)
  console.log(`✅ ${path.basename(outPath)}（pose=${opt.pose}${opt.flip ? ' flip' : ''}${opt.rot ? ' rot' + opt.rot : ''} @ ${x},${y} h=${opt.h} fg=${opt.fg} soak=${opt.soak} deep=${opt.deep}${opt.strip ? ' strip' : ''}）`)
})().catch((e) => { console.error(e.message); process.exit(1) })
