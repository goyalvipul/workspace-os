/**
 * Operator CLI. Run inside the container:  docker compose exec app node dist/cli.js <command>
 * or from the repo:                         pnpm cli <command>
 */
import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv } from './config/env.js';
import { makeLogger } from './app.js';
import { createContext, openAppDatabase } from './bootstrap.js';
import { issueSetupCode, ownerExists } from './services/auth.js';
import { runBackup, restoreDatabase, verifyBackupArchive, listBackupFiles } from './services/backup.js';
import { rmSync as rm } from 'node:fs';

const [cmd, ...args] = process.argv.slice(2);

function usage(): never {
   
  console.log(`Workspace OS CLI

  setup-code                 Print a fresh one-time setup code (only before an owner exists)
  backup                     Create a verified backup now
  list-backups               List backup archives in BACKUP_DIR
  verify <archive.sqlite.gz> Check an archive (checksum, integrity, schema version) without restoring
  restore <archive> --yes    Restore the database from an archive (STOP THE APP FIRST). A rollback copy is kept.
  wipe-data --yes            Delete the database file (STOP THE APP FIRST). Backups are kept.
`);
  process.exit(cmd ? 1 : 0);
}

async function main() {
  const env = loadEnv();
  const log = makeLogger({ ...env, LOG_LEVEL: 'warn' });
  const log2 = (s: string) => console.log(s);  

  switch (cmd) {
    case 'setup-code': {
      const h = openAppDatabase(env, log);
      const ctx = createContext({ env, handle: h, log });
      if (ownerExists(ctx)) log2('An owner account already exists; no setup code is needed.');
      else log2(`Setup code: ${issueSetupCode(ctx)}`);
      h.close();
      return;
    }
    case 'backup': {
      const h = openAppDatabase(env, log);
      const ctx = createContext({ env, handle: h, log });
      const b = await runBackup(ctx, 'manual');
      log2(`Backup ok: ${join(resolve(env.BACKUP_DIR), b.filename ?? '')} (${b.sizeBytes} bytes, sha256 ${b.sha256})`);
      h.close();
      return;
    }
    case 'list-backups': {
      for (const f of listBackupFiles(resolve(env.BACKUP_DIR))) log2(f);
      return;
    }
    case 'verify': {
      const file = args[0];
      if (!file || !existsSync(file)) {
        log2('Give the path of an archive that exists.');
        process.exit(1);
      }
      const v = await verifyBackupArchive(resolve(file));
      rm(v.tmpDb, { force: true });
      log2(`OK: archive is intact (schema version ${v.schemaVersion}${v.manifest ? ', manifest checksum matches' : ', no manifest found'}).`);
      return;
    }
    case 'restore': {
      const file = args[0];
      if (!file || !existsSync(file)) {
        log2('Give the path of an archive that exists.');
        process.exit(1);
      }
      if (!args.includes('--yes')) {
        log2('Restore replaces the live database. Stop the app first, then re-run with --yes.');
        process.exit(1);
      }
      const r = await restoreDatabase(resolve(file), resolve(env.DATABASE_PATH), resolve(env.BACKUP_DIR));
      log2(`Restored (schema version ${r.schemaVersion}). Rollback copy: ${r.rollbackFile ?? 'none (database was empty)'}. Start the app again.`);
      return;
    }
    case 'wipe-data': {
      if (!args.includes('--yes')) {
        log2('This deletes the database. Re-run with --yes to confirm.');
        process.exit(1);
      }
      for (const suffix of ['', '-wal', '-shm']) rmSync(`${resolve(env.DATABASE_PATH)}${suffix}`, { force: true });
      log2('Database removed. A new first-run setup code will be printed on next start.');
      return;
    }
    default:
      usage();
  }
}

main().catch((e) => {
   
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
