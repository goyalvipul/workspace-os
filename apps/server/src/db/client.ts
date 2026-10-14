import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type SqliteDb = Database.Database;

export interface DbHandle {
  db: Db;
  sqlite: SqliteDb;
  path: string;
  createdNew: boolean;
  close(): void;
}

export function migrationsFolder(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [resolve(here, 'drizzle'), resolve(here, '../drizzle'), resolve(here, '../../drizzle'), resolve(process.cwd(), 'drizzle'), resolve(process.cwd(), 'apps/server/drizzle')];
  for (const c of candidates) if (existsSync(join(c, 'meta', '_journal.json'))) return c;
  throw new Error('Migrations folder not found. Looked in: ' + candidates.join(', '));
}

export function latestMigrationTag(): string {
  const journal = JSON.parse(readFileSync(join(migrationsFolder(), 'meta', '_journal.json'), 'utf8')) as { entries: { tag: string }[] };
  return journal.entries[journal.entries.length - 1]?.tag ?? 'none';
}

export function migrationCount(): number {
  const journal = JSON.parse(readFileSync(join(migrationsFolder(), 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
  return journal.entries.length;
}

export interface OpenOptions {
  path: string;
  /** called before pending migrations run on a non-empty database */
  beforeMigrate?: (sqlite: SqliteDb, pendingCount: number) => void;
  readonly?: boolean;
  skipMigrate?: boolean;
}

export function openDatabase(opts: OpenOptions): DbHandle {
  const path = opts.path === ':memory:' ? opts.path : resolve(opts.path);
  const createdNew = path !== ':memory:' && !existsSync(path);
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path, { readonly: opts.readonly ?? false });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
  sqlite.pragma('temp_store = MEMORY');
  const db = drizzle(sqlite, { schema });

  if (!opts.skipMigrate && !opts.readonly) {
    const folder = migrationsFolder();
    const journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    let applied = 0;
    try {
      applied = (sqlite.prepare('SELECT count(*) AS c FROM __drizzle_migrations').get() as { c: number }).c;
    } catch {
      applied = 0;
    }
    const pending = journal.entries.length - applied;
    if (pending > 0 && applied > 0) opts.beforeMigrate?.(sqlite, pending);
    migrate(db, { migrationsFolder: folder });
  }

  return { db, sqlite, path, createdNew, close: () => sqlite.close() };
}

/** In Docker the data dir must be a volume; warn loudly otherwise (data would vanish on container re-create). */
export function dataDirMountWarning(dbPath: string): string | null {
  try {
    if (!existsSync('/proc/self/mountinfo')) return null;
    const mounts = readFileSync('/proc/self/mountinfo', 'utf8').split('\n');
    const dir = dirname(resolve(dbPath));
    if (!dir.startsWith('/app/')) return null;
    const isMount = mounts.some((l) => l.split(' ')[4] === dir);
    return isMount ? null : `The data directory ${dir} is not a mounted volume. Data will be lost when the container is re-created!`;
  } catch {
    return null;
  }
}

export function listMigrationFiles(): string[] {
  return readdirSync(migrationsFolder()).filter((f) => f.endsWith('.sql'));
}

export { schema };
