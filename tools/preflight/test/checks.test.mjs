import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import net from 'node:net';
import {
  checkNodeVersion,
  checkDshHome,
  checkProfile,
  checkCredentials,
  checkPluginLinks,
  checkPort,
  checkPermissionMode,
  checkWorkspace,
  runChecks,
} from '../src/checks.mjs';
import { summarize, renderReport } from '../src/report.mjs';

const run = promisify(execFile);

async function tmp() {
  return mkdtemp(join(tmpdir(), 'preflight-'));
}

async function makeProfile(home, name = 'web') {
  const dir = join(home, 'profiles', name);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'cordis.patch.yml'), '- id: x\n  config: {}\n', 'utf8');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'my-plugin'] } } }), 'utf8');
  return dir;
}

test('Node 版本检查通过（当前环境 >= 22）', async () => {
  const r = await checkNodeVersion();
  assert.equal(r.level, 'ok');
});

test('DSH_HOME 不存在报 fail', async () => {
  const dir = join(await tmp(), 'nope');
  const r = await checkDshHome(dir);
  assert.equal(r.level, 'fail');
});

test('profile 存在且读到 bundles', async () => {
  const home = await tmp();
  await makeProfile(home);
  const r = await checkProfile(home);
  assert.equal(r.level, 'ok');
  assert.match(r.detail, /my-plugin/);
});

test('凭据只有授权记录时给警告', async () => {
  const home = await tmp();
  await writeFile(join(home, '.credentials.yaml'), 'version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      secret: abc\n', 'utf8');
  const r = await checkCredentials(home);
  assert.equal(r.level, 'warn');
});

test('凭据含模型记录时通过，且不输出明文', async () => {
  const home = await tmp();
  await writeFile(join(home, '.credentials.yaml'), 'version: 1\nrecords:\n  model/deepseek-official:\n    kind: api-key\n    payload:\n      secret: sk-should-not-appear\n', 'utf8');
  const r = await checkCredentials(home);
  assert.equal(r.level, 'ok');
  assert.doesNotMatch(r.detail, /sk-should-not-appear/);
});

test('悬空的插件链接报 fail', async () => {
  const home = await tmp();
  const profile = await makeProfile(home);
  const mods = join(profile, 'node_modules');
  await mkdir(mods, { recursive: true });
  const target = join(home, 'src-plugin');
  await mkdir(target);
  await symlink(target, join(mods, 'gone-plugin'), 'junction');
  await rm(target, { recursive: true, force: true });
  const r = await checkPluginLinks(home);
  assert.equal(r.level, 'fail');
  assert.match(r.title, /gone-plugin/);
});

test('正常插件链接通过', async () => {
  const home = await tmp();
  const profile = await makeProfile(home);
  const mods = join(profile, 'node_modules');
  await mkdir(mods, { recursive: true });
  const target = join(home, 'src-plugin');
  await mkdir(target);
  await symlink(target, join(mods, 'ok-plugin'), 'junction');
  const r = await checkPluginLinks(home);
  assert.equal(r.level, 'ok');
});

test('端口占用与空闲都能识别', async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const busy = await checkPort(port);
  assert.equal(busy.level, 'warn');
  await new Promise((r) => server.close(r));
  const free = await checkPort(port);
  assert.equal(free.level, 'ok');
});

test('danger-full-access 报 fail，默认 workspace-write 通过', () => {
  assert.equal(checkPermissionMode({ DSH_PERMISSION_MODE: 'danger-full-access' }).level, 'fail');
  assert.equal(checkPermissionMode({}).level, 'ok');
});

test('工作区有无 AGENTS.md 分别告警与通过', async () => {
  const dir = await tmp();
  assert.equal((await checkWorkspace(dir)).level, 'warn');
  await writeFile(join(dir, 'AGENTS.md'), '# x\n', 'utf8');
  assert.equal((await checkWorkspace(dir)).level, 'ok');
});

test('runChecks 汇总并按严重度排序', async () => {
  const home = await tmp();
  await makeProfile(home);
  const findings = await runChecks({ home, port: 1, env: {} });
  assert.ok(findings.length >= 6);
  const levels = findings.map((f) => f.level);
  const rank = { fail: 0, warn: 1, ok: 2, info: 3 };
  for (let i = 1; i < levels.length; i++) {
    assert.ok(rank[levels[i - 1]] <= rank[levels[i]]);
  }
  assert.ok(summarize(findings).ok >= 1);
});

test('报告包含结论与处理建议', async () => {
  const findings = [
    { id: 'a', level: 'fail', title: '坏掉了', detail: '原因', fix: '这样修' },
    { id: 'b', level: 'ok', title: '好着', detail: '' },
  ];
  const md = renderReport(findings, { home: 'C:/h', dateStr: '2026-10-29' });
  assert.match(md, /1 项失败/);
  assert.match(md, /\[失败\] 坏掉了/);
  assert.match(md, /\*\*处理\*\*：这样修/);
  assert.match(md, /未读取任何 Key 明文/);
});

test('CLI 在 DSH_HOME 缺失时退出码为 1 并输出 JSON', async () => {
  const missing = join(await tmp(), 'none');
  let error;
  try {
    await run(process.execPath, ['src/index.mjs', '--home', missing, '--json'], { cwd: fileURLToPath(new URL('..', import.meta.url)) });
  } catch (e) {
    error = e;
  }
  assert.ok(error, '应当以非零退出');
  assert.equal(error.code, 1);
  const parsed = JSON.parse(error.stdout);
  assert.ok(Array.isArray(parsed.findings));
});

test('修复闭环：按报告建议处理后面板全绿', async () => {
  const home = await tmp();
  const profile = await makeProfile(home);
  const mods = join(profile, 'node_modules');
  await mkdir(mods, { recursive: true });
  const target = join(home, 'plugin-src');
  await mkdir(target);
  await symlink(target, join(mods, 'broken-plugin'), 'junction');
  await rm(target, { recursive: true, force: true });

  await writeFile(
    join(home, '.credentials.yaml'),
    'version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n',
    'utf8',
  );

  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const broken = await runChecks({ home, workspace: home, port, env: { DSH_PERMISSION_MODE: 'danger-full-access' } });
  const ids = broken.filter((f) => f.level === 'fail' || f.level === 'warn').map((f) => f.id);
  for (const id of ['credentials', 'plugins', 'port', 'permission', 'workspace']) {
    assert.ok(ids.includes(id), `应当先报出 ${id}`);
  }

  await mkdir(target);
  await writeFile(
    join(home, '.credentials.yaml'),
    'version: 1\nrecords:\n  model/deepseek-official:\n    kind: api-key\n    payload:\n      secret: sk-test\n',
    'utf8',
  );
  await writeFile(join(home, 'AGENTS.md'), '# 指令\n', 'utf8');
  await new Promise((r) => server.close(r));

  const fixed = await runChecks({ home, workspace: home, port, env: {} });
  const remaining = fixed.filter((f) => f.level === 'fail' || f.level === 'warn');
  assert.deepEqual(remaining.map((f) => f.id), [], `仍有未清除项：${remaining.map((f) => f.title).join('；')}`);
});
