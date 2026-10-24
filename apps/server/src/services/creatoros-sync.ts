import { and, eq, inArray } from 'drizzle-orm';
import { schema, type Db, type Tx } from '../db/client.js';
import { chunk, nowIso } from '../util.js';

// Detects which published tasks changed and queues them for delivery to CreatorOS. Called by `transact`
// at the end of every domain transaction, so a task change and its outbox row are committed together (or not at all).
// This file must stay free of imports from the other services: tx.ts imports it.

const CFG = schema.creatorosConfig;
const LINK = schema.creatorosTaskLinks;
const OUT = schema.creatorosOutbox;
type TaskRow = typeof schema.tasks.$inferSelect;
type ConfigRow = typeof CFG.$inferSelect;

export function getConfigRow(tx: Db | Tx, ownerId: string): ConfigRow | undefined {
  return tx.select().from(CFG).where(eq(CFG.ownerUserId, ownerId)).get();
}

/** Queue (or refresh) the delivery for one task. Replaces a failed/pending row so the newest intent wins. */
export function queueDelivery(tx: Tx, ownerId: string, taskId: string, kind: 'upsert' | 'remove', opts: { reason?: string | null; externalId?: string | null } = {}): void {
  const now = nowIso();
  tx.insert(OUT)
    .values({ taskId, ownerUserId: ownerId, kind, reason: opts.reason ?? null, externalId: opts.externalId ?? null, status: 'pending', attempts: 0, nextAttemptAt: now, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: OUT.taskId, set: { kind, reason: opts.reason ?? null, externalId: opts.externalId ?? null, status: 'pending', attempts: 0, nextAttemptAt: now, lastError: null, updatedAt: now } })
    .run();
}

/** Does this task qualify for automatic publishing under the owner's rule? */
export function matchesAutoRule(cfg: ConfigRow, row: Pick<TaskRow, 'id' | 'projectId' | 'status' | 'deletedAt'>, labelIds: Set<string>): boolean {
  if (row.deletedAt || row.status !== 'open') return false;
  if (cfg.autoProjectId && row.projectId === cfg.autoProjectId) return true;
  if (cfg.autoLabelId && labelIds.has(cfg.autoLabelId)) return true;
  return false;
}

function labelsByTask(tx: Tx, ids: string[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const part of chunk(ids, 400)) {
    for (const r of tx.select().from(schema.taskLabels).where(inArray(schema.taskLabels.taskId, part)).all()) {
      const set = map.get(r.taskId) ?? new Set<string>();
      set.add(r.labelId);
      map.set(r.taskId, set);
    }
  }
  return map;
}

/**
 * For every changed task: if it is published (or now matches the auto rule) and CreatorOS does not hold its current
 * version, queue a delivery. Tasks changed *by* CreatorOS have `syncedVersion` set to their new version inside the same
 * transaction, which is what stops a change from being echoed back.
 */
export function queueChangedTasks(tx: Tx, ownerId: string, taskIds: string[]): void {
  const cfg = getConfigRow(tx, ownerId);
  if (!cfg || !cfg.enabled) return;
  const ids = [...new Set(taskIds)];
  for (const part of chunk(ids, 400)) {
    const rows = tx.select().from(schema.tasks).where(and(inArray(schema.tasks.id, part), eq(schema.tasks.ownerUserId, ownerId))).all();
    if (!rows.length) continue;
    const links = new Map(tx.select().from(LINK).where(inArray(LINK.taskId, part)).all().map((l) => [l.taskId, l]));
    const labels = cfg.autoLabelId ? labelsByTask(tx, rows.map((r) => r.id)) : new Map<string, Set<string>>();
    for (const row of rows) {
      let link = links.get(row.id);
      if (!link) {
        if (!matchesAutoRule(cfg, row, labels.get(row.id) ?? new Set())) continue;
        link = { taskId: row.id, ownerUserId: ownerId, externalId: null, origin: 'auto', syncedVersion: 0, linkedAt: nowIso() };
        tx.insert(LINK).values(link).run();
      }
      if (link.syncedVersion === row.version) continue;
      queueDelivery(tx, ownerId, row.id, row.deletedAt ? 'remove' : 'upsert', { reason: row.deletedAt ? 'deleted' : null, externalId: link.externalId });
    }
  }
}
