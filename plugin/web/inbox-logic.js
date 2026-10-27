/**
 * 收信箱与明信片判新的纯逻辑。
 *
 * 为什么单独成文件：skin.ts 是注入宿主页面的脚本，通篇依赖 DOM 与 localStorage，
 * 没有导出面，自动化测试无从下手。而这一轮反复出问题的恰恰是这里的判定逻辑——
 * 开箱层堆到 428 个、未读永远清不掉、演示接入时连弹一串明信片，根因全在这几个
 * 函数的边界条件上。把它们抽成不碰任何浏览器 API 的纯函数，就能被 vitest 直接覆盖。
 *
 * 约定：本文件不得引入任何 DOM / localStorage 依赖，否则测试价值立刻归零。
 */
/** 卡片指纹：id 在服务端清档后可能复用，必须叠加创建时间才唯一。 */
export function fingerprintOf(card) {
    return `${card.cardId}|${card.createdAt}`;
}
/**
 * 按 seq 单调水位挑出新卡片。
 *
 * 三条边界都必须成立：
 *   - lastSeq < 0 表示本机首次接入，静默对齐到当前最大值，不为存量卡片补发通知
 *     （否则升级或切到演示模式那一刻会把十几张旧卡一次性弹出来）
 *   - 服务端清档后 maxSeq 会低于水位，此时水位同步下调且不补发
 *   - 其余情况只投递 seq 高于水位的卡片，天然幂等、不可能重放
 *
 * 早先用"指纹集合 + 遍历全部卡片"判新，而集合有容量上限会被裁剪，卡片累积到超过
 * 上限后被裁掉的旧卡重新被判为新卡，每帧反复投递——实测堆出 428 个开箱层。
 */
export function pickFreshCards(cards, lastSeq) {
    const maxSeq = cards.reduce((acc, c) => Math.max(acc, c.seq ?? 0), 0);
    if (maxSeq < lastSeq)
        return { fresh: [], nextSeq: maxSeq };
    if (lastSeq < 0)
        return { fresh: [], nextSeq: maxSeq };
    const fresh = cards
        .filter((c) => (c.seq ?? 0) > lastSeq)
        .slice()
        .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    const nextSeq = fresh.reduce((acc, c) => Math.max(acc, c.seq ?? 0), lastSeq);
    return { fresh, nextSeq };
}
/**
 * 收信箱对账：未读明信片必须在权威状态里真实存在。
 *
 * 演示残留、服务端清档后的陈旧条目、别的标签页写回的脏数据都会被这一步清掉。
 * 这是比"逐个写入点加护栏"更可靠的兜底——护栏靠人记得，对账靠不变量自动生效。
 */
export function reconcileCards(inbox, authoritative) {
    if (inbox.length === 0)
        return [];
    const live = new Set(authoritative.map((c) => fingerprintOf(c)));
    return inbox.filter((c) => live.has(fingerprintOf(c)));
}
/** 未读队列裁剪：只保留最近的若干封。 */
export function capInbox(inbox, cap) {
    if (cap <= 0)
        return [];
    if (inbox.length <= cap)
        return inbox.slice();
    return inbox.slice(inbox.length - cap);
}
/**
 * 未读是否已被权威状态确认。
 *
 * 启动宽限期到期时用它决定"留还是删"：本地可能存着来历不明的未读（早期演示污染、
 * 其它窗口写回、清档遗留），权威状态没确认的一律不该继续显示。
 */
export function allConfirmed(inbox, authoritative) {
    if (inbox.length === 0)
        return true;
    if (authoritative === null)
        return false;
    const live = new Set(authoritative.map((c) => fingerprintOf(c)));
    return inbox.every((c) => live.has(fingerprintOf(c)));
}
