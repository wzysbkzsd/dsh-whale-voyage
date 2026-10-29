import type { Kind } from './normalize.js';

/** 插件要展示的全部状态。纯数据，无 I/O——这是能被单测覆盖的前提。 */
export interface Stats {
  turns: number;
  running: number;
  tools: number;
  lastEventAt: number;
}

export function initialStats(): Stats {
  return { turns: 0, running: 0, tools: 0, lastEventAt: 0 };
}

/** 纯函数归约：同样的输入永远得到同样的输出，方便断言。 */
export function reduce(stats: Stats, kind: Kind, at: number): Stats {
  switch (kind) {
    case 'turn-start':
      return { ...stats, running: stats.running + 1, lastEventAt: at };
    case 'turn-end':
      return { ...stats, turns: stats.turns + 1, running: Math.max(0, stats.running - 1), lastEventAt: at };
    case 'tool-used':
      return { ...stats, tools: stats.tools + 1, lastEventAt: at };
  }
}
