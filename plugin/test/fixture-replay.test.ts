import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { reduce } from '../src/voyage/machine'
import { normalize, type RawQueuedEvent } from '../src/voyage/normalize'

/**
 * 真实事件流回放：fixtures 里的无 Key 采样样本（20 条真实事件）。
 * 该航次实际结局：轮次因 MISSING_CREDENTIAL 报错终止 → outcome 'error'，
 * 时长远低于阈值 → 不出明信片；但遇险会给一枚贝壳（失败时刻也要有回应）。
 */
describe('真实事件流回放（fixtures）', () => {
  it('无 Key 采样样本：航次建立并以 error 收场，不出卡但给一枚贝壳', () => {
    const fixturePath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'sse-sample-2026-08-21-nokey.jsonl')
    const lines = readFileSync(fixturePath, 'utf-8').trim().split('\n')
    expect(lines.length).toBeGreaterThan(0)

    const inputs = lines
      .map((line) => JSON.parse(line))
      .map((row): RawQueuedEvent => ({
        at: row.at,
        event: row.event,
        sessionId: row.sessionId,
        payload: row.payload,
      }))
      .map(normalize)
      .filter((input): input is NonNullable<typeof input> => input !== null)

    // 白名单归一化后仍有实质输入
    expect(inputs.length).toBeGreaterThan(0)

    const state = reduce(inputs)
    expect(state.voyageCounter).toBe(1)
    expect(state.closed).toHaveLength(1)
    expect(state.closed[0].outcome).toBe('error')
    expect(state.cards).toHaveLength(0)
    expect(state.shells.count).toBe(1) // 遇险的安慰奖
    expect(state.members).toHaveLength(1)
    expect(state.members[0].state).toBe('home')
  })
})
