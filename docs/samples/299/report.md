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

cordis.patch.yml 可用；bundles: @deepseek-ai/dsh-base -> @deepseek-ai/dsh-web-app -> dsh-whale-voyage

## [通过] 插件 1 个，链接正常

dsh-whale-voyage -> C:\Users\<user>\PycharmProjects\dsh-whale-voyage\plugin

## [通过] 端口 8899 空闲

## [通过] 权限模式 workspace-write

越界操作会弹窗询问

---

> 本报告由只读检查生成，未修改任何文件、未读取任何 Key 明文。
> 解决不了？把这份报告发到 https://github.com/wzysbkzsd/dsh-whale-voyage/issues/new?template=service.md

交接单：C:\Users\<user>\PycharmProjects\dsh-whale-voyage\docs\samples\299\handoff.md
