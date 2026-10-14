// Environment doctor: checks the host prerequisites and the configuration. Never prints secret values.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const results = [];
const add = (status, name, detail = '') => results.push({ status, name, detail });
const run = (cmd, args) => {
  try {
    const viaCmd = process.platform === 'win32' && cmd === 'pnpm'; // pnpm is a .cmd shim on Windows
    return { ok: true, out: execFileSync(viaCmd ? 'cmd.exe' : cmd, viaCmd ? ['/c', cmd, ...args] : args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 }).trim() };
  } catch (e) {
    return { ok: false, out: String(e.stderr || e.message || '').replace(/\0/g, '').trim().slice(0, 160) };
  }
};

const major = Number(process.versions.node.split('.')[0]);
add(major >= 22 ? 'PASS' : 'FAIL', 'Node.js >= 22', `found ${process.versions.node}`);
const pnpm = run('pnpm', ['--version']);
add(pnpm.ok ? 'PASS' : 'FAIL', 'pnpm installed', pnpm.ok ? pnpm.out : 'run: corepack enable  (or npm i -g pnpm)');
const docker = run('docker', ['--version']);
add(docker.ok ? 'PASS' : 'WARN', 'Docker CLI installed', docker.ok ? docker.out : 'needed only for the Docker deployment');
if (docker.ok) {
  const info = run('docker', ['info', '--format', '{{.ServerVersion}}']);
  add(info.ok ? 'PASS' : 'BLOCKED', 'Docker engine reachable', info.ok ? `engine ${info.out}` : 'Docker Desktop is not running, or WSL2 is missing (see docs/OWNER_ACTIONS.md)');
}
if (process.platform === 'win32') {
  const wsl = run('wsl', ['--status']);
  const text = wsl.out.replace(/\s+/g, ' ');
  add(wsl.ok && !/not installed/i.test(text) ? 'PASS' : 'BLOCKED', 'WSL2 (Docker Desktop backend)', wsl.ok && !/not installed/i.test(text) ? 'available' : 'not installed: run  wsl --install  in an admin PowerShell, then reboot');
}
const ts = run('tailscale', ['version']);
add(ts.ok ? 'PASS' : 'WARN', 'Tailscale CLI', ts.ok ? ts.out.split('\n')[0] : 'needed only for phone access (docs/DEPLOY_WINDOWS_TAILSCALE.md)');

// configuration (values are never printed)
const envPath = resolve(root, '.env');
if (!existsSync(envPath)) {
  add('FAIL', '.env present', 'run: node scripts/gen-env.mjs');
} else {
  const env = Object.fromEntries(readFileSync(envPath, 'utf8').split(/\r?\n/).filter((l) => l && !l.startsWith('#') && l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
  add('PASS', '.env present');
  const set = (k) => env[k] && env[k] !== 'GENERATE_ME';
  add(set('SESSION_SECRET') && env.SESSION_SECRET.length >= 32 ? 'PASS' : 'FAIL', 'SESSION_SECRET set (value hidden)');
  let keyOk = false;
  try { keyOk = set('DATA_ENCRYPTION_KEY') && Buffer.from(env.DATA_ENCRYPTION_KEY, 'base64').length === 32; } catch { keyOk = false; }
  add(keyOk ? 'PASS' : 'FAIL', 'DATA_ENCRYPTION_KEY is 32 bytes (value hidden)');
  add(set('VAPID_PUBLIC_KEY') && set('VAPID_PRIVATE_KEY') ? 'PASS' : 'WARN', 'Web push keys (VAPID) present', 'push is disabled without them');
  add(/^https?:\/\//.test(env.PUBLIC_BASE_URL ?? '') ? 'PASS' : 'FAIL', 'PUBLIC_BASE_URL is a URL', env.PUBLIC_BASE_URL ?? 'missing');
  add(set('GOOGLE_CLIENT_ID') && set('GOOGLE_CLIENT_SECRET') ? 'PASS' : 'INFO', 'Google Calendar credentials', set('GOOGLE_CLIENT_ID') ? 'configured' : 'not configured yet (BLOCKED_EXTERNAL until the owner adds them)');
  add(set('MS_CLIENT_ID') && set('MS_CLIENT_SECRET') ? 'PASS' : 'INFO', 'Microsoft credentials', set('MS_CLIENT_ID') ? 'configured' : 'not configured yet (BLOCKED_EXTERNAL until the owner adds them)');
  const port = env.HOST_PUBLISHED_PORT || '4390';
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health/ready`, { signal: AbortSignal.timeout(3000) });
    add(r.ok ? 'PASS' : 'WARN', `App ready on 127.0.0.1:${port}`, `HTTP ${r.status}`);
  } catch {
    add('INFO', `App not reachable on 127.0.0.1:${port}`, 'not started yet');
  }
}

const w = Math.max(...results.map((r) => r.name.length));
for (const r of results) console.log(`${r.status.padEnd(7)} ${r.name.padEnd(w)}  ${r.detail}`);
const failed = results.filter((r) => r.status === 'FAIL').length;
console.log(failed ? `\n${failed} problem(s) need attention.` : '\nNo blocking problems found.');
process.exit(failed ? 1 : 0);
