import Database from 'better-sqlite3';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, statfsSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { desc, eq } from 'drizzle-orm';
import { newId } from '@wos/shared';
import type { AppContext } from '../context.js';
import { latestMigrationTag, migrationCount, openDatabase } from '../db/client.js';
import { schema } from '../db/client.js';
import { AppError, notFound } from '../errors.js';
import { nowIso } from '../util.js';

export interface BackupManifest {
  appVersion: string;
  schemaVersion: number;
  schemaTag: string;
  timestamp: string;
  dbSha256: string;
  archiveSha256: string;
  archiveFile: string;
  filesIncluded: string[];
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolveHash, reject) => {
    const h = createHash('sha256');
    const s = createReadStream(path);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolveHash(h.digest('hex')));
    s.on('error', reject);
  });
}

function schemaVersionOf(db: Database.Database): number {
  try {
    return (db.prepare('SELECT count(*) AS c FROM __drizzle_migrations').get() as { c: number }).c;
  } catch {
    return 0;
  }
}

function integrityOk(file: string): { ok: boolean; schemaVersion: number } {
  const db = new Database(file, { readonly: true });
  try {
    const rows = db.pragma('integrity_check') as { integrity_check: string }[];
    const ok = rows.length === 1 && rows[0]?.integrity_check === 'ok';
    return { ok, schemaVersion: schemaVersionOf(db) };
  } finally {
    db.close();
  }
}

export async function runBackup(ctx: AppContext, trigger: 'manual' | 'scheduled' | 'pre-migration' = 'manual'): Promise<typeof schema.backups.$inferSelect> {
  const dir = resolve(ctx.env.BACKUP_DIR);
  mkdirSync(dir, { recursive: true });
  const id = newId();
  const startedAt = nowIso();
  ctx.db.insert(schema.backups).values({ id, startedAt, status: 'running', trigger }).run();
  const tmpDb = join(dir, `.tmp-${id}.sqlite`);
  const stamp = startedAt.replace(/[:.]/g, '-');
  const archiveName = `workspace-${stamp}-${id.slice(-6).toLowerCase()}.sqlite.gz`;
  const tmpArchive = join(dir, `.tmp-${id}.gz`);
  try {
    // Disk space check: need roughly 2x the live DB size
    try {
      const dbSize = statSync(ctx.handle.path).size;
      const fs = statfsSync(dir);
      if (fs.bavail * fs.bsize < dbSize * 2 + 10_000_000) throw new AppError(507, 'BACKUP_NO_SPACE', 'Not enough free disk space for a backup');
    } catch (e) {
      if (e instanceof AppError) throw e;
    }
    await ctx.sqlite.backup(tmpDb); // consistent online snapshot (handles WAL correctly)
    const check = integrityOk(tmpDb);
    if (!check.ok) throw new Error('Integrity check failed on the snapshot');
    const dbSha = await sha256File(tmpDb);
    await pipeline(createReadStream(tmpDb), createGzip({ level: 6 }), createWriteStream(tmpArchive));
    const archiveSha = await sha256File(tmpArchive);
    const finalPath = join(dir, archiveName);
    renameSync(tmpArchive, finalPath); // atomic publish
    const manifest: BackupManifest = { appVersion: ctx.env.GIT_SHA, schemaVersion: check.schemaVersion, schemaTag: latestMigrationTag(), timestamp: startedAt, dbSha256: dbSha, archiveSha256: archiveSha, archiveFile: archiveName, filesIncluded: ['workspace.sqlite'] };
    writeFileSync(`${finalPath}.manifest.json`, JSON.stringify(manifest, null, 2));
    const size = statSync(finalPath).size;
    ctx.db.update(schema.backups).set({ finishedAt: nowIso(), filename: archiveName, sizeBytes: size, sha256: archiveSha, schemaVersion: check.schemaVersion, status: 'ok' }).where(eq(schema.backups.id, id)).run();
    applyRetention(ctx);
  } catch (e) {
    const msg = e instanceof Error ? e.message.slice(0, 300) : 'failed';
    ctx.db.update(schema.backups).set({ finishedAt: nowIso(), status: 'failed', error: msg }).where(eq(schema.backups.id, id)).run();
    throw e;
  } finally {
    rmSync(tmpDb, { force: true });
    rmSync(tmpArchive, { force: true });
  }
  return ctx.db.select().from(schema.backups).where(eq(schema.backups.id, id)).get() as typeof schema.backups.$inferSelect;
}

export function listBackups(ctx: AppContext) {
  return ctx.db.select().from(schema.backups).orderBy(desc(schema.backups.startedAt)).limit(100).all();
}

export function backupFilePath(ctx: AppContext, id: string): { path: string; filename: string } {
  const b = ctx.db.select().from(schema.backups).where(eq(schema.backups.id, id)).get();
  if (!b || b.status !== 'ok' || !b.filename) throw notFound('Backup');
  const path = join(resolve(ctx.env.BACKUP_DIR), basename(b.filename)); // basename: no path traversal
  if (!existsSync(path)) throw notFound('Backup file');
  return { path, filename: basename(b.filename) };
}

/** Keep newest N daily + weekly + monthly backups, delete the rest. */
export function applyRetention(ctx: AppContext): number {
  const ok = ctx.db.select().from(schema.backups).where(eq(schema.backups.status, 'ok')).orderBy(desc(schema.backups.startedAt)).all();
  const keep = new Set<string>();
  const days = new Set<string>();
  const weeks = new Set<string>();
  const months = new Set<string>();
  const isoWeek = (d: Date) => {
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return `${t.getUTCFullYear()}-W${Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7)}`;
  };
  for (const b of ok) {
    const d = new Date(b.startedAt);
    const day = b.startedAt.slice(0, 10);
    const week = isoWeek(d);
    const month = b.startedAt.slice(0, 7);
    if (days.size < ctx.env.BACKUP_RETENTION_DAILY && !days.has(day)) { days.add(day); keep.add(b.id); }
    if (weeks.size < ctx.env.BACKUP_RETENTION_WEEKLY && !weeks.has(week)) { weeks.add(week); keep.add(b.id); }
    if (months.size < ctx.env.BACKUP_RETENTION_MONTHLY && !months.has(month)) { months.add(month); keep.add(b.id); }
  }
  let removed = 0;
  for (const b of ok) {
    if (keep.has(b.id)) continue;
    if (b.filename) {
      const p = join(resolve(ctx.env.BACKUP_DIR), basename(b.filename));
      rmSync(p, { force: true });
      rmSync(`${p}.manifest.json`, { force: true });
    }
    ctx.db.delete(schema.backups).where(eq(schema.backups.id, b.id)).run();
    removed++;
  }
  return removed;
}

// ---------- offline helpers (used by the CLI; no AppContext needed) ----------
export async function gunzipTo(archive: string, dest: string): Promise<void> {
  await pipeline(createReadStream(archive), createGunzip(), createWriteStream(dest));
}

export async function verifyBackupArchive(archive: string): Promise<{ manifest: BackupManifest | null; tmpDb: string; schemaVersion: number }> {
  const manifestPath = `${archive}.manifest.json`;
  const manifest = existsSync(manifestPath) ? (JSON.parse(readFileSync(manifestPath, 'utf8')) as BackupManifest) : null;
  if (manifest) {
    const actual = await sha256File(archive);
    if (actual !== manifest.archiveSha256) throw new Error('Archive checksum does not match its manifest (file is corrupted or modified)');
  }
  const tmpDb = join(dirname(archive), `.verify-${Date.now()}.sqlite`);
  await gunzipTo(archive, tmpDb);
  try {
    if (manifest && (await sha256File(tmpDb)) !== manifest.dbSha256) throw new Error('Database checksum does not match the manifest');
    const r = integrityOk(tmpDb);
    if (!r.ok) throw new Error('SQLite integrity_check failed for the backup');
    return { manifest, tmpDb, schemaVersion: r.schemaVersion };
  } catch (e) {
    rmSync(tmpDb, { force: true });
    throw e;
  }
}

/**
 * Restore `archive` into `dbPath`. The application MUST be stopped. Keeps a rollback copy; validates the result
 * (opens with migrations + integrity_check) and rolls back automatically on failure.
 */
export async function restoreDatabase(archive: string, dbPath: string, backupDir: string): Promise<{ rollbackFile: string | null; schemaVersion: number }> {
  const { tmpDb, schemaVersion } = await verifyBackupArchive(archive);
  if (schemaVersion > migrationCount()) {
    rmSync(tmpDb, { force: true });
    throw new Error(`This backup has schema version ${schemaVersion}, newer than this application understands (${migrationCount()}). Update the app first.`);
  }
  const target = resolve(dbPath);
  mkdirSync(dirname(target), { recursive: true });
  mkdirSync(backupDir, { recursive: true });
  let rollbackFile: string | null = null;
  try {
    if (existsSync(target)) {
      rollbackFile = join(backupDir, `rollback-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
      const live = new Database(target);
      try {
        await live.backup(rollbackFile);
      } finally {
        live.close();
      }
    }
    for (const suffix of ['-wal', '-shm']) rmSync(target + suffix, { force: true });
    copyFileSync(tmpDb, `${target}.restoring`);
    renameSync(`${target}.restoring`, target);
    // validate: migrations roll forward + integrity
    const h = openDatabase({ path: target });
    try {
      const rows = h.sqlite.pragma('integrity_check') as { integrity_check: string }[];
      if (rows[0]?.integrity_check !== 'ok') throw new Error('Restored database failed integrity_check');
    } finally {
      h.close();
    }
    return { rollbackFile, schemaVersion };
  } catch (e) {
    if (rollbackFile && existsSync(rollbackFile)) {
      for (const suffix of ['-wal', '-shm']) rmSync(target + suffix, { force: true });
      copyFileSync(rollbackFile, target);
    }
    throw e;
  } finally {
    rmSync(tmpDb, { force: true });
    rmSync(`${target}.restoring`, { force: true });
  }
}

export function listBackupFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.sqlite.gz')).sort().reverse();
}
