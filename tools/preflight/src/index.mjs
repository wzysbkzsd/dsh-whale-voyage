#!/usr/bin/env node
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { runChecks } from './checks.mjs';
import { renderReport, renderJson, summarize } from './report.mjs';

function parseArgs(argv) {
  const args = { home: join(homedir(), '.dsh'), workspace: '', port: 8899, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--home') args.home = resolve(argv[++i]);
    else if (a === '--workspace') args.workspace = resolve(argv[++i]);
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--json') args.json = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

const HELP = `用法：node src/index.mjs [选项]

  --home <dir>        DSH_HOME，默认 ~/.dsh
  --workspace <dir>   工作区目录，用于检查 AGENTS.md
  --port <n>          要检查的端口，默认 8899
  --json              输出 JSON（便于二次处理）
  -h, --help          帮助

只读检查：不修改文件、不读取 Key 明文、不发起模型请求。`;

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  process.stdout.write(`${HELP}\n`);
  process.exit(0);
}

const findings = await runChecks({ home: args.home, workspace: args.workspace || undefined, port: args.port });
const meta = { home: args.home, port: args.port, date: new Date().toISOString() };
process.stdout.write(args.json ? `${renderJson(findings, meta)}\n` : `${renderReport(findings, { home: args.home })}\n`);

const { fail } = summarize(findings);
process.exit(fail > 0 ? 1 : 0);
