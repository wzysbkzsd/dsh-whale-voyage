/**
 * 归一化：把宿主事件裁成插件认识的有限几种。
 * 白名单模式：不认识的一律 null。不要在这里"猜"事件含义——
 * 宿主事件形状会变，猜错的结果是插件静默出错而不是报错。
 */

export type Kind = 'turn-start' | 'turn-end' | 'tool-used';

export interface RawEvent {
  event: string;
  sessionId: string;
  payload: unknown;
}

export function normalize(raw: RawEvent): Kind | null {
  if (raw.event === 'agent/status') {
    const status = (raw.payload as { status?: unknown } | null)?.status;
    if (status === 'running') return 'turn-start';
    if (status === 'idle') return 'turn-end';
    return null;
  }

  // 转录事实流：事件名形如 session/event:<type>
  const prefix = 'session/event:';
  if (raw.event.startsWith(prefix)) {
    const type = raw.event.slice(prefix.length);
    if (type === 'tool/start' || type === 'tool/result') return 'tool-used';
  }

  return null;
}
