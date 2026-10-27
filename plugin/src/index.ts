/**
 * dsh-whale-voyage — Cordis 组合包入口（M2）
 *
 * 红线约束（DESIGN.md 第 3 节）在本文件的体现：
 *   R1 只订阅 emit 类只读事件（agent/status、session/*、subagent/*、agent/error），
 *      不挂任何 waterfall / serial 钩子；
 *   R2 不注册工具、技能、提示词 —— 对模型零增量；
 *   R6 监听器内工作为常数时间（入队 + 状态机单步归约），异常一律吞掉（fail-open）；
 *   R7 环形缓冲封顶，历史时长数组封顶；
 *   R4 页面经 webServer 命名路由提供（静态文件只读、路径穿越防护），不改宿主文件。
 *
 * 规则依据（docs/dsh-research.md 第 2 节）：仅命名导出，禁止 default export；
 * 树外插件交付构建产物 lib/ + web/ 静态页；监听器统一带 { global: true }。
 *
 * 路由面：
 *   GET /whale-voyage                 → web/index.html（游戏页）
 *   GET /whale-voyage/assets/<file>   → web/ 静态资源（只读白名单扩展名）
 *   GET /whale-voyage/events          → SSE（raw 事件 + state 快照）
 *   GET /whale-voyage/events?demo=1   → SSE（演示回放：合成航次驱动同一状态机）
 */
import { statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { applyInput, createInitialState } from './voyage/machine.js'
import { normalize, type RawQueuedEvent } from './voyage/normalize.js'
import { buildDemoVoyage } from './voyage/demo.js'
import { Store, loadState, readOrNull, storePath } from './voyage/store.js'
import type { VoyageState } from './voyage/types.js'

export const name = 'whale-voyage'

/** 进程启动时刻，用作资源版本戳的兜底。 */
const bootedAt = Date.now()

/** 事件环容量（R7）：超出丢弃最旧，宁可漏记不可拖慢宿主。 */
const RING_CAPACITY = 4096
/** SSE 状态快照节流（毫秒）。 */
const STATE_EMIT_INTERVAL_MS = 500
/** 演示回放的步进间隔与循环间歇（毫秒）；间歇留足现看收尾战利品（相册/日志）的时间。 */
const DEMO_STEP_MS = 240
const DEMO_LOOP_GAP_MS = 12_000

/** 静态资源扩展名白名单（R4：只读，且不执行任何上传内容）。 */
const ASSET_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
}

const WEB_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'web')

/** 单条队列消息：事件名 + 会话归属 + 原始载荷。 */
interface QueuedEvent {
  readonly at: number
  readonly event: string
  readonly sessionId: string
  readonly payload: unknown
}

/** 定长环形缓冲：监听器侧唯一工作（入队 O(1)，无分配扩容路径）。 */
class Ring {
  private readonly items: QueuedEvent[] = new Array(RING_CAPACITY)
  private head = 0
  private size = 0

  push(item: QueuedEvent): void {
    this.items[(this.head + this.size) % RING_CAPACITY] = item
    if (this.size < RING_CAPACITY) this.size += 1
    else this.head = (this.head + 1) % RING_CAPACITY
  }

  drain(): QueuedEvent[] {
    const out: QueuedEvent[] = []
    for (let i = 0; i < this.size; i += 1) out.push(this.items[(this.head + i) % RING_CAPACITY])
    this.head = 0
    this.size = 0
    return out
  }
}

/** fail-open 包装：任何监听器异常都不向宿主传播（R6）。 */
function safe(fn: () => void): void {
  try {
    fn()
  } catch {
    /* 吞掉：观察者故障不影响 agent 循环 */
  }
}

/** 会话头快照（子代理归属判定所需的最小字段）。 */
function pickHeader(session: any): { origin?: 'subagent'; parentSession?: string; cwd?: string } | undefined {
  const header = session?.header
  if (header === null || typeof header !== 'object') return undefined
  return {
    origin: header.origin === 'subagent' ? 'subagent' : undefined,
    parentSession: typeof header.parentSession === 'string' ? header.parentSession : undefined,
    cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
  }
}

export function apply(ctx: any): void {
  const ring = new Ring()
  // 状态权威：启动时从磁盘加载（冷启动对齐：活跃航次按未归结算），变更后防抖落盘
  const store = new Store(storePath())
  let state: VoyageState = loadState(readOrNull(storePath()))
  ctx.effect?.(() => () => safe(() => store.flush(state)))

  const ingest = (event: string, sessionId: string, payload: unknown, at: number = Date.now()): void => {
    safe(() => {
      ring.push({ at, event, sessionId, payload })
      const raw: RawQueuedEvent = { at, event, sessionId, payload }
      const input = normalize(raw)
      if (input !== null) {
        state = applyInput(state, input)
        store.schedule(state)
      }
    })
  }

  // ---- 航次起止主信号（emit） ----
  ctx.on('agent/status', (p: any) => {
    ingest('agent/status', String(p?.agent?.id ?? ''), { status: p?.status })
  }, { global: true })

  // ---- 会话生命周期（emit）：登记建立与强制清除 ----
  ctx.on('session/created', (s: any) => {
    ingest('session/created', String(s?.id ?? ''), { header: pickHeader(s) })
  }, { global: true })

  ctx.on('session/disposed', (s: any) => {
    ingest('session/disposed', String(s?.id ?? ''), null)
  }, { global: true })

  // ---- 转录事实流（emit）：场景判定与统计的主要来源 ----
  ctx.on('session/event', (s: any, e: any) => {
    ingest(`session/event:${e?.type}`, String(s?.id ?? ''), e ? { seq: e.seq, time: e.time, data: e.data } : null)
  }, { global: true })

  // ---- 同伴（emit） ----
  ctx.on('subagent/start', (info: any) => {
    ingest('subagent/start', String(info?.id ?? ''), info)
  }, { global: true })

  ctx.on('subagent/end', (info: any) => {
    ingest('subagent/end', String(info?.id ?? ''), info)
  }, { global: true })

  // ---- 遇险（emit） ----
  ctx.on('agent/error', (p: any) => {
    ingest('agent/error', String(p?.agent?.id ?? ''), { turn: p?.turn, step: p?.step })
  }, { global: true })

  // ---- 页面与事件流（webServer 命名路由；无 webServer 的 profile 下静默跳过） ----
  ctx.inject?.(['webServer'], (scope: any) => {
    const disposers: Array<() => void> = []
    const writeAsset = async (req: any, res: any, file: string): Promise<void> => {
      const type = ASSET_TYPES[extname(file)]
      if (type === undefined) {
        res.writeHead(404)
        res.end('not found')
        return
      }
      const resolved = resolve(WEB_DIR, file)
      // 路径穿越防护：解析后的目标必须仍在 web/ 内（归一化分隔符，兼容 Windows 反斜杠）
      const norm = (p: string): string => p.replace(/\\/g, '/')
      const root = norm(WEB_DIR)
      const target = norm(resolved)
      if (target !== root && !target.startsWith(root + '/')) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      try {
        const body = await readFile(resolved)
        // 美术资源走长缓存（SSE 长连接可能占满 HTTP/1.1 连接池，缓存可避免图片请求挂起）。
        // 其余资源用 no-store 而非 no-cache：后者只要求"重新验证"，而这里没有
        // ETag/Last-Modified 可供验证，浏览器仍会复用旧副本——实测导致主界面跑着
        // 旧版 skin.js，前端修复看起来完全没生效。
        const cacheControl = file.startsWith('art/') ? 'public, max-age=86400' : 'no-store'
        res.writeHead(200, { 'content-type': type, 'cache-control': cacheControl })
        res.end(body)
      } catch {
        res.writeHead(404)
        res.end('not found')
      }
    }

    disposers.push(scope.webServer.register({
      kind: 'exact',
      path: '/whale-voyage',
      handler: (req: any, res: any) => {
        void writeAsset(req, res, 'index.html')
      },
    }))

    disposers.push(scope.webServer.register({
      kind: 'prefix',
      path: '/whale-voyage/assets',
      handler: (req: any, res: any) => {
        const raw = new URL(req.url ?? '/', 'http://x').pathname
        const file = raw.replace(/^\/whale-voyage\/assets\/?/, '')
        void writeAsset(req, res, file)
      },
    }))

    disposers.push(scope.webServer.register({
      kind: 'exact',
      path: '/whale-voyage/events',
      handler: (req: any, res: any) => {
        const url = new URL(req.url ?? '/', 'http://x')
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
        })
        if (url.searchParams.has('demo')) {
          demoStream(res, url.searchParams.get('demo') ?? '1')
          return
        }
        liveStream(res)
      },
    }))

    /**
     * 皮肤资源的版本戳：取文件 mtime。文件一改 URL 就变，浏览器不可能复用旧副本。
     * 读取失败时退回进程启动时间，至少保证每次重启 dsh 会刷新。
     */
    const assetVersion = (file: string): string => {
      try {
        return String(Math.floor(statSync(join(WEB_DIR, file)).mtimeMs))
      } catch {
        return String(bootedAt)
      }
    }

    // 伴航皮肤：官方 tapIndex 钩子向 dsh 主页注入皮肤样式与脚本（幂等、增量、可开关）
    disposers.push(scope.webServer.tapIndex((html: string): string => {
      if (html.includes('data-wv-skin')) return html
      const cssV = assetVersion('skin.css')
      const jsV = assetVersion('skin.js')
      const inject = `<link data-wv-skin rel="stylesheet" href="/whale-voyage/assets/skin.css?v=${cssV}">`
        + `<script data-wv-skin type="module" src="/whale-voyage/assets/skin.js?v=${jsV}"></script>`
      return html.includes('</head>') ? html.replace('</head>', `${inject}</head>`) : inject + html
    }))

    const liveStream = (res: any): void => {
      let lastStateEmit = 0
      const timer = setInterval(() => {
        safe(() => {
          for (const item of ring.drain()) {
            res.write(`event: ${item.event}\ndata: ${JSON.stringify(item)}\n\n`)
          }
          const now = Date.now()
          if (now - lastStateEmit >= STATE_EMIT_INTERVAL_MS) {
            lastStateEmit = now
            res.write(`event: state\ndata: ${JSON.stringify(state)}\n\n`)
          } else {
            res.write(': ping\n\n')
          }
        })
      }, 1000)
      res.on('close', () => clearInterval(timer))
    }

    /** 演示回放：合成航次（demo.ts）驱动同一状态机，加速步进并循环。 */
    /**
     * 演示回放的共享进度。
     *
     * 早先每个连接自建一份状态，于是主界面（?wv-demo=1）与右下角面板 iframe 各跑一份，
     * 用户刚收到明信片、点开相册却是"明信片 0"；且每轮结束会把状态清零，战利品永远攒不起来。
     * 改为所有 ?demo=1 连接共享同一份进度，且循环时只重置回放游标（换新会话 id），
     * 不清零状态——相册与日志会逐轮累积，演示才看得出收集感。
     */
    const demo = {
      state: createInitialState(),
      inputs: buildDemoVoyage('demo-voyage-1'),
      index: 0,
      round: 1,
      timer: undefined as any,
      /** 客户端 → 接入模式（'1' 循环 / 'once' 单次 / 'view' 旁观）。 */
      clients: new Map<any, string>(),
      /** 本进程是否已经开演过（决定要不要清零状态）。 */
      everRan: false,
      /** 单次意图锁：置位后本轮结束即停，不被循环客户端覆盖。 */
      forceOnce: false,
    }

    /**
     * 本轮跑完后是否继续循环。
     *
     * "播放一次"是用户的明确意图，必须压倒一切：一旦收到 once 请求就置 forceOnce，
     * 本轮结束即停并消费掉该标记。否则任何一个忘关的 ?wv-demo=1 客户端（甚至是
     * 残留的僵尸连接，实测确有）都会永久劫持别人的单次演示。
     * 无 forceOnce 时才按观众集合决定：还有循环观众就继续循环。
     */
    const demoShouldLoop = (): boolean => {
      if (demo.forceOnce) {
        demo.forceOnce = false
        return false
      }
      for (const mode of demo.clients.values()) if (mode === '1') return true
      return false
    }

    const demoBroadcast = (event: string, payload: string): void => {
      for (const client of demo.clients.keys()) safe(() => client.write(`event: ${event}\ndata: ${payload}\n\n`))
    }

    const demoStep = (): void => {
      safe(() => {
        if (demo.index < demo.inputs.length) {
          demo.state = applyInput(demo.state, demo.inputs[demo.index])
          demo.index += 1
          demoBroadcast('state', JSON.stringify(demo.state))
          demo.timer = setTimeout(demoStep, DEMO_STEP_MS)
        } else if (demoShouldLoop()) {
          demo.round += 1
          demo.index = 0
          demo.inputs = buildDemoVoyage(`demo-voyage-${demo.round}`)
          // 带上观众模式，便于诊断"该停却还在循环"这类问题
          demoBroadcast('demo-restart', JSON.stringify({ modes: Array.from(demo.clients.values()) }))
          demoBroadcast('state', JSON.stringify(demo.state))
          demo.timer = setTimeout(demoStep, DEMO_LOOP_GAP_MS)
        } else {
          // 单次模式：跑完即停，明确告知前端"演示结束"，避免用户分不清起止
          demo.timer = undefined
          demoBroadcast('demo-end', JSON.stringify({ round: demo.round }))
        }
      })
    }

    /**
     * 从头重演一次完整远行：游标归零、换新会话 id、**状态一并清空**。
     *
     * 状态不清空的话，接入瞬间的快照里还留着上一轮的明信片，界面一上来就亮着
     * 未读信标——用户会疑惑"还没远行怎么就有信了"。演示的首要价值是把完整流程
     * 演清楚，不是攒收藏。
     */
    /** 回卷到出航前：只重置游标与会话 id，**保留已收集的明信片**。 */
    const demoRewind = (): void => {
      demo.index = 0
      demo.round += 1
      demo.inputs = buildDemoVoyage(`demo-voyage-${demo.round}`)
    }

    /**
     * 首次开演：状态清零后回卷。
     *
     * 清零只在整个进程第一次有人来看演示时发生。此前用"当前没有演示在跑"作条件，
     * 但客户端全部断开的瞬间定时器会停，SSE 重连正好落在这个窗口里 —— 于是每次
     * 重连都清一次，相册永远攒不起来（实测卡片数 0→2→重连后 0）。
     * 重置该由用户意图决定，不该由连接状态决定。
     */
    const demoFirstRun = (): void => {
      demo.state = createInitialState()
      demoRewind()
      demo.everRan = true
    }

    /**
     * 演示流的三种接入方式：
     *   demo=1     循环回放（录制宣传素材用）
     *   demo=once  跑一轮就停，结束时广播 demo-end
     *   demo=view  旁观：只接收共享进度，不启动也不改变回放（面板 iframe 用，
     *              否则面板一接入就会把演示重新拉起来）
     */
    const demoStream = (res: any, mode: string): void => {
      demo.clients.set(res, mode)
      res.write(`event: state\ndata: ${JSON.stringify(demo.state)}\n\n`)
      if (mode === 'once') {
        // 明确点了"播放一次"就从头播：若回放正在中途（可能被别的循环客户端驱动），
        // 也重置游标，否则用户只看到后半段
        // 明确点了"播放一次"：从出航重新演一遍，但不清掉已收集的明信片
        // ——用户要的是看完整流程，不是清空相册
        demo.forceOnce = true
        if (demo.everRan) demoRewind()
        else demoFirstRun()
        if (demo.timer === undefined) demo.timer = setTimeout(demoStep, DEMO_STEP_MS)
      } else if (mode !== 'view') {
        // 循环演示：仅首次开演时清零，之后（含 SSE 重连）一律保留累积进度。
        // 接到上一轮中途不再是问题——客户端水位静默对齐不会补发旧卡。
        if (!demo.everRan) {
          demoFirstRun()
          res.write(`event: state\ndata: ${JSON.stringify(demo.state)}\n\n`)
        }
        if (demo.timer === undefined) demo.timer = setTimeout(demoStep, DEMO_STEP_MS)
      }
      res.on('close', () => {
        demo.clients.delete(res)
        // 无人观看时停表，不做无用功
        if (demo.clients.size === 0) {
          clearTimeout(demo.timer)
          demo.timer = undefined
        }
      })
    }

    return () => {
      clearTimeout(demo.timer)
      demo.timer = undefined
      for (const dispose of disposers) safe(dispose)
    }
  })
}
