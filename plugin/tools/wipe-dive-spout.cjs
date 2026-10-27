/**
 * 抹掉深潜立绘上那股喷水。
 *
 * 设定图给每个姿态都画了头顶小水柱。居家与打盹时它合理（鲸浮在水面呼吸），但深潜姿态
 * 整体转向后水柱跑到身侧，读起来像"从身上漏水"，而且水下深潜本就不该喷水。
 *
 * 走过的弯路都记在这里，免得重犯：
 *   - 连通域法无效：水柱与鲸头在 alpha 上相连，整图始终只有 1 个连通域
 *   - 靠网格猜坐标无效：曾把 x<38 / y62-115 整块清空，直接切掉鲸体左轮廓，出现方形缺口
 *   - 只按颜色擦不干净：水柱自带的深棕描边与鲸体描边完全同色
 *   - 分成两个 sharp 调用写同一文件会竞态：后完成者覆盖前者，成果全丢（面积回到原值）
 *
 * 最终四步都建立在两个不依赖人工坐标的事实上：
 *   ① 鲸体永远是每行最靠右的那一大段 → 删掉其余的左侧窄段（水柱主体与描边）
 *   ② 水柱填充是浅青蓝，鲸体深蓝 B≈167、腹部 R>G>B → 按色补擦贴着鲸头的部分
 *   ③ 残下的零星水滴按孤立小簇清理
 *   ④ 鲸体轮廓线的一侧必然紧邻蓝色躯体或米白腹部，而水柱描边此刻两侧都已透明
 *      → 邻域内没有填充色的深色像素即为水柱残留描边
 *
 * 全程单次读取、四步顺序处理、一次写入。
 */
const sharp = require('sharp')
const path = require('path')

const SRC = path.join(__dirname, '..', 'web', 'art', 'pose-sheet-dive.png')
const LEFT_ZONE = 75    // 只在这个横向范围内动手
const MAX_STRAY_W = 40  // 比这更宽的段不可能是水花
const STRAY_AREA = 150  // 孤立小簇的面积上限
const RADIUS = 6        // 判断"附近有无填充色"的搜索半径

sharp(SRC).ensureAlpha().raw().toBuffer({ resolveWithObject: true }).then(({ data, info }) => {
  const { width: W, height: H, channels: C } = info
  const A = (x, y) => data[(y * W + x) * C + 3]
  const clear = (x, y) => { const i = (y * W + x) * C; data[i] = 0; data[i + 1] = 0; data[i + 2] = 0; data[i + 3] = 0 }
  const area = () => { let n = 0; for (let p = 0; p < W * H; p++) if (data[p * C + 3] > 24) n++; return n }
  const before = area()

  const isWater = (x, y) => {
    const i = (y * W + x) * C
    const r = data[i], g = data[i + 1], b = data[i + 2]
    return b > 195 && g > 188 && b - r > 16
  }
  /** 填充色：蓝色躯体或米白腹部（描边与水色都不算） */
  const isFill = (x, y) => {
    const i = (y * W + x) * C
    if (data[i + 3] < 100) return false
    const r = data[i], g = data[i + 1], b = data[i + 2]
    return (b > 140 && b - r > 45) || (r > 205 && g > 190 && b < 235)
  }
  const rowSegments = (y) => {
    const segs = []
    let cur = null
    for (let x = 0; x < W; x++) {
      if (A(x, y) > 24) { if (cur === null) cur = { a: x, b: x }; else cur.b = x }
      else if (cur !== null) { segs.push(cur); cur = null }
    }
    if (cur !== null) segs.push(cur)
    return segs
  }

  /* ① 删除除最右段以外的左侧窄段 */
  let n1 = 0
  for (let y = 0; y < H; y++) {
    const segs = rowSegments(y)
    if (segs.length < 2) continue // 只有一段：那就是鲸体，绝不触碰
    const body = segs[segs.length - 1]
    for (const s of segs.slice(0, -1)) {
      if (s.b >= LEFT_ZONE || s.b - s.a + 1 > MAX_STRAY_W || s.b >= body.a - 1) continue
      for (let x = s.a; x <= s.b; x++) if (A(x, y) > 0) { clear(x, y); n1++ }
    }
  }

  /* ② 左侧区域按水色补擦 */
  let n2 = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < LEFT_ZONE && x < W; x++) {
    if (A(x, y) === 0 || !isWater(x, y)) continue
    clear(x, y); n2++
  }

  /* ③ 清孤立小簇 */
  const seen = new Uint8Array(W * H)
  let n3 = 0
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x
    if (seen[i] || A(x, y) < 24) continue
    const st = [i]; seen[i] = 1; const cell = [i]
    while (st.length) {
      const p = st.pop(); const cx = p % W, cy = (p - cx) / W
      for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        const q = ny * W + nx
        if (seen[q] || A(nx, ny) < 24) continue
        seen[q] = 1; st.push(q); cell.push(q)
      }
    }
    if (cell.length < STRAY_AREA) for (const p of cell) { const cx = p % W; clear(cx, (p - cx) / W); n3++ }
  }

  /* ④ 擦掉与填充色无邻接的深色像素（水柱的残留描边） */
  const doomed = []
  for (let y = 0; y < H; y++) for (let x = 0; x < LEFT_ZONE && x < W; x++) {
    if (A(x, y) === 0 || isFill(x, y)) continue
    let near = false
    for (let dy = -RADIUS; dy <= RADIUS && !near; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
        if (isFill(nx, ny)) { near = true; break }
      }
    }
    if (!near) doomed.push([x, y])
  }
  for (const [x, y] of doomed) clear(x, y)

  const after = area()
  return sharp(data, { raw: { width: W, height: H, channels: C } }).png().toFile(SRC).then(() => {
    console.log(`分段删 ${n1} + 水色擦 ${n2} + 小簇清 ${n3} + 孤立描边 ${doomed.length} 像素`)
    console.log(`不透明面积 ${before} → ${after}（减少 ${before - after}）`)
    if (after >= before) { console.error('面积没有减少，处理未生效'); process.exit(1) }
  })
}).catch((e) => { console.error(e.message); process.exit(1) })
