import { and, eq, gt, lt, sql } from 'drizzle-orm';
import type { AppContext, AppEventRow } from '../context.js';
import { schema } from '../db/client.js';
import { nowIso } from '../util.js';

/** Persist a durable app event and publish it to live SSE clients (call only AFTER the domain commit). */
export function emitEvent(ctx: AppContext, ownerId: string, type: string, entityId: string | null, payload: Record<string, unknown> = {}): AppEventRow {
  const createdAt = nowIso();
  const row = ctx.db.insert(schema.appEvents).values({ ownerUserId: ownerId, eventType: type, entityId, payloadJson: JSON.stringify(payload), createdAt }).returning({ seq: schema.appEvents.seq }).get();
  const ev: AppEventRow = { seq: row.seq, ownerUserId: ownerId, eventType: type, entityId, payload, createdAt };
  ctx.bus.publish(ev);
  return ev;
}

export function eventsAfter(ctx: AppContext, ownerId: string, after: number, limit = 500): { events: AppEventRow[]; resyncRequired: boolean } {
  const E = schema.appEvents;
  const oldest = ctx.db.select({ m: sql<number | null>`min(seq)` }).from(E).where(eq(E.ownerUserId, ownerId)).get()?.m ?? null;
  const latest = ctx.db.select({ m: sql<number | null>`max(seq)` }).from(E).get()?.m ?? 0;
  // Client claims a position the server doesn't have (e.g. DB was restored) or the log was pruned past it
  if (after > latest || (oldest !== null && after > 0 && after < oldest - 1 && after !== 0)) {
    return { events: [], resyncRequired: true };
  }
  const rows = ctx.db.select().from(E).where(and(eq(E.ownerUserId, ownerId), gt(E.seq, after))).orderBy(E.seq).limit(limit).all();
  return {
    events: rows.map((r) => ({ seq: r.seq, ownerUserId: r.ownerUserId, eventType: r.eventType, entityId: r.entityId, payload: r.payloadJson ? (JSON.parse(r.payloadJson) as Record<string, unknown>) : {}, createdAt: r.createdAt })),
    resyncRequired: false,
  };
}

/** Bounded retention: keep the newest 5000 events and anything younger than 7 days. */
export function pruneEvents(ctx: AppContext): number {
  const E = schema.appEvents;
  const maxSeq = ctx.db.select({ m: sql<number | null>`max(seq)` }).from(E).get()?.m ?? 0;
  const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return ctx.db.delete(E).where(and(lt(E.seq, maxSeq - 5000), lt(E.createdAt, cutoff))).run().changes;
}
