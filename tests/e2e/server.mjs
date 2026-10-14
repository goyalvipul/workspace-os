// Starts an isolated production-mode server for Playwright (fresh database, throwaway secrets, port 4398).
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const dir = resolve(root, '.test-data/e2e');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

export const E2E_ENV = {
  NODE_ENV: 'production',
  APP_HOST: '127.0.0.1',
  APP_PORT: '4398',
  HOST_PUBLISHED_PORT: '4398',
  PUBLIC_BASE_URL: 'http://localhost:4398',
  DATABASE_PATH: resolve(dir, 'db.sqlite'),
  BACKUP_DIR: resolve(dir, 'backups'),
  WEB_DIST_DIR: resolve(root, 'apps/web/dist'),
  SESSION_SECRET: randomBytes(48).toString('base64url'),
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
  LOG_LEVEL: 'warn',
  DISABLE_RATE_LIMIT: 'true',
};

const child = spawn(process.execPath, [resolve(root, 'apps/server/dist/index.js')], { env: { ...process.env, ...E2E_ENV }, stdio: ['ignore', 'pipe', 'inherit'] });
let buf = '';
child.stdout.on('data', (d) => {
  buf += d.toString();
  const m = /Setup code:\s*([A-Z0-9-]+)/.exec(buf);
  if (m) {
    import('node:fs').then((fs) => fs.writeFileSync(resolve(dir, 'setup-code.txt'), m[1]));
  }
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
