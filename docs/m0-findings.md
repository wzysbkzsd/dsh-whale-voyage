# M0 源码验证结论

> 本文件记录 `docs/dsh-research.md` 第 9 节待实测清单中，**已通过阅读官方源码解决**的部分（2026-08-20，master 浅克隆）。
> 结论按清单原编号排列；标注"运行时"的项仍需真实会话采样最终确认。
> 证据锚点为源码路径，可对照 `.refs/deepseek-harness`（已 gitignore，不入库）或重新克隆核对。

## 已解决项

✅ **1. 订阅事件的确切 payload 结构** — 已产出 `plugin/src/dsh-events.ts`（类型声明，268 行）。关键确认：

- `agent/status` 载荷为 `{ agent: Agent; status: 'idle' | 'running' }`，`Agent` 含 `id`（即 SessionId）、`options`（provider/model）、`status`（`packages/core/agent/src/runtime-types.ts:178`）
- `session/event` 载荷为 `(session: Session, event: SessionEvent)` 双参数；`SessionEvent` 为按 `type` 判别的联合，信封含 `seq` / `time` / `data` / `ignorable?`（`packages/core/session/src/types.ts:408`）
- 会话事件完整词汇见 dsh-events.ts 的 `SessionEventMap`，含 `tool/call`（有 `name` 字段——场景映射白名单的键）、`tool/result`（含 `error` 与工具私有 `meta`，文件工具的结果期 diff 在 `meta` 里）、`todo/write`、`request/context`（provider/model）、`assistant/message`（含 `usage` token 计量）

✅ **2. 授权请求的只读推导** — **完全解决，方案优于预期**。`approval/asked` 与 `approval/decided` 是由 user-approval 包合并进会话日志的审计事件对（`packages/interaction/user-approval/src/index.ts:34-73`）：每次授权提问**先**向会话日志追加 `approval/asked`（含 `id`/`toolName`/`callId`/`reason`），**再**进入 waterfall 决策，结论以 `approval/decided`（含 `outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'`）落盘。即：**只订阅 session/event 即可完整观察授权生命周期，零接触 waterfall**。家书机制成立。

✅ **4. 多会话并发下的事件归属** — 每个服务事件载荷都携带 `agent`/`session` 实体（`agent.status` → `agent.id`；`session/event` 首参即 session）。另需注意：Cordis 事件按 scope 过滤分发（agent 作用域监听器只收到该 agent 的事件），**全局观察者必须以 `{ global: true }` 选项注册监听器**（`vendor/cordis/src/events.ts` 的 `EventOptions`，`docs/cordis-api/events.md:173`）。骨架已按此实现。

✅ **5. 子代理与父会话的关联** — 双路径确认：其一，`subagent/start|end` 载荷 `SubagentRunInfo` 含子会话 `id` 与 `provider` 名（同伴种类来源）；其二，子会话头 `SessionHeader.parentSession` + `origin: 'subagent'` + `delegationDepth`（`packages/core/session/src/types.ts:61-99`）。归属父航次判定：`origin === 'subagent'` 的会话不登记为独立航次。

✅ **7. 插件静态资源路由注册** — `webServer` 服务（`packages/host/webserver/src/index.ts`）提供命名路由注册：`register({ kind: 'exact' | 'prefix', path, handler })`，handler 拥有完整响应生命周期，**官方注释明示可保持长连接（如 SSE）**。另有 `registerUpgrade`（WebSocket 升级）与 `tapIndex`（index.html 变换）。同名路由重复注册抛错；路由随插件卸载自动撤回。骨架已注册 `/whale-voyage`（页）与 `/whale-voyage/events`（SSE）。

✅ **8. 冷启动枚举活跃会话** — 枚举面确认：`ctx.agents`（`AgentRegistry`，`packages/core/agent/src/index.ts:38`）与 `ctx.sessions`（`SessionStore`，`packages/core/session/src/index.ts:792`）。确切枚举方法名待运行时核对（骨架未使用；M1 实现冷启动对齐时补）。

✅ **9. 插件可写数据目录** — harness 主目录约定为 `$DSH_HOME`，缺省 `~/.dsh`（`packages/settings/settings-file/src/index.ts:24`）。本项目权威数据落于其下插件子目录；具体创建方式（配置档目录旁挂或独立目录）运行时确认。

✅ **10. Web 端口** — 端口为 `webServer` 配置项（`z.natural().max(65535).required()`，支持 0 = 系统分配；`packages/host/webserver/src/index.ts:62`），**无硬编码默认值**，3080/3018 均为各资料所见的部署配置。结论：本项目不得假设端口，应从 `ctx.webServer.port` 读取或提示使用者访问 `http://127.0.0.1:<port>/whale-voyage`。

## 附带的重要发现

1. **航次终止路径的数据源直连**：`turn/end` 事件的 `reason` 为结构化联合 `{ kind: 'completed' | 'aborted' | 'blocked' | 'error' | 'max-tokens' | 'interrupted' }`，`aborted.reason.kind` 再分 `'user' | 'parent' | 'hook' | 'disposed' | 'legacy'`（`packages/core/session/src/types.ts:143-177`）。DESIGN.md 7.4 的终止路径表与该词汇一一对应：completed→正常完成；aborted(user)→使用者取消；aborted(disposed)→会话销毁；error→报错终止。**终止判定直接消费 turn/end.reason，无需自行推断**。
2. **订阅宽限机制**：未知事件类型带 `ignorable: true` 标记时可安全跳过；缺失该标记的未知类型应拒绝重建会话（对我们：记录并降级，不崩溃）。dsh 处于预览期，事件词汇会增长，解析必须走白名单（与既定设计一致）。
3. **`request/context` 事件含 provider/model**：鲸的"性格"若按模型区分（如 Flash/Pro 不同姿态风格），数据现成。
4. **SDK 群组**（`packages/sdk/`）提供跨进程驱动 harness 的 TS 客户端与 stdio JSON-RPC 协议——未来跨 harness 版本（v2）的适配可复用。

## 遗留（运行时验证，需要使用者配合）

⏳ 3. `session/event` 中工具类别标识字段 —— 类型上为 `tool/call.name`，**实际工具名清单**（read/edit/bash/web_search 等的具体字符串）需采样归纳，场景映射白名单初版以采样为准
⏳ 真实事件流采样（fixtures 导出）：需在装有 dsh 且配置 DeepSeek API Key 的环境执行一次真实任务，采样脚本随 M1 提供

---

## 运行时采样结果（2026-08-21 补充）

采样方式：`scripts/sample-events.mjs`（SSE 采集 + `/api` RPC 触发，脚本化精确同步）。样本：`fixtures/sse-sample-2026-08-21-nokey.jsonl`（无 Key，20 条真实事件）。

✅ **第 3 项（工具名清单）部分解决**：无 Key 流程不含 `tool/call`（模型请求在工具前即失败），带 Key 采样留待有凭据环境。初版场景映射白名单已按源码工具命名惯例先行拟定，标注"待修订"。

**实测确认的关键数据**：

- `turn/end` 结构化终止原因（与源码类型一致）：`{"kind":"error","error":{"message":"llm-deepseek: …","code":"MISSING_CREDENTIAL"}}`
- `agent/status` running → idle 完整括住一次轮次（航次边界信号实测成立）
- `request/context`：`{"provider":"deepseek-official","model":"deepseek-v4-flash","contextWindow":1000000}`
- `user/message` 的 `source` 字段区分真实用户输入与注入上下文（runtime context、skill 提醒均为 user/message 但 source 不同）——**统计与文案必须按 source 白名单过滤**
- RPC 线格式：`POST /api/<method>`，JSON 信封 `{"type":"client-request","rpcId":"…","method":"…","payload":{…}}`；`session.create`（payload 接受 `cwd` 或 `workspaceId`）与 `session.prompt`（`{sessionId, mode:'queue'|'steer', content:[{type:'text',text}]}`）实测可用

**新发现的会话事件类型**（源码文档未覆盖，均为 log-only、白名单外忽略）：`permission/preset`、`sandbox/mode`、`session/title`、`session/title-llm-request`（会话标题的 LLM 请求——无 Key 流程中 `assistant/chunk` 即来源于此）。

**骨架修复**：`Ring.drain()` 只读不清导致 SSE 每秒重播全部事件，已修复（读取后重置游标）。

---

## M1 运行时验证（2026-08-21 补充）

✅ 状态机全链路实测贯通：dsh 真实事件 → 事件桥（global 监听 + 环形缓冲）→ 白名单归一化 → 航次状态机 → SSE 状态快照（`event: state`，500ms 节流）。实测一次无 Key 航次：voyageCounter=1、成员 m-1"Lan"出航归来、outcome=error（MISSING_CREDENTIAL 预期行为）、有效时长 142ms、不出卡不计贝——与设计逐条吻合。

**新教训（树外插件构建规则）**：dsh 以原生 ESM 加载插件产物，**相对导入必须带 `.js` 扩展名**，tsconfig 须用 `module/moduleResolution: NodeNext`（vitest 可容错无扩展名导入，故测试全绿不代表可加载）。另实测确认：**模块级导入失败会导致 dsh 整体启动失败**——fail-open 红线只覆盖运行时监听器异常，不覆盖模块加载；插件产物必须保证导入完整性。
