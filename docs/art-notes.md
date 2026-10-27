# 美术资源配方（M3）

> 十张核心资源的生成配方与处理管线。续产或替换时按本文件执行，保证风格一致。
> 风格锚：旅行青蛙（Tabikaeru）式低饱和手绘；主体鲸身**必须强调深饱和品牌蓝 #4D6BFE**
> （生图模型倾向把品牌蓝画成粉彩天蓝——提示词里必须写"DEEP VIVID AZURE BLUE exactly #4D6BFE,
> strongly saturated, clearly deeper than sky blue"，否则需重生成）。
> 源图在生成目录，入库产物经 sips 压缩（见"处理管线"）。

## 处理管线（可复现）

1. 生成 1024×1024（姿态）/ 1024×768（场景）/ 1792×1024（主景）
2. `sips -Z <maxpx> <src> --out <dst>`：
   - 姿态 → 360px，保持 PNG（需在奶油底卡片上使用）
   - 场景与主景 → 800/1440px 后转 JPEG（`sips -s format jpeg -s formatOptions 72`）
   - macOS sips 不支持 webp（实测报错）；场景类矩形图用 JPEG 质量 72 足够
3. 入库 `plugin/web/art/`，经 `/whale-voyage/assets/art/<file>` 路由分发

## 资产清单与配方要点

| 文件 | 用途 | 配方要点 |
| --- | --- | --- |
| pose-float.png | 空闲漂浮（日志/专业模式头像位） | 侧视漂浮、涟漪与气泡、奶油底 |
| pose-dive.png | 远行中（备用姿态） | 头朝下潜、尾鳍出水、水花 |
| pose-surface.png | 归来/求助（备用姿态） | 直立上浮、喷水弧线、闭眼笑 |
| home.jpg | 海面主景（昼）+ open-sea 图鉴面 | 无角色纯背景；地平线上三分之一；**画面中部海面留白**供 CSS 鲸叠放 |
| scene-shipwreck.jpg | 沉船书房（读文件） | 沉船木肋骨+书架+光柱，鲸翻看发光的书 |
| scene-coral.jpg | 珊瑚苗圃（写代码） | 珊瑚橙粉苗圃+小鱼围观，鲸扶新苗 |
| scene-plankton.jpg | 磷虾集市（搜索） | 浮木集市摊+水母灯笼+章鱼摊主+海鸥 |
| scene-current.jpg | 洋流赛道（命令/测试） | 光流+沙丁鱼竞速+气泡终点线+海龟裁判 |
| scene-trench.jpg | 海沟边缘（长任务） | 靛黑深渊+生物微光+灯笼鱼陪伴 |
| scene-dolphin.jpg | 与海豚同游（subagent；亦用于 companion/pod 图鉴面） | 灰粉海豚并肩+金色光斑 |

## 接入点（代码侧）

- `web-src/app.ts`：`SCENE_ART`（场景→文件）、`RARE_ART`（同伴系→海豚场景）、`ART` 前缀；相册卡面 background-image、日志 `.log-avatar`、专业模式 `.pro-avatar`
- `web/app.css`：`.stage` 主景背景（夜色仍由 CSS filter 实现）；头像圆形奶油底
- `plugin/src/index.ts`：`ASSET_TYPES` 含 `.png/.jpg/.jpeg/.webp`
- 舞台上的鲸仍是 **CSS 造型**（有透明背景与全动画控制）；姿态立绘用于头像位——若需透明底立绘，可对奶油底做色彩键出（墙外有工具链时处理）

## 剩余与备选

- 稀有成因中 storm/aurora/milestone/marathon/abyss/festival 的图鉴卡面暂用渐变+徽标（设计允许：稀有卡以成因文案为主视觉）；后续按本配方补图即可
- 夜景主景：昼景 + CSS filter 已达标；如需专用夜景图，按 home 配方加"moon + stars"重生成
