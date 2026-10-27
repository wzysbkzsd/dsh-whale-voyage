import { describe, expect, it } from 'vitest'
import {
  allConfirmed,
  capInbox,
  fingerprintOf,
  pickFreshCards,
  reconcileCards,
  type CardRef,
} from '../web-src/inbox-logic.js'

/**
 * 皮肤脚本的判新与收信箱逻辑。
 *
 * 这些用例一对一锁住本轮真实踩过的坑，不是为覆盖率而写：
 *   - 开箱层堆到 428 个（判新会重放）
 *   - 演示接入时连弹一串明信片（水位沿用了磁盘上的真实值）
 *   - 未读永远清不掉（对账缺失或被绕过）
 */

const card = (seq: number, id = `card-${seq}`, createdAt = seq * 1000): CardRef => ({ cardId: id, seq, createdAt })

describe('明信片判新（seq 单调水位）', () => {
  it('首次接入静默对齐，不为存量卡片补发通知', () => {
    // 水位 -1 代表本机从未记录过。若此时把存量卡片全判为新卡，
    // 升级或切到演示模式那一刻会一次性弹出十几张——这正是用户遇到的"先弹一串明信片"
    const cards = [card(1), card(2), card(3)]
    const r = pickFreshCards(cards, -1)
    expect(r.fresh).toHaveLength(0)
    expect(r.nextSeq).toBe(3)
  })

  it('只投递水位之上的卡片，且按 seq 升序', () => {
    const cards = [card(3), card(1), card(2), card(4)]
    const r = pickFreshCards(cards, 2)
    expect(r.fresh.map((c) => c.seq)).toEqual([3, 4])
    expect(r.nextSeq).toBe(4)
  })

  it('幂等：同一批状态反复处理不会重复投递', () => {
    const cards = [card(1), card(2)]
    const first = pickFreshCards(cards, 0)
    expect(first.fresh).toHaveLength(2)
    // 用上一轮的水位再跑一次，模拟 SSE 每帧推同一份状态
    const second = pickFreshCards(cards, first.nextSeq)
    expect(second.fresh).toHaveLength(0)
    expect(second.nextSeq).toBe(first.nextSeq)
  })

  it('服务端清档：水位同步下调且不补发', () => {
    // 演示状态重置或服务重启后 seq 会回退。若不下调水位，此后永远判不出新卡；
    // 若下调时还补发，又会把旧卡当新卡弹一遍
    const r = pickFreshCards([card(1)], 9)
    expect(r.fresh).toHaveLength(0)
    expect(r.nextSeq).toBe(1)
  })

  it('空状态：水位归零，不产生投递', () => {
    const r = pickFreshCards([], 5)
    expect(r.fresh).toHaveLength(0)
    expect(r.nextSeq).toBe(0)
  })

  it('不会因为卡片数量超过任何内部上限而重放（428 层事故的回归用例）', () => {
    // 早先用容量上限为 40 的指纹集合判新，卡片累积到 40 以上后被裁掉的旧卡
    // 重新被判为新卡，每帧反复投递，实测同时堆出 428 个开箱层
    const many = Array.from({ length: 200 }, (_, i) => card(i + 1))
    const r1 = pickFreshCards(many, 0)
    expect(r1.fresh).toHaveLength(200)
    const r2 = pickFreshCards(many, r1.nextSeq)
    expect(r2.fresh).toHaveLength(0)
  })
})

describe('收信箱对账', () => {
  it('只保留权威状态里仍存在的未读', () => {
    const inbox = [card(1), card(2), card(3)]
    const kept = reconcileCards(inbox, [card(1), card(3)])
    expect(kept.map((c) => c.seq)).toEqual([1, 3])
  })

  it('权威状态为空时清空全部未读（用户遇到的清不掉场景）', () => {
    expect(reconcileCards([card(1), card(2)], [])).toHaveLength(0)
  })

  it('指纹叠加创建时间：id 复用不会被误判为同一张', () => {
    const older: CardRef = { cardId: 'card-1', seq: 1, createdAt: 1000 }
    const reused: CardRef = { cardId: 'card-1', seq: 1, createdAt: 9999 }
    expect(fingerprintOf(older)).not.toBe(fingerprintOf(reused))
    // 权威状态里只有复用后的那张，旧的必须被清掉
    expect(reconcileCards([older], [reused])).toHaveLength(0)
  })

  it('空收信箱不炸也不产生副作用', () => {
    expect(reconcileCards([], [card(1)])).toHaveLength(0)
  })
})

describe('未读容量与确认', () => {
  it('裁剪保留最近的若干封', () => {
    const inbox = [card(1), card(2), card(3), card(4), card(5)]
    expect(capInbox(inbox, 2).map((c) => c.seq)).toEqual([4, 5])
  })

  it('未超容量时原样返回；上限为 0 时清空（演示模式只留最新一封走的就是这条）', () => {
    expect(capInbox([card(1)], 5)).toHaveLength(1)
    expect(capInbox([card(1), card(2)], 1).map((c) => c.seq)).toEqual([2])
    expect(capInbox([card(1)], 0)).toHaveLength(0)
  })

  it('权威状态未到达时一律视为未确认，宽限期到点即清', () => {
    // 状态没到就认定"已确认"会让脏未读永久留存
    expect(allConfirmed([card(1)], null)).toBe(false)
    expect(allConfirmed([], null)).toBe(true)
  })

  it('全部能在权威状态里找到才算确认', () => {
    expect(allConfirmed([card(1), card(2)], [card(1), card(2), card(3)])).toBe(true)
    expect(allConfirmed([card(1), card(9)], [card(1)])).toBe(false)
  })
})
