import { readFile, readdir, lstat, realpath, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import net from 'node:net';

const LEVEL_ORDER = { fail: 0, warn: 1, ok: 2, info: 3 };

async function safe(fn, fallback) {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export async function checkNodeVersion() {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 22
    ? { id: 'node', level: 'ok', title: `Node ${process.version}`, detail: '满足原生 ESM 加载要求' }
    : {
        id: 'node',
        level: 'fail',
        title: `Node ${process.version} 过低`,
        detail: 'dsh 用原生 ESM 加载插件，低于 22 常见表现是命令零输出直接退出',
        fix: '升级到 Node 22 或更高版本',
      };
}

export async function checkDshHome(home) {
  if (!existsSync(home)) {
    return {
      id: 'home',
      level: 'fail',
      title: '找不到 DSH_HOME',
      detail: `未发现 ${home}，说明 dsh 从未成功启动过，或 DSH_HOME 指向了别处`,
      fix: '先执行一次 npx @deepseek-ai/dsh web，让它创建默认目录',
    };
  }
  const profiles = await safe(() => readdir(join(home, 'profiles')), []);
  return {
    id: 'home',
    level: profiles.length ? 'ok' : 'warn',
    title: profiles.length ? `DSH_HOME 正常，profiles: ${profiles.join(', ')}` : 'DSH_HOME 存在但没有 profile',
    detail: home,
  };
}

export async function checkProfile(home, name = 'web') {
  const dir = join(home, 'profiles', name);
  if (!existsSync(dir)) {
    return { id: 'profile', level: 'warn', title: `没有 ${name} profile`, detail: dir, fix: `执行 dsh web 让它自动创建` };
  }
  const patch = join(dir, 'cordis.patch.yml');
  const pkgPath = join(dir, 'package.json');
  const pkg = await safe(async () => JSON.parse(await readFile(pkgPath, 'utf8')), null);
  const bundles = pkg?.dsh?.profile?.bundles ?? [];
  return {
    id: 'profile',
    level: 'ok',
    title: `profile ${name} 存在`,
    detail: [
      existsSync(patch) ? 'cordis.patch.yml 可用' : '缺少 cordis.patch.yml',
      bundles.length ? `bundles: ${bundles.join(' -> ')}` : '未读到 bundles',
    ].join('；'),
  };
}

export async function checkCredentials(home) {
  const file = join(home, '.credentials.yaml');
  if (!existsSync(file)) {
    return {
      id: 'credentials',
      level: 'fail',
      title: '没有 .credentials.yaml',
      detail: '模型 Key 未配置，任何任务都会失败',
      fix: 'Web UI → 设置 → 模型 → 填入 sk- 开头的 Key 并保存',
    };
  }
  const text = await safe(() => readFile(file, 'utf8'), '');
  const recordNames = [...text.matchAll(/^ {2}([A-Za-z0-9@._/-]+):\s*$/gm)].map((m) => m[1]);
  const kinds = [...text.matchAll(/kind:\s*(\w+)/g)].map((m) => m[1]);
  const hasModelish = recordNames.some((n) => /model|provider|deepseek|llm/i.test(n)) || kinds.some((k) => k !== 'grant');
  if (!hasModelish) {
    return {
      id: 'credentials',
      level: 'warn',
      title: '凭据文件里只有浏览器授权，没有模型 Key',
      detail: `现有记录：${recordNames.join(', ') || '无'}`,
      fix: 'Web UI → 设置 → 模型 → 填 Key 并保存（保存后立即生效，无需重启）',
    };
  }
  return {
    id: 'credentials',
    level: 'ok',
    title: '已发现模型凭据',
    detail: `记录：${recordNames.join(', ')}`,
  };
}

async function listModules(dir) {
  const out = [];
  for (const entry of await safe(() => readdir(dir, { withFileTypes: true }), [])) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith('.')) continue;
    if (entry.name.startsWith('@')) {
      for (const sub of await safe(() => readdir(join(dir, entry.name), { withFileTypes: true }), [])) {
        if (sub.isDirectory() || sub.isSymbolicLink()) out.push(`${entry.name}/${sub.name}`);
      }
    } else {
      out.push(entry.name);
    }
  }
  return out;
}

export async function checkPluginLinks(home, name = 'web') {
  const dir = join(home, 'profiles', name, 'node_modules');
  if (!existsSync(dir)) {
    return { id: 'plugins', level: 'info', title: '没有安装插件', detail: dir };
  }
  const mods = await listModules(dir);
  const broken = [];
  const linked = [];
  for (const mod of mods) {
    const p = join(dir, mod);
    const st = await safe(() => lstat(p), null);
    if (!st) continue;
    if (st.isSymbolicLink()) {
      const real = await safe(() => realpath(p), null);
      const okDir = real && (await safe(async () => (await stat(real)).isDirectory(), false));
      if (okDir) linked.push(`${mod} -> ${real}`);
      else broken.push(mod);
    }
  }
  if (broken.length) {
    return {
      id: 'plugins',
      level: 'fail',
      title: `悬空的插件链接：${broken.join(', ')}`,
      detail: '源码目录被移走或改名后，软链悬空。表现是启动崩溃，而不是提示插件找不到',
      fix: 'dsh plugin --profile web add <包名> 重新挂载',
    };
  }
  return {
    id: 'plugins',
    level: 'ok',
    title: `插件 ${mods.length} 个，链接正常`,
    detail: linked.length ? linked.join('；') : '未使用 link 安装',
  };
}

export function checkPort(port, { timeoutMs = 400 } = {}) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    const done = (occupied) => {
      socket.destroy();
      resolve(
        occupied
          ? {
              id: 'port',
              level: 'warn',
              title: `端口 ${port} 已被占用`,
              detail: '常见于上一个 dsh 实例没退干净',
              fix: `换端口启动：dsh web --port 0`,
            }
          : { id: 'port', level: 'ok', title: `端口 ${port} 空闲`, detail: '' },
      );
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

export async function checkWorkspace(dir) {
  if (!dir) return { id: 'workspace', level: 'info', title: '未指定工作区', detail: '' };
  const agents = join(dir, 'AGENTS.md');
  return existsSync(agents)
    ? { id: 'workspace', level: 'ok', title: '工作区有 AGENTS.md', detail: agents }
    : {
        id: 'workspace',
        level: 'warn',
        title: '工作区没有 AGENTS.md',
        detail: 'agent 不会加载任何项目指令，行为会偏通用',
        fix: '在会话里选好工作区，并按需放一份 AGENTS.md',
      };
}

export function checkPermissionMode(env = process.env) {
  const mode = env.DSH_PERMISSION_MODE ?? 'workspace-write';
  if (mode === 'danger-full-access') {
    return {
      id: 'permission',
      level: 'fail',
      title: '权限模式是 danger-full-access',
      detail: '沙箱全开且授权从不询问，任何一次提示注入都可能写到工作区外',
      fix: '去掉 DSH_PERMISSION_MODE，或显式设为 workspace-write',
    };
  }
  return { id: 'permission', level: 'ok', title: `权限模式 ${mode}`, detail: '越界操作会弹窗询问' };
}

export async function runChecks({ home, workspace, port = 8899, env = process.env } = {}) {
  const findings = await Promise.all([
    checkNodeVersion(),
    checkDshHome(home),
    checkProfile(home),
    checkCredentials(home),
    checkPluginLinks(home),
    checkPort(port),
    checkWorkspace(workspace),
    Promise.resolve(checkPermissionMode(env)),
  ]);
  return findings.sort((a, b) => LEVEL_ORDER[a.level] - LEVEL_ORDER[b.level]);
}
