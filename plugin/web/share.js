/**
 * 分享载荷构建（纯函数）。
 *
 * 隐私原则（DESIGN.md 11.3）：分享卡默认脱敏。本项目从设计上就不在卡片数据中
 * 存放文件名/路径，分享载荷进一步收敛为白名单字段——sessionId、memberId、
 * 工具调用明细（toolCounts）、模型路由等一律不进入分享内容。
 */
export function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m${s % 60 > 0 ? `${s % 60}s` : ''}`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
}
/**
 * 构建分享载荷。传入的 card 字段由调用方从 Card 挑选映射，
 * 本函数不再接收任何未脱敏对象，防止字段意外穿透。
 */
export function buildSharePayload(card, owned, total, voyageCount) {
    return {
        card: {
            captionZh: String(card.captionZh ?? ''),
            captionEn: String(card.captionEn ?? ''),
            sceneLabel: String(card.sceneLabel ?? ''),
            sceneEmoji: String(card.sceneEmoji ?? '🐋'),
            rarityLabel: String(card.rarityLabel ?? ''),
            rarityClass: card.rarityClass === '' ? '' : String(card.rarityClass),
            dayNight: card.dayNight === 'night' ? 'night' : 'day',
            voyageNo: Math.max(0, Number.isFinite(card.voyageNo) ? card.voyageNo : 0),
            durationMs: Math.max(0, Number.isFinite(card.durationMs) ? card.durationMs : 0),
            toolCalls: Math.max(0, Number.isFinite(card.toolCalls) ? card.toolCalls : 0),
        },
        progress: { owned: Math.max(0, owned | 0), total: Math.max(0, total | 0) },
        voyageCount: Math.max(0, voyageCount | 0),
        brand: { zh: '鲸的远行', en: 'Whale Voyage', url: 'dsh-whale-voyage' },
    };
}
/** 序列化为分享卡上的邮戳行。 */
export function stampLineOf(payload) {
    const c = payload.card;
    return `第 ${c.voyageNo} 次远行 · ${fmtDuration(c.durationMs)} · ${c.toolCalls} 次潜探`;
}
