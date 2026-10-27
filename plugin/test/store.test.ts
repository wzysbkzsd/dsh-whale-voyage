import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reduce } from '../src/voyage/machine'
import { buildDemoVoyage } from '../src/voyage/demo'
import {
  Store,
  loadState,
  readOrNull,
  serialize,
  storePath,
  writeAtomic,
} from '../src/voyage/store'

const T0 = Date.parse('2026-08-27T14:00:00')

describe('持久化：序列化与加载', () => {
  it('空输入/损坏 JSON/版本不符/形状异常 → 全新状态（fail-open）', () => {
    expect(loadState(undefined).voyageCounter).toBe(0)
    expect(loadState('').voyageCounter).toBe(0)
    expect(loadState('{broken json').voyageCounter).toBe(0)
    expect(loadState(JSON.stringify({ version: 99, state: {} })).voyageCounter).toBe(0)
    expect(loadState(JSON.stringify({ version: 1, state: { members: 'x' } })).voyageCounter).toBe(0)
    expect(loadState('null').voyageCounter).toBe(0)
  })

  it('冷启动对齐：磁盘上的活跃航次按未归结算，成员回家', () => {
    // 演示序列跑到一半（尚有活跃航次）即序列化
    const inputs = buildDemoVoyage('s1', { endTime: T0 })
    const half = inputs.slice(0, 8) // running 之后、turn/end 之前
    const state = reduce(half)
    expect(Object.keys(state.voyages)).toHaveLength(1)
    expect(state.members[0].state).not.toBe('home')

    const reloaded = loadState(serialize(state), T0 + 60_000)
    expect(Object.keys(reloaded.voyages)).toHaveLength(0) // 活跃航次清空
    expect(reloaded.members[0].state).toBe('home') // 成员回家
    expect(reloaded.closed.at(-1)?.outcome).toBe('disposed') // 记为未归
  })

  it('完整往返：相册、日志、阈值样本跨重启保留', () => {
    const state = reduce(buildDemoVoyage('a', { endTime: T0 }))
    const text = serialize(state)
    const reloaded = loadState(text, T0 + 1000)
    expect(reloaded.cards).toHaveLength(1)
    expect(reloaded.cards[0].caption.zh).toBe(state.cards[0].caption.zh)
    expect(reloaded.closed.at(-1)?.outcome).toBe('completed')
    expect(reloaded.voyageCounter).toBe(1)
    expect(reloaded.durations).toHaveLength(1)
    expect(reloaded.members[0].name).toBe('Lan')
  })

  it('容量裁剪：closed/cards/durations 超限被裁到上限（防手工编辑）', () => {
    const state = reduce(buildDemoVoyage('a', { endTime: T0 }))
    state.closed = Array.from({ length: 80 }, (_, i) => state.closed[0] ? { ...state.closed[0], sessionId: `s${i}` } : state.closed[0])
    state.cards = Array.from({ length: 600 }, () => state.cards[0])
    state.durations = Array.from({ length: 900 }, () => 1000)
    const reloaded = loadState(serialize(state))
    expect(reloaded.closed.length).toBeLessThanOrEqual(50)
    expect(reloaded.cards.length).toBeLessThanOrEqual(500)
    expect(reloaded.durations.length).toBeLessThanOrEqual(500)
  })
})

describe('持久化：文件读写', () => {
  const dirs: string[] = []

  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'wv-store-'))
    dirs.push(dir)
    return dir
  }

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('writeAtomic 原子写 + readOrNull 读取；目录不存在时自动创建', () => {
    const dir = tmp()
    const path = `${dir}/nested/dir/state.json`
    expect(writeAtomic(path, serialize(reduce(buildDemoVoyage('a'))))).toBe(true)
    expect(existsSync(path)).toBe(true)
    expect(readOrNull(path)).toBeDefined()
    expect(readOrNull(`${dir}/missing.json`)).toBeUndefined()
    // 不留临时文件
    expect(existsSync(`${path}.tmp`)).toBe(false)
  })

  it('Store 防抖：schedule 合并写、flush 立即写并取消调度', async () => {
    vi.useFakeTimers()
    const dir = tmp()
    const store = new Store(`${dir}/state.json`, 2_000)
    const state = reduce(buildDemoVoyage('a', { endTime: T0 }))

    store.schedule(state)
    expect(store.pending).toBe(true)
    expect(existsSync(`${dir}/state.json`)).toBe(false) // 未到时间不写

    store.schedule(state) // 再次调度应重置计时而非双写
    vi.advanceTimersByTime(1_999)
    expect(existsSync(`${dir}/state.json`)).toBe(false)
    vi.advanceTimersByTime(1)
    expect(existsSync(`${dir}/state.json`)).toBe(true) // 2 秒整落盘
    expect(store.pending).toBe(false)

    // flush 立即写且取消待定调度
    store.schedule(state)
    expect(store.flush(state)).toBe(true)
    expect(store.pending).toBe(false)
    vi.useRealTimers()
  })

  it('文件级往返：写 → 读 → load，与内存态等价（不含活跃航次）', () => {
    const dir = tmp()
    const path = `${dir}/state.json`
    const state = reduce(buildDemoVoyage('a', { endTime: T0 }))
    writeAtomic(path, serialize(state))
    const reloaded = loadState(readFileSync(path, 'utf8'))
    expect(reloaded.cards.length).toBe(state.cards.length)
    expect(reloaded.voyageCounter).toBe(state.voyageCounter)
  })

  it('storePath：$DSH_HOME 优先，缺省 ~/.dsh/whale-voyage/state.json', () => {
    expect(storePath('/custom/home')).toBe('/custom/home/whale-voyage/state.json')
    expect(storePath('')).toBe(storePath(undefined)) // 空串视同未设置
    expect(storePath(undefined)).toMatch(/whale-voyage[\\/]state\.json$/)
  })
})
