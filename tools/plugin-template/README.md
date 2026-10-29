# dsh-plugin-template

只读订阅型 dsh 插件骨架。用来把一个"有想法但不想从零啃规范"的需求，压到几天内可交付。

```bash
npm install
npm run build     # tsc，产出 lib/
npm test          # 17 个用例
```

## 结构

```
src/normalize.ts   宿主事件 → 有限几种 Kind（白名单，不认识就 null）
src/stats.ts       纯函数归约（无 I/O，所以能被断言）
src/store.ts       $DSH_HOME/plugin-template/summary.json，防抖 + 原子写 + fail-open
src/index.ts       apply(ctx)：订阅事件、注册 /plugin-template 只读路由、卸载清理
test/plugin.test.ts
```

改自己的插件，只动三处：**认哪些事件**（normalize）、**算什么**（stats）、**路由返回什么**（index）。

## 装进 dsh

```bash
# 需要 pnpm
dsh plugin --profile web link .
# 重启 dsh
```

然后访问 `http://127.0.0.1:<端口>/plugin-template`，返回当前统计的 JSON。

## 骨架已经处理掉的坑

- **只读**：只订阅 emit 事件，监听器全部带 `{ global: true }`；不注册工具、不注入提示词、不调模型
- **fail-open**：监听器内异常一律吞掉，绝不抛进宿主循环
- **白名单**：未识别事件返回 null，不猜语义
- **原子写**：临时文件 + rename，进程被杀不会留下半截 JSON
- **防抖**：状态变更后静默 2 秒写一次，高频事件不打爆磁盘
- **卸载清理**：停表 + 落盘 + 注销路由
- **NodeNext**：源码相对导入带 `.js` 扩展名（dsh 用原生 ESM 加载，漏了扩展名 = 整个 dsh 起不来）

## 交付方式

需求单确认后：填 normalize 的白名单 → 改 stats 的归约 → 改路由返回 → 补测试 → `npm run build` → 现场装一次给客户看。

验收看需求单那 6 条，不额外加戏。

## 边界

- 不写宿主文件，状态只落在 `$DSH_HOME/plugin-template/`
- 不联网、不读凭据
- 本骨架的单元测试覆盖纯逻辑；路由与事件订阅用的是已验证插件里同一套调用方式，但**本骨架没有单独做运行时验证**——第一次交付时按需求单现场跑一遍即可
