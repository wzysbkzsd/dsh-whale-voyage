/**
 * 归一化：插件事件桥的原始队列消息 → 状态机输入。
 * 白名单模式：仅识别已明确归类的事件类型，未识别一律返回 null（不猜测、不展示）。
 */
import type { SessionHeaderInfo, TurnEndReasonInput, VoyInput } from './types.js'

/** 事件桥（plugin/src/index.ts）入队的消息形状，亦即 SSE data 的 JSON。 */
export interface RawQueuedEvent {
  at: number
  event: string
  sessionId: string
  payload: unknown
}

interface SessionEventPayload {
  seq?: number
  time?: number
  data?: any
}

function normalizeReason(reason: any): TurnEndReasonInput {
  if (reason === null || typeof reason !== 'object' || typeof reason.kind !== 'string') {
    return { kind: 'other', raw: String(reason) }
  }
  switch (reason.kind) {
    case 'completed':
    case 'blocked':
    case 'max-tokens':
    case 'interrupted':
      return { kind: reason.kind }
    case 'error':
      return { kind: 'error', error: reason.error ? { code: reason.error.code } : undefined }
    case 'aborted':
      return {
        kind: 'aborted',
        reason: reason.reason && typeof reason.reason.kind === 'string' ? { kind: reason.reason.kind } : undefined,
      }
    default:
      return { kind: 'other', raw: reason.kind }
  }
}

function normalizeHeader(payload: any): SessionHeaderInfo | undefined {
  const header = payload?.header
  if (header === null || typeof header !== 'object') return undefined
  return {
    origin: header.origin === 'subagent' ? 'subagent' : undefined,
    parentSession: typeof header.parentSession === 'string' ? header.parentSession : undefined,
    cwd: typeof header.cwd === 'string' ? header.cwd : undefined,
  }
}

export function normalize(raw: RawQueuedEvent): VoyInput | null {
  const sessionId = raw.sessionId
  if (typeof sessionId !== 'string' || sessionId === '') return null

  switch (raw.event) {
    case 'agent/status': {
      const status = (raw.payload as any)?.status
      if (status !== 'running' && status !== 'idle') return null
      return { kind: 'agent-status', sessionId, status, time: raw.at }
    }
    case 'session/created':
      return { kind: 'session-created', sessionId, time: raw.at, header: normalizeHeader(raw.payload) }
    case 'session/disposed':
      return { kind: 'session-disposed', sessionId, time: raw.at }
    case 'agent/error':
      return { kind: 'agent-error', sessionId, time: raw.at }
    case 'subagent/start':
    case 'subagent/end': {
      const info = raw.payload as any
      if (info === null || typeof info !== 'object' || typeof info.id !== 'string') return null
      const base = {
        sessionId,
        time: raw.at,
        runId: String(info.runId ?? ''),
        provider: String(info.provider ?? ''),
        childId: info.id,
      }
      return raw.event === 'subagent/start'
        ? { kind: 'subagent-start', ...base }
        : { kind: 'subagent-end', ...base }
    }
    default:
      break
  }

  if (raw.event.startsWith('session/event:')) {
    const type = raw.event.slice('session/event:'.length)
    const payload = (raw.payload ?? {}) as SessionEventPayload
    const seq = typeof payload.seq === 'number' ? payload.seq : -1
    const time = typeof payload.time === 'number' ? payload.time : raw.at
    const data = payload.data ?? {}
    switch (type) {
      case 'turn/start':
        return { kind: 'turn-start', sessionId, seq, time }
      case 'turn/end':
        return { kind: 'turn-end', sessionId, seq, time, reason: normalizeReason(data.reason) }
      case 'tool/call':
        return {
          kind: 'tool-call',
          sessionId,
          seq,
          time,
          callId: String(data.callId ?? ''),
          toolName: String(data.name ?? ''),
        }
      case 'tool/result':
        return { kind: 'tool-result', sessionId, seq, time, isError: data.error !== undefined }
      case 'approval/asked':
        return {
          kind: 'approval-asked',
          sessionId,
          seq,
          time,
          askId: String(data.id ?? ''),
          toolName: String(data.toolName ?? ''),
        }
      case 'approval/decided':
        return { kind: 'approval-decided', sessionId, seq, time, askId: String(data.id ?? '') }
      case 'request/context':
        return {
          kind: 'model-route',
          sessionId,
          seq,
          time,
          provider: String(data.provider ?? ''),
          model: String(data.model ?? ''),
        }
      default:
        return null // 白名单外（含实测发现的 permission/preset、sandbox/mode、session/title* 等）
    }
  }

  return null
}
