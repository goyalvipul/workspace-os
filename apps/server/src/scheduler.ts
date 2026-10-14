import { eq } from 'drizzle-orm';
import { desc } from 'drizzle-orm';
import type { AppContext } from './context.js';
import { schema } from './db/client.js';
import { pruneOldEvents } from './calendar/store.js';
import { pruneJobs, scheduleTick, workerTick } from './calendar/service.js';
import { pruneSessions } from './services/auth.js';
import { runBackup } from './services/backup.js';
import { pruneEvents } from './services/events.js';
import { pruneNotifications, reminderTick } from './services/notifications.js';
import { nowIso } from './util.js';

/** Single-process lease so a (mistaken) second container cannot run the same periodic job concurrently. */
function withLease<T>(ctx: AppContext, name: string, ttlMs: number, fn: () => T): T | undefined {
  const L = schema.jobLeases;
  const now = Date.now();
  const owner = `pid-${process.pid}`;
  const got = ctx.sqlite.transaction(() => {
    const row = ctx.db.select().from(L).where(eq(L.name, name)).get();
    if (row?.leaseExpiresAt && Date.parse(row.leaseExpiresAt) > now && row.leaseOwner !== owner) return false;
    const exp = new Date(now + ttlMs).toISOString();
    ctx.db.insert(L).values({ name, leaseOwner: owner, leaseExpiresAt: exp }).onConflictDoUpdate({ target: L.name, set: { leaseOwner: owner, leaseExpiresAt: exp } }).run();
    return true;
  })();
  if (!got) return undefined;
  try {
    const out = fn();
    ctx.db.update(L).set({ lastRunAt: nowIso(), lastStatus: 'ok', leaseExpiresAt: null }).where(eq(L.name, name)).run();
    return out;
  } catch (e) {
    ctx.db.update(L).set({ lastRunAt: nowIso(), lastStatus: 'error', leaseExpiresAt: null }).where(eq(L.name, name)).run();
    throw e;
  }
}

export interface Scheduler {
  stop(): Promise<void>;
  healthy(): boolean;
}

export function startScheduler(ctx: AppContext): Scheduler {
  const timers: NodeJS.Timeout[] = [];
  let lastBeat = Date.now();
  let stopping = false;
  const inflight = new Set<Promise<unknown>>();

  const guard = (name: string, fn: () => Promise<unknown> | unknown) => {
    let running = false;
    return async () => {
      if (running || stopping) return;
      running = true;
      const p = (async () => {
        try {
          await fn();
        } catch (e) {
          ctx.log.error({ job: name, err: e instanceof Error ? e.message : String(e) }, 'scheduled job failed');
        } finally {
          running = false;
        }
      })();
      inflight.add(p);
      void p.finally(() => inflight.delete(p));
      await p;
    };
  };

  const work = guard('sync-worker', async () => {
    lastBeat = Date.now();
    await workerTick(ctx);
  });
  const schedule = guard('sync-schedule', () => {
    scheduleTick(ctx);
  });
  const reminders = guard('reminders', async () => {
    await reminderTick(ctx);
  });
  const backup = guard('daily-backup', async () => {
    const last = ctx.db.select().from(schema.backups).where(eq(schema.backups.status, 'ok')).orderBy(desc(schema.backups.startedAt)).limit(1).get();
    if (last && Date.now() - Date.parse(last.startedAt) < 23 * 3_600_000) return;
    await runBackup(ctx, 'scheduled');
    ctx.log.info('scheduled backup complete');
  });
  const prune = guard('prune', () => {
    withLease(ctx, 'prune', 5 * 60_000, () => {
      pruneSessions(ctx);
      pruneEvents(ctx);
      pruneNotifications(ctx);
      pruneOldEvents(ctx);
      pruneJobs(ctx);
      ctx.sqlite.prepare('DELETE FROM client_mutations WHERE applied_at < ?').run(new Date(Date.now() - 7 * 86_400_000).toISOString());
    });
  });

  timers.push(setInterval(() => void work(), 3_000));
  timers.push(setInterval(() => void schedule(), 15_000));
  timers.push(setInterval(() => void reminders(), 30_000));
  timers.push(setInterval(() => void backup(), 10 * 60_000));
  timers.push(setInterval(() => void prune(), 60 * 60_000));
  for (const t of timers) t.unref();
  ctx.nudgeSync = () => {
    setImmediate(() => void work());
  };
  // first run shortly after boot
  setTimeout(() => void schedule(), 2_000).unref();
  setTimeout(() => void prune(), 10_000).unref();
  setTimeout(() => void backup(), 60_000).unref();

  return {
    healthy: () => Date.now() - lastBeat < 90_000,
    stop: async () => {
      stopping = true;
      for (const t of timers) clearInterval(t);
      await Promise.allSettled([...inflight]);
    },
  };
}
