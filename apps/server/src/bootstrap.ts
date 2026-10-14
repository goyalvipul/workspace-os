import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { FastifyBaseLogger } from 'fastify';
import { eq } from 'drizzle-orm';
import type { Env } from './config/env.js';
import { EventBus, type AppContext } from './context.js';
import { openDatabase, schema, type DbHandle } from './db/client.js';
import { buildKeyring, decryptString } from './security/crypto.js';
import { createGoogleProvider } from './calendar/google.js';
import { createMicrosoftProvider } from './calendar/microsoft.js';
import type { CalendarProvider, ProviderId } from './calendar/types.js';

export function createContext(opts: { env: Env; handle: DbHandle; log: FastifyBaseLogger; providers?: Partial<Record<ProviderId, CalendarProvider>> }): AppContext {
  return {
    env: opts.env,
    handle: opts.handle,
    db: opts.handle.db,
    sqlite: opts.handle.sqlite,
    keyring: buildKeyring(opts.env),
    bus: new EventBus(),
    log: opts.log,
    providers: {
      google: opts.providers?.google ?? createGoogleProvider(opts.env),
      microsoft: opts.providers?.microsoft ?? createMicrosoftProvider(opts.env),
    },
    presence: { sseClients: 0, lastCalendarViewAt: 0 },
  };
}

/** Opens the database. Before applying pending migrations to an existing database it takes a safety copy. */
export function openAppDatabase(env: Env, log: FastifyBaseLogger): DbHandle {
  return openDatabase({
    path: env.DATABASE_PATH,
    beforeMigrate: (sqlite, pending) => {
      const dir = resolve(env.BACKUP_DIR);
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `pre-migration-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
      log.warn({ pending }, 'pending migrations: writing a safety copy first');
      sqlite.prepare('VACUUM INTO ?').run(file);
      log.warn({ file }, 'safety copy written');
    },
  });
}

/** Detects the classic "wrong DATA_ENCRYPTION_KEY" mistake before it silently breaks calendar sync. */
export function encryptedAccountPreflight(ctx: AppContext): { total: number; unreadable: number } {
  const rows = ctx.db.select().from(schema.connectedAccounts).where(eq(schema.connectedAccounts.status, 'connected')).all();
  let unreadable = 0;
  for (const a of rows) {
    try {
      decryptString(ctx.keyring, a.tokenCiphertext, `account:${a.id}`);
    } catch {
      unreadable++;
    }
  }
  return { total: rows.length, unreadable };
}
