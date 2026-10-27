/**
 * 双语支持。
 *
 * 明信片数据一直带着 caption.en，但整个项目从未有过语言切换 —— 英文文案写好了却
 * 永远显示不出来。这里补上骨架：跟随浏览器语言，允许手动切换并记住选择。
 *
 * 关于覆盖范围的实话：界面里约有 210 条中文文案，一次全译完属于独立工程量。
 * 本表优先覆盖用户最先接触的部分（标签、按钮、标题、空态、统计、鲸的台词），
 * 未登记的 key 会**原样回落中文**而不是显示空白，因此增量翻译不会破坏界面。
 */
const KEY_LANG = 'whale-voyage:lang';
/** 当前语言。缺省跟随浏览器，只认中文与英文两档。 */
let current = detect();
function detect() {
    try {
        const saved = localStorage.getItem(KEY_LANG);
        if (saved === 'zh' || saved === 'en')
            return saved;
    }
    catch { /* 隐私模式下不可读，按浏览器语言走 */ }
    const nav = typeof navigator === 'undefined' ? 'zh' : (navigator.language || 'zh');
    return nav.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}
export function lang() {
    return current;
}
export function setLang(next) {
    current = next;
    try {
        localStorage.setItem(KEY_LANG, next);
    }
    catch { /* 写不进就只在本次会话生效 */ }
}
/** 从一条双语数据里取当前语言的那面（明信片文案走这条）。 */
export function pick(pair) {
    if (pair === undefined)
        return '';
    return current === 'en' ? (pair.en || pair.zh) : pair.zh;
}
/**
 * 界面文案表。key 用中文原文，这样未登记时能直接回落，
 * 也免去维护一套抽象 key 名的成本。
 */
const EN = {
    // —— 标签与导航 ——
    '🏠 小家': '🏠 Nest',
    '相册': 'Album',
    '航海日志': 'Logbook',
    '🐋 相册与航海日志': '🐋 Album & Logbook',
    '关闭': 'Close',
    '面板切换': 'Switch panel',
    // —— 相册 ——
    '每一张都来自一次真实的远行': 'Every card comes from a real voyage',
    '图鉴': 'Collection',
    '⤓ 分享卡': '⤓ Share card',
    '还没有明信片，等一次长一点的远行吧。': 'No postcards yet — wait for a longer voyage.',
    // —— 小家 ——
    '它记得的事': 'What it remembers',
    '行囊里的东西': 'In its satchel',
    '看看它怎么远行': 'See how it voyages',
    '自检信息': 'Self-check',
    '🫧 摸摸它': '🫧 Pet it',
    '▶︎ 播放一次演示': '▶︎ Play demo once',
    '🧹 清掉未读提示': '🧹 Clear unread badge',
    '已清掉': 'Cleared',
    '相处已满：配件、台词与记忆全部解锁': 'Fully bonded: all accessories, lines and memories unlocked',
    // —— 统计 ——
    '次远行': 'voyages',
    '张明信片': 'postcards',
    '天相识': 'days together',
    '今日贝壳': 'shells today',
    // —— 鲸的台词 ——
    '我回来了': "I'm back",
    '回来了': 'Back home',
    '要出发了，看我一趟': "Heading out — watch me go",
    '给你带了明信片，想看的时候点它': 'Brought you a postcard — tap when you like',
    '好，那就先不看了': 'Alright, later then',
    '好，那就先回来': "Alright, I'll come back",
    '它下潜了，正好看看之前的信': "It's diving — good time to read past letters",
    '这趟遇上风浪了，不过我捡到一枚贝壳': 'Rough seas out there — but I found a shell',
    '没走成，带回一枚贝壳给你': "Didn't make it far, brought you a shell",
    '风浪太大就回来了，贝壳收好': 'Too stormy, came back — keep this shell',
    '新明信片': 'New postcard',
    '让它去休息（右下角可唤回）': 'Let it rest (recall from bottom-right)',
    '摸摸它': 'Pet it',
    '点开看它带回来的明信片': 'Tap to see the postcard it brought',
    '收到一张明信片': 'Received a postcard',
};
/** 取界面文案。未登记的 key 原样返回中文，绝不返回空串。 */
export function t(zh) {
    if (current === 'zh')
        return zh;
    return EN[zh] ?? zh;
}
/** 已登记的英文条目数（自查与测试用）。 */
export function translatedCount() {
    return Object.keys(EN).length;
}
