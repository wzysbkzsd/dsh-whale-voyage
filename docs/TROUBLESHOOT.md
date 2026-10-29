# dsh 起动失败自查清单

先按顺序走一遍，八成问题能自己解决。每条都写了怎么确认、怎么修。

**更快的办法**：先跑一次体检，它会直接告诉你哪一项没过，以及怎么修：

```bash
node tools/preflight/src/index.mjs --workspace /你的项目路径
```

报告里的每一项，修法在 [修复手册](REMEDIATION.md) 里一一对应。

> 本文里的命令和路径来自 dsh 0.2.1-rc.2 的实测（Windows）与默认 profile 结构；不是从文档抄的。

---

## 0. 先确认它到底起没起

正常情况下，`dsh web` 会打印一行：

```
dsh web: http://127.0.0.1:8899/?token=xxxxxxxx
```

- **打印了但浏览器打不开**：先确认端口没被别的进程占，再确认你复制的是完整地址（`token` 参数不能丢，丢了会被浏览器信任校验挡住）。
- **一行都没打印就退出**：跳到第 1 条。
- **打印了但页面白屏**：看清楚控制台有没有插件加载失败的报错，通常是第 5 条。

---

## 1. Node 版本低于 22

dsh 用原生 ESM 加载插件。Node 版本过低时，常见表现是**命令零输出、直接退出**，连报错都没有，很容易误判成"装好了"。

```bash
node -v   # 需要 >= 22
```

版本不够就升级，不要试图用参数绕过。

---

## 2. 依赖解析卡死或内存溢出

`npm install` 长时间停在 `reify` 阶段，或者直接 OOM。先换源再试，仍失败就提高内存：

```bash
npm config set registry https://registry.npmmirror.com
npm install --no-audit --no-fund
```

Windows PowerShell 提内存：

```powershell
$env:NODE_OPTIONS="--max-old-space-size=8192"
```

---

## 3. 端口被上一个实例占着

`dsh web` 默认端口被残留进程占用时，表现是启动即失败。

```bash
dsh web --port 0        # 让系统挑一个空闲端口
dsh web --port 3199     # 或指定一个
dsh web --no-open       # 不自动开浏览器，先看有没有报错
```

不要在启动失败后反复重试同一个端口，先换端口判断是不是占用问题。

---

## 4. 模型配置报错：`MISSING_CREDENTIAL` / `UNKNOWN_MODEL`

- `MISSING_CREDENTIAL`：Key 没配或没存进去。Web UI 里 **设置 → 模型** 填入 `sk-` 开头的 Key 并保存；它会落到 `$DSH_HOME/.credentials.yaml`（默认 `~/.dsh`），界面上不会再显示明文。
- `UNKNOWN_MODEL`：模型名写错。默认 profile 用的是 `deepseek-flash`，不要写成 `deepseek-v4-flash`（旧名虽然还能调，但对应模型已下线）。

保存后模型路由**立即生效**，不需要重启服务。

---

## 5. 插件装了，但 dsh 起不来

这是最容易误判的一类：插件加载失败会被宿主表现成"启动崩溃"，而不是"插件不存在"。

按这个顺序二分：

```bash
# 1. 用干净的默认 profile 起一次
dsh rescue --from-default-profile web
# 能起 → 问题在你的插件或 patch 层
# 不能起 → 问题在宿主/环境

# 2. 看你的 patch 层，把最近加的行逐条注释掉
#    Windows: %USERPROFILE%\.dsh\profiles\web\cordis.patch.yml
#    macOS/Linux: ~/.dsh/profiles/web/cordis.patch.yml

# 3. 看组合后的完整插件树（不启动）
dsh --profile web --dump-config
```

**link 安装的插件有个隐蔽坑**：profile 里是软链（`node_modules/<插件名> → 源码目录`）。源码目录被移走或改名后，软链悬空，表现为启动崩溃，而不是提示"插件找不到"。用 `dsh plugin --profile web add <包名>` 重新挂一次即可。

**另一个坑**：`dsh plugin` 必须带 `--profile`，漏了会直接报 `required option '--profile <name>' not specified`。本项目早期 README 漏写过，已修正；如果你是从旧版本复制的命令，注意补上。

---

## 6. 确认权限模式

默认是 `workspace-write`：agent 只能改工作区内的文件，越界操作会弹窗问你。

三档预设：

| 模式 | 沙箱 | 授权 |
|---|---|---|
| `read-only` | 只读 | 询问 |
| `workspace-write`（默认） | 只能写工作区 | 询问 |
| `danger-full-access` | 全盘 | **从不询问** |

```bash
DSH_PERMISSION_MODE=read-only dsh web    # macOS/Linux
set DSH_PERMISSION_MODE=read-only && dsh web   # Windows cmd
```

除非你明确知道自己在做什么，不要用 `danger-full-access`。

---

## 7. 找不到"我刚才到底改了什么"

dsh 的所有状态都在 `$DSH_HOME`（默认 `~/.dsh`）：

```
~/.dsh/
  .credentials.yaml      Key 与授权记录
  profiles/web/
    cordis.yml           根层，空列表，不要编辑
    cordis.patch.yml     你的覆盖层，改这里
    package.json         profile 的 bundle 列表
  storages/              workspace.json 等工作区状态
```

改配置只改 `cordis.patch.yml`，不要动 `cordis.yml`。

---

## 8. 仍然不行

把这三样发我 / 开 issue，能省掉一轮来回：

1. `node -v`、`npm -v`、`dsh --version`
2. 你最后执行的那条命令 + 完整报错
3. `dsh --profile web --dump-config | tail -30` 的输出（里面不含 Key）

[服务咨询](https://github.com/wzysbkzsd/dsh-whale-voyage/issues/new?template=service.md)

---

**这份清单免费。** 如果你照着做完了还是卡住，才是付费服务该介入的时候。
