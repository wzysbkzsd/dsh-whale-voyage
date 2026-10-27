import { esc } from './escape.js';
import { pick, t } from './i18n.js';
import { allConfirmed, capInbox, pickFreshCards, reconcileCards } from './inbox-logic.js';
const BASE = '/whale-voyage';
const ART = `${BASE}/assets/art/`;
/** 美术资源版本戳：art/ 走 max-age=86400 长缓存，替换美术文件后改此值强制刷新。 */
const ART_V = '?v=20261027';
/**
 * 姿态立绘：全部从同一张角色设定图切出（tools/crop-poses），因此天然同风格、同比例。
 * 不再用 CSS 旋转硬凑，也不再混用独立生成的图。
 */
const POSE_AWAY = 'pose-sheet-dive.png';
const POSE_HELPING = 'pose-sheet-surface.png';
/**
 * 居家姿态按羁绊等级取带配件的立绘（配件已烘焙进图，见 tools/make-accessories.cjs）。
 * 出航与求助是过渡态，不叠配件。
 */
const POSE_SLEEP = 'pose-sheet-sleep.png';
function poseFor(phase) {
    if (phase === 'sleep')
        return POSE_SLEEP;
    if (phase === 'away')
        return POSE_AWAY;
    if (phase === 'helping')
        return POSE_HELPING;
    return `pose-sheet-float-lv${Math.min(3, levelOf(bond))}.png`;
}
const WHALE_ART = 'pose-sheet-float-lv0.png';
/** 场景配图（信封开箱时展示明信片画面）。 */
const SCENE_ART = {
    shipwreck: 'scene-shipwreck.jpg',
    coral: 'scene-coral.jpg',
    plankton: 'scene-plankton.jpg',
    current: 'scene-current.jpg',
    trench: 'scene-trench.jpg',
    dolphin: 'scene-dolphin.jpg',
    'open-sea': 'scene-opensea.jpg',
};
/**
 * 稀有专属配图：按 rareKind 选取，比场景图更先匹配。
 * 每张都带各自的光影氛围（风暴后彩虹、极光夜航、深渊荧光、水面浮灯……），
 * 是"稀有"最直观的表达 —— 文案之外，图也要配得上这次远行。
 */
const RARE_ART = {
    companion: 'rare-companion.jpg',
    storm: 'rare-storm.jpg',
    aurora: 'rare-aurora.jpg',
    milestone: 'rare-milestone.jpg',
    marathon: 'rare-marathon.jpg',
    pod: 'rare-pod.jpg',
    abyss: 'rare-abyss.jpg',
    festival: 'rare-festival.jpg',
};
const KEY_HIDDEN = 'whale-voyage:skin-hidden';
const KEY_POS = 'whale-voyage:whale-pos';
const KEY_BOND = 'whale-voyage:bond';
const KEY_PET_DAY = 'whale-voyage:petDay';
const KEY_INBOX = 'whale-voyage:inbox';
const KEY_NAME = 'whale-voyage:name';
/** 指纹去重是否已完成首次种子化（区分"全新接入"与"确有新卡"）。 */
const KEY_SEEDED = 'whale-voyage:inbox-seeded';
const KEY_CARD_SEQ = 'whale-voyage:card-seq';
/** 残留未读的一次性清理标记（脏数据来自早期演示污染与开箱堆积）。 */
const KEY_INBOX_RESET = 'whale-voyage:inbox-reset-v3';
/** 未读明信片上限：只留最近几封，避免久不打开时堆积。 */
const INBOX_MAX = 5;
const KEY_SINCE = 'whale-voyage:since';
const KEY_SEEN_CARDS = 'whale-voyage:seen-cards';
const KEY_SEEN_VOYAGES = 'whale-voyage:seen-voyages';
/** 亲密度等级门槛与配件。 */
const LEVELS = [0, 12, 36, 80, 160];
const LEVEL_NAME = ['初识', '相熟', '默契', '挚友', '同舟'];
/** 摸头反应（按等级递进）。 */
const PET_LINES = [
    ['（歪了歪头）', '（眨了下眼）', '嗯？', '（打了个小小的水花）'],
    ['你来啦', '（把头靠过来一点）', '今天风不错', '（轻轻喷了口水）'],
    ['我在等你', '（眼睛亮了一下）', '还想再摸一下', '（尾巴晃了晃）'],
    ['和你一起最安心', '（贴住你的手）', '我们下次去更远的地方', '（哼了一小段鲸歌）'],
    ['一直都在', '（安静地依着你）', '你在，就不算远行', '（把最好的贝壳给你）'],
];
let demoMode = new URLSearchParams(location.search).has('wv-demo') ? 'loop' : 'live';
function isDemo() { return demoMode !== 'live'; }
let hidden = localStorage.getItem(KEY_HIDDEN) === '1';
let bond = Number(localStorage.getItem(KEY_BOND) ?? '0');
let sinceDay = localStorage.getItem(KEY_SINCE);
if (sinceDay === null) {
    sinceDay = String(Date.now());
    localStorage.setItem(KEY_SINCE, sinceDay);
}
let seenCards = Number(localStorage.getItem(KEY_SEEN_CARDS) ?? '-1');
let seenVoyages = Number(localStorage.getItem(KEY_SEEN_VOYAGES) ?? '-1');
let lastPetAt = 0;
let whaleBox = null;
let whaleImg = null;
let artA = null;
let artB = null;
let artOnA = true;
let swapToken = 0;
let bubbles = null;
let tint = null;
let cornerBtn = null;
let panel = null;
let toastEl = null;
let lastState = null;
let toastTimer;
let sayTimer;
function fmtDuration(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
}
function levelOf(points) {
    let lv = 0;
    for (let i = 0; i < LEVELS.length; i += 1)
        if (points >= LEVELS[i])
            lv = i;
    return lv;
}
function daysTogether() {
    return Math.max(1, Math.floor((Date.now() - Number(sinceDay)) / 86_400_000) + 1);
}
/** 羁绊上限（满级分值）。超出即无意义，展示与累加都以此为界。 */
const BOND_MAX = LEVELS[LEVELS.length - 1];
/** 每日摸头可得上限，防止刷分掩盖真实相处时长。 */
const PET_DAILY_CAP = 6;
/**
 * 羁绊只做一件事：记录相处的累积，用来解锁配件、台词层级与记忆。
 * 它不参与明信片稀有度的判定——稀有度必须只由真实工作事件驱动，否则明信片就不再
 * 是"真实工作的凭证"。演示模式（?wv-demo=1）一律不写羁绊，避免假数据污染养成。
 */
function addBond(points) {
    if (isDemo())
        return;
    if (bond >= BOND_MAX)
        return;
    const before = levelOf(bond);
    bond = Math.min(BOND_MAX, bond + points);
    localStorage.setItem(KEY_BOND, String(bond));
    const after = levelOf(bond);
    applyLevel();
    if (after > before) {
        say(`羁绊加深了 · ${LEVEL_NAME[after]}`, 4200);
        toast(`🐋 你和它的羁绊到了「${LEVEL_NAME[after]}」`);
    }
}
/**
 * 姿态换图用双层交叉淡入。直接改同一个 img 的 src 会在动画中途出现硬切（跳帧），
 * 这是"动作看不懂"的主因之一；两层叠加淡入才有连续感。
 */
function swapArt(file) {
    const from = artOnA ? artA : artB;
    const to = artOnA ? artB : artA;
    if (from === null || to === null)
        return;
    if (from.src.includes(file))
        return;
    // 令牌作废迟到回调：前一次若图未就绪，其 onload 可能在本次切换后才触发，
    // 把 is-on 搬回旧图（实测导致归来后仍显示深潜立绘）
    swapToken += 1;
    const my = swapToken;
    const run = () => {
        if (my !== swapToken || from === null || to === null)
            return;
        to.classList.add('is-on');
        from.classList.remove('is-on');
        artOnA = !artOnA;
        whaleImg = to;
    };
    to.onload = null;
    to.onerror = null;
    to.src = `${ART}${file}${ART_V}`;
    if (to.complete && to.naturalWidth > 0)
        run();
    else {
        to.onload = run;
        to.onerror = run;
    }
}
function applyLevel() {
    if (whaleBox === null)
        return;
    whaleBox.dataset.level = String(levelOf(bond));
    // 居家状态下立即换成带新配件的立绘（配件已烘焙进图，不做 CSS 叠加）
    if (whaleBox.dataset.state === 'home' && !dozing)
        swapArt(poseFor('home'));
}
/** 鲸的说话气泡（临时覆盖状态文案）。 */
function say(text, ms = 3000) {
    if (whaleBox === null || occluded)
        return;
    const bubble = whaleBox.querySelector('.wv-say');
    bubble.textContent = text;
    bubble.hidden = false;
    window.clearTimeout(sayTimer);
    sayTimer = window.setTimeout(() => { bubble.hidden = true; }, ms);
}
function hearts() {
    if (whaleBox === null)
        return;
    for (let i = 0; i < 4; i += 1) {
        const h = document.createElement('i');
        h.className = 'wv-heart';
        h.textContent = i % 2 === 0 ? '♥' : '✦';
        h.style.setProperty('--dx', `${(Math.random() * 46 - 23).toFixed(1)}px`);
        h.style.setProperty('--d', `${(i * 0.09).toFixed(2)}s`);
        whaleBox.appendChild(h);
        window.setTimeout(() => h.remove(), 1400);
    }
}
/** 今日已通过摸头获得的羁绊（按自然日重置）。 */
function petToday() {
    const raw = localStorage.getItem(KEY_PET_DAY) ?? '';
    const [day, n] = raw.split('|');
    return day === new Date().toDateString() ? Number(n) : 0;
}
function bumpPetToday() {
    if (isDemo())
        return; // 演示时摸头不计入真实的每日额度（自查发现的漏点）
    localStorage.setItem(KEY_PET_DAY, `${new Date().toDateString()}|${petToday() + 1}`);
}
/** 摸头：台词 + 挤压反应 + 爱心（30 秒限流、每日上限）。 */
function pet() {
    if (whaleBox === null)
        return;
    wake();
    const lv = levelOf(bond);
    const pool = PET_LINES[lv] ?? PET_LINES[0];
    say(pool[Math.floor(Math.random() * pool.length)]);
    hearts();
    // 挤压反应：重播动画需先移除类并强制重排
    const fig = whaleBox.querySelector('.wv-figure');
    fig.classList.remove('is-petted');
    void fig.offsetWidth;
    fig.classList.add('is-petted');
    window.setTimeout(() => fig.classList.remove('is-petted'), 900);
    const now = Date.now();
    if (now - lastPetAt > 30_000 && petToday() < PET_DAILY_CAP) {
        lastPetAt = now;
        bumpPetToday();
        addBond(1);
    }
}
/** 记忆感台词：引用真实历史（点击状态条时触发）。 */
function recall() {
    const voyages = lastState?.voyageCounter ?? 0;
    const cards = lastState?.cards.length ?? 0;
    const lines = [
        `我们一起走过 ${voyages} 次远行`,
        `相识第 ${daysTogether()} 天了`,
        cards > 0 ? `寄回过 ${cards} 张明信片` : '还没寄回过明信片呢',
        `羁绊：${LEVEL_NAME[levelOf(bond)]}（${bond}）`,
    ];
    say(lines[Math.floor(Math.random() * lines.length)], 4200);
}
function applyVisibility() {
    document.body.classList.toggle('wv-skin', !hidden);
    if (whaleBox !== null)
        whaleBox.hidden = hidden;
    if (bubbles !== null)
        bubbles.style.display = hidden ? 'none' : '';
    if (cornerBtn !== null)
        cornerBtn.textContent = hidden ? '🐋 唤回小鲸' : '🐋 航海日志';
}
/** 拖拽：位置持久化，限制在视口内。 */
function makeDraggable(el) {
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let baseX = 0;
    let baseY = 0;
    const saved = localStorage.getItem(KEY_POS);
    if (saved !== null) {
        try {
            const { x, y } = JSON.parse(saved);
            placeFixed(x, y);
        }
        catch { /* 忽略坏值 */ }
    }
    el.addEventListener('pointerdown', (ev) => {
        if (ev.button !== 0)
            return;
        dragging = true;
        moved = false;
        startX = ev.clientX;
        startY = ev.clientY;
        const rect = el.getBoundingClientRect();
        baseX = rect.left;
        baseY = rect.top;
        el.setPointerCapture(ev.pointerId);
        el.classList.add('wv-dragging');
    });
    el.addEventListener('pointermove', (ev) => {
        if (!dragging)
            return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3)
            moved = true;
        placeFixed(baseX + dx, baseY + dy);
    });
    const end = (ev) => {
        if (!dragging)
            return;
        dragging = false;
        el.classList.remove('wv-dragging');
        try {
            el.releasePointerCapture(ev.pointerId);
        }
        catch { /* 已释放 */ }
        const rect = el.getBoundingClientRect();
        if (moved) {
            localStorage.setItem(KEY_POS, JSON.stringify({ x: rect.left, y: rect.top }));
        }
        else {
            pet(); // 未移动 = 单击互动
        }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
}
function placeFixed(x, y) {
    if (whaleBox === null)
        return;
    const w = whaleBox.offsetWidth || 120;
    const h = whaleBox.offsetHeight || 150;
    const cx = Math.min(Math.max(6, x), Math.max(6, window.innerWidth - w - 6));
    const cy = Math.min(Math.max(6, y), Math.max(6, window.innerHeight - h - 6));
    whaleBox.classList.add('wv-free');
    whaleBox.style.left = `${cx}px`;
    whaleBox.style.top = `${cy}px`;
    whaleBox.style.right = 'auto';
    whaleBox.style.bottom = 'auto';
}
function mount() {
    const conversation = document.querySelector('[data-slot="conversation"]');
    whaleBox = document.createElement('div');
    whaleBox.className = 'wv-whale';
    whaleBox.dataset.state = 'home';
    whaleBox.dataset.level = '0';
    whaleBox.title = '点一下摸摸它 · 按住可拖走 · 点状态条听它说说话';
    whaleBox.innerHTML = `
    <button class="wv-dismiss" type="button" aria-label="${esc(t('让它去休息（右下角可唤回）'))}" title="${esc(t('让它去休息（右下角可唤回）'))}">✕</button>
    <div class="wv-say" role="status" aria-live="polite" hidden></div>
    <div class="wv-figure" role="button" tabindex="0" aria-label="${esc(t('摸摸它'))}">
      <img class="wv-whale-art wv-art-a is-on" src="${ART}${WHALE_ART}${ART_V}" alt="" draggable="false">
      <img class="wv-whale-art wv-art-b" alt="" draggable="false">
      <span class="wv-spray"></span>
    </div>
    <button class="wv-letter" type="button" hidden title="点开看它带回来的明信片">
      <span class="wv-letter-icon">💌</span>
      <span class="wv-letter-text">${esc(t('新明信片'))}</span>
      <span class="wv-letter-n"></span>
    </button>
    <div class="wv-whale-ripple" hidden></div>
    <div class="wv-meta">
      <button class="wv-whale-tag" type="button"></button>
      <span class="wv-badges" title="羁绊解锁的行囊"></span>
    </div>`;
    if (conversation !== null)
        conversation.appendChild(whaleBox);
    else {
        whaleBox.classList.add('wv-fixed');
        document.body.appendChild(whaleBox);
    }
    artA = whaleBox.querySelector('.wv-art-a');
    artB = whaleBox.querySelector('.wv-art-b');
    whaleImg = artA;
    // figure 已声明 role="button"，就必须响应 Enter 与空格，否则语义是假的
    const figureEl = whaleBox.querySelector('.wv-figure');
    figureEl.addEventListener('keydown', (ev) => {
        const key = ev.key;
        if (key !== 'Enter' && key !== ' ')
            return;
        ev.preventDefault();
        pet();
    });
    const letterBtn = whaleBox.querySelector('.wv-letter');
    letterBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openInbox();
    });
    // 右键或长按 = 忽略全部未读（确定的手动出口）
    letterBtn.addEventListener('contextmenu', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        dismissInbox();
    });
    let pressTimer;
    letterBtn.addEventListener('pointerdown', () => {
        window.clearTimeout(pressTimer);
        pressTimer = window.setTimeout(dismissInbox, 650);
    });
    for (const evName of ['pointerup', 'pointerleave', 'pointercancel']) {
        letterBtn.addEventListener(evName, () => window.clearTimeout(pressTimer));
    }
    for (const file of [poseFor('home'), POSE_AWAY, POSE_HELPING]) {
        const warm = new Image();
        warm.src = `${ART}${file}${ART_V}`;
    }
    makeDraggable(whaleBox.querySelector('.wv-figure'));
    whaleBox.querySelector('.wv-whale-tag').addEventListener('click', recall);
    whaleBox.querySelector('.wv-dismiss').addEventListener('click', (ev) => {
        ev.stopPropagation();
        hidden = true;
        localStorage.setItem(KEY_HIDDEN, '1');
        applyVisibility();
    });
    // 水色氛围层：相位变化靠它的不透明度平滑过渡。直接改宿主的 --dsw-alias-bg-*
    // 变量无法过渡（CSS 变量变更不参与 transition），整页背景会瞬变成闪烁
    tint = document.createElement('div');
    tint.className = 'wv-tint';
    if (conversation !== null)
        conversation.appendChild(tint);
    bubbles = document.createElement('div');
    bubbles.className = 'wv-bubbles';
    bubbles.innerHTML = Array.from({ length: 9 }, (_, i) => `<i style="--d:${i * 1.3}s;--x:${6 + (i * 11) % 88}%"></i>`).join('');
    if (conversation !== null)
        conversation.appendChild(bubbles);
    else
        document.body.appendChild(bubbles);
    cornerBtn = document.createElement('button');
    cornerBtn.type = 'button';
    cornerBtn.className = 'wv-corner';
    cornerBtn.title = '相册与航海日志';
    cornerBtn.addEventListener('click', () => {
        if (hidden) {
            hidden = false;
            localStorage.setItem(KEY_HIDDEN, '0');
            applyVisibility();
            say(t('我回来了'), 2600);
            return;
        }
        openPanel();
    });
    document.body.appendChild(cornerBtn);
    panel = document.createElement('div');
    panel.className = 'wv-panel';
    panel.hidden = true;
    // 弹出层要有 dialog 语义，读屏才会宣告"进入对话框"并把焦点收在里面
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', '相册与航海日志');
    panel.innerHTML = `
    <div class="wv-panel-head">
      <span>${esc(t('🐋 相册与航海日志'))}</span>
      <button class="wv-panel-close" type="button" aria-label="${esc(t('关闭'))}">✕</button>
    </div>
    <iframe class="wv-panel-frame" title="相册与航海日志"></iframe>`;
    document.body.appendChild(panel);
    panel.querySelector('.wv-panel-close')?.addEventListener('click', closePanel);
    document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape')
        closePanel(); });
    toastEl = document.createElement('div');
    toastEl.className = 'wv-toast';
    toastEl.hidden = true;
    document.body.appendChild(toastEl);
    applyLevel();
    applyVisibility();
}
/** 打开面板时按当前模式定 iframe 地址：演示中让面板旁观同一份进度。 */
function openPanel() {
    if (panel === null)
        return;
    const frame = panel.querySelector('.wv-panel-frame');
    const want = `${BASE}${isDemo() ? '?demo=view' : ''}`;
    if (frame.getAttribute('src') !== want)
        frame.setAttribute('src', want);
    panel.hidden = false;
    panel.querySelector('.wv-panel-close')?.focus();
}
function closePanel() {
    if (panel === null || panel.hidden)
        return;
    panel.hidden = true;
    // 关闭后焦点交还触发按钮，符合 dialog 的基本约定
    cornerBtn?.focus();
}
function toast(text) {
    if (toastEl === null || hidden)
        return;
    toastEl.textContent = text;
    toastEl.hidden = false;
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => { if (toastEl !== null)
        toastEl.hidden = true; }, 3600);
}
const RARITY_ZH = { common: '', variant: '变体', rare: '稀有', ultra: '超稀' };
/**
 * 明信片抵达时**不弹窗**。
 *
 * 时序上，航次结束正是 agent 回复落地的瞬间，用户注意力在读消息，此刻弹全屏
 * 仪式等于打断工作。改为：鲸上浮把信递过来，留一个可点的未读信标；用户在下一段
 * 等待时间（agent 又开始干活、注意力空出来）再点开——内容正好填进空窗。
 */
/** 递信动作：鲸上浮把信送过来。 */
function deliverPose() {
    if (whaleBox === null)
        return;
    const fig = whaleBox.querySelector('.wv-figure');
    fig.classList.add('is-delivering');
    window.setTimeout(() => fig.classList.remove('is-delivering'), 1400);
}
/** 预载场景图后开箱（超时兜底，绝不卡住仪式）。 */
function openWithArt(cards) {
    const urls = cards.map(() => '');
    let pending = cards.length;
    let fired = false;
    const go = () => { if (!fired) {
        fired = true;
        openEnvelope(cards, urls);
    } };
    cards.forEach((card, i) => {
        const img = new Image();
        const done = (ok) => {
            if (ok)
                urls[i] = img.src;
            pending -= 1;
            if (pending === 0)
                window.setTimeout(go, 140);
        };
        img.onload = () => done(true);
        img.onerror = () => done(false);
        const art = (card.rareKind !== undefined ? RARE_ART[card.rareKind] : undefined) ?? SCENE_ART[card.scene] ?? 'home.jpg';
        img.src = `${ART}${art}${ART_V}`;
    });
    window.setTimeout(go, 1800);
}
/**
 * 收到明信片。
 *
 * 演示与真实走**完全相同**的路径：都只留未读信标，等用户点开。
 * 曾为让用户看到开箱动效而在演示里改成自动播放，结果演示演的不是真实交互，
 * 用户当场发问"明信片不是要点击才弹出吗"——演示一旦与产品行为不一致就是误导。
 * 演示的隔离只体现在两点：不落盘（saveInbox 护栏）、未读只留最新一封。
 */
function receive(card) {
    receivedCount += 1;
    addBond(3);
    inbox.push(card);
    inbox = capInbox(inbox, isDemo() ? 1 : INBOX_MAX);
    saveInbox();
    applyInbox();
    say(inbox.length > 1 ? `还有 ${inbox.length} 封没看呢` : t('给你带了明信片，想看的时候点它'), 5200);
    deliverPose();
}
/**
 * 收信箱对账：未读明信片必须在权威状态里真实存在。
 *
 * 演示残留、服务端清档后的陈旧条目、其它窗口写回的脏数据都会被清掉。
 * 必须在每条加载路径之后调用，只在 render 里做是不够的——跨标签页同步会绕过它。
 */
function reconcileInbox() {
    if (lastState === null || inbox.length === 0)
        return;
    const kept = reconcileCards(inbox, lastState.cards);
    if (kept.length === inbox.length)
        return;
    inbox = kept;
    saveInbox(true); // 清理必须落盘，否则刷新后脏数据又被读回
    applyInbox();
}
/**
 * 未读的宽限期兜底。
 *
 * 启动时本地可能存着来历不明的未读（早期演示污染、其它窗口写回、清档遗留）。
 * 权威状态每 500ms 一帧，5 秒内必然到达并确认哪些未读是真的；到期仍未被确认的
 * 一律删键。这条不依赖 render 时序、不依赖护栏参数，是最后一道闸。
 */
function armInboxGrace() {
    if (inbox.length === 0)
        return;
    window.setTimeout(() => {
        if (inbox.length === 0)
            return;
        // 确认逻辑走 inbox-logic 里那份（有测试覆盖）
        if (allConfirmed(inbox, lastState === null ? null : lastState.cards))
            return;
        // 未被权威状态确认：清掉并删键
        inbox = [];
        try {
            localStorage.removeItem(KEY_INBOX);
        }
        catch { /* 忽略 */ }
        applyInbox();
        inboxGraceCleared = true;
    }, 5000);
}
/** 忽略全部未读：用户可控的确定出口，不依赖任何自动逻辑。 */
function dismissInbox() {
    inbox = [];
    // 直接删键而不是写空数组：这是用户点下的明确指令，必须在任何模式、任何
    // 状态下都确定生效，不经任何护栏与条件判断
    try {
        localStorage.removeItem(KEY_INBOX);
    }
    catch { /* 忽略 */ }
    applyInbox();
    say(t('好，那就先不看了'), 3200);
}
/**
 * 遇险归来的安慰。
 *
 * 文案要点明"仍有收获"（遇险也会带回一枚贝壳），否则用户只感到白等一场；
 * 主动召回则不必安慰，那是用户自己的决定，说多了反而像埋怨。
 */
function comfort(outcome) {
    if (outcome === 'error') {
        const lines = [
            '这趟遇上风浪了，不过我捡到一枚贝壳',
            '没走成，带回一枚贝壳给你',
            '风浪太大就回来了，贝壳收好',
        ];
        say(t(lines[Math.floor(Math.random() * lines.length)]), 5000);
        return;
    }
    if (outcome === 'aborted-user')
        say(t('好，那就先回来'), 3200);
}
/** 未读信标与角落按钮的红点。 */
function applyInbox() {
    if (whaleBox === null)
        return;
    const btn = whaleBox.querySelector('.wv-letter');
    const n = whaleBox.querySelector('.wv-letter-n');
    // 权威状态还没到达时不显示：此刻无法判断本地未读是否仍然有效，
    // 先不亮，等第一帧状态到了由对账定夺，避免脏数据闪现
    btn.hidden = inbox.length === 0 || lastState === null;
    // 抖几下即安静：常驻抖动会让人觉得"一直在催"
    if (!btn.hidden && btn.dataset.nudged !== '1') {
        btn.dataset.nudged = '1';
        window.setTimeout(() => btn.classList.add('is-calm'), 9000);
    }
    if (btn.hidden) {
        delete btn.dataset.nudged;
        btn.classList.remove('is-calm');
    }
    n.textContent = inbox.length > 1 ? `×${inbox.length}` : '';
    btn.title = (inbox.length > 1
        ? `点开看它带回来的 ${inbox.length} 张明信片`
        : t('点开看它带回来的明信片')) + '（右键或长按可忽略）';
    cornerBtn?.classList.toggle('has-unread', inbox.length > 0);
}
/**
 * 收信箱落盘。
 *
 * 演示模式默认不写：演示卡片若持久化，用户切回真实使用后右上角会永远挂着一封
 * 演示遗留的明信片。但**清理必须能落盘**——护栏只该拦"写入新数据"，不该拦"删除
 * 脏数据"。此前 `if (isDemo()) return` 无条件生效，导致对账与手动清空都只清了
 * 内存，磁盘上的脏未读分毫未动，刷新即复原（用户点了清空看到"已清掉"、刷新后
 * 又出现，就是这个原因）。
 *
 * @param force 清理类写入传 true，绕过演示护栏。
 */
function saveInbox(force = false) {
    if (isDemo() && !force)
        return;
    try {
        localStorage.setItem(KEY_INBOX, JSON.stringify(inbox));
    }
    catch { /* 配额满则丢弃 */ }
}
function loadInbox() {
    try {
        const raw = localStorage.getItem(KEY_INBOX);
        const arr = raw === null ? [] : JSON.parse(raw);
        if (Array.isArray(arr))
            inbox = arr.slice(-INBOX_MAX);
    }
    catch {
        inbox = [];
    }
}
/**
 * 点开最早的一封：先预载场景图（1.5s 超时兜底），再走开箱仪式。
 * 预载放在点击之后，用户已表达意愿，等一下是可接受的；反之自动弹窗时等待就是干扰。
 */
/**
 * 一次收下全部未读：攒了多张就一起铺开看，不逼用户点五遍。
 * 先并行预载所有场景图（1.8 秒超时兜底），再开箱。
 */
function openInbox() {
    if (inbox.length === 0)
        return;
    const cards = inbox.slice();
    inbox = [];
    saveInbox(true); // 已收下，属清理，必须落盘
    applyInbox();
    wake();
    openWithArt(cards);
}
/** 信封开箱仪式：信封落下 → 蜡封脱落 → 开封 → 明信片升起 → 飞向右下角入册。 */
/** 单张明信片的内容（信封内与铺开视图共用）。 */
function cardMarkup(card, artUrl, i, n) {
    const rarity = RARITY_ZH[card.rarity] ?? '';
    return `<div class="wv-card" style="--i:${i};--n:${n}">
      <div class="wv-card-art">
        ${artUrl === '' ? '' : `<img src="${artUrl}" alt="">`}
        ${rarity === '' ? '' : `<span class="wv-card-rarity">${rarity}</span>`}
      </div>
      <div class="wv-card-body">
        <div class="wv-card-caption">${esc(pick(card.caption))}</div>
        <div class="wv-card-stamp">第 ${esc(card.stamp.voyageNo)} 次远行 · ${esc(fmtDuration(card.stamp.durationMs))} · ${esc(card.stamp.toolCalls)} 次潜探</div>
      </div>
    </div>`;
}
/**
 * 开箱仪式。一张时从信封里升起；多张时从信封飞出并排铺开，一眼看全。
 */
function openEnvelope(cards, artUrls) {
    if (hidden || cards.length === 0)
        return;
    // 强制单例：同一时刻只允许一个开箱层。这是防御性兜底——即便判新逻辑再出问题，
    // 也绝不会像此前那样堆出几百层动画把画面炸掉。
    for (const stale of Array.from(document.querySelectorAll('.wv-mail')))
        stale.remove();
    const n = cards.length;
    const many = n > 1;
    const layer = document.createElement('div');
    layer.className = 'wv-mail';
    // 开箱是一次打断式演出，给它 dialog 语义并允许 Esc 收起
    layer.setAttribute('role', 'dialog');
    layer.setAttribute('aria-label', cards.length > 1 ? `收到 ${cards.length} 张明信片` : t('收到一张明信片'));
    layer.dataset.n = String(n);
    layer.innerHTML = `
    <div class="wv-mail-stage">
      <div class="wv-envelope">
        <div class="wv-env-back"></div>
        ${many ? '' : cardMarkup(cards[0], artUrls[0], 0, 1)}
        <div class="wv-env-flap"></div>
        <div class="wv-env-front"></div>
        <div class="wv-env-seal">🐋</div>
      </div>
      <div class="wv-mail-hint">${many ? `收到 ${n} 张明信片 · 点任意处收下` : '收到一张明信片'}</div>
    </div>
    ${many ? `<div class="wv-spread">${cards.map((c, i) => cardMarkup(c, artUrls[i], i, n)).join('')}</div>` : ''}`;
    document.body.appendChild(layer);
    // 阶段推进：落下 → 开封 → 展示 → 入册
    // 节奏：落下(0.9s) → 开封(0.7s) → 展示(3.6s) → 入册(1.1s)，每段都有缓动衔接
    window.setTimeout(() => layer.classList.add('is-land'), 60);
    window.setTimeout(() => layer.classList.add('is-open'), 980);
    window.setTimeout(() => layer.classList.add('is-show'), 1660);
    const hold = many ? 8200 : 5400;
    window.setTimeout(() => layer.classList.add('is-file'), hold);
    window.setTimeout(() => layer.remove(), hold + 1200);
    layer.addEventListener('click', () => {
        layer.classList.add('is-file');
        window.setTimeout(() => layer.remove(), 900);
    });
}
/**
 * 会话栏航迹图标：为左栏中能匹配到 sessionId 的行挂状态标记。
 * 这不是"多头鲸"，而是同一头鲸在各航道的动静（🫧 深潜 / 💌 家书 / 🐚 刚归来）。
 * 选择器采用多路兜底；匹配不到则静默跳过（dsh 预览期 DOM 可能变化）。
 */
function markSessionRows(state) {
    const marks = new Map();
    for (const voyage of Object.values(state.voyages)) {
        const member = state.members.find((m) => m.memberId === voyage.memberId);
        marks.set(voyage.sessionId, member?.state === 'helping' ? '💌' : '🫧');
    }
    for (const closed of state.closed.slice(-6)) {
        if (!marks.has(closed.sessionId) && Date.now() - closed.endedAt < 5 * 60_000) {
            marks.set(closed.sessionId, closed.outcome === 'completed' ? '🐚' : '🌀');
        }
    }
    const sidebar = document.querySelector('[data-slot="sidebar"]');
    if (sidebar === null)
        return;
    // 清理过期标记
    for (const old of Array.from(sidebar.querySelectorAll('.wv-row-mark'))) {
        const id = old.dataset.wvFor ?? '';
        if (!marks.has(id))
            old.remove();
    }
    for (const [sessionId, glyph] of marks) {
        const row = sidebar.querySelector(`[href*="${sessionId}"], [data-session-id="${sessionId}"], [data-id="${sessionId}"], [data-key="${sessionId}"]`);
        if (row === null)
            continue;
        let mark = row.querySelector(`.wv-row-mark[data-wv-for="${sessionId}"]`);
        if (mark === null) {
            mark = document.createElement('span');
            mark.className = 'wv-row-mark';
            mark.dataset.wvFor = sessionId;
            row.appendChild(mark);
        }
        if (mark.textContent !== glyph)
            mark.textContent = glyph;
    }
}
let inbox = [];
let hintedInbox = false;
let renderFailed = false;
let statusText = '';
let whaleName = localStorage.getItem('whale-voyage:name') ?? '';
let seeded = localStorage.getItem('whale-voyage:inbox-seeded') === '1';
/** 宽限期是否清理过未读（诊断用）。 */
let inboxGraceCleared = false;
/** 本次会话触发过多少次投递（诊断用）。 */
let receivedCount = 0;
/** 已处理到的明信片 seq 水位（-1 表示本机首次接入）。 */
/**
 * 已处理到的明信片 seq 水位（-1 表示"首次接入，静默对齐"）。
 *
 * 演示模式必须从 -1 起：磁盘上的水位来自真实数据（通常为 0），而演示状态往往
 * 已累积多张卡（seq 1..N），若沿用磁盘水位，接入第一帧就会把它们全判成新卡
 * 连着投递——用户看到的正是"先弹一串明信片，之后才看到下潜"。
 */
let lastCardSeq = isDemo() ? -1 : Number(localStorage.getItem('whale-voyage:card-seq') ?? '-1');
let occluded = false;
let phaseNow = '';
let phaseWanted = '';
let transToken = 0;
let homeSince = 0;
let dozing = false;
/** 打盹阈值：居家静置这么久就趴下睡（用户此刻在读消息，鲸不该抢注意力）。 */
const DOZE_AFTER_MS = 45_000;
/**
 * 注意力对齐：agent 空闲时用户在读消息或打字，鲸应当安静（打盹）；
 * agent 工作时用户空出手来，鲸才是主角（清晰的深潜游动）。
 */
function tickDoze() {
    if (whaleBox === null || hidden)
        return;
    const canDoze = phaseNow === 'home' && inbox.length === 0 && homeSince > 0;
    const should = canDoze && Date.now() - homeSince > DOZE_AFTER_MS;
    if (should === dozing)
        return;
    dozing = should;
    whaleBox.classList.toggle('is-dozing', dozing);
    swapArt(dozing ? POSE_SLEEP : poseFor('home'));
}
/**
 * 宿主是否弹出了全屏模态。
 *
 * 不能用 elementFromPoint 探测：让位后鲸自身是 pointer-events: none，命中测试会
 * 穿透到兄弟节点，于是永远判定"被遮挡"再也恢复不了（自锁）。改为结构化扫描——
 * 模态通常挂在 body 根部（portal），是覆盖大半视口的 fixed 层。只看 body 下两层，
 * 避免遍历整棵树。
 */
function hostOverlay() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const candidates = [];
    for (const child of Array.from(document.body.children)) {
        candidates.push(child);
        for (const grand of Array.from(child.children))
            candidates.push(grand);
    }
    for (const el of candidates) {
        if (whaleBox !== null && (el.contains(whaleBox) || whaleBox.contains(el)))
            continue;
        if (el === cornerBtn)
            continue;
        if (el.tagName === 'SCRIPT' || el.tagName === 'LINK' || el.tagName === 'STYLE')
            continue;
        const cs = getComputedStyle(el);
        if (cs.position !== 'fixed')
            continue;
        if (cs.display === 'none' || cs.visibility === 'hidden')
            continue;
        if (cs.pointerEvents === 'none')
            continue;
        if (Number(cs.opacity) < 0.05)
            continue;
        const r = el.getBoundingClientRect();
        if (r.width >= vw * 0.7 && r.height >= vh * 0.7)
            return true;
    }
    return false;
}
/** 宿主模态期间让位：淡出并交出指针事件，模态消失后自动回来。 */
function tickOcclusion() {
    if (whaleBox === null || hidden)
        return;
    const blocked = hostOverlay();
    if (blocked === occluded)
        return;
    occluded = blocked;
    whaleBox.classList.toggle('is-blocked', occluded);
    cornerBtn?.classList.toggle('is-blocked', occluded);
}
/**
 * 认领对话区：把鲸与氛围层迁入 [data-slot="conversation"]。
 *
 * mount 常常早于对话区渲染（首屏是引导页），那时鲸只能 fixed 挂在 body 上、
 * 水色层无处可挂——氛围会作用到整页而不是对话区，观感就是"整页闪一下"。
 * 对话区出现后搬家即可归位。用户拖动过的鲸保持原位，不强行搬走。
 */
function adoptConversation() {
    const conv = document.querySelector('[data-slot="conversation"]');
    if (conv === null)
        return;
    conv.classList.add('wv-host');
    if (tint !== null && tint.parentElement !== conv)
        conv.appendChild(tint);
    if (bubbles !== null && bubbles.parentElement !== conv)
        conv.appendChild(bubbles);
    if (whaleBox !== null && whaleBox.parentElement !== conv && !whaleBox.classList.contains('wv-free')) {
        whaleBox.classList.remove('wv-fixed');
        conv.appendChild(whaleBox);
    }
}
/** 唤醒：任何互动都让它抬头。 */
function wake() {
    homeSince = Date.now();
    if (!dozing)
        return;
    dozing = false;
    if (whaleBox !== null)
        whaleBox.classList.remove('is-dozing');
    swapArt(poseFor('home'));
}
/**
 * 相位切换的衔接：先做反向蓄力（起势），再换姿态图并落势。
 * 直接换图会让"漂浮→俯冲"看起来像跳帧；蓄力 + 落势提供动作连续感。
 * transToken 保证快速连切时旧的收尾不会覆盖新的相位。
 */
function setPhase(next) {
    if (whaleBox === null || whaleImg === null)
        return;
    if (next === phaseWanted)
        return; // 已在切往该相位，不再重排（否则每帧互相作废）
    phaseWanted = next;
    const fig = whaleBox.querySelector('.wv-figure');
    const token = transToken + 1;
    transToken = token;
    if (next === phaseNow) {
        // 过渡途中数据又折返回原相位：取消进行中的过渡，直接落回当前态
        fig.classList.remove('is-out');
        applyStatus();
        return;
    }
    fig.classList.remove('is-in');
    const first = phaseNow === ''; // 首帧直接落位，不做起势
    const apply = () => {
        if (transToken !== token || whaleBox === null)
            return;
        phaseNow = next;
        dozing = false;
        whaleBox.classList.remove('is-dozing');
        homeSince = next === 'home' ? Date.now() : 0;
        document.body.dataset.wvPhase = next;
        whaleBox.dataset.state = next;
        swapArt(poseFor(next));
        applyStatus();
        fig.classList.remove('is-out');
        fig.classList.add('is-in');
        // 特效对齐动作关键帧：下潜在"没入"那一刻冒气泡，归来在"落水"那一刻炸水花
        if (next === 'away') {
            window.setTimeout(() => { if (transToken === token)
                bubbleBurst(10); }, 620);
        }
        if (next === 'home' && !first) {
            breach(fig);
            window.setTimeout(() => { if (transToken === token)
                splash(); }, 880);
            window.setTimeout(() => { if (transToken === token)
                splash(); }, 1080);
        }
        window.setTimeout(() => { if (transToken === token)
            fig.classList.remove('is-in'); }, IN_MS);
    };
    if (first) {
        apply();
        return;
    }
    // 起势要足够长，用户才反应得过来：蓄力 0.56s → 换图淡入 → 落势 0.9s
    fig.classList.add('is-out');
    window.setTimeout(apply, OUT_MS);
}
/** 过渡时长（与 skin.css 的关键帧严格对应，改一处必须改两处）。 */
const OUT_MS = 560;
const IN_MS = 1450;
/** 明信片 seq 水位落盘。演示的卡片不得推高真实水位。 */
function persistCardSeq() {
    if (isDemo())
        return;
    localStorage.setItem(KEY_CARD_SEQ, String(lastCardSeq));
}
/** 计数水位落盘。演示的计数不得写进真实水位。 */
function persistWatermarks() {
    if (isDemo())
        return;
    localStorage.setItem(KEY_SEEN_CARDS, String(seenCards));
    localStorage.setItem(KEY_SEEN_VOYAGES, String(seenVoyages));
}
/** 状态文案与涟漪：与立绘在同一时刻更新。 */
function applyStatus() {
    if (whaleBox === null)
        return;
    whaleBox.querySelector('.wv-whale-ripple').hidden = phaseNow === 'home';
    const tag = whaleBox.querySelector('.wv-whale-tag');
    if (tag.textContent !== statusText)
        tag.textContent = statusText;
}
/** 下潜时上浮的气泡串。 */
function bubbleBurst(n) {
    if (whaleBox === null)
        return;
    for (let i = 0; i < n; i += 1) {
        const el = document.createElement('i');
        el.className = 'wv-bubble';
        el.style.setProperty('--dx', `${(Math.random() * 54 - 27).toFixed(1)}px`);
        el.style.setProperty('--sz', `${(3 + Math.random() * 5).toFixed(1)}px`);
        el.style.setProperty('--d', `${(i * 0.11).toFixed(2)}s`);
        whaleBox.appendChild(el);
        window.setTimeout(() => el.remove(), 2200);
    }
}
/** 归来跃出水面时的喷水（顶点喷一下，交代"它上来了"）。 */
function breach(fig) {
    fig.classList.add('is-breach');
    window.setTimeout(() => fig.classList.remove('is-breach'), 900);
}
/** 归来破水的水花。 */
function splash() {
    if (whaleBox === null)
        return;
    const el = document.createElement('i');
    el.className = 'wv-splash';
    whaleBox.appendChild(el);
    window.setTimeout(() => el.remove(), 1100);
}
function render(state) {
    lastState = state;
    if (whaleBox === null || whaleImg === null)
        return;
    const voyages = Object.values(state.voyages);
    const helping = state.members.find((m) => m.state === 'helping');
    const known = state.members[0]?.name;
    if (known !== undefined && known !== whaleName) {
        whaleName = known;
        if (!isDemo())
            localStorage.setItem(KEY_NAME, whaleName);
    }
    let phase = 'home';
    let status = '';
    if (helping !== undefined) {
        phase = 'helping';
        status = `💌 ${helping.name} 在等你的回信`;
    }
    else if (voyages.length > 0) {
        phase = 'away';
        const longest = Math.max(...voyages.map((v) => Date.now() - v.startedAt));
        const member = state.members.find((m) => m.memberId === voyages[0].memberId);
        status = `🫧 ${member?.name ?? '鲸'} 深潜中 · ${fmtDuration(longest)}${voyages.length > 1 ? ` ×${voyages.length}` : ''}`;
    }
    else {
        // 名字要记得住：状态被重置（清档或演示回放）时成员列表会空，
        // 此时仍应称呼它，而不是退回"等待第一次远行"
        const name = state.members[0]?.name ?? whaleName;
        status = name !== '' ? `🐋 ${name} · ${LEVEL_NAME[levelOf(bond)]}` : '🐋 等待第一次远行';
    }
    // 文案与立绘必须同步：立绘要等起势结束（OUT_MS）才换，若文案立即更新，
    // 中间约一秒会出现"写着深潜中、画面还在漂浮"的矛盾
    statusText = status;
    setPhase(phase);
    // 非过渡期才即时刷新（否则交给 applyStatus 在换图那一刻统一更新）
    if (phaseNow === phase)
        applyStatus();
    reconcileInbox();
    // 明信片按 seq 单调水位判新。
    //
    // 早先用"指纹集合 + 遍历全部 cards"，而集合有容量上限会被裁剪；卡片累积到超过
    // 上限后，被裁掉的旧卡片重新被判为新卡，每帧反复投递 —— 实测堆出 428 个开箱层，
    // 画面直接爆炸。卡片是单调追加的，水位判新既省内存也不可能重放。
    // 判新逻辑在 inbox-logic.ts 里，那份有测试覆盖：首次接入静默对齐、
    // 服务端清档回退、幂等不重放三条边界都被用例锁住了
    const picked = pickFreshCards(state.cards, lastCardSeq);
    lastCardSeq = picked.nextSeq;
    for (const card of picked.fresh)
        receive(card);
    persistCardSeq();
    // 航次归来 +2；计数回退时同步下调，避免此后永远判定不出归来
    if (state.voyageCounter < seenVoyages)
        seenVoyages = state.voyageCounter;
    if (seenVoyages >= 0 && state.voyageCounter > seenVoyages) {
        addBond(2);
        // 遇险归来要有一句话。此前只有"带回明信片"这条路径有台词，
        // 任务失败时鲸一言不发，等于只在顺利时陪着用户。
        const last = state.closed[state.closed.length - 1];
        if (last !== undefined && last.outcome !== 'completed')
            comfort(last.outcome);
    }
    seenVoyages = state.voyageCounter;
    seenCards = state.cards.length;
    persistWatermarks();
    // 刚进入等待且有未读：提示可以趁这段时间看信（只提示一次）
    if (phaseNow === 'away' && inbox.length > 0 && !hintedInbox) {
        hintedInbox = true;
        window.setTimeout(() => { if (phaseNow === 'away' && inbox.length > 0)
            say(t('它下潜了，正好看看之前的信'), 5000); }, 2600);
    }
    if (phaseNow !== 'away')
        hintedInbox = false;
    markSessionRows(state);
}
let source = null;
function streamUrl() {
    if (demoMode === 'loop')
        return `${BASE}/events?demo=1`;
    if (demoMode === 'once')
        return `${BASE}/events?demo=once`;
    return `${BASE}/events`;
}
/** 播放一次完整演示：切到 once 流，结束由 demo-end 收尾。 */
function playDemoOnce() {
    if (demoMode === 'once')
        return;
    demoMode = 'once';
    document.body.dataset.wvDemo = 'once';
    // 水位回到"首次接入"，避免把演示状态里的存量卡片当成新卡一次性弹出
    lastCardSeq = -1;
    inbox = [];
    applyInbox();
    closePanel(); // 演出在对话区，面板开着正好挡住
    reconnect();
    toast('▶︎ 演示开始 · 完整走一次远行');
    say(t('要出发了，看我一趟'), 4200);
}
/** 演示结束：回到真实数据流。 */
function endDemo() {
    demoMode = 'live';
    delete document.body.dataset.wvDemo;
    // 丢弃演示期间攒下的内存残留，回到磁盘上的真实未读与水位
    inbox = [];
    loadInbox();
    lastCardSeq = Number(localStorage.getItem(KEY_CARD_SEQ) ?? '-1');
    applyInbox();
    toast('■ 演示结束 · 已回到真实状态');
    say(t('回来了'), 3600);
    reconnect();
}
function reconnect() {
    if (source !== null) {
        source.onerror = null;
        source.close();
        source = null;
    }
    connect();
}
/**
 * 自检信息。浏览器自动化通道在部分环境不可用，把关键状态显式暴露出来，
 * 面板可直接展示、用户截图即可完成排查。
 */
function diagnostics() {
    const script = document.querySelector('script[data-wv-skin]');
    const src = script === null ? '(未注入)' : String(script.getAttribute('src'));
    let stored = '(空)';
    try {
        const raw = localStorage.getItem(KEY_INBOX);
        const arr = raw === null ? [] : JSON.parse(raw);
        stored = Array.isArray(arr) ? `${arr.length} 封` : '(坏数据)';
    }
    catch {
        stored = '(解析失败)';
    }
    return {
        脚本版本: src.replace('/whale-voyage/assets/', ''),
        运行模式: demoMode === 'live' ? '真实数据' : demoMode === 'once' ? '演示（单次）' : '演示（循环）',
        内存未读: `${inbox.length} 封`,
        磁盘未读: stored,
        权威明信片: lastState === null ? '(状态未到达)' : `${lastState.cards.length} 张`,
        卡片水位: String(lastCardSeq),
        收到过投递: receivedCount === 0 ? '否' : `${receivedCount} 次`,
        宽限期已清理: inboxGraceCleared ? '是' : '否',
        渲染异常: renderFailed ? '有（见控制台）' : '无',
    };
}
function connect() {
    const es = new EventSource(streamUrl());
    source = es;
    es.addEventListener('demo-end', () => { if (demoMode === 'once')
        endDemo(); });
    es.addEventListener('state', (ev) => {
        try {
            render(JSON.parse(ev.data));
        }
        catch (err) {
            // 只在首次失败时告警：静默全吞会让渲染崩溃彻底隐身（实测曾因此漏掉一次真 bug），
            // 每帧都打又会刷屏干扰宿主控制台
            if (!renderFailed) {
                renderFailed = true;
                console.warn('[whale-voyage] 渲染失败，已降级：', err);
            }
        }
    });
    es.onerror = () => {
        es.close();
        if (source === es)
            source = null;
        window.setTimeout(() => { if (source === null)
            connect(); }, 10_000);
    };
}
/**
 * 越界归正：早期演示模式（?wv-demo=1）会把假数据算进羁绊，导致分值远超满级。
 * 载入时钳到满级，保证展示与解锁逻辑成立。
 */
function migrateBond() {
    const max = LEVELS[LEVELS.length - 1];
    if (bond > max) {
        bond = max;
        localStorage.setItem(KEY_BOND, String(bond));
    }
}
/**
 * 一次性清理被污染的残留未读。
 *
 * 早期版本把演示明信片写进了真实收信箱，且开箱层曾无限堆积，这些脏数据已落在
 * 用户本地。对账只能清掉"不在当前状态里"的条目，无法覆盖服务端仍留有同名卡片的
 * 情形，因此用一次性版本标记做一次彻底清空——明信片本体仍在相册里，丢的只是
 * "未读"这一提示状态。
 */
function migrateInbox() {
    if (localStorage.getItem(KEY_INBOX_RESET) === '1')
        return;
    localStorage.setItem(KEY_INBOX_RESET, '1');
    localStorage.removeItem(KEY_INBOX);
    localStorage.removeItem('whale-voyage:delivered'); // 已废弃的指纹集合
    inbox = [];
}
/**
 * 开发者模式开关：URL 带 ?wv-dev=1 开启、?wv-dev=0 关闭，状态记在 localStorage。
 *
 * 演示按钮、清掉未读提示、自检信息都只是开发与排查工具，正式发布不暴露给用户；
 * 面板（iframe）与宿主同源，直接读这个键决定显隐。不带参数时维持现状，
 * 所以开发者设一次即可，日常刷新不会丢。
 */
function applyDevFlag() {
    const flag = new URLSearchParams(location.search).get('wv-dev');
    if (flag === '1' || flag === '0') {
        try {
            localStorage.setItem('whale-voyage:dev', flag);
        }
        catch { /* 写不进就本次会话内生效 */ }
    }
}
function start() {
    applyDevFlag();
    migrateBond();
    migrateInbox();
    loadInbox();
    mount();
    applyInbox();
    armInboxGrace();
    homeSince = Date.now();
    // 常驻轮询留下句柄并在卸载时清掉。单页面模型下不清也不会出事，但没有清理路径
    // 意味着一旦宿主支持重载主界面，轮询就会逐次累加。
    const timers = [
        window.setInterval(tickDoze, 5000),
        window.setInterval(tickOcclusion, 1200),
        window.setInterval(adoptConversation, 1200),
    ];
    window.addEventListener('pagehide', () => {
        for (const id of timers)
            window.clearInterval(id);
        source?.close();
    });
    adoptConversation();
    window.addEventListener('storage', (ev) => {
        // 另一个标签页改了收信箱：跟随刷新，避免两边未读状态互相矛盾
        if (ev.key !== KEY_INBOX && ev.key !== KEY_CARD_SEQ)
            return;
        if (isDemo())
            return;
        inbox = [];
        loadInbox();
        lastCardSeq = Number(localStorage.getItem(KEY_CARD_SEQ) ?? '-1');
        reconcileInbox(); // 别的窗口可能写回脏数据，读回来必须立刻对账
        applyInbox();
    });
    window.addEventListener('message', (ev) => {
        if (ev.origin !== location.origin)
            return;
        const data = ev.data;
        if (data !== null && data.type === 'wv-demo-once')
            playDemoOnce();
        if (data !== null && data.type === 'wv-inbox-clear')
            dismissInbox();
        // 焦点在 iframe 内时按 Esc，keydown 不会冒泡到宿主页面，只能由子页面转发
        if (data !== null && data.type === 'wv-panel-close')
            closePanel();
        if (data !== null && data.type === 'wv-diag-ask' && panel !== null) {
            const frame = panel.querySelector('.wv-panel-frame');
            frame.contentWindow?.postMessage({ type: 'wv-diag', payload: diagnostics() }, location.origin);
        }
    });
    tickOcclusion();
    connect();
}
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
}
else {
    start();
}
