import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { normalize } from '../src/normalize.js';
import { initialStats, reduce } from '../src/stats.js';
import { homeDir, statePath, loadStats, saveStats } from '../src/store.js';

describe('normalize', () => {
  it('agent/status running → turn-start', () => {
    expect(normalize({ event: 'agent/status', sessionId: 's', payload: { status: 'running' } })).toBe('turn-start');
  });

  it('agent/status idle → turn-end', () => {
    expect(normalize({ event: 'agent/status', sessionId: 's', payload: { status: 'idle' } })).toBe('turn-end');
  });

  it('未识别的状态返回 null，不猜测', () => {
    expect(normalize({ event: 'agent/status', sessionId: 's', payload: { status: 'weird' } })).toBeNull();
    expect(normalize({ event: 'agent/status', sessionId: 's', payload: null })).toBeNull();
  });

  it('工具事件只在白名单内命中', () => {
    expect(normalize({ event: 'session/event:tool/start', sessionId: 's', payload: {} })).toBe('tool-used');
    expect(normalize({ event: 'session/event:tool/result', sessionId: 's', payload: {} })).toBe('tool-used');
    expect(normalize({ event: 'session/event:thinking', sessionId: 's', payload: {} })).toBeNull();
  });

  it('无关事件返回 null', () => {
    expect(normalize({ event: 'session/created', sessionId: 's', payload: {} })).toBeNull();
  });
});

describe('reduce', () => {
  it('turn-start 增加 running，不动 turns', () => {
    const s = reduce(initialStats(), 'turn-start', 100);
    expect(s).toEqual({ turns: 0, running: 1, tools: 0, lastEventAt: 100 });
  });

  it('turn-end 增加 turns 并释放 running', () => {
    const s = reduce({ turns: 2, running: 1, tools: 0, lastEventAt: 0 }, 'turn-end', 50);
    expect(s).toEqual({ turns: 3, running: 0, tools: 0, lastEventAt: 50 });
  });

  it('running 不会减成负数', () => {
    expect(reduce({ turns: 0, running: 0, tools: 0, lastEventAt: 0 }, 'turn-end', 1).running).toBe(0);
  });

  it('tool-used 只累加工具数', () => {
    expect(reduce(initialStats(), 'tool-used', 9)).toEqual({ turns: 0, running: 0, tools: 1, lastEventAt: 9 });
  });

  it('不修改入参', () => {
    const base = initialStats();
    reduce(base, 'turn-start', 1);
    expect(base.running).toBe(0);
  });
});

describe('store 路径', () => {
  it('DSH_HOME 为空时退回 ~/.dsh', () => {
    expect(homeDir('')).toMatch(/\.dsh$/);
    expect(homeDir('   ')).toMatch(/\.dsh$/);
  });

  it('指定 DSH_HOME 时用指定目录，且输出正斜杠', () => {
    const p = statePath('C:/tmp/home');
    expect(p).toBe('C:/tmp/home/plugin-template/summary.json');
    expect(p).not.toMatch(/\\/);
  });
});

describe('store 读写', () => {
  it('文件不存在时返回初始状态', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-'));
    try {
      expect(loadStats(join(dir, 'nope.json'))).toEqual(initialStats());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('损坏的 JSON 返回初始状态，不抛', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-'));
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{not json', 'utf8');
    try {
      expect(loadStats(p)).toEqual(initialStats());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('版本不符返回初始状态', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-'));
    const p = join(dir, 'v.json');
    writeFileSync(p, JSON.stringify({ version: 999, stats: { turns: 5 } }), 'utf8');
    try {
      expect(loadStats(p)).toEqual(initialStats());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('越界数值被钳制，负数归零', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-'));
    const p = join(dir, 'c.json');
    writeFileSync(p, JSON.stringify({ version: 1, stats: { turns: -3, running: 1e9, tools: 'x', lastEventAt: 7 } }), 'utf8');
    try {
      expect(loadStats(p)).toEqual({ turns: 0, running: 1e6, tools: 0, lastEventAt: 7 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('写入后能读回，且是原子写', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pt-'));
    const p = join(dir, 'nested', 'summary.json');
    const stats = { turns: 3, running: 1, tools: 12, lastEventAt: 123 };
    try {
      saveStats(stats, p);
      expect(loadStats(p)).toEqual(stats);
      expect(readFileSync(p, 'utf8')).toContain('"version":1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
