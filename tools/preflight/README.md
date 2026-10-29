# dsh-preflight

dsh 环境体检工具。**只读**：不修改文件、不读取 Key 明文、不发起模型请求。

## 用法

```bash
node tools/preflight/src/index.mjs --workspace /path/to/your/project
```

```bash
node tools/preflight/src/index.mjs --home ~/.dsh --port 8899 --json
```

| 参数 | 说明 |
|---|---|
| `--home <dir>` | DSH_HOME，默认 `~/.dsh` |
| `--workspace <dir>` | 工作区，用于检查 AGENTS.md |
| `--port <n>` | 要检查的端口，默认 8899 |
| `--json` | 输出 JSON，便于二次处理 |

有失败项时退出码为 1，便于脚本判断。

## 检查什么

1. Node 版本是否 ≥ 22（低于 22 常见表现是命令零输出，没有报错）
2. DSH_HOME 是否存在、有哪些 profile
3. profile 的 `cordis.patch.yml` 与 bundle 链
4. 凭据里有没有模型 Key（只报记录名，不读明文）
5. 插件软链是否悬空（悬空表现为启动崩溃，而不是提示插件不存在）
6. 目标端口是否被占用
7. 工作区有没有 `AGENTS.md`
8. 权限模式是否为 `danger-full-access`

## 测试

```bash
cd tools/preflight && npm test    # 13 个用例
```

## 解决不了

把 `--json` 的输出发到 [服务咨询](https://github.com/wzysbkzsd/dsh-whale-voyage/issues/new?template=service.md)。
