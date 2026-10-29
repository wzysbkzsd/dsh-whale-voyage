const LABEL = { fail: '失败', warn: '警告', ok: '通过', info: '信息' };

export function summarize(findings) {
  return findings.reduce((acc, f) => {
    acc[f.level] = (acc[f.level] ?? 0) + 1;
    return acc;
  }, { fail: 0, warn: 0, ok: 0, info: 0 });
}

export function renderReport(findings, { home, dateStr = new Date().toISOString().slice(0, 10), host = '' } = {}) {
  const counts = summarize(findings);
  const lines = [
    `# dsh 环境诊断报告`,
    '',
    `- 日期：${dateStr}`,
    `- DSH_HOME：${home}`,
    host ? `- 主机：${host}` : '',
    `- 结论：${counts.fail ? `${counts.fail} 项失败，需处理` : counts.warn ? `${counts.warn} 项警告，可用` : '全部通过'}`,
    '',
    `失败 ${counts.fail} · 警告 ${counts.warn} · 通过 ${counts.ok} · 信息 ${counts.info}`,
    '',
    '---',
    '',
  ].filter((l) => l !== '');

  for (const f of findings) {
    lines.push(`## [${LABEL[f.level] ?? f.level}] ${f.title}`);
    if (f.detail) lines.push('', f.detail);
    if (f.fix) lines.push('', `**处理**：${f.fix}`);
    lines.push('');
  }

  lines.push(
    '---',
    '',
    '> 本报告由只读检查生成，未修改任何文件、未读取任何 Key 明文。',
    '> 解决不了？把这份报告发到 https://github.com/wzysbkzsd/dsh-whale-voyage/issues/new?template=service.md',
    '',
  );
  return lines.join('\n');
}

export function renderJson(findings, meta) {
  return JSON.stringify({ meta, findings }, null, 2);
}
