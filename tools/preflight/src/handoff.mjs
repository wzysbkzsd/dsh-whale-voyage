const LABEL = { fail: '失败', warn: '警告', ok: '通过', info: '信息' };

/**
 * 由体检结果生成客户交接单。数据全部来自检查项本身，
 * 不写"建议您定期维护"这类空话——那种东西客户不会看第二遍。
 */
export function renderHandoff(findings, meta = {}, options = {}) {
  const { customer = '________', dateStr = new Date().toISOString().slice(0, 10), workspace = '' } = options;
  const counts = findings.reduce((acc, f) => {
    acc[f.level] = (acc[f.level] ?? 0) + 1;
    return acc;
  }, { fail: 0, warn: 0, ok: 0, info: 0 });

  const rows = findings.map((f) => `| ${f.title} | ${LABEL[f.level] ?? f.level} | ${(f.detail ?? '').replace(/\|/g, '/')} |`);
  const todo = findings.filter((f) => (f.level === 'fail' || f.level === 'warn') && f.fix);

  const lines = [
    '# dsh 环境交接单',
    '',
    `- 客户：${customer}`,
    `- 日期：${dateStr}`,
    `- DSH_HOME：${meta.home ?? '（未记录）'}`,
    `- 工作区：${workspace || '（未指定）'}`,
    `- 结论：${counts.fail ? `${counts.fail} 项失败，需处理` : counts.warn ? `${counts.warn} 项警告，可用` : '全部通过'}`,
    '',
    '## 一、环境现状',
    '',
    '| 检查项 | 状态 | 说明 |',
    '| --- | --- | --- |',
    ...rows,
    '',
  ];

  if (todo.length) {
    lines.push('## 二、还需要你处理', '');
    for (const f of todo) lines.push(`- **${f.title}**：${f.fix}`);
    lines.push('');
  } else {
    lines.push('## 二、还需要你处理', '', '无。当前没有失败或警告项。', '');
  }

  lines.push(
    '## 三、日常操作',
    '',
    '重启：结束当前 dsh 进程后，重新执行',
    '',
    '```bash',
    'dsh web --port 0',
    '```',
    '',
    '`--port 0` 让系统挑空闲端口，避免上次的实例没退干净导致启动失败。',
    '',
    '升级 dsh：',
    '',
    '```bash',
    'npx @deepseek-ai/dsh@latest web',
    '```',
    '',
    '卸载本次安装的插件：',
    '',
    '```bash',
    'dsh plugin --profile web remove <插件包名>',
    '```',
    '',
    '数据与凭据位置：`$DSH_HOME`（默认 `~/.dsh`）。Key 存在 `.credentials.yaml`，不要在聊天里贴出来。',
    '',
    '## 四、支持窗口',
    '',
    '- 7 天，仅 20:00–22:00 回复。',
    '- 超出窗口的问题按新单处理。',
    '- 验收清单里任何一条没跑通，现在告诉我，我当天补。',
    '',
    '---',
    '',
    '> 本文件由只读检查生成，未修改任何文件、未读取任何 Key 明文。',
    '',
  );

  return lines.join('\n');
}
