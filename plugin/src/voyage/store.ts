/**
 * 状态持久化（插件侧唯一状态权威；页面为只读投影）。
 *
 * 存储位置：$DSH_HOME/whale-voyage/state.json（缺省 ~/.dsh/whale-voyage/state.json）。
 *
 * 设计要点：
 * - 原子写：临时文件 + rename，进程中断不会留下半截文件；
 * - 防抖写：航次高频事件不落盘，仅在状态变更后静默 2 秒统一写一次；
 * - 冷启动对齐：磁盘上的"活跃航次"在重启后无法再收到它的 agent/status 流，
 *   一律按"未归"（disposed）结算并释放成员——宁可一次误结算，不可永久泄漏登记；
 * - fail-open：文件缺失、损坏、版本不符、形状异常 → 一律从全新状态开始（观察者
 *   绝不因自己的存储问题影响宿主启动）。
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInitialState } from './machine.js'
import type { VoyageState } from './types.js'

const FILE_VERSION = 1

/** 已关闭航次与明信片的保留上限（与 machine 的运行时上限一致，防手工编辑超限）。 */
const CLOSED_CAP = 50
const CARDS_CAP = 500
const DURATIONS_CAP = 500

/** 归一化分隔符为 POSIX 正斜杠：Windows 下 node:fs 同样接受正斜杠路径，跨平台保持一致（与测试契约、文档路径写法对齐）。 */
function posix(p: string): string {
  return p.replace(/\\/g, '/')
}

export function storeDir(envHome: string | undefined = process.env.DSH_HOME): string {
  const home = typeof envHome === 'string' && envHome.trim() !== '' ? envHome : join(homedir(), '.dsh')
  return posix(join(home, 'whale-voyage'))
}

export function storePath(envHome: string | undefined = process.env.DSH_HOME): string {
  return posix(join(storeDir(envHome), 'state.json'))
}

export function serialize(state: VoyageState): string {
  return JSON.stringify({ version: FILE_VERSION, savedAt: Date.now(), state })
}

/**
 * 加载并做冷启动对齐。raw 为文件内容字符串；undefined / 损坏 / 版本不符 / 形状异常
 * 均返回全新状态。
 */
export function loadState(raw: string | undefined, now: number = Date.now()): VoyageState {
  if (typeof raw !== 'string' || raw.length === 0) return createInitialState()
  let parsed: any
  try {
    parsed = JSON.parse(raw)
  } catch {
    return createInitialState()
  }
  if (parsed === null || typeof parsed !== 'object'
    || parsed.version !== FILE_VERSION
    || parsed.state === null || typeof parsed.state !== 'object') {
    return createInitialState()
  }
  const state = parsed.state as VoyageState
  if (!Array.isArray(state.members) || !Array.isArray(state.cards)
    || state.voyages === null || typeof state.voyages !== 'object'
    || !Array.isArray(state.durations) || !Array.isArray(state.closed)) {
    return createInitialState()
  }

  // 冷启动对齐：活跃航次按"未归"结算，成员回家
  for (const [sessionId, voyage] of Object.entries(state.voyages)) {
    if (voyage === null || typeof voyage !== 'object') continue
    const startedAt = typeof voyage.startedAt === 'number' ? voyage.startedAt : now
    const lastEventAt = typeof voyage.lastEventAt === 'number' ? voyage.lastEventAt : startedAt
    state.closed.push({
      sessionId,
      memberId: String(voyage.memberId ?? ''),
      outcome: 'disposed',
      durationMs: Math.max(0, lastEventAt - startedAt),
      endedAt: now,
    })
    const member = state.members.find((m) => m.memberId === voyage.memberId)
    if (member !== undefined) member.state = 'home'
  }
  state.voyages = {}

  // 容量裁剪（防手工编辑或历史版本超限）
  state.closed = state.closed.slice(-CLOSED_CAP)
  state.cards = state.cards.slice(-CARDS_CAP)
  state.durations = state.durations.slice(-DURATIONS_CAP)
  // 老存档没有 cardDay 字段，补默认值，避免每日上限判定读到 undefined
  if (state.cardDay === undefined) state.cardDay = { date: '', count: 0 }
  return state
}

/** 原子写：临时文件 + rename。失败返回 false（调用方静默降级，仅内存态）。 */
export function writeAtomic(path: string, text: string): boolean {
  try {
    mkdirSync(dirname(path), { recursive: true })
    const tmp = `${path}.tmp`
    writeFileSync(tmp, text)
    renameSync(tmp, path)
    return true
  } catch {
    return false
  }
}

/** 读取文件内容；失败返回 undefined（不存在、无权限等）。 */
export function readOrNull(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return undefined
  }
}

/** 防抖持久化器：schedule 后静默 debounceMs 毫秒落盘；flush 立即落盘。 */
export class Store {
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(
    private readonly path: string,
    private readonly debounceMs: number = 2_000,
  ) {}

  /** 状态变更后调用；高频事件下合并为一次写。 */
  schedule(state: VoyageState): void {
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = undefined
      writeAtomic(this.path, serialize(state))
    }, this.debounceMs)
  }

  /** 立即落盘（进程退出钩子用）。 */
  flush(state: VoyageState): boolean {
    if (this.timer !== undefined) {
      clearTimeout(this.timer)
      this.timer = undefined
    }
    return writeAtomic(this.path, serialize(state))
  }

  /** 测试辅助：是否有待落盘的调度。 */
  get pending(): boolean {
    return this.timer !== undefined
  }
}
