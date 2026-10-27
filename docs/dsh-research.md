# DeepSeek Harness 调研档

> 用途：本文件是 Whale Voyage 项目的技术前提汇总，供后续任何开发者或 agent 直接使用，避免重复调研。
> 调研时间：2026-08-20 ｜ dsh 状态：开发者预览（developer preview）
> 信息来源：官方仓库 `deepseek-ai/deepseek-harness` 的 `docs/` 目录（含中文对侧文档）、官方社区讨论区、竞品仓库、生态文章。逐条来源见第 10 节。

---

## 1. dsh 概览

### 1.1 基本事实

| 项目 | 内容 |
| --- | --- |
| 仓库 | `deepseek-ai/deepseek-harness`（MIT 协议） |
| 发布时间 | 2026-08-13，与 V4 Pro 模型同日 |
| 当前阶段 | 开发者预览，接口仍在快速迭代 |
| 最短启动方式 | `npx @deepseek-ai/dsh web` |
| 默认 Web 地址 | `http://127.0.0.1:3080`（部分资料记为 3018，以实测为准） |
| 社区规模 | 本体约 17.1 万星；生态中标记 `dsh-plugin` 的仓库超过 700 个 |

### 1.2 核心机制：Cordis

dsh 的内核是 Cordis 插件系统，官方表述为"一切皆插件"（everything is a plugin）：模型适配、工具、技能、会话、沙箱、存储、执行循环、调度与界面，全部以插件形式提供，通过 Cordis 的服务与事件协作。扩展能力时修改的是配置，而非 harness 源码。

配套论文：《A Programming Paradigm for Spatiotemporal Composability》（时空可组合性编程范式）。

对本项目的意义：我们所需的能力（订阅事件、提供静态资源、注册页面路由）均属插件的一等能力，无需修改宿主源码。

### 1.3 两个关键概念

| 概念 | 含义 | 对应物 |
| --- | --- | --- |
| 组合包（bundle） | 开发者产出的分发单位。一个普通 npm 包，额外声明 `dsh.bundle` 并附配置补丁文件 | 我们要交付的东西 |
| 配置档（profile） | 使用者侧的启动配方，位于 `$DSH_HOME/profiles/<name>`，决定叠加哪些组合包及顺序 | 使用者的安装位置 |

两者角色不重叠：组合包是积木，配置档是拼法。`dsh plugin --profile web add <包>` 并非把代码写入 harness 仓库，而是在配置档目录内转发给包管理器安装；安装后包名进入 `dsh.profile.bundles`，下次启动按层叠加各包的配置补丁。

插件是运行时的组成单位而非挂件：卸载某层时，其注册的工具、命令、钩子会一并撤回（Cordis 的可逆副作用机制）。

---

## 2. 插件工程规范

### 2.1 最小组合包（三个文件）

`package.json` 声明自身为组合包，入口指向已构建的 JavaScript：

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } }
}
```

插件入口只做命名导出：

```js
export const name = 'hello-plugin'

export function apply() {
  // 注册逻辑
}
```

`cordis.patch.yml` 向配置树插入一行，`name` 为可解析到入口的 Node 模块名：

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

### 2.2 加载链路

`package.json` 声明 bundle → 配置补丁插入一行 → 加载器按包名导入模块 → 规范化导出（`unwrapExports`）→ Cordis 注册并调用 `apply`。

中间没有额外的插件通信协议，Cordis 认的就是命名导出。

### 2.3 生产级规则（务必遵守）

| 规则 | 说明 |
| --- | --- |
| 只用命名导出 | 导出 `name` / `inject` / `Config` / `apply`；**禁止 default export**，否则 `unwrapExports` 会折叠命名空间导致 `inject` 丢失 |
| `inject` 只写硬依赖 | 可选服务用 `ctx.get(name)` 获取；`inject` 写多了在缺少对应服务时整层挂不上，写少了拿不到能力 |
| `Config` 需为标准 Schema | 普通对象不被接受，Cordis 依赖其填默认值与校验 |
| 工具走 `defineTool` | 本项目不注册工具，此规则不适用 |
| 树外插件交付 `lib/` | 配置档内的 TypeScript 不会被 harness 编译，须提交构建产物 |
| 提供 `./invariant` | 树外包可为空安装器 |
| 动态加载宿主 peer | 在 `apply` 内动态加载 `@deepseek-ai/*`，避免树外包静态导入时解析失败 |
| 密钥不入配置补丁 | `--dump-config` 会完整打印配置树 |

### 2.4 安装与调试命令

```bash
# 确保 web 配置档已存在（先执行一次 dsh web 即可）
dsh plugin --profile web add <包名 | 本地路径 | tarball | github:owner/repo>

# 查看合成后的配置树，确认插件已挂载
dsh --profile web --dump-config

# 卸载
dsh plugin --profile web remove <包名>
```

修改 TypeScript 后需重新构建并重启 `dsh web`。

### 2.5 环境变量优先级

环境变量优先于配置补丁。长期非密钥配置可写入 `~/.dsh/profiles/web/cordis.patch.yml`；注意 harness 会**整份替换**该行的 `config`，需保留的项必须一并写出。

---

## 3. 事件系统

### 3.1 两条通道

| 通道 | 性质 | 用途 |
| --- | --- | --- |
| `session/event` | 持久、可回放的记录事实 | 需要转录数据的消费方应订阅此通道 |
| `agent/*` | 实时控制与状态 | 队列与状态、提示词拦截、请求构造、中途引导、错误处理 |

本项目主要消费 `session/event`（内容语义）与 `agent/status`（状态迁移）。

### 3.2 事件模式与安全性判定

事件分为四种模式，直接决定是否违反本项目红线 R1（不改变 agent 行为）：

| 模式 | 能力 | 本项目可否使用 |
| --- | --- | --- |
| `emit` | 旁路通知，监听方无法影响流程 | ✅ 可用 |
| `waterfall` | 瀑布式，监听方可改写、驳回、替换下游内容 | ❌ 禁止挂载 |
| `serial` | 串行检查点，可阻塞 | ❌ 禁止挂载 |
| `parallel` | 并行通知 | 谨慎（仅在明确无副作用时） |

### 3.3 本项目订阅清单（全部为 `emit` 类）

| 事件 | 模式 | 用途 |
| --- | --- | --- |
| `agent/status` | emit | 运行 / 空闲迁移，航次起止的主信号 |
| `session/event` | emit | 转录事实流，内含 `tool/call`、`tool/result`、`assistant/message`、`turn/start`、`turn/end`、`step/start`、`step/end`、`fs/observed`、`todo/write` 等 |
| `subagent/start`、`subagent/end` | emit | 同伴合影与群游判定 |
| `agent/error` | emit | 遇险判定 |
| `session/created`、`session/disposed` | emit | 航次登记建立与强制清除 |
| `fs/observed` | emit | 文件观察统计（经由 session/event 或直接订阅） |

**需要注意的两个事件**：

- `approval/request` 为 `waterfall` 模式。本项目**不得挂载该事件**（会获得改写授权结果的能力，违反 R1 与 R3）。授权提示应改由 `session/event` 中的相关记录或工具调用被挂起的状态推导。**此项为 M0 阶段待实测确认的关键未知项**（见第 9 节）。
- `agent/request-error` 为 `waterfall` 模式，同样不得挂载。风暴自愈判定改由 `agent/error` 与后续成功事件的组合推导。

### 3.4 官方事件全表（摘录，供扩展时查阅）

以下为官方生成文档中列出的 harness 自有事件。标注模式便于判断可用性。

| 事件 | 模式 |
| --- | --- |
| `agent/created`、`agent/disposed` | emit |
| `agent/status` | emit |
| `agent/error` | emit |
| `agent/session-start` | emit |
| `agent/inbox/inserted`、`claimed`、`discarded`、`spliced` | emit |
| `agent/pre-step` | waterfall |
| `agent/request` | waterfall |
| `agent/request-error` | waterfall |
| `agent/turn-stopping` | serial |
| `approval/request` | waterfall |
| `session/created`、`session/disposed`、`session/event` | emit |
| `session/flush` | parallel |
| `subagent/start`、`subagent/end` | emit |
| `subagent/provider-added`、`provider-removed` | emit |
| `tools/pre-execute`、`tools/execute`、`tools/post-execute` | waterfall |
| `tools/result` | emit |
| `tools/change` | emit |
| `fs/write-intent`、`fs/edit-intent` | waterfall |
| `fs/observed` | emit |
| `llm/stream` | waterfall |
| `llm/adapters-updated` | emit |
| `system-prompt/assemble` | waterfall |
| `system-prompt/change` | emit |
| `workflow/start`、`phase`、`log`、`agent-start`、`agent-end`、`end` | emit |
| `goal/changed` | emit |
| `skills/change`、`commands/change` | emit |
| `settings/updated`、`settings/document-updated` | emit |
| `credentials/updated` | emit |
| `domain/changed` | emit |
| `cordis/*`（dynamic-package、inspect-query 等） | emit |
| `session-telemetry/record` | waterfall |

> 确切的事件签名（payload 类型）位于仓库生成的 Cordis 目录中，需读取源码确认。此为 M0 的主要工作之一。

---

## 4. 生命周期时序

### 4.1 轮次与步骤

一次交互的骨架（简化，省略瀑布式钩子）：

```
使用者提交内容
  → 收件箱插入（agent/inbox/inserted）
  → 驱动器唤醒，状态置为 running（agent/status）
  → 轮次开始（turn/start）
      → 步骤开始（step/start）
      → 系统提示词组装
      → 模型请求与流式返回（assistant/chunk）
      → 助手消息（assistant/message）
      → 工具调用分类与执行
          → tool/call（执行前记录）
          → 工具体执行（含 fs/* 事件）
          → tool/result（面向模型的单一结果）
      → 步骤结束（step/end）
  → 轮次结束（turn/end）
  → 状态置为 idle（agent/status）
```

### 4.2 对本项目的关键推论

1. **航次边界**：`agent/status` 的 running / idle 迁移是最可靠的航次起止信号；`turn/start` 与 `turn/end` 可作为交叉校验。
2. **工具执行中的判定**：`tool/call` 在执行前记录，`tool/result` 在结果确定后记录。存在未配对的 `tool/call` 即表示工具正在执行中——这是"存活判定"（设计文档 5.6）区分"正常长时执行"与"疑似卡死"的技术基础。
3. **单轮内可多步**：一个轮次内可能有多个步骤与多批工具调用，因此航次统计需按轮次聚合，不能按步骤计数。
4. **错误与重试**：请求失败会经 `agent/request-error` 处理，压缩插件可能触发重试轮次。风暴自愈判定需容忍这种内部重试，避免误报。

---

## 5. 界面注入的现状与本项目的选择

### 5.1 官方界面的约束

dsh 的浏览器客户端有严格的样式体系：`ui-theme` 包拥有全局样式与主题令牌（`--dsw-*`），功能包只能使用语义别名，不得定义全局主题，不得引入组件库或 Tailwind，不得在功能组件中写主题选择器。

结论：**向 dsh 界面内部注入内容目前没有官方顺滑路径**。竞品是通过脚本改写安装目录中的前端资源实现的（后续版本改为注册只读静态资源路由 + 浏览器侧注入）。

### 5.2 本项目的架构选择

采用**插件注册静态资源路由 + 独立页面**：

- 插件侧注册只读静态资源路由，向浏览器提供页面与美术资源；
- 页面在独立标签页运行，不改写 dsh 的界面结构（符合红线 R4）；
- 不受宿主内部样式体系与预览阶段变更的牵制；
- 独立页面同时使"动态图标 + 标签页标题"这两个后台可见载体成为可能（设计文档第 6 节），这是注入式方案无法获得的位置。

该形态已被竞品的 bundle 模式间接验证可行。

---

## 6. 生态现状

- 官方讨论区设有 `Show Your Plugins!` 板块，是插件发布的主要场所之一。
- 已出现的插件类型：长期记忆与上下文（如接入独立记忆服务）、Claude Code 配置迁移桥、侧边栏工作台（文件、终端、Git、子代理）、桌宠、插件市场本身。
- 已存在**以插件形式实现的插件市场**（在设置页内新增市场标签页，含 manifest 校验与 SHA-256 完整性校验），这是分发环节最有价值的形态，已被占位。
- 若干独立市场与目录站已上线（见第 8 节）。

结论：分发端已高度拥挤，本项目**不进入分发端竞争**，改为"把分发做进产品"（分享物料 + 多渠道提交）。

---

## 7. 竞品分析：dsh-whale-musume

生态内最直接的相邻产品，也是本项目差异化定位的主要参照。

### 7.1 客观数据（2026-08-20 经 GitHub API 获取）

| 项目 | 数值 |
| --- | --- |
| 星标 | 23 |
| Fork | 3 |
| 关注 | 23 |
| 开放议题 | 2 |
| 建仓时间 | 2026-08-15（harness 开源后第二天） |
| 最后推送 | 2026-08-18 |
| 语言 / 协议 | JavaScript / MIT |

### 7.2 功能规模

立绘 90 张以上（发布首帖时 47 张，三日内翻倍）、台词 530 条以上、成就 39 个、每日任务与周签到、羁绊等级、天气联动与全屏天气特效、节日自动换装、13 种梗表情、内置小游戏、单元测试 97 个、CDP 端到端验收 38 项。

### 7.3 关键技术事实

- **状态获取方式**：嗅探页面属性（`data-running`、`data-state="ongoing"`）判断是否在运行。这意味着其可获得的信息仅为二元状态。
- **安装方式**：早期为脚本改写 DSH 安装目录前端资源（带备份与回滚）；后续提供标准组合包形态，插件侧注册只读静态资源路由。
- **数据存储**：浏览器 localStorage，键名前缀 `whale-moe:`。
- **测试环境**：README 明示仅在 Windows 10 / 11 开发与测试。

### 7.4 对本项目的推论

| 观察 | 推论 |
| --- | --- |
| 豪华投入仅换得 23 星 | 品类无赢家，窗口仍开放；**瓶颈在分发与定位，不在功能量** |
| 纯中文 README | 在英文主导的生态中自限传播，本项目须双语 |
| 只能获得二元运行状态 | 本项目的语义级事件流构成结构性优势 |
| 内容为预写台词库 | 会被穷尽；本项目内容来自真实工作数据，不会重复 |
| 仅 Windows 验证 | 打通 macOS / Linux 即为直接差异化 |
| 数据存于 localStorage | 清理缓存即丢失；本项目权威数据落文件 |

---

## 8. 分发渠道清单

| 渠道 | 形态 | 备注 |
| --- | --- | --- |
| 官方讨论区 `Show Your Plugins!` | 发帖 | 主要场所，须双语与动图 |
| dsh-plugin-market | 插件形态的市场 | 支持 HTTPS 仓库目录、manifest 与 SHA-256 校验 |
| mydsh.dev | 独立市场站 | — |
| deepseek-harness-plugin.com | 独立目录站 | 含中文导读 |
| dsh.deepseek404.com | 独立市场站 | — |
| Awesome 类精选清单 | Pull Request | 社区维护，需逐个提交 |
| 内容渠道 | 文章与视频 | 方法论文章自带长尾 |

---

## 9. 待实测确认的未知项（M0 任务清单）

以下事项文档未明确或存在不确定性，须在真实环境中验证。**这是 M0 阶段的核心产出。**

✅ 待确认：各订阅事件的确切 payload 结构（读取仓库生成的 Cordis 目录与类型定义，产出本项目的类型声明文件）
✅ 待确认：授权请求在不挂载 `approval/request`（waterfall）的前提下，可否由 `session/event` 稳定推导出"正在等待授权"状态
✅ 待确认：`session/event` 中工具调用的类别标识字段，用于场景映射白名单
✅ 待确认：`agent/status` 与 `turn/start`、`turn/end` 在多会话并发下的会话归属字段
✅ 待确认：子代理事件与父会话的关联字段
✅ 待确认：插件侧注册静态资源路由的具体接口
✅ 待确认：插件启动时枚举当前活跃会话的可用途径（冷启动对齐）
✅ 待确认：事件去重可用的序号字段（`seq` / `sourceEventSeqs` 的语义）
✅ 待确认：dsh 主目录的存储位置约定与插件可写路径
✅ 待确认：Web 界面实际端口（3080 与 3018 两说，以实测为准）

**产出要求**：验证过程中将真实事件流导出为样本数据（fixtures）提交入库，使后续开发与测试可完全脱离 dsh 环境运行。

---

## 10. 信息来源

官方文档（仓库 `deepseek-ai/deepseek-harness` 的 `docs/` 目录，均有中文对侧）：

- `architecture.md` — 总体架构
- `agent-lifecycle.md` — 轮次与步骤生命周期时序
- `event-producer-consumer.md` — 事件生产方与消费方矩阵（本文第 3 节的事件表来源）
- `tool-execution-pipeline.md` — 工具执行流水线
- `web-styling.md` — 界面样式职责归属（本文第 5 节依据）
- `cordis-primer.md`、`cordis-tutorial/`、`cordis-api/` — Cordis 机制与 API
- `capability-seams.md`、`config-catalog.md`、`tool-catalog.md`、`persistence-catalog.md` — 能力接缝与目录
- `defensive-patterns.md`、`testing.md`、`development.md` — 工程规范
- `packages/AGENTS.md` — 插件编写规则（本文第 2.3 节依据）

其他来源：

- 官方论文《A Programming Paradigm for Spatiotemporal Composability》
- 官方讨论区：`Show Your Plugins!` 板块，含竞品发布帖与插件市场帖
- 竞品仓库 `Sutera-Diffusus/dsh-whale-musume` 的 README 与 GitHub API 数据
- 生态实践文章：第三方插件开发实录（组合包与配置档概念、加载链路、生产规则的整理依据）

> 时效提示：dsh 处于开发者预览阶段，接口与文档可能已变更。使用本文件前建议核对官方仓库最新状态，并以实测结果为准。
