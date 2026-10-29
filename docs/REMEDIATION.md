# 修复手册（与体检报告一一对应）

体检工具报出哪一项，就翻到哪一条。每条都写清：现象 → 原因 → 修法 → 复查。

```bash
node tools/preflight/src/index.mjs --workspace /你的项目
```

改完重新跑一次，直到 `失败 0`。

---

## 1. `Node 版本过低`

**现象**：跑 `dsh web` 一行输出都没有，直接退出。最容易误判成"装好了"。

**原因**：dsh 用原生 ESM 加载插件，Node 低于 22 时模块解析失败，且不总是报错。

**修法**：升级 Node 到 22 或更高。Windows 用官方安装包或 nvm-windows，macOS 用 `brew install node@22`。

**复查**：`node -v` 显示 v22 以上。

---

## 2. `找不到 DSH_HOME`

**现象**：`~/.dsh` 不存在。

**原因**：dsh 从未成功启动过，或者你把 `DSH_HOME` 指到了别处。

**修法**：先跑一次 `npx @deepseek-ai/dsh web` 让它自己建目录，再检查环境变量里有没有残留的 `DSH_HOME`。

**复查**：`~/.dsh/profiles` 下出现 `web`。

---

## 3. `没有 web profile`

**现象**：profile 目录缺失。

**原因**：profile 被删，或首次启动没走完。

**修法**：

```bash
dsh rescue --from-default-profile web
```

这条会用官方模板重建一个干净的 web profile。注意：它会替换掉你不小心改坏的配置，但不会动你的 Key。

**复查**：`~/.dsh/profiles/web/cordis.patch.yml` 存在。

---

## 4. `凭据文件里只有浏览器授权，没有模型 Key`

**现象**：页面能打开，但发消息就失败，或表现为"AI 很笨"。

**原因**：Key 没配。这个错误不会在启动时报出来。

**修法**：Web UI → **设置 → 模型** → 填 `sk-` 开头的 Key → 保存。它落到 `~/.dsh/.credentials.yaml`，**立即生效，不用重启**。

不要手动编辑那个文件：里面的结构带版本号和加密字段，手改容易把整份凭据弄坏。

**复查**：体检报告里这一项变成"已发现模型凭据"。

---

## 5. `悬空的插件链接`

**现象**：装了插件之后 dsh 起不来，但日志里没有"插件不存在"这种话。

**原因**：profile 里是软链（`node_modules/<插件> → 源码目录`）。源码目录被移走或改名后，软链悬空，宿主把这当成崩溃。

**修法**：

```bash
dsh plugin --profile web add <包名或本地路径>
```

**复查**：体检报告列出 `插件 N 个，链接正常`，并且能看到 `-> 真实路径`。

---

## 6. `端口已被占用`

**现象**：启动即失败，或打开的是旧实例的页面。

**原因**：上一个实例没退干净。

**修法（优先）**：换端口。

```bash
dsh web --port 0
```

**修法（要杀进程时）**：先认准再杀，别按端口一把梭。

```powershell
netstat -ano | findstr :8899
tasklist /FI "PID eq <上一步的PID>"
```

确认 COMMAND 和 PID 都对应 dsh 再结束它。Windows 上同一个端口可能同时挂着客户端连接，杀错会把你别的程序带下去。

**复查**：体检报告显示端口空闲。

---

## 7. `工作区没有 AGENTS.md`

**现象**：agent 行为很通用，不遵守你的项目约定。

**原因**：dsh 从工作区读 `AGENTS.md`（也认 `AGENTS.local.md`、`CLAUDE.md`），没有就什么都不加载。

**修法**：在会话里选好工作区，放一份 `AGENTS.md`，写清：技术栈、构建命令、不要动哪些目录、提交规范。

**复查**：体检报告显示 `工作区有 AGENTS.md`。

---

## 8. `权限模式是 danger-full-access`

**现象**：没有这一项的时候你不会看到它，但风险最大。

**原因**：`DSH_PERMISSION_MODE=danger-full-access` 时沙箱全开、授权从不询问。任何一次提示注入都可能写到工作区外。

**修法**：去掉这个环境变量，或显式设成 `workspace-write`。

```bash
# macOS / Linux
unset DSH_PERMISSION_MODE
# Windows
set DSH_PERMISSION_MODE=
```

**复查**：体检报告显示 `权限模式 workspace-write`。

---

## 修完还是不行

把这份报告发出去，别自己硬猜：

https://github.com/wzysbkzsd/dsh-whale-voyage/issues/new?template=service.md
