/**
 * 配件贴图烘焙。
 *
 * 为什么烘焙而非 CSS 叠加：立绘是位图，CSS 定位的色块无法贴合轮廓，还会跟着呼吸动画
 * 一起飘（此前在鲸脸上压出一条横杠）。改为用 sharp 合成进立绘，位置一次校准、永久正确，
 * 且产物可直接肉眼验收。
 *
 * 锚点按立绘实测几何标定（pose-sheet-float 297x220）：
 *   头部 x 5%-50%，颈位 x≈52%，该列身体上沿 y≈21%、下沿 y≈90%，尾鳍伸至 x 99%。
 * 缠绕类配件（围巾）必须横跨整个身体轮廓才读得出"绕一圈"，并用底图 alpha 遮罩裁剪，
 * 保证不溢出轮廓；垂挂类（结、提灯）不裁剪。
 *
 * 产物：pose-sheet-float-lv1/2/3.png（羁绊等级递进，配件逐件叠加）
 * 用法：node tools/make-accessories.cjs
 */
const path = require('path')
const sharp = require('sharp')

const ART = path.resolve(__dirname, '..', 'web', 'art')
const BASE = path.join(ART, 'pose-sheet-float.png')

/* 配色跟随立绘：深褐描边 + 品牌暖橙 + 提灯暖黄 */
const INK = '#3f342c'
const WARM = '#f2956b'
const WARM_DARK = '#d2703f'
const GOLD = '#f0c46a'
const GLOW = '#ffe8b0'

const svg = (w, h, body) => Buffer.from(
  `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">${body}</svg>`,
)

/** 绶带主体：斜挎过身的带子，收在腹线上方（需遮罩裁剪）。 */
function scarfBand(w, h, ch) {
  const x0 = w * 0.487
  const x1 = w * 0.578
  const yTop = h * 0.185
  const yBot = h * 0.760
  const bulge = w * 0.030
  return svg(w, ch, `
    <g stroke="${INK}" stroke-width="2.6" stroke-linejoin="round">
      <path d="M${x0} ${yTop}
               C ${x0 - bulge} ${h * 0.45}, ${x0 - bulge * 0.4} ${h * 0.70}, ${x0 + w * 0.045} ${yBot}
               L ${x1 + w * 0.045} ${yBot}
               C ${x1 - bulge * 0.4} ${h * 0.70}, ${x1 - bulge} ${h * 0.45}, ${x1} ${yTop} Z"
            fill="${WARM}"/>
      <path d="M${x0 + w * 0.008} ${yTop + h * 0.02}
               C ${x0 - bulge * 0.85} ${h * 0.46}, ${x0 - bulge * 0.3} ${h * 0.70}, ${x0 + w * 0.050} ${yBot - h * 0.02}"
            fill="none" stroke="${WARM_DARK}" stroke-width="2.2" opacity="0.6"/>
    </g>`)
}

/** 绶带的结与飘带：贴在身上，不裁剪。 */
function scarfKnot(w, h, ch) {
  const kx = w * 0.556
  const ky = h * 0.745
  return svg(w, ch, `
    <g stroke="${INK}" stroke-width="2.4" stroke-linejoin="round">
      <path d="M${kx - w * 0.030} ${ky + h * 0.010}
               q ${-w * 0.050} ${h * 0.060}, ${-w * 0.028} ${h * 0.125}
               l ${w * 0.048} ${h * 0.008}
               q ${w * 0.000} ${-h * 0.062}, ${w * 0.020} ${-h * 0.118} Z"
            fill="${WARM_DARK}"/>
      <path d="M${kx + w * 0.026} ${ky + h * 0.010}
               q ${w * 0.040} ${h * 0.055}, ${w * 0.016} ${h * 0.110}
               l ${-w * 0.044} ${h * 0.004}
               q ${w * 0.004} ${-h * 0.058}, ${-w * 0.014} ${-h * 0.106} Z"
            fill="${WARM}"/>
      <ellipse cx="${kx}" cy="${ky}" rx="${w * 0.036}" ry="${h * 0.028}" fill="${WARM}"/>
    </g>`)
}

/** 船长标：别在围巾带上的小圆牌，刻一枚锚。 */
function anchorTag(w, h, ch) {
  const cx = w * 0.533
  const cy = h * 0.36
  const r = h * 0.050
  return svg(w, ch, `
    <g stroke="${INK}" stroke-width="1.9">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="${GOLD}"/>
      <g stroke-width="1.6" fill="none" stroke-linecap="round">
        <circle cx="${cx}" cy="${cy - r * 0.48}" r="${r * 0.16}"/>
        <path d="M${cx} ${cy - r * 0.3} L ${cx} ${cy + r * 0.5}"/>
        <path d="M${cx - r * 0.4} ${cy + r * 0.06} L ${cx + r * 0.4} ${cy + r * 0.06}"/>
        <path d="M${cx - r * 0.42} ${cy + r * 0.26} q ${r * 0.42} ${r * 0.5}, ${r * 0.84} 0"/>
      </g>
    </g>`)
}

/** 深海提灯：从围巾结垂下。 */
function lantern(w, h, ch) {
  const cx = w * 0.556
  const cy = h * 1.045
  const r = h * 0.062
  return svg(w, ch, `
    <g stroke="${INK}" stroke-width="2.1" stroke-linecap="round">
      <path d="M${cx} ${h * 0.745} L ${cx} ${cy - r * 1.22}" fill="none" stroke-width="1.7"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 1.12}" fill="${WARM}"/>
      <ellipse cx="${cx}" cy="${cy}" rx="${r * 0.46}" ry="${r * 0.6}" fill="${GLOW}" stroke="none"/>
      <path d="M${cx - r * 0.78} ${cy - r * 1.18} L ${cx + r * 0.78} ${cy - r * 1.18}" fill="none"/>
      <path d="M${cx - r * 0.68} ${cy + r * 1.08} L ${cx + r * 0.68} ${cy + r * 1.08}" fill="none"/>
    </g>`)
}

/** 同舟勋章：绶带加星，别在身侧蓝区（避开面部、腹部与尾鳍）。 */
function medal(w, h, ch) {
  const cx = w * 0.672
  const cy = h * 0.560
  const r = h * 0.062
  const star = Array.from({ length: 10 }, (_, i) => {
    const rad = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 === 0 ? r : r * 0.44
    return `${(cx + Math.cos(rad) * rr).toFixed(1)} ${(cy + Math.sin(rad) * rr).toFixed(1)}`
  }).join(' L ')
  return svg(w, ch, `
    <g stroke="${INK}" stroke-width="1.9" stroke-linejoin="round">
      <path d="M${cx - r * 0.5} ${cy - r * 1.95} l ${r} 0 l ${-r * 0.08} ${r * 0.95} l ${-r * 0.84} 0 Z" fill="${WARM}"/>
      <path d="M${star} Z" fill="${GOLD}"/>
    </g>`)
}

const PARTS = {
  scarf: [{ draw: scarfBand, clip: true }, { draw: scarfKnot, clip: false }],
  tag: [{ draw: anchorTag, clip: false }],
  lantern: [{ draw: lantern, clip: false }],
  medal: [{ draw: medal, clip: false }],
}

/** lv0 也输出到同一扩展画布，保证等级切换时立绘尺寸与基线不跳动。 */
const LEVELS = [
  { level: 0, keys: [] },
  { level: 1, keys: ['scarf'] },
  { level: 2, keys: ['scarf', 'tag', 'lantern'] },
  { level: 3, keys: ['scarf', 'tag', 'lantern', 'medal'] },
]

async function main() {
  const meta = await sharp(BASE).metadata()
  const w = meta.width
  const h = meta.height
  const padBottom = Math.round(h * 0.26) // 提灯垂在身体下方，画布需向下扩展
  const ch = h + padBottom

  // 底图铺到扩展画布，作为遮罩与底层
  const baseOnCanvas = await sharp({
    create: { width: w, height: ch, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: await sharp(BASE).png().toBuffer(), top: 0, left: 0 }]).png().toBuffer()

  for (const { level, keys } of LEVELS) {
    const layers = []
    for (const key of keys) {
      for (const { draw, clip } of PARTS[key]) {
        let buf = await sharp(draw(w, h, ch)).png().toBuffer()
        if (clip) {
          // 用底图 alpha 裁剪，缠绕带不会溢出身体轮廓
          buf = await sharp(buf).composite([{ input: baseOnCanvas, blend: 'dest-in' }]).png().toBuffer()
        }
        layers.push({ input: buf, top: 0, left: 0 })
      }
    }
    const file = path.join(ART, `pose-sheet-float-lv${level}.png`)
    await sharp(baseOnCanvas).composite(layers).png().toFile(file)
    const m = await sharp(file).metadata()
    console.log(`pose-sheet-float-lv${level}.png  ${m.width}x${m.height}`)
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
