/**
 * 构建期自查。
 *
 * 为什么需要：本项目连续多轮出现同一类回归——演示模式的数据写进真实持久化状态、
 * 同名 @keyframes 重复定义导致旧规则悄悄生效、被替换的旧规则残留后误导排查。
 * 这些都不是逻辑难题，而是"改动时忘了同步检查"。把检查固化在构建里，
 * 靠不变量自动生效，而不是靠人每次记得。
 *
 * 检查项：
 *   1. skin.ts 的每个 localStorage 写入点必须登记在下方清单里，并声明是否需要演示护栏；
 *      需要护栏的必须在函数体内出现 isDemo() 判断。新增未登记的写入点 → 失败。
 *   2. skin.css 中同名 @keyframes 不得重复定义（后定义者静默胜出，极易误判）。
 *   3. skin.css 中同一选择器不得重复声明 transform（权重相同时后者整条覆盖前者，
 *      这是"hover 一扫就放大两成"的成因）。
 *   4. skin.css 必须保留 hidden 兜底规则（作者样式的 display 会覆盖 hidden 属性，
 *      导致 JS 里的 el.hidden = true 完全无效）。
 *
 * 用法：node tools/selfcheck.cjs（已接入 npm run build 前置）
 */
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const SKIN_TS = path.join(ROOT, 'web-src/skin.ts')
const SKIN_CSS = path.join(ROOT, 'web/skin.css')

/**
 * 已审阅的持久化写入点。
 * demoGuard: true  = 演示模式绝不可写（进度、计数、未读一类）
 * demoGuard: false = 与演示无关的用户偏好或一次性迁移，演示时照常写入
 * exemptIn      = 在这些函数里写入可豁免护栏，必须写明理由（豁免要显式，不许放宽检查）
 */
const STORAGE_POINTS = [
  { key: 'KEY_SINCE', demoGuard: false, why: '相识起始日，首次访问初始化一次' },
  {
    key: 'KEY_BOND',
    demoGuard: true,
    why: '羁绊进度',
    // migrateBond 是把历史越界分值钳回满级的一次性修正，与演示无关，必须照常执行
    exemptIn: ['migrateBond'],
  },
  { key: 'KEY_PET_DAY', demoGuard: true, why: '摸头每日额度' },
  { key: 'KEY_POS', demoGuard: false, why: '拖拽位置，属用户偏好' },
  { key: 'KEY_HIDDEN', demoGuard: false, why: '显隐偏好，属用户偏好' },
  { key: 'KEY_INBOX', demoGuard: true, why: '未读收信箱' },
  { key: 'KEY_NAME', demoGuard: true, why: '鲸的名字' },
  { key: 'KEY_SEEN_CARDS', demoGuard: true, why: '卡片计数水位' },
  { key: 'KEY_SEEN_VOYAGES', demoGuard: true, why: '航次计数水位' },
  { key: 'KEY_CARD_SEQ', demoGuard: true, why: '明信片 seq 水位（判新用）' },
  {
    key: 'KEY_INBOX_RESET',
    demoGuard: false,
    why: '残留未读的一次性清理标记',
    // 标记本身必须无条件落盘：演示页刷新若不落标记，清理会反复执行
  },
]

const errors = []
const notes = []

/* ---------- 检查 1：持久化写入点与演示护栏 ---------- */
function checkStorage() {
  const src = fs.readFileSync(SKIN_TS, 'utf8')
  const lines = src.split('\n')
  const registered = new Map(STORAGE_POINTS.map((p) => [p.key, p]))
  const seen = new Set()

  lines.forEach((line, i) => {
    const m = line.match(/localStorage\.setItem\(\s*([A-Za-z_$][\w$]*)/)
    if (m === null) return
    const key = m[1]
    seen.add(key)
    const point = registered.get(key)
    if (point === undefined) {
      errors.push(`skin.ts:${i + 1} 出现未登记的持久化写入点 ${key}。请在 tools/selfcheck.cjs 的 STORAGE_POINTS 中登记，并说明是否需要演示护栏。`)
      return
    }
    if (!point.demoGuard) return
    // 护栏可以在同一行、也可以在所属函数体内（向上找到函数起始行）
    let start = i
    while (start > 0 && !/^(export )?(async )?function |^\s*const \w+ = \(/.test(lines[start])) start -= 1
    const fnName = (lines[start].match(/function\s+([\w$]+)|const\s+([\w$]+)\s*=/) ?? []).slice(1).find((x) => x !== undefined) ?? '?'
    if ((point.exemptIn ?? []).includes(fnName)) return
    const body = lines.slice(start, i + 1).join('\n')
    if (!/isDemo\(\)/.test(body)) {
      errors.push(`skin.ts:${i + 1} 函数 ${fnName} 写入 ${key}（${point.why}）缺少演示护栏 isDemo()。演示数据写进真实进度是本项目已复发三次的回归；确属例外请在 STORAGE_POINTS 的 exemptIn 里登记并写明理由。`)
    }
  })

  for (const p of STORAGE_POINTS) {
    if (!seen.has(p.key)) notes.push(`STORAGE_POINTS 中登记的 ${p.key} 在 skin.ts 里已无写入点，可考虑清理登记`)
  }
}

/* ---------- 检查 2：同名 @keyframes 重复定义 ---------- */
function checkKeyframes() {
  const css = fs.readFileSync(SKIN_CSS, 'utf8')
  const counts = new Map()
  const re = /@keyframes\s+([\w-]+)/g
  let m
  while ((m = re.exec(css)) !== null) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1)
  for (const [name, n] of counts) {
    if (n > 1) errors.push(`skin.css 中 @keyframes ${name} 定义了 ${n} 次。后定义者静默胜出，旧的那份会变成误导性死代码（曾因此把"深潜像虚化"排查歪）。`)
  }
}

/* ---------- 检查 3：同一选择器重复声明 transform ---------- */
function checkTransformConflicts() {
  const css = fs.readFileSync(SKIN_CSS, 'utf8')
  // 粗粒度：收集"选择器 → 是否声明了 transform"，同一选择器出现多次且都带 transform 即告警
  const blocks = css.match(/[^{}]+\{[^{}]*\}/g) ?? []
  const map = new Map()
  for (const block of blocks) {
    const idx = block.indexOf('{')
    const sel = block.slice(0, idx).trim().replace(/\s+/g, ' ')
    if (sel.startsWith('@') || sel.includes('%') || sel === '') continue
    const body = block.slice(idx)
    if (!/(^|[;{\s])transform\s*:/.test(body)) continue
    map.set(sel, (map.get(sel) ?? 0) + 1)
  }
  for (const [sel, n] of map) {
    if (n > 1) errors.push(`skin.css 中选择器 "${sel}" 重复声明 transform ${n} 次。权重相同时后者整条覆盖前者（hover 覆盖姿态缩放曾导致鲸突然放大两成）。`)
  }
}

/* ---------- 检查 4：hidden 属性必须能压过 display ---------- */
function checkHiddenOverride() {
  const css = fs.readFileSync(SKIN_CSS, 'utf8')
  // 必须存在覆盖本皮肤全部元素的兜底规则
  const hasFallback = /\[class\^="wv-"\]\[hidden\][\s\S]{0,80}display:\s*none\s*!important/.test(css)
  if (!hasFallback) {
    errors.push('skin.css 缺少 [class^="wv-"][hidden] { display: none !important } 兜底规则。hidden 属性靠浏览器默认样式生效，作者样式里任意一条 display 声明都会覆盖它——实测 .wv-letter 的 display: flex 让 hidden 完全失效，数据早已清空信标却挂着不走，排查被引向数据侧数轮。')
  }
}

/* ---------- 检查 5：门槛百分位在状态机与面板之间必须一致 ---------- */
function checkThresholdParity() {
  const machine = fs.readFileSync(path.join(ROOT, 'src/voyage/machine.ts'), 'utf8')
  const app = fs.readFileSync(path.join(ROOT, 'web-src/app.ts'), 'utf8')
  const grab = (src, name) => {
    const m = src.match(new RegExp(name + '\\s*=\\s*([0-9._]+)'))
    return m === null ? null : m[1].replace(/_/g, '')
  }
  // 首张门槛也必须一致：面板要如实告诉用户"第一张只要多久"
  const fa = grab(machine, 'FIRST_CARD_THRESHOLD_MS')
  const fb = grab(app, 'FIRST_CARD_THRESHOLD_MS')
  if (fa !== null && fb !== null && fa !== fb) {
    errors.push(`首张明信片门槛漂移：machine.ts 为 ${fa}，app.ts 为 ${fb}。`)
  }
  const a = grab(machine, 'THRESHOLD_PERCENTILE')
  const b = grab(app, 'THRESHOLD_PERCENTILE')
  if (a === null) { errors.push('machine.ts 中找不到 THRESHOLD_PERCENTILE'); return }
  if (b === null) { errors.push('app.ts 中找不到 THRESHOLD_PERCENTILE（面板显示门槛时必须复用同一百分位）'); return }
  if (a !== b) {
    errors.push(`门槛百分位漂移：machine.ts 为 ${a}，app.ts 为 ${b}。判定与显示必须一致，否则面板报出的"远行门槛"与真实出卡条件不符。`)
  }
}

checkStorage()
checkKeyframes()
checkTransformConflicts()
checkHiddenOverride()
checkThresholdParity()

for (const n of notes) console.log(`提示：${n}`)
if (errors.length > 0) {
  console.error(`\n自查未通过（${errors.length} 项）：`)
  for (const e of errors) console.error(`  ✗ ${e}`)
  process.exit(1)
}
console.log('自查通过：持久化护栏、关键帧唯一性、transform 冲突均无问题')
