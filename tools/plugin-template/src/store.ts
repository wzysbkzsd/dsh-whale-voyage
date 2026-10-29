import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { initialStats, type Stats } from './stats.js';

const VERSION = 1;
const CAP = { turns: 1e9, running: 1e6, tools: 1e9 };

/** DSH_HOME 缺省为 ~/.dsh；空字符串视为未设置。 */
export function homeDir(env: string | undefined = process.env.DSH_HOME): string {
  const v = typeof env === 'string' ? env.trim() : '';
  return v !== '' ? v : join(homedir(), '.dsh');
}

export function statePath(env?: string): string {
  return join(homeDir(env), 'plugin-template', 'summary.json').replace(/\\/g, '/');
}

function num(x: unknown, cap: number): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(x, cap) : 0;
}

/** fail-open：文件缺失、损坏、版本不符、形状异常，一律从空状态开始，绝不因自己的存储拖垮宿主。 */
export function loadStats(path: string = statePath()): Stats {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    if (raw === null || typeof raw !== 'object' || raw.version !== VERSION) return initialStats();
    const s = raw.stats;
    if (s === null || typeof s !== 'object') return initialStats();
    return {
      turns: num(s.turns, CAP.turns),
      running: num(s.running, CAP.running),
      tools: num(s.tools, CAP.tools),
      lastEventAt: num(s.lastEventAt, Number.MAX_SAFE_INTEGER),
    };
  } catch {
    return initialStats();
  }
}

/** 原子写：临时文件 + rename，进程中途被杀不会留下半截 JSON。 */
export function saveStats(stats: Stats, path: string = statePath()): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify({ version: VERSION, stats, savedAt: Date.now() }), 'utf8');
  renameSync(tmp, path);
}
