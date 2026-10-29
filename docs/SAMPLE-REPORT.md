# 交付物示例：诊断报告

下面是体检工具在一台真实机器上的输出（路径已脱敏，其余原样）。299 档交付的就是这份东西 + 60 分钟逐条解读。

```text
# dsh 环境诊断报告

- 日期：2026-10-29
- DSH_HOME：C:\Users\<user>\.dsh
- 结论：2 项警告，可用

失败 0 · 警告 2 · 通过 6 · 信息 0

---

## [警告] 凭据文件里只有浏览器授权，没有模型 Key

现有记录：client-connection/browser-session

**处理**：Web UI → 设置 → 模型 → 填 Key 并保存（保存后立即生效，无需重启）

## [警告] 工作区没有 AGENTS.md

agent 不会加载任何项目指令，行为会偏通用

**处理**：在会话里选好工作区，并按需放一份 AGENTS.md

## [通过] Node v22.22.0

满足原生 ESM 加载要求

## [通过] DSH_HOME 正常，profiles: node_modules, web

C:\Users\<user>\.dsh

## [通过] profile web 存在

cordis.patch.yml 可用；bundles: @deepseek-ai/dsh-base -> @deepseek-ai/dsh-web-app -> <你的插件>

## [通过] 插件 1 个，链接正常

<你的插件> -> C:\Users\<user>\PycharmProjects\<项目>\plugin

## [通过] 端口 8899 空闲

## [通过] 权限模式 workspace-write

越界操作会弹窗询问

---

> 本报告由只读检查生成，未修改任何文件、未读取任何 Key 明文。
```

## 这份报告能看出什么

- **"可用但有坑"和"坏了"是两件事**。上面的机器能正常跑，但缺模型 Key，任何任务都会失败——这类问题不会报错，只会让你觉得"AI 好笨"。
- **插件链接那行最有价值**。软链悬空时 dsh 的表现是启动崩溃，不是提示插件不存在，肉眼几乎判断不出来。
- 报告不读 Key 明文，可以原样发给别人排查。

## 你自己跑一遍

```bash
node tools/preflight/src/index.mjs --workspace /你的项目路径
```

免费。只有当你照着报告还是修不好，才需要付费那一步。
