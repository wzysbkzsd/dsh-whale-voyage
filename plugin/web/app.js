import { esc } from './escape.js';
import { lang, pick, setLang, t } from './i18n.js';
/**
 * 鲸的远行 — 页面投影层（只读视图，无任何写回路径；插件侧为唯一状态权威）。
 *
 * 数据源：SSE /whale-voyage/events（live）或 ?demo=1（演示回放）。
 * 每条 state 事件携带完整 VoyageState 快照，页面做差分渲染：
 *   - 成员三态演出（home / away / helping）与归来喷水
 *   - 家书浮层（存在 helping 成员时）
 *   - 相册（已收集 + 剪影图鉴）
 *   - 航海日志 + Markdown 导出
 *   - 专业模式（状态条；数据照记不照展）
 *   - 动态 favicon 与标签页标题（后台可见的注意力层）
 */
import { buildSharePayload, stampLineOf } from './share.js';
const $ = (id) => document.getElementById(id);
/* ---------- 配置与常量 ---------- */
/**
 * 开发者模式：演示按钮、清掉未读提示与自检信息只对开发者可见。
 * 开关由宿主页面解析 ?wv-dev=1/0 后写入 localStorage（面板与宿主同源，直接读），
 * 不带参数时维持现状。用它就必须面对它：这批 UI 是排查工具，不是产品功能。
 */
const DEV = (() => {
    try {
        return localStorage.getItem('whale-voyage:dev') === '1';
    }
    catch {
        return false;
    }
})();
const SCENE_EMOJI = {
    shipwreck: '🚢',
    coral: '🌿',
    plankton: '🦐',
    current: '🌊',
    trench: '🌑',
    dolphin: '🐬',
    'open-sea': '☁️',
};
const SCENE_ZH = {
    shipwreck: '沉船书房',
    coral: '珊瑚苗圃',
    plankton: '磷虾集市',
    current: '洋流赛道',
    trench: '海沟边缘',
    dolphin: '与海豚同游',
    'open-sea': '开阔洋面',
};
const RARE_ZH = {
    pod: '群游',
    companion: '同伴合影',
    storm: '风暴自愈',
    aurora: '极光海面',
    milestone: '里程碑',
    marathon: '马拉松深潜',
    abyss: '深渊归来',
    festival: '节日',
};
const RARITY_ZH = { common: '', variant: '变体', rare: '稀有', ultra: '超稀' };
const OUTCOME_ZH = {
    completed: '完成',
    error: '遇险',
    'aborted-user': '召回',
    'aborted-other': '中止',
    disposed: '未归',
};
/** 图鉴全集：7 场景 × 昼夜 + 8 稀有成因（剪影目标）。 */
const CATALOG = [
    ...Object.keys(SCENE_ZH).flatMap((s) => [
        { key: `scene:${s}:day`, label: `${SCENE_ZH[s]} · 昼` },
        { key: `scene:${s}:night`, label: `${SCENE_ZH[s]} · 夜` },
    ]),
    ...Object.keys(RARE_ZH).map((k) => ({ key: `rare:${k}`, label: RARE_ZH[k] })),
];
/** 美术资源（M3）：场景明信片与姿态立绘；open-sea 复用海面主景。 */
const ART = '/whale-voyage/assets/art/';
/**
 * 美术资源版本戳：art/ 响应头为 max-age=86400 长缓存，替换美术文件后改此值，
 * 强制浏览器重新拉取（否则旧图会一直留在缓存里）。
 */
const ART_V = '?v=20261027';
const SCENE_ART = {
    shipwreck: 'scene-shipwreck.jpg',
    coral: 'scene-coral.jpg',
    plankton: 'scene-plankton.jpg',
    current: 'scene-current.jpg',
    trench: 'scene-trench.jpg',
    dolphin: 'scene-dolphin.jpg',
    'open-sea': 'scene-opensea.jpg',
};
/** 稀有专属配图（与 skin.ts 的 RARE_ART 保持一致；稀有卡优先于场景图）。 */
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
// 旧版稀有回退映射已并入上方 RARE_ART（此前同伴/鲸群回退海豚场景，其余走渐变背景）
const LETTER_ASKED_ZH = [
    '浮上水面，敲了敲船舷',
    '家书一封，盼复',
    '她在原地等一支笔',
    '求助不丢人，迷路才丢人',
    '信里只问了件小事',
    '水面上的光晃了三下',
    '她把问题写得很工整',
    '请回信，她就在这里',
];
const HOME_ZH = ['在家晒太阳', '打了个长长的哈欠', '绕着家游了三圈', '枕着浪小睡', '数了一遍邮戳', '喷水玩，没人看也喷'];
const COLD_SAMPLES = 10;
/**
 * 门槛百分位。**必须与 machine.ts 的 THRESHOLD_PERCENTILE 保持一致**：
 * 这里只负责把门槛显示给用户，判定在状态机里。两处一旦漂移，面板报的门槛就与
 * 实际出卡条件不符（此前状态机已调到 0.85，这里还留着 0.7，用户看到的门槛比现实宽松
 * 两分钟左右）。构建期自查会比对这两个值。
 */
/** 首张明信片的门槛，**必须与 machine.ts 的 FIRST_CARD_THRESHOLD_MS 一致**（自查会比对）。 */
const FIRST_CARD_THRESHOLD_MS = 45_000;
const THRESHOLD_PERCENTILE = 0.85;
const THRESHOLD_DEFAULT_MS = 180_000;
const THRESHOLD_MIN_MS = 90_000;
const THRESHOLD_MAX_MS = 900_000;
let prev = {
    memberStates: new Map(),
    cardCount: 0,
    helping: false,
};
let lastState = { members: [], voyages: {}, cards: [], voyageCounter: 0, closed: [], durations: [], shells: { date: '', count: 0 } };
/* ---------- 连接 ---------- */
const params = new URLSearchParams(location.search);
const isDemo = params.has('demo');
let source = null;
let reconnectTimer;
function connect() {
    setStatus(false, isDemo ? '演示回放中' : '连接中…');
    // 演示模式要把具体模式透传（view = 只旁观共享进度，不启动也不改变回放）
    const demoParam = params.get('demo') ?? '1';
    source = new EventSource(isDemo ? `/whale-voyage/events?demo=${demoParam}` : '/whale-voyage/events');
    source.addEventListener('state', (ev) => {
        setStatus(true, isDemo ? '演示回放中' : '已连接');
        try {
            onState(JSON.parse(ev.data));
        }
        catch { /* 忽略坏帧 */ }
    });
    source.onerror = () => {
        setStatus(false, '连接断开，5 秒后重连…');
        source?.close();
        source = null;
        reconnectTimer = window.setTimeout(connect, 5000);
    };
}
function setStatus(on, text) {
    $('conn-dot').className = `dot ${on ? 'dot-on' : 'dot-off'}`;
    $('conn-text').textContent = text;
}
/* ---------- 主渲染 ---------- */
function onState(state) {
    lastState = state;
    const night = isNightNow();
    $('app').setAttribute('data-night', night ? '1' : '0');
    renderNest(state);
    renderAlbum(state);
    renderLogbook(state);
    renderStatusline(state);
    updateFaviconTitle(state, night);
    maybeNotify(state);
    prev = {
        memberStates: new Map(state.members.map((m) => [m.memberId, m.state])),
        cardCount: state.cards.length,
        helping: state.members.some((m) => m.state === 'helping'),
    };
}
/**
 * 主题跟随宿主：面板是 dsh 主界面里的 iframe（同源），直接读父窗口的暗色标记，
 * 避免"外壳浅色、卡片深色"的割裂（此前按时钟判夜间导致）。
 */
function isNightNow() {
    try {
        const parentBody = window.parent?.document?.body;
        if (parentBody !== undefined && parentBody !== null) {
            return parentBody.hasAttribute('data-ds-dark-theme');
        }
    }
    catch { /* 跨域则退回自身判断 */ }
    return document.body.hasAttribute('data-ds-dark-theme');
}
function fmtDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60)
        return `${s}s`;
    const m = Math.floor(s / 60);
    if (m < 60)
        return `${m}m${s % 60 > 0 ? `${s % 60}s` : ''}`;
    return `${Math.floor(m / 60)}h${m % 60}m`;
}
/* ---------- 小家：鲸的房间（羁绊 / 成长 / 记忆） ---------- */
const KEY_BOND = 'whale-voyage:bond';
const KEY_SINCE = 'whale-voyage:since';
const KEY_PET_DAY = 'whale-voyage:petDay';
const LEVELS = [0, 12, 36, 80, 160];
const LEVEL_NAME = ['初识', '相熟', '默契', '挚友', '同舟'];
const BOND_MAX = LEVELS[LEVELS.length - 1];
const PET_DAILY_CAP = 6;
/** 配件与羁绊等级对应，图已烘焙进立绘（tools/make-accessories.cjs）。 */
const ACCESSORIES = [
    { lv: 1, icon: '🎀', name: '珊瑚绶带', desc: '相熟时它自己系上的' },
    { lv: 2, icon: '⚓', name: '船长标', desc: '认得所有航道' },
    { lv: 2, icon: '🏮', name: '深海提灯', desc: '默契后夜航不再怕黑' },
    { lv: 3, icon: '🎖️', name: '同舟勋章', desc: '挚友的证明' },
];
function bondPoints() {
    // 越界归正：早期演示模式把假数据算进了羁绊，分值可能远超满级
    const raw = Number(localStorage.getItem(KEY_BOND) ?? '0');
    if (!Number.isFinite(raw) || raw < 0)
        return 0;
    if (raw > BOND_MAX) {
        localStorage.setItem(KEY_BOND, String(BOND_MAX));
        return BOND_MAX;
    }
    return raw;
}
function petToday() {
    const [day, n] = (localStorage.getItem(KEY_PET_DAY) ?? '').split('|');
    return day === new Date().toDateString() ? Number(n) : 0;
}
function bondLevel(points) {
    let lv = 0;
    for (let i = 0; i < LEVELS.length; i += 1)
        if (points >= LEVELS[i])
            lv = i;
    return lv;
}
function daysTogether() {
    const since = Number(localStorage.getItem(KEY_SINCE) ?? String(Date.now()));
    return Math.max(1, Math.floor((Date.now() - since) / 86_400_000) + 1);
}
let lastPetAt = 0;
function bindNest() {
    // 演示开关：面板是同源 iframe，交由主界面皮肤执行（演出发生在对话区）
    // 焦点落在面板 iframe 里时，Esc 的 keydown 不会冒泡到宿主页面，
    // 宿主那条监听形同虚设——必须由子页面主动转发关闭意图
    window.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Escape')
            return;
        window.parent.postMessage({ type: 'wv-panel-close' }, location.origin);
    });
    // 自检信息：向主界面索要，收到后渲染（浏览器自动化在部分环境不可用，
    // 把状态摆到界面上，用户截图即可完成排查）
    window.addEventListener('message', (ev) => {
        if (ev.origin !== location.origin)
            return;
        const data = ev.data;
        if (data === null || data.type !== 'wv-diag' || data.payload === undefined)
            return;
        // 自检里的脚本版本取自宿主页面的 script[src]，属外部输入，必须转义
        const rows = Object.entries(data.payload)
            .map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`)
            .join('');
        $('diag-list').innerHTML = rows;
    });
    const askDiag = () => { window.parent.postMessage({ type: 'wv-diag-ask' }, location.origin); };
    askDiag();
    // 自检区块只在开发者模式下渲染，轮询也随之只在开发者模式下跑
    const diagTimer = DEV ? window.setInterval(askDiag, 3000) : 0;
    // 与 SSE 一起在卸载时收掉；此前只关了 SSE，轮询留着
    window.addEventListener('pagehide', () => { if (diagTimer)
        window.clearInterval(diagTimer); });
    // 开发者模式（DEV 常量定义在文件顶部）：演示按钮、清掉未读提示与自检信息
    // 都是排查工具，不暴露给用户。开发者加 ?wv-dev=1 刷新即恢复。
    if (!DEV) {
        for (const section of Array.from(document.querySelectorAll('.nest-section'))) {
            const title = section.querySelector('h3')?.textContent ?? '';
            if (title === '自检信息' || title === '看看它怎么远行')
                section.hidden = true;
        }
    }
    // 静态界面文案统一按语言刷一遍。用 data-i18n 标注而不是散落调用，
    // 切换语言时只要重跑这一个函数
    const applyLang = () => {
        document.documentElement.lang = lang() === 'en' ? 'en' : 'zh-CN';
        for (const el of Array.from(document.querySelectorAll('[data-i18n]'))) {
            const zh = el.dataset.i18nZh ?? el.textContent ?? '';
            if (el.dataset.i18nZh === undefined)
                el.dataset.i18nZh = zh; // 记住原文，来回切换才不丢
            el.textContent = t(zh);
        }
        const btn = $('lang-toggle');
        btn.textContent = lang() === 'en' ? '🌐 中文' : '🌐 EN';
    };
    applyLang();
    $('lang-toggle').addEventListener('click', () => {
        setLang(lang() === 'en' ? 'zh' : 'en');
        applyLang();
        // 明信片文案、日志、记忆行都随语言变，重绘一次当前状态
        onState(lastState);
    });
    $('inbox-clear').addEventListener('click', () => {
        const btn = $('inbox-clear');
        window.parent.postMessage({ type: 'wv-inbox-clear' }, location.origin);
        btn.textContent = '已清掉';
        window.setTimeout(() => { btn.textContent = '🧹 清掉未读提示'; }, 2600);
    });
    $('demo-once').addEventListener('click', () => {
        const btn = $('demo-once');
        window.parent.postMessage({ type: 'wv-demo-once' }, location.origin);
        btn.disabled = true;
        btn.textContent = '演示中…';
        // 一轮回放约 6 秒，留足余量后恢复可点
        window.setTimeout(() => {
            btn.disabled = false;
            btn.textContent = '▶︎ 再播一次';
        }, 14_000);
    });
    $('nest-pet').addEventListener('click', () => {
        const art = $('nest-art');
        // 挤压反应：重播动画需先移除类并强制重排
        art.classList.remove('petted');
        void art.offsetWidth;
        art.classList.add('petted');
        petHearts();
        const now = Date.now();
        const capped = petToday() >= PET_DAILY_CAP;
        if (now - lastPetAt > 30_000 && !capped && bondPoints() < BOND_MAX) {
            lastPetAt = now;
            localStorage.setItem(KEY_PET_DAY, `${new Date().toDateString()}|${petToday() + 1}`);
            localStorage.setItem(KEY_BOND, String(Math.min(BOND_MAX, bondPoints() + 1)));
            renderNest(lastState);
        }
        const hint = $('nest-hint');
        hint.textContent = capped ? '今天已经玩够啦，明天再来' : '它蹭了蹭你的手';
        hint.classList.remove('show');
        void hint.offsetWidth;
        hint.classList.add('show');
    });
}
/** 摸头爱心粒子。 */
function petHearts() {
    const box = $('nest-portrait-box');
    for (let i = 0; i < 5; i += 1) {
        const el = document.createElement('i');
        el.className = 'nest-heart';
        el.textContent = i % 2 === 0 ? '♥' : '✦';
        el.style.setProperty('--dx', `${(Math.random() * 60 - 30).toFixed(1)}px`);
        el.style.setProperty('--d', `${(i * 0.08).toFixed(2)}s`);
        box.appendChild(el);
        window.setTimeout(() => el.remove(), 1500);
    }
}
function renderNest(state) {
    const points = bondPoints();
    const lv = bondLevel(points);
    const next = LEVELS[Math.min(lv + 1, LEVELS.length - 1)];
    const floor = LEVELS[lv];
    const ratio = lv >= LEVELS.length - 1 ? 1 : Math.max(0, Math.min(1, (points - floor) / Math.max(1, next - floor)));
    const member = state.members[0];
    const nestArt = $('nest-art');
    const activeVoyages = Object.keys(state.voyages).length;
    const nestPose = state.members.some((m) => m.state === 'helping')
        ? 'pose-sheet-surface.png'
        : activeVoyages > 0 ? 'pose-sheet-dive.png' : `pose-sheet-float-lv${Math.min(3, lv)}.png`;
    if (!nestArt.src.includes(nestPose))
        nestArt.src = `${ART}${nestPose}${ART_V}`;
    $('nest-title').textContent = member?.name ?? 'Lan';
    $('nest-level').textContent = LEVEL_NAME[lv];
    $('nest-bar-fill').style.width = `${(ratio * 100).toFixed(1)}%`;
    // 展示等级与进度，不裸露分值（分值只是内部计数，直接显示会引发"这数字是什么"的困惑）
    $('nest-bar-text').textContent = lv >= LEVELS.length - 1
        ? '已至同舟 · 羁绊满'
        : `还差 ${next - points} 点到「${LEVEL_NAME[lv + 1]}」`;
    $('home-bond-mini').textContent = LEVEL_NAME[lv];
    $('panel-nest').dataset.level = String(lv);
    $('nest-voyages').textContent = String(state.voyageCounter);
    $('nest-cards').textContent = String(state.cards.length);
    $('nest-days').textContent = String(daysTogether());
    $('nest-shells').textContent = String(state.shells?.count ?? 0);
    const lines = [
        `我们一起走过 ${state.voyageCounter} 次远行。`,
        `相识第 ${daysTogether()} 天了。`,
    ];
    const lastCard = state.cards.at(-1);
    if (lastCard !== undefined)
        lines.push(`最近寄回的一张：${pick(lastCard.caption)}。`);
    const lastClosed = state.closed.at(-1);
    if (lastClosed !== undefined) {
        lines.push(lastClosed.outcome === 'completed'
            ? `上一趟走了 ${fmtDuration(lastClosed.durationMs)}，平安回来了。`
            : `上一趟不太顺利，它回来时没说话。`);
    }
    if (state.cards.length === 0)
        lines.push(t('还没有明信片，等一次长一点的远行吧。'));
    $('nest-memories').innerHTML = lines.map((l) => `<li>${esc(l)}</li>`).join('');
    $('nest-bond-note').textContent = lv >= LEVELS.length - 1
        ? '相处已满：配件、台词与记忆全部解锁'
        : `相处累积会解锁配件与新的对话；每天最多摸头 ${PET_DAILY_CAP} 次`;
    $('nest-accs').innerHTML = ACCESSORIES.map((a) => {
        const owned = lv >= a.lv;
        return `<div class="nest-acc-item${owned ? '' : ' locked'}" title="${esc(owned ? a.desc : `羁绊达到「${LEVEL_NAME[a.lv]}」解锁`)}">
      <span class="nest-acc-icon">${owned ? a.icon : '·'}</span>
      <span class="nest-acc-name">${esc(a.name)}</span>
    </div>`;
    }).join('');
}
/* ---------- 相册（图鉴） ---------- */
let albumSig = '';
function renderAlbum(state) {
    const grid = $('album-grid');
    // 防闪：数据未变则不重建 DOM（SSE 每帧全量推送，重建会重放入场动画）
    const sig = `${state.cards.length}|${state.cards.map((c) => c.cardId).join(',')}`;
    if (sig === albumSig && grid.childElementCount > 0)
        return;
    albumSig = sig;
    const owned = new Map();
    for (const card of state.cards) {
        const key = card.rareKind !== undefined ? `rare:${card.rareKind}` : `scene:${card.scene}:${card.dayNight}`;
        const list = owned.get(key) ?? [];
        list.push(card);
        owned.set(key, list);
    }
    latestCardByKey = owned;
    const parts = [];
    for (const entry of CATALOG) {
        const cards = owned.get(entry.key);
        if (cards === undefined) {
            // 未收集：场景剪影（同场景色系去饱和 + 线稿海平线 + 问号水印），不用 emoji 占位
            const hintScene = entry.key.startsWith('scene:') ? entry.key.split(':')[1] : 'open-sea';
            const hintNight = entry.key.endsWith(':night');
            parts.push(`<div class="postcard locked" title="尚未收集">
        <div class="pc-art" style="background:${sceneBg(hintScene, hintNight ? 'night' : 'day')}">
          <span class="pc-horizon"></span>
          <span class="pc-lock">?</span>
        </div>
        <div class="pc-caption">${esc(entry.label)}</div>
        <div class="pc-stamp">尚未抵达</div>
      </div>`);
            continue;
        }
        const newest = cards.at(-1);
        const nightClass = newest.dayNight === 'night' ? ' night' : '';
        const rarityClass = newest.rarity === 'common' ? '' : ` r-${newest.rarity}`;
        const rarityTag = RARITY_ZH[newest.rarity] ?? '';
        const artFile = newest.rareKind !== undefined
            ? RARE_ART[newest.rareKind]
            : (newest.rareKind !== undefined ? RARE_ART[newest.rareKind] : undefined) ?? SCENE_ART[newest.scene];
        const artStyle = artFile !== undefined
            ? `background-image:url('${ART}${artFile}${ART_V}');background-size:cover;background-position:center;`
            : `background:${sceneBg(newest.scene, newest.dayNight)};`;
        parts.push(`<div class="postcard owned" title="${esc(entry.label)} ×${cards.length}">
      <div class="pc-art${nightClass}" style="${artStyle}">
        ${rarityTag === '' ? '' : `<span class="pc-rarity${rarityClass}">${rarityTag}</span>`}
        ${cards.length > 1 ? `<span class="pc-count">×${cards.length}</span>` : ''}
      </div>
      <div class="pc-body">
        <div class="pc-caption">${esc(pick(newest.caption))}</div>
        <div class="pc-stamp"><b>第 ${esc(newest.stamp.voyageNo)} 次远行</b>${esc(fmtDuration(newest.stamp.durationMs))} · ${esc(newest.stamp.toolCalls)} 次潜探</div>
      </div>
      <button class="pc-share" type="button" data-share-key="${esc(entry.key)}">⤓ 分享卡</button>
    </div>`);
    }
    grid.innerHTML = parts.join('');
    $('card-count').textContent = String(state.cards.length);
    $('stat-cards').textContent = `明信片 ${state.cards.length}`;
    $('stat-progress').textContent = `图鉴 ${owned.size} / ${CATALOG.length}`;
    // 收集进度环（conic-gradient，随进度推进）
    const pct = CATALOG.length === 0 ? 0 : Math.round((owned.size / CATALOG.length) * 100);
    const ring = $('album-ring');
    ring.style.setProperty('--pct', String(pct));
    ring.querySelector('b').textContent = `${pct}%`;
}
function sceneBg(scene, dayNight) {
    if (dayNight === 'night')
        return 'linear-gradient(180deg,#2b3f63,#17253f)';
    const map = {
        shipwreck: 'linear-gradient(180deg,#d8eef0,#a9c9d6)',
        coral: 'linear-gradient(180deg,#ffe9dc,#f9c8b8)',
        plankton: 'linear-gradient(180deg,#e5f6f2,#bde6dd)',
        current: 'linear-gradient(180deg,#dcecf8,#a8c6e8)',
        trench: 'linear-gradient(180deg,#37507a,#22355c)',
        dolphin: 'linear-gradient(180deg,#e3f2fa,#b6dcf2)',
        'open-sea': 'linear-gradient(180deg,#e8f6f9,#bfe5ea)',
    };
    return map[scene] ?? 'linear-gradient(180deg,#eef6f7,#d5e9ea)';
}
/* ---------- 航海日志 ---------- */
let logSig = '';
function renderLogbook(state) {
    const list = $('logbook-list');
    const sigL = `${state.voyageCounter}|${state.closed.length}|${state.closed.at(-1)?.endedAt ?? 0}`;
    if (sigL === logSig && list.childElementCount > 0)
        return;
    logSig = sigL;
    const entries = [...state.closed].reverse().slice(0, 60);
    const cardById = new Map(state.cards.map((c) => [c.cardId, c]));
    list.innerHTML = entries.map((entry) => {
        const card = entry.cardId !== undefined ? cardById.get(entry.cardId) : undefined;
        const icon = card !== undefined ? '🖼️' : entry.outcome === 'completed' ? '🐚' : '🌀';
        const text = card !== undefined
            ? `第 ${card.stamp.voyageNo} 次远行 · ${pick(card.caption)}`
            : entry.outcome === 'completed'
                ? `短途往返（${fmtDuration(entry.durationMs)}），带回小贝壳`
                : `一次${OUTCOME_ZH[entry.outcome] ?? '结束'}的航程（${fmtDuration(entry.durationMs)}）`;
        return `<div class="log-entry">
      <span class="log-time">${new Date(entry.endedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
      <img class="log-avatar" src="${ART}pose-sheet-float.png${ART_V}" alt="">
      <span>${esc(text)}</span>
      <span class="log-outcome">${esc(OUTCOME_ZH[entry.outcome] ?? '')}</span>
    </div>`;
    }).join('');
    $('stat-voyages').textContent = `远行 ${state.voyageCounter} 次`;
}
/* ---------- 状态行 ---------- */
function renderStatusline(state) {
    const n = state.durations.length;
    // 首张明信片走低门槛，状态行要如实反映，否则用户以为还要等三分钟
    if (state.cards.length === 0) {
        $('threshold-hint').textContent = `第一张只要 ${fmtDuration(FIRST_CARD_THRESHOLD_MS)}`;
        return;
    }
    let thresholdMs = THRESHOLD_DEFAULT_MS;
    if (n >= COLD_SAMPLES) {
        const sorted = [...state.durations].sort((a, b) => a - b);
        const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * THRESHOLD_PERCENTILE) - 1));
        thresholdMs = Math.min(THRESHOLD_MAX_MS, Math.max(THRESHOLD_MIN_MS, sorted[idx]));
    }
    $('threshold-hint').textContent = `远行门槛 ≈ ${fmtDuration(thresholdMs)}${n < COLD_SAMPLES ? '（学习你的节奏中）' : ''}`;
}
/* ---------- 注意力层：favicon 与标题 ---------- */
function faviconOf(state) {
    if (state.members.some((m) => m.state === 'helping'))
        return '💌';
    if (Object.keys(state.voyages).length > 0)
        return '🫧';
    return '🐋';
}
function updateFaviconTitle(state, night) {
    const emoji = faviconOf(state);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y="80" font-size="80">${emoji}</text></svg>`;
    let link = document.querySelector('link[rel="icon"]');
    if (link === null) {
        link = document.createElement('link');
        link.rel = 'icon';
        document.head.appendChild(link);
    }
    link.type = 'image/svg+xml';
    link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
    const active = Object.values(state.voyages);
    // 标题不再重复 emoji：favicon 已用动态 emoji（🐋/🫧/💌），标题保持纯文字，
    // 避免标签页出现「图标 + 同款 emoji」两个小标签
    if (state.members.some((m) => m.state === 'helping')) {
        document.title = '鲸在求助！';
    }
    else if (active.length > 0) {
        const longest = Math.max(...active.map((v) => Date.now() - v.startedAt));
        document.title = `深潜中 · ${fmtDuration(longest)}${active.length > 1 ? ` ×${active.length}` : ''}`;
    }
    else {
        document.title = `鲸的远行${night ? ' · 夜航灯已点' : ''}`;
    }
}
/* ---------- 系统通知（仅两类：授权、明信片） ---------- */
function maybeNotify(state) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted')
        return;
    const helping = state.members.some((m) => m.state === 'helping');
    if (helping && !prev.helping) {
        new Notification('鲸的远行', { body: '一头鲸浮上水面等待你的授权（家书）', tag: 'whale-helping' });
    }
    if (state.cards.length > prev.cardCount) {
        const card = state.cards.at(-1);
        new Notification('鲸的远行', { body: `收到明信片：${pick(card.caption)}`, tag: 'whale-card' });
    }
}
/* ---------- 面板/模式切换 ---------- */
function bindTabs() {
    const tabs = Array.from(document.querySelectorAll('.tab'));
    const activate = (btn) => {
        for (const t of tabs) {
            const on = t === btn;
            t.classList.toggle('active', on);
            // aria-selected 必须跟着走，否则读屏永远播报第一个标签为选中
            t.setAttribute('aria-selected', on ? 'true' : 'false');
        }
        const tab = btn.dataset.tab ?? 'nest';
        $('panel-nest').hidden = tab !== 'nest';
        $('panel-album').hidden = tab !== 'album';
        $('panel-logbook').hidden = tab !== 'logbook';
    };
    for (const [i, btn] of tabs.entries()) {
        btn.addEventListener('click', () => { activate(btn); });
        // tablist 的键盘约定：左右方向键在标签间移动
        btn.addEventListener('keydown', (ev) => {
            const step = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
            if (step === 0)
                return;
            ev.preventDefault();
            const next = tabs[(i + step + tabs.length) % tabs.length];
            activate(next);
            next.focus();
        });
    }
}
/**
 * 模式开关已移除（2026-08-28）：形态定稿后"可爱/专业"失去意义——
 * 需要清爽时直接叉掉对话区的鲸即可（右下角按钮可唤回）。
 */
/* ---------- 分享卡（canvas 渲染 PNG，默认脱敏：仅白名单字段） ---------- */
let latestCardByKey = new Map();
const RARITY_COLOR = {
    common: '#9ab3c4',
    variant: '#58a06e',
    rare: '#5b7de0',
    ultra: '#b06ac9',
};
function bindShare() {
    $('album-grid').addEventListener('click', (ev) => {
        const target = ev.target;
        if (target.classList?.contains('pc-share') !== true)
            return;
        const key = target.dataset.shareKey ?? '';
        const card = latestCardByKey.get(key)?.at(-1);
        if (card === undefined)
            return;
        const ownedCount = latestCardByKey.size;
        downloadShareCard(drawShareCard({
            card,
            owned: ownedCount,
            total: CATALOG.length,
            voyageCount: lastState.voyageCounter,
        }));
    });
}
function drawShareCard(input) {
    const payload = buildSharePayload({
        captionZh: input.card.caption.zh,
        captionEn: input.card.caption.en,
        sceneLabel: input.card.rareKind !== undefined ? (RARE_ZH[input.card.rareKind] ?? '') : (SCENE_ZH[input.card.scene] ?? ''),
        sceneEmoji: SCENE_EMOJI[input.card.scene] ?? '🐋',
        rarityLabel: RARITY_ZH[input.card.rarity] ?? '',
        rarityClass: RARITY_COLOR[input.card.rarity] ?? RARITY_COLOR.common,
        dayNight: input.card.dayNight,
        voyageNo: input.card.stamp.voyageNo,
        durationMs: input.card.stamp.durationMs,
        toolCalls: input.card.stamp.toolCalls,
    }, input.owned, input.total, input.voyageCount);
    return renderShareCanvas(payload);
}
function renderShareCanvas(payload) {
    const W = 1200, H = 675; // 16:9，2x 分辨率
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (ctx === null)
        return canvas;
    const c = payload.card;
    const night = c.dayNight === 'night';
    // 背景渐变
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    if (night) {
        bg.addColorStop(0, '#2b3f63');
        bg.addColorStop(1, '#17253f');
    }
    else {
        bg.addColorStop(0, '#e8f6f4');
        bg.addColorStop(1, '#a9c9d6');
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // 波浪缓条
    ctx.fillStyle = night ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.72);
    ctx.quadraticCurveTo(W * 0.25, H * 0.66, W * 0.5, H * 0.72);
    ctx.quadraticCurveTo(W * 0.75, H * 0.78, W, H * 0.72);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    // 左上：场景 emoji 与标签
    ctx.font = '120px "PingFang SC","Apple Color Emoji","Segoe UI Emoji",sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(c.sceneEmoji, 64, 70);
    ctx.font = '600 30px "PingFang SC",sans-serif';
    ctx.fillStyle = night ? '#d9e6ea' : '#3a4a5a';
    ctx.fillText(c.sceneLabel, 210, 108);
    if (c.rarityLabel !== '') {
        ctx.fillStyle = c.rarityClass;
    }
    else {
        ctx.fillStyle = night ? '#6f8296' : '#9ab3c4';
    }
    ctx.font = '600 24px sans-serif';
    ctx.fillText(c.rarityLabel === '' ? '普通' : c.rarityLabel, 210, 150);
    // 中部：文案（中英）
    ctx.fillStyle = night ? '#f2f7f9' : '#22303c';
    ctx.font = '700 58px "PingFang SC","Hiragino Sans GB",sans-serif';
    ctx.fillText(c.captionZh, 64, 300);
    ctx.fillStyle = night ? '#a8bcc9' : '#5a6d7e';
    ctx.font = '400 28px "PingFang SC","Segoe UI",sans-serif';
    ctx.fillText(c.captionEn, 64, 380);
    // 邮戳行
    ctx.fillStyle = night ? '#8fa6b6' : '#6d8296';
    ctx.font = '26px "PingFang SC",sans-serif';
    ctx.fillText(stampLineOf(payload), 64, 450);
    // 底部品牌行与进度
    ctx.fillStyle = night ? '#d9e6ea' : '#3a4a5a';
    ctx.font = '600 26px "PingFang SC",sans-serif';
    ctx.fillText(`🐋 ${payload.brand.zh} · ${payload.brand.en}`, 64, H - 70);
    ctx.fillStyle = night ? '#8fa6b6' : '#6d8296';
    ctx.font = '24px sans-serif';
    const right = `图鉴 ${payload.progress.owned}/${payload.progress.total} · 远行 ${payload.voyageCount} 次`;
    const rightW = ctx.measureText(right).width;
    ctx.fillText(right, W - 64 - rightW, H - 70);
    // 官方蓝鲸水印（右下角，几何造型）
    ctx.fillStyle = '#4d6bfe';
    ctx.beginPath();
    ctx.ellipse(W - 180, H - 190, 110, 62, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f7f3e8';
    ctx.beginPath();
    ctx.ellipse(W - 180, H - 168, 84, 34, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c2b4a';
    ctx.beginPath();
    ctx.arc(W - 146, H - 206, 9, 0, Math.PI * 2);
    ctx.fill();
    // 相框描边
    ctx.strokeStyle = 'rgba(58,74,90,0.15)';
    ctx.lineWidth = 4;
    ctx.strokeRect(16, 16, W - 32, H - 32);
    return canvas;
}
function downloadShareCard(canvas) {
    canvas.toBlob((blob) => {
        if (blob === null)
            return;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `鲸的远行-分享卡-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
    }, 'image/png');
}
/* ---------- 导出 Markdown ---------- */
function exportMarkdown(state) {
    const lines = ['# 航海日志', '', `导出于 ${new Date().toLocaleString('zh-CN')} · 共 ${state.voyageCounter} 次远行`, ''];
    const cardById = new Map(state.cards.map((c) => [c.cardId, c]));
    for (const entry of state.closed) {
        const time = new Date(entry.endedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        const card = entry.cardId !== undefined ? cardById.get(entry.cardId) : undefined;
        const outcome = OUTCOME_ZH[entry.outcome] ?? entry.outcome;
        if (card !== undefined) {
            lines.push(`- **${time}** 第 ${card.stamp.voyageNo} 次远行（${outcome}，${fmtDuration(entry.durationMs)}）→ 🖼️ ${card.caption.zh}（${card.stamp.toolCalls} 次潜探${card.stamp.model !== undefined ? ` · ${card.stamp.model}` : ''}）`);
        }
        else if (entry.outcome === 'completed') {
            lines.push(`- **${time}** 短途往返（${fmtDuration(entry.durationMs)}）带回小贝壳`);
        }
        else {
            lines.push(`- **${time}** 一次${outcome}的航程（${fmtDuration(entry.durationMs)}）`);
        }
    }
    const blob = new Blob([lines.join('\n') + '\n'], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `航海日志-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
}
/* ---------- 启动 ---------- */
bindTabs();
bindShare();
bindNest();
// 子页面板形态（产品定稿）：本页仅作为主界面右下角弹层内容（相册 + 航海日志），
// 海面即 dsh 对话区，不再有独立主界面；数据源仍为 live SSE（相册/日志实时）。
document.body.classList.add('wv-panel');
document.querySelector('.tab[data-tab="album"]')?.click();
$('export-md').addEventListener('click', () => exportMarkdown(lastState));
// pagehide 比 beforeunload 更可靠：后者在移动端与页面缓存场景下常常不触发
window.addEventListener('pagehide', () => source?.close());
connect();
