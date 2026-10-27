/**
 * HTML 转义。
 *
 * 项目里多处用模板字符串拼 `innerHTML`（明信片文案、图鉴标签、日志正文、自检信息），
 * 插值全部未经转义。这些数据当前来自服务端的固定文案库，确实构造不出可利用的注入，
 * 所以这不是一个可利用漏洞 —— 但架构是脆弱的：一旦文案改为取自任务内容、
 * 会话标题或 agent 输出，同一行代码立刻变成 XSS。
 *
 * 与其记住"这里的数据现在是可信的"，不如让转义成为默认动作。
 */
const MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
};
/** 把任意值转成可安全插入 HTML 文本或属性值的字符串。 */
export function esc(value) {
    if (value === null || value === undefined)
        return '';
    return String(value).replace(/[&<>"']/g, (ch) => MAP[ch] ?? ch);
}
