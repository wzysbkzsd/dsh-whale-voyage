/**
 * 只读订阅型 dsh 插件骨架。
 *
 * 红线（与 WHALE 的做法一致）：
 *   - 只订阅 emit 类只读事件，监听器一律带 { global: true }
 *   - 不注册工具、不注入提示词、不调用模型
 *   - 监听器内只做常数时间工作，异常一律吞掉（fail-open）
 *   - 状态只写插件自己的目录（$DSH_HOME/plugin-template/）
 *
 * 要改成你自己的插件，只动三处：normalize.ts 里认哪些事件、stats.ts 里算什么、
 * index.ts 里路由返回什么。
 */

import { normalize, type Kind } from './normalize.js';
import { initialStats, reduce, type Stats } from './stats.js';
import { loadStats, saveStats, statePath } from './store.js';

export const name = 'plugin-template';

const FLUSH_DEBOUNCE_MS = 2000;
const bootedAt = Date.now();

function safe(fn: () => void): void {
  try {
    fn();
  } catch {
    // 观察者绝不把异常抛进宿主循环
  }
}

export function apply(ctx: any): void {
  let stats: Stats = loadStats();
  let timer: NodeJS.Timeout | undefined;

  const flush = (): void => {
    timer = undefined;
    safe(() => saveStats(stats, statePath()));
  };

  const schedule = (): void => {
    if (timer !== undefined) return;
    timer = setTimeout(flush, FLUSH_DEBOUNCE_MS);
    timer.unref?.();
  };

  const ingest = (event: string, sessionId: string, payload: unknown): void => {
    safe(() => {
      const kind: Kind | null = normalize({ event, sessionId, payload });
      if (kind === null) return;
      stats = reduce(stats, kind, Date.now());
      schedule();
    });
  };

  // ---- 只读订阅（emit 事件） ----
  ctx.on('agent/status', (p: any) => {
    ingest('agent/status', String(p?.agent?.id ?? ''), { status: p?.status });
  }, { global: true });

  ctx.on('session/event', (s: any, e: any) => {
    ingest(`session/event:${e?.type}`, String(s?.id ?? ''), { data: e?.data });
  }, { global: true });

  // ---- 只读路由（没有 webServer 的 profile 下静默跳过） ----
  ctx.inject?.(['webServer'], (scope: any) => {
    const dispose = scope.webServer.register({
      kind: 'exact',
      path: '/plugin-template',
      handler: (_req: any, res: any) => {
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        });
        res.end(JSON.stringify({ ...stats, uptimeMs: Date.now() - bootedAt }));
      },
    });
    ctx.effect?.(() => () => {
      safe(() => dispose?.());
    });
  });

  // ---- 卸载清理：停表 + 落盘 ----
  ctx.effect?.(() => () => {
    if (timer !== undefined) clearTimeout(timer);
    safe(() => saveStats(stats, statePath()));
  });
}
