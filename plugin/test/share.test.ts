import { describe, expect, it } from 'vitest'
import { buildSharePayload, stampLineOf, type ShareCardInput } from '../web-src/share'

const CARD: ShareCardInput = {
  captionZh: '在沉船书房翻检旧物',
  captionEn: 'Browsing old keepsakes in the sunken library',
  sceneLabel: '沉船书房 · 昼',
  sceneEmoji: '🚢',
  rarityLabel: '稀有',
  rarityClass: 'r-rare',
  dayNight: 'day',
  voyageNo: 47,
  durationMs: 12 * 60_000,
  toolCalls: 23,
}

describe('分享卡（隐私白名单）', () => {
  it('载荷只含白名单字段：不含会话/成员/工具明细等任何可识别信息', () => {
    const payload = buildSharePayload(CARD, 5, 22, 47)
    const text = JSON.stringify(payload)
    for (const banned of ['sessionId', 'memberId', 'voyageId', 'toolCounts', 'model', 'provider', 'cwd', 'path', 'file']) {
      expect(text.includes(banned), `载荷不应包含 ${banned}`).toBe(false)
    }
    expect(payload.card.captionZh).toBe('在沉船书房翻检旧物')
    expect(payload.progress).toEqual({ owned: 5, total: 22 })
  })

  it('数值字段做防御性归一（NaN/负数不会泄漏进分享卡）', () => {
    const payload = buildSharePayload(
      { ...CARD, voyageNo: Number.NaN, durationMs: -5, toolCalls: Number.POSITIVE_INFINITY },
      -3, -1, -2,
    )
    expect(payload.card.voyageNo).toBe(0)
    expect(payload.card.durationMs).toBe(0)
    expect(payload.card.toolCalls).toBe(0)
    expect(payload.progress).toEqual({ owned: 0, total: 0 })
    expect(payload.voyageCount).toBe(0)
  })

  it('邮戳行由脱敏数据渲染，含次数/时长/潜探数', () => {
    const line = stampLineOf(buildSharePayload(CARD, 5, 22, 47))
    expect(line).toBe('第 47 次远行 · 12m · 23 次潜探')
  })
})
