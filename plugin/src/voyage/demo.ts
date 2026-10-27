/**
 * 演示模式：一次完整远行的合成事件序列（M1 为机器层回放，M2 接页面演出）。
 * 时间戳使用本地时间解析（不带 Z），保证昼夜判定的可测试性。
 */
import type { TurnEndReasonInput, VoyInput } from './types.js'

export interface DemoOptions {
  /** 远行总时长（毫秒），默认 8 分钟（超过冷启动阈值 3 分钟，出卡）。 */
  durationMs?: number
  /** 完成时刻（毫秒时间戳）；缺省取当前时刻（演示页实时显示“≈8 分钟”而非陈旧日期）。 */
  endTime?: number
  /**
   * 结局，默认顺利完成。用来构造"遇险归来"这条路径——它有独立的回馈（一枚贝壳）
   * 与安慰台词，需要能被测试和演示覆盖。
   */
  outcome?: 'completed' | 'error' | 'aborted-user'
}

export function buildDemoVoyage(sessionId = 'demo-voyage', options: DemoOptions = {}): VoyInput[] {
  const durationMs = options.durationMs ?? 8 * 60_000
  const endTime = options.endTime ?? Date.now()
  const t0 = endTime - durationMs - 200
  const childId = `${sessionId}-child`
  const events: VoyInput[] = []
  let seq = 0

  events.push({ kind: 'session-created', sessionId, time: t0 })
  events.push({ kind: 'agent-status', sessionId, status: 'running', time: t0 })
  events.push({ kind: 'turn-start', sessionId, seq: ++seq, time: t0 + 1_000 })

  // 沉船书房：读取旧物
  events.push({ kind: 'tool-call', sessionId, seq: ++seq, time: t0 + 2_000, callId: 'c1', toolName: 'read_file' })
  events.push({ kind: 'tool-call', sessionId, seq: ++seq, time: t0 + 2_500, callId: 'c2', toolName: 'read_file' })
  events.push({ kind: 'tool-call', sessionId, seq: ++seq, time: t0 + 3_000, callId: 'c3', toolName: 'grep_search' })
  events.push({ kind: 'tool-result', sessionId, seq: ++seq, time: t0 + 4_000, isError: false })
  events.push({ kind: 'tool-result', sessionId, seq: ++seq, time: t0 + 4_100, isError: false })
  events.push({ kind: 'tool-result', sessionId, seq: ++seq, time: t0 + 4_200, isError: false })

  // 家书：等待授权 15 秒（应从有效时长中扣除）
  events.push({ kind: 'approval-asked', sessionId, seq: ++seq, time: t0 + 5_000, askId: 'a1', toolName: 'bash' })
  events.push({ kind: 'tool-call', sessionId, seq: ++seq, time: t0 + 6_000, callId: 'c4', toolName: 'bash' })
  events.push({ kind: 'approval-decided', sessionId, seq: ++seq, time: t0 + 20_000, askId: 'a1' })
  events.push({ kind: 'tool-result', sessionId, seq: ++seq, time: t0 + 30_000, isError: false })

  // 模型路由（邮戳数据）
  events.push({ kind: 'model-route', sessionId, seq: ++seq, time: t0 + 31_000, provider: 'deepseek-official', model: 'deepseek-v4-flash' })

  // 同伴：子代理同行
  events.push({ kind: 'session-created', sessionId: childId, time: t0 + 40_000, header: { origin: 'subagent', parentSession: sessionId } })
  events.push({ kind: 'subagent-start', sessionId: childId, time: t0 + 41_000, runId: 'r1', provider: 'claude-code', childId })
  events.push({ kind: 'subagent-end', sessionId: childId, time: t0 + 60_000, runId: 'r1', provider: 'claude-code', childId })

  // 珊瑚苗圃：栽种新枝
  events.push({ kind: 'tool-call', sessionId, seq: ++seq, time: t0 + 61_000, callId: 'c5', toolName: 'write_file' })
  events.push({ kind: 'tool-result', sessionId, seq: ++seq, time: t0 + 70_000, isError: false })

  const outcome = options.outcome ?? 'completed'
  const endReason: TurnEndReasonInput =
    outcome === 'error' ? { kind: 'error', error: { code: 'DEMO_STORM' } }
      : outcome === 'aborted-user' ? { kind: 'aborted', reason: { kind: 'user' } }
        : { kind: 'completed' }
  events.push({ kind: 'turn-end', sessionId, seq: ++seq, time: endTime - 100, reason: endReason })
  events.push({ kind: 'agent-status', sessionId, status: 'idle', time: endTime })
  return events
}
