#!/usr/bin/env node
/**
 * scripts/preview.mjs —— 本地演示服务器（不依赖 dsh / DeepSeek API / 美术资源）
 *
 * 用途：在真实 dsh 环境外直接预览「鲸的远行」页面与完整演出。
 * 复用 plugin/lib/ 的编译产物（同一状态机、同一演示序列），路由与插件保持一致：
 *   /whale-voyage/                        → 页面（index.html）
 *   /whale-voyage/assets/<file>           → 静态资源（web/，白名单扩展名 + 路径穿越防护）
 *   /whale-voyage/events?demo=1|once|view → SSE 演示回放（合成航次驱动同一状态机）
 *
 * 用法：
 *   node scripts/preview.mjs                          # 默认 http://127.0.0.1:3311/whale-voyage/?demo=1
 *   PREVIEW_PORT=8080 node scripts/preview.mjs        # 换端口
 *
 * 前置：先 cd plugin && npm run build（本脚本依赖 lib/ 编译产物）。
 * 打开页面时：
 *   ?demo=1    循环回放（录制素材用）
 *   ?demo=once 跑一轮就停
 *   ?demo=view 旁观，不启动回放
 * 不带 ?demo= 时也直接回放演示（本地没有真实事件源）。
 */
import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { extname, join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInitialState, applyInput } from '../plugin/lib/voyage/machine.js'
import { buildDemoVoyage } from '../plugin/lib/voyage/demo.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB_DIR = resolve(HERE, '..', 'plugin', 'web')
const PORT = Number(process.env.PREVIEW_PORT ?? 3311)

const ASSET_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
}
const DEMO_STEP_MS = Number(process.env.PREVIEW_STEP_MS ?? 1200)
const DEMO_LOOP_GAP_MS = 12_000

/* ---------- 演示回放（语义与 plugin/src/index.ts 的 demo 流一致） ---------- */
const demo = {
  state: createInitialState(),
  inputs: buildDemoVoyage('demo-voyage-1'),
  index: 0,
  round: 1,
  timer: null,
  /** 客户端 → 接入模式（'1' 循环 / 'once' 单次 / 'view' 旁观） */
  clients: new Map(),
  everRan: false,
  forceOnce: false,
}

const demoShouldLoop = () => {
  if (demo.forceOnce) {
    demo.forceOnce = false
    return false
  }
  for (const mode of demo.clients.values()) if (mode === '1') return true
  return false
}

const demoBroadcast = (event, payload) => {
  for (const client of demo.clients.keys()) {
    try {
      client.write(`event: ${event}\ndata: ${payload}\n\n`)
    } catch {
      /* 客户端已断开 */
    }
  }
}

const demoStep = () => {
  try {
    if (demo.index < demo.inputs.length) {
      demo.state = applyInput(demo.state, demo.inputs[demo.index])
      demo.index += 1
      demoBroadcast('state', JSON.stringify(demo.state))
      demo.timer = setTimeout(demoStep, DEMO_STEP_MS)
    } else if (demoShouldLoop()) {
      demo.round += 1
      demo.index = 0
      demo.inputs = buildDemoVoyage(`demo-voyage-${demo.round}`)
      demoBroadcast('demo-restart', JSON.stringify({ modes: Array.from(demo.clients.values()) }))
      demoBroadcast('state', JSON.stringify(demo.state))
      demo.timer = setTimeout(demoStep, DEMO_LOOP_GAP_MS)
    } else {
      demo.timer = null
      demoBroadcast('demo-end', JSON.stringify({ round: demo.round }))
    }
  } catch (err) {
    console.error('demo step failed:', err)
    demo.timer = null
  }
}

const demoRewind = () => {
  demo.index = 0
  demo.round += 1
  demo.inputs = buildDemoVoyage(`demo-voyage-${demo.round}`)
}

const demoFirstRun = () => {
  demo.state = createInitialState()
  demoRewind()
  demo.everRan = true
}

const demoStream = (res, mode) => {
  demo.clients.set(res, mode)
  res.write(`event: state\ndata: ${JSON.stringify(demo.state)}\n\n`)
  if (mode === 'once') {
    // 明确"播放一次"：从头重演，但保留已收集的明信片
    demo.forceOnce = true
    if (demo.everRan) demoRewind()
    else demoFirstRun()
    if (demo.timer === null) demo.timer = setTimeout(demoStep, DEMO_STEP_MS)
  } else if (mode !== 'view') {
    // 循环演示：仅首次开演时清零，之后（含重连）保留累积进度
    if (!demo.everRan) {
      demoFirstRun()
      res.write(`event: state\ndata: ${JSON.stringify(demo.state)}\n\n`)
    }
    if (demo.timer === null) demo.timer = setTimeout(demoStep, DEMO_STEP_MS)
  }
  res.on('close', () => {
    demo.clients.delete(res)
    // 无人观看时停表
    if (demo.clients.size === 0 && demo.timer !== null) {
      clearTimeout(demo.timer)
      demo.timer = null
    }
  })
}

/* ---------- 静态资源 ---------- */
const writeAsset = async (req, res, file) => {
  const type = ASSET_TYPES[extname(file).toLowerCase()]
  if (type === undefined) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  const resolved = resolve(WEB_DIR, file)
  // 路径穿越防护：解析后的目标必须仍在 web/ 内
  if (!resolved.startsWith(WEB_DIR + '/') && !resolved.startsWith(WEB_DIR + '\\') && resolved !== WEB_DIR) {
    res.writeHead(403)
    res.end('forbidden')
    return
  }
  if (!existsSync(resolved)) {
    res.writeHead(404)
    res.end('not found')
    return
  }
  try {
    const body = await readFile(resolved)
    const cacheControl = file.startsWith('art/') ? 'public, max-age=86400' : 'no-store'
    res.writeHead(200, { 'content-type': type, 'cache-control': cacheControl })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end('not found')
  }
}

/* ---------- 路由 ---------- */
const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://127.0.0.1')
  const path = url.pathname
  if (path === '/' || path === '/whale-voyage' || path === '/whale-voyage/') {
    void writeAsset(req, res, 'index.html')
  } else if (path.startsWith('/whale-voyage/assets/')) {
    const file = path.replace(/^\/whale-voyage\/assets\/?/, '')
    void writeAsset(req, res, file)
  } else if (path === '/whale-voyage/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    // 本地没有真实事件源：带 ?demo= 按模式回放，不带也默认循环回放
    demoStream(res, url.searchParams.get('demo') ?? '1')
  } else {
    res.writeHead(404)
    res.end('not found')
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🐋 鲸的远行 · 本地预览: http://127.0.0.1:${PORT}/whale-voyage/?demo=1`)
  console.log(`   页面参数: ?demo=1 循环回放 / ?demo=once 单次 / ?demo=view 旁观`)
  console.log(`   Ctrl+C 退出`)
})
