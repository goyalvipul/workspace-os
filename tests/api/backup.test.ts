import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { restoreDatabase, verifyBackupArchive } from '../../apps/server/src/services/backup.js';
import { PASSWORD, startHarness, type Client, type Harness } from './harness.js';

const V = '/api/v1';
let h: Harness;
let c: Client;

beforeAll(async () => {
  h = await startHarness();
  c = h.client();
  await c.signup();
});
afterAll(async () => {
  await h.close();
});

describe('backup, verify and restore drill', () => {
  it('creates a verified backup, detects corruption, and restores the data', async () => {
    const keep = (await c.call('POST', `${V}/tasks`, { title: 'Survives restore' })).json.task;
    const b = await c.call('POST', `${V}/backups`);
    expect(b.status).toBe(201);
    const file = join(h.env.BACKUP_DIR, b.json.backup.filename);
    expect(existsSync(file)).toBe(true);

    const v = await verifyBackupArchive(file);
    expect(v.schemaVersion).toBeGreaterThan(0);

    // corrupt a copy: verification must fail
    const bad = join(mkdtempSync(join(tmpdir(), 'wos-bad-')), 'bad.sqlite.gz');
    const buf = readFileSync(file);
    buf[Math.floor(buf.length / 2)] = (buf[Math.floor(buf.length / 2)] as number) ^ 0xff;
    writeFileSync(bad, buf);
    await expect(verifyBackupArchive(bad)).rejects.toBeTruthy();

    // lose the task after the backup was taken, then restore into a fresh database file
    await c.call('DELETE', `${V}/tasks/${keep.id}`);
    const restoredPath = join(mkdtempSync(join(tmpdir(), 'wos-restore-')), 'restored.sqlite');
    const r = await restoreDatabase(file, restoredPath, h.env.BACKUP_DIR);
    expect(r.schemaVersion).toBeGreaterThan(0);
    const Database = h.ctx.sqlite.constructor as new (p: string, o?: object) => typeof h.ctx.sqlite;
    const db = new Database(restoredPath, { readonly: true });
    const row = db.prepare('SELECT title, deleted_at FROM tasks WHERE id = ?').get(keep.id) as { title: string; deleted_at: string | null };
    db.close();
    expect(row.title).toBe('Survives restore');
    expect(row.deleted_at).toBeNull();
  });

  it('backup download requires password re-entry', async () => {
    const list = await c.call('GET', `${V}/backups`);
    const id = list.json.items.find((x: { status: string }) => x.status === 'ok').id;
    expect((await c.call('POST', `${V}/backups/${id}/download`, { password: 'Wrong-Password-1' })).status).toBe(403);
    const ok = await c.call('POST', `${V}/backups/${id}/download`, { password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(String(ok.headers['content-type'])).toContain('gzip');
  });

  it('writes a safety copy before applying pending migrations to an existing database', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'wos-mig-'));
    const dbFile = join(dir, 'old.sqlite');
    h.ctx.sqlite.prepare('VACUUM INTO ?').run(dbFile); // a plain file copy would miss WAL content
    // forget the last migration so it is "pending" again
    const Database = h.ctx.sqlite.constructor as new (p: string, o?: object) => typeof h.ctx.sqlite;
    const raw = new Database(dbFile);
    raw.prepare('DELETE FROM __drizzle_migrations WHERE created_at = (SELECT max(created_at) FROM __drizzle_migrations)').run();
    raw.close();
    const { loadEnv } = await import('../../apps/server/src/config/env.js');
    const { openAppDatabase } = await import('../../apps/server/src/bootstrap.js');
    const { makeLogger } = await import('../../apps/server/src/app.js');
    const env = loadEnv({ NODE_ENV: 'test', DATABASE_PATH: dbFile, BACKUP_DIR: join(dir, 'bk'), LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);
    try {
      const handle = openAppDatabase(env, makeLogger(env));
      handle.close();
    } catch {
      /* re-applying a non-idempotent migration may fail; the safety copy must exist regardless */
    }
    expect(readdirSync(join(dir, 'bk')).some((f) => f.startsWith('pre-migration-'))).toBe(true);
  });
});
