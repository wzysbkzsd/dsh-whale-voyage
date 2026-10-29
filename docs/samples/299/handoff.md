# dsh 环境交接单

- 客户：示例客户
- 日期：2026-10-29
- DSH_HOME：C:\Users\<user>\.dsh
- 工作区：C:\Users\<user>\PycharmProjects\dsh-whale-voyage
- 结论：2 项警告，可用

## 一、环境现状

| 检查项 | 状态 | 说明 |
| --- | --- | --- |
| 凭据文件里只有浏览器授权，没有模型 Key | 警告 | 现有记录：client-connection/browser-session |
| 工作区没有 AGENTS.md | 警告 | agent 不会加载任何项目指令，行为会偏通用 |
| Node v22.22.0 | 通过 | 满足原生 ESM 加载要求 |
| DSH_HOME 正常，profiles: node_modules, web | 通过 | C:\Users\<user>\.dsh |
| profile web 存在 | 通过 | cordis.patch.yml 可用；bundles: @deepseek-ai/dsh-base -> @deepseek-ai/dsh-web-app -> dsh-whale-voyage |
| 插件 1 个，链接正常 | 通过 | dsh-whale-voyage -> C:\Users\<user>\PycharmProjects\dsh-whale-voyage\plugin |
| 端口 8899 空闲 | 通过 |  |
| 权限模式 workspace-write | 通过 | 越界操作会弹窗询问 |

## 二、还需要你处理

- **凭据文件里只有浏览器授权，没有模型 Key**：Web UI → 设置 → 模型 → 填 Key 并保存（保存后立即生效，无需重启）
- **工作区没有 AGENTS.md**：在会话里选好工作区，并按需放一份 AGENTS.md

## 三、日常操作

重启：结束当前 dsh 进程后，重新执行

```bash
dsh web --port 0
```

`--port 0` 让系统挑空闲端口，避免上次的实例没退干净导致启动失败。

升级 dsh：

```bash
npx @deepseek-ai/dsh@latest web
```

卸载本次安装的插件：

```bash
dsh plugin --profile web remove <插件包名>
```

数据与凭据位置：`$DSH_HOME`（默认 `~/.dsh`）。Key 存在 `.credentials.yaml`，不要在聊天里贴出来。

## 四、支持窗口

- 7 天，仅 20:00–22:00 回复。
- 超出窗口的问题按新单处理。
- 验收清单里任何一条没跑通，现在告诉我，我当天补。

---

> 本文件由只读检查生成，未修改任何文件、未读取任何 Key 明文。
