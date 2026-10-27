/**
 * tools/make-placeholders.cjs —— 明信片占位图生成器
 *
 * 背景：AI 生图路线（文字直出 / 图生图）无法保证 15 张明信片里的鲸鱼形象一致，
 * 成品忽好忽坏。为让项目在美术定稿前保持完整、可运行、可预览，本脚本把 15 张
 * 明信片（7 场景 + 8 稀有）统一替换为**干净的占位图**：
 *   · 海面质感柔和蓝渐变底（rare 额外叠一层暖光晕，区别于普通卡）
 *   · 半透明的基准立绘（pose-sheet-float-lv0.png）作为居中水印——占位期也保持
 *     「同一只鲸」的形象一致性
 *   · 虚线框 + 「占位图 · PLACEHOLDER」标签 + 中文名 / 英文名 / 文件名
 * 美术定稿后，用真实图覆盖同名文件即可，本脚本可留作降级/预览兜底。
 *
 * 纯确定性（sharp + SVG），不依赖任何模型；逐文件幂等覆盖。
 * 用法：node tools/make-placeholders.cjs
 */
const sharp = require('sharp')
const path = require('path')
const fs = require('fs')

const ART = path.join(__dirname, '..', 'web', 'art')
const W = 800
const H = 600

/** 15 张明信片：key=稀有/场景标识，file=落盘名，kind=scene|rare */
const CARDS = [
  { key: 'shipwreck', file: 'scene-shipwreck.jpg', zh: '沉船书房', en: 'Shipwreck Study', kind: 'scene' },
  { key: 'coral', file: 'scene-coral.jpg', zh: '珊瑚苗圃', en: 'Coral Nursery', kind: 'scene' },
  { key: 'plankton', file: 'scene-plankton.jpg', zh: '磷虾集市', en: 'Krill Market', kind: 'scene' },
  { key: 'current', file: 'scene-current.jpg', zh: '洋流赛道', en: 'Current Race', kind: 'scene' },
  { key: 'trench', file: 'scene-trench.jpg', zh: '海沟边缘', en: 'Trench Edge', kind: 'scene' },
  { key: 'dolphin', file: 'scene-dolphin.jpg', zh: '与海豚同游', en: 'Dolphin Friend', kind: 'scene' },
  { key: 'opensea', file: 'scene-opensea.jpg', zh: '开阔洋面', en: 'Open Sea', kind: 'scene' },
  { key: 'companion', file: 'rare-companion.jpg', zh: '稀有 · 同伴', en: 'Companion', kind: 'rare' },
  { key: 'storm', file: 'rare-storm.jpg', zh: '稀有 · 风暴', en: 'Storm', kind: 'rare' },
  { key: 'aurora', file: 'rare-aurora.jpg', zh: '稀有 · 极光', en: 'Aurora', kind: 'rare' },
  { key: 'milestone', file: 'rare-milestone.jpg', zh: '稀有 · 里程碑', en: 'Milestone', kind: 'rare' },
  { key: 'marathon', file: 'rare-marathon.jpg', zh: '稀有 · 马拉松', en: 'Marathon', kind: 'rare' },
  { key: 'pod', file: 'rare-pod.jpg', zh: '稀有 · 鲸群', en: 'Pod', kind: 'rare' },
  { key: 'abyss', file: 'rare-abyss.jpg', zh: '稀有 · 深渊', en: 'Abyss', kind: 'rare' },
  { key: 'festival', file: 'rare-festival.jpg', zh: '稀有 · 庆典', en: 'Festival', kind: 'rare' },
]

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** 底图：海面渐变 + 水波线 +（rare）暖光晕 */
function bgSvg(card) {
  const glow =
    card.kind === 'rare'
      ? `<defs><radialGradient id="glow" cx="0.8" cy="0.22" r="0.55">
           <stop offset="0%" stop-color="rgba(255,214,150,0.55)"/>
           <stop offset="100%" stop-color="rgba(255,214,150,0)"/>
         </radialGradient></defs><rect width="${W}" height="${H}" fill="url(#glow)"/>`
      : ''
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#e9f4fc"/><stop offset="46%" stop-color="#cbe6f4"/>
    <stop offset="100%" stop-color="#95cbe8"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  ${glow}
  <g fill="none" stroke="#ffffff" stroke-opacity="0.22" stroke-width="3">
    <path d="M0 470 q100 -18 200 0 t200 0 t200 0 t200 0"/>
    <path d="M0 512 q100 -18 200 0 t200 0 t200 0 t200 0"/>
    <path d="M0 554 q100 -18 200 0 t200 0 t200 0 t200 0"/>
  </g>
</svg>`
}

/** 覆盖层：虚线框 + 占位标签 + 稀有 chip + 居中标题 + 副标题 + 水印提示 */
function overlaySvg(card) {
  const kindChip =
    card.kind === 'rare'
      ? `<g><rect x="316" y="360" width="168" height="34" rx="17" fill="#f59473"/>
           <text x="400" y="383" text-anchor="middle" font-size="18" letter-spacing="1" fill="#ffffff" font-weight="bold">RARE · 稀有卡</text></g>`
      : `<g><rect x="322" y="360" width="156" height="34" rx="17" fill="#5180c2"/>
           <text x="400" y="383" text-anchor="middle" font-size="18" letter-spacing="1" fill="#ffffff" font-weight="bold">SCENE · 明信片</text></g>`
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <rect x="22" y="22" width="${W - 44}" height="${H - 44}" rx="20" fill="none"
        stroke="#ffffff" stroke-opacity="0.75" stroke-width="3" stroke-dasharray="14 10"/>
  <g><rect x="44" y="44" width="236" height="40" rx="20" fill="rgba(255,255,255,0.72)"/>
     <text x="162" y="70" text-anchor="middle" font-size="19" fill="#4b6584" letter-spacing="1">占位图 · PLACEHOLDER</text></g>
  <text x="400" y="452" text-anchor="middle" font-size="54" font-weight="bold" fill="#2f5478"
        style="font-family:'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif">${esc(card.zh)}</text>
  <text x="400" y="488" text-anchor="middle" font-size="22" fill="#42628a"
        style="font-family:sans-serif">${esc(card.en)} · ${esc(card.file)}</text>
  ${kindChip}
</svg>`
}

/** 把立绘等比缩到目标框内（sharp resize 默认只缩不放） */
async function fitWhale(fitW, fitH) {
  const src = path.join(ART, 'pose-sheet-float-lv0.png')
  const m = await sharp(src).metadata()
  const scale = Math.min(fitW / m.width, fitH / m.height)
  return sharp(src)
    .resize(Math.max(1, Math.round(m.width * scale)), Math.max(1, Math.round(m.height * scale)), { fit: 'fill' })
    .ensureAlpha()
    .toBuffer()
}

async function make(card) {
  // 1) 先把立绘压成半透明水印（alpha ×0.16），居中
  const whaleFit = await fitWhale(420, 320)
  const { data, info } = await sharp(whaleFit).raw().toBuffer({ resolveWithObject: true })
  for (let p = 0; p < info.width * info.height; p++) {
    data[p * info.channels + 3] = Math.round(data[p * info.channels + 3] * 0.16)
  }
  const faint = await sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } })
    .png()
    .toBuffer()
  const wm = await sharp(faint).metadata()
  const whaleLayer = { input: faint, left: Math.round((W - wm.width) / 2), top: Math.round((H - wm.height) / 2) - 18 }

  // 2) 三层顺序：底图 →（半透明鲸）→ 文字/边框覆盖层（保证文字压在鲸之上、清晰可读）
  const base = Buffer.from(bgSvg(card))
  const overlay = Buffer.from(overlaySvg(card))
  const out = path.join(ART, card.file)
  await sharp(base)
    .composite([whaleLayer, { input: overlay }])
    .jpeg({ quality: 85, mozjpeg: true })
    .toFile(out)
  console.log(`  ✅ ${card.file.padEnd(22)} ${card.zh}`)
}

;(async () => {
  if (!fs.existsSync(ART)) {
    console.error('找不到 art 目录：' + ART)
    process.exit(1)
  }
  console.log(`生成 ${CARDS.length} 张明信片占位图 → ${ART}`)
  for (const card of CARDS) await make(card)
  console.log('完成。美术定稿后用真实图覆盖同名文件即可。')
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
