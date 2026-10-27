# HANDOFF — 交接与重建协议

> 本文件面向接手本项目的开发者或 AI agent，目标：**从单文件自解压脚本零上下文重建项目、验收、并执行发布**。
> 配套生成物：`dsh-whale-voyage-restore.mjs`（仓库根目录，由 `tools/make-restore.mjs` 生成；本项目在开发环境内完成全部开发，发布环节由接收方执行）。

## 一、项目是什么

dsh-whale-voyage（鲸的远行）：DeepSeek Harness（dsh）的等待体验设计插件。agent 任务即"鲸的远行"：任务开始鲸深潜、长任务归来产出明信片（自适应 P70 分位阈值）、子代理是同游的同伴、授权请求是家书。事件全部只读订阅，对 agent 零干扰、运行时零 token。设计全集见 `DESIGN.md`（先读第 3 节红线、第 7 节鲸群并发、第 12 节不变量）。

## 二、从单文件重建（复制即用）

```bash
# 1. 解压文本资源（逐文件 SHA-256 校验，传输损坏会立即失败而非静默出错）
node dsh-whale-voyage-restore.mjs ./whale-voyage

# 2. 手动复制 3 张概念图到对应路径（路径与 SHA-256 见 --list），然后校验
node dsh-whale-voyage-restore.mjs --check-images ./whale-voyage

# 3. 验收（判据：vitest 全绿 + 构建零错误，用例数以实际运行为准）
cd whale-voyage/plugin
npm install
npx vitest run        # 预期全部通过（用例数以运行输出为准）
npm run build         # 预期 tsc 零错误，产出 lib/
```

图片不入包（保持单文件在可粘贴传输的体积）；当前代码与测试不依赖图片，M2 美术接入时才需要。package-lock.json 亦不入包（验收时 npm install 自动重建；如需精确复现，可按 --list 的 SHA-256 从源机器复制核对）。
仅校验已有目录：`node dsh-whale-voyage-restore.mjs --check ./whale-voyage`（文本）/ `--check-images`（图片与 lock）
列出内嵌清单与图片校验值：`node dsh-whale-voyage-restore.mjs --list`

## 三、环境要求

- Node ≥ 22（dsh 以原生 ESM 加载插件）
- pnpm：`corepack enable && corepack prepare pnpm@latest --activate`（`dsh plugin add` 依赖）
- dsh：`npx -y @deepseek-ai/dsh web --port 3199`（首次执行自动创建 profile web）
- DeepSeek API Key：仅"完整事件流采样"需要（Web UI 的 Models 页或启动环境变量配置；无 Key 也可开发与测试，航次会以 error 收场但仍产生完整会话事件）

## 四、接手须知（按序阅读）

1. `DESIGN.md` — 设计定稿：零干扰红线 R1–R8、不变量 I1–I7、鲸群并发模型、出卡节奏与四档稀有度
2. `PROGRESS.md` — 当前断点、里程碑记录、"关键结论速查"（防偏移，含已否决方案及原因）
3. `docs/dsh-research.md` — dsh 技术调研档（事件系统全表带模式标注、插件工程规范、竞品数据）
4. `docs/m0-findings.md` — 源码级与运行时验证结论（逐条附证据锚点）

## 五、必须遵守的铁律

- 只订阅 **emit 类只读事件**，监听器一律带 `{ global: true }`（Cordis 按 scope 过滤，不带收不到全部会话）
- 不注册工具、技能、提示词；不挂 waterfall / serial 钩子（零干扰红线，详见 DESIGN.md 第 3 节）
- 插件构建：`module/moduleResolution: NodeNext`，**源码相对导入必须带 `.js` 扩展名**（vitest 容错无扩展名，dsh 原生 ESM 不容错；模块导入失败 = dsh 整体启动失败）
- 事件解析一律白名单模式：未识别的事件类型默认忽略，不猜测
- 权威数据只写插件侧文件（$DSH_HOME 下），页面为只读投影
- 场景映射白名单（`plugin/src/voyage/scenes.ts`）为初版，带 Key 采样后须按实际工具名修订

## 六、当前状态与下一步（M2）

M0（设计/调研/骨架/实测）、M1（状态机/21 测试/运行时验证）已完成，详见 PROGRESS.md。M2 任务清单：

1. 游戏页（Vite + TS，独立于插件构建）：海面主界面、鲸三态演出、归来仪式、动态 favicon、标签页标题、系统通知
2. 图鉴（未获得项显示剪影）、航海日志（Markdown 导出）、分享卡（默认脱敏）
3. 专业模式（状态条视图，数据照记不照展）
4. 状态持久化：插件侧写文件（$DSH_HOME 下插件子目录）
5. 十张美术资源接入（官方蓝 Q 版鲸，`assets/concept/` 已有设定图与明信片样例）
6. 演示模式接页面（`plugin/src/voyage/demo.ts` 序列驱动完整演出）

## 七、发布任务清单（由接收方执行）

开发环境无法访问外部服务，以下发布环节全部由接收方完成，按序执行：

1. **重建与验收**：按第二节完成（vitest 全绿 + build 零错误）
2. **带 Key 采样修订**：配置 DEEPSEEK_API_KEY 后跑一次真实任务（可复用 `scripts/sample-events.mjs`），归纳实际工具名，修订 `plugin/src/voyage/scenes.ts` 场景白名单（M0 遗留项）
3. **真实环境端到端验证**：`dsh plugin --profile web add <plugin目录>` 安装，跑一次真实长任务，确认页面演出、出卡、图鉴全链路
4. **GitHub 建仓推送**：新建公开仓库 `dsh-whale-voyage`，git init + 首提 + push（restore 文件不含 git 历史，重建首提即可）
5. **npm 发布**：`plugin/` 目录 `npm publish`（package.json 已声明 dsh.bundle）
6. **插件市场提交**：mydsh.dev、deepseek-harness-plugin.com、dsh.deepseek404.com、dsh-plugin-market（官方 Discussion #1758）逐个提交
7. **官方讨论区发帖**：`Show Your Plugins!` 板块，双语 README + 演示 GIF（用演示模式录制一次完整航次，15–60 秒）
8. **可选长尾**：Awesome 清单 PR、方法论文章《等待体验设计：通信模型》（内容已具备，见 DESIGN.md 通信语法章节）

发布素材（双语 README、GIF 脚本、帖子文案）由开发方随包交付；账号（GitHub/npm/各市场）由使用者提供。

## 八、注意事项

- `.refs/deepseek-harness`（官方源码参照，gitignore 未入库）：需要时重新浅克隆 `git clone --depth 1 https://github.com/deepseek-ai/deepseek-harness.git`
- 插件以 pnpm link 安装于 profile web；仓库路径变更后需重新 `dsh plugin --profile web add <plugin目录>`
- 事件采样脚本：`scripts/sample-events.mjs <base-url>`（SSE 采集 + RPC 触发，无需浏览器）
- RPC 触发格式：`POST /api/<method>`，信封 `{"type":"client-request","rpcId":"…","method":"…","payload":{…}}`；可用方法 `session.create`（payload 收 `cwd` 或 `workspaceId`）、`session.prompt`（`{sessionId, mode:'queue'|'steer', content:[{type:'text',text}]}`）
- 竞品参照：`Sutera-Diffusus/dsh-whale-musume`（差异定位见 DESIGN.md 1.4：其只能获得二元运行状态，本项目的语义级事件流是结构性优势）
- 重新打包工具 `tools/make-restore.mjs` 未入包（在源仓库 git 中，保持单文件体积）；打包协议见本节与 restore 脚本头注
- 进程清理：按端口杀进程须先核对 COMMAND/PID（lsof 会列出客户端连接），杀后按 PID 验证退出
