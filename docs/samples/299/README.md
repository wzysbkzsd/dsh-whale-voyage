# 299 交付包（示例）

这一份是诊断档交付给客户的全部东西。三样，不多不少。

| 文件 | 是什么 |
|---|---|
| [report.md](report.md) | 只读体检报告原件，未改动 |
| [handoff.md](handoff.md) | 交接单，自动生成，含重启/升级/卸载命令与答疑窗口 |
| [acceptance.md](acceptance.md) | 验收清单，当面逐条勾选 |

## 怎么生成的

```bash
node tools/preflight/src/index.mjs \
  --workspace <客户工作区> \
  --handoff ./交付-<客户>.md \
  --customer "<客户名>"
```

一次命令出报告和交接单，人工只填客户名。

## 关于这份示例

- 路径已脱敏（`C:\Users\<user>`），其余内容是一台真实机器的真实输出
- 那台机器当时的结论是"2 项警告，可用"：缺模型 Key、工作区没有 AGENTS.md
- 报告不读取任何 Key 明文，所以客户可以原样转给别人看
