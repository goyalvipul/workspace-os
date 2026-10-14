import { dataDirMountWarning, schema } from './db/client.js';
import { ConfigError, loadEnv } from './config/env.js';
import { buildApp, makeLogger } from './app.js';
import { createContext, encryptedAccountPreflight, openAppDatabase } from './bootstrap.js';
import { startScheduler, type Scheduler } from './scheduler.js';
import { issueSetupCode, ownerExists, seedBuiltinTemplates } from './services/auth.js';
import { pushConfigured } from './services/notifications.js';

function banner(lines: string[]) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = '='.repeat(width);
  // eslint-disable-next-line no-console
  console.log(['', bar, ...lines.map((l) => `  ${l}`), bar, ''].join('\n'));
}

async function main() {
  let env;
  try {
    env = loadEnv();
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(e instanceof ConfigError ? e.message : e);
    process.exit(1);
  }
  const log = makeLogger(env);
  const warn = dataDirMountWarning(env.DATABASE_PATH);
  if (warn) log.error(warn);

  const handle = openAppDatabase(env, log);
  const ctx = createContext({ env, handle, log });
  seedBuiltinTemplates(ctx);

  const pre = encryptedAccountPreflight(ctx);
  if (pre.unreadable > 0) {
    log.error({ accounts: pre.unreadable }, 'Connected calendar accounts cannot be decrypted with the current DATA_ENCRYPTION_KEY. Restore the original key (or DATA_ENCRYPTION_KEY_PREVIOUS) or reconnect those accounts.');
  }
  if (!pushConfigured(ctx)) log.info('Web push is not configured (VAPID keys missing); in-app notifications only.');

  let scheduler: Scheduler | null = null;
  const app = await buildApp(ctx, { schedulerHealthy: () => (scheduler ? scheduler.healthy() : true) });
  await app.listen({ host: env.APP_HOST, port: env.APP_PORT });
  if (!env.DISABLE_SCHEDULER) scheduler = startScheduler(ctx);

  if (!ownerExists(ctx)) {
    const code = issueSetupCode(ctx);
    banner([
      'WORKSPACE OS - FIRST RUN SETUP',
      '',
      `Open: ${env.PUBLIC_BASE_URL}`,
      `Setup code: ${code}`,
      '',
      'Enter this code on the setup screen to create the owner account.',
      'It is valid until an owner exists. Re-issue with: pnpm cli setup-code',
    ]);
  }
  log.info({ port: env.APP_PORT, db: handle.path, migrations: 'applied', env: env.NODE_ENV }, 'Workspace OS is ready');

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 15_000);
    force.unref();
    try {
      await scheduler?.stop();
      await app.close();
      handle.sqlite.pragma('wal_checkpoint(TRUNCATE)');
      handle.close();
    } catch (e) {
      log.error({ err: e instanceof Error ? e.message : String(e) }, 'error during shutdown');
    }
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  void schema;
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', e instanceof Error ? e.message : e);
  process.exit(1);
});
