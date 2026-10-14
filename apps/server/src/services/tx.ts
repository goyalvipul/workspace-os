import { newId } from '@wos/shared';
import type { AppContext, AppEventRow } from '../context.js';
import { schema, type Tx } from '../db/client.js';
import { nowIso } from '../util.js';

export interface Emitter {
  /** Durable event (app_events); published to SSE only after the transaction commits. */
  emit(type: string, entityId: string | null, payload?: Record<string, unknown>): void;
  activity(a: ActivityInput): void;
}

export interface ActivityInput {
  entityType: string;
  entityId: string;
  projectId?: string | null;
  action: string;
  summary: string;
  delta?: Record<string, unknown>;
}

/**
 * Run a synchronous domain mutation in one SQLite transaction.
 * Activity rows and app_events are written in the same transaction; the in-memory bus is notified after commit.
 */
export function transact<T>(ctx: AppContext, ownerId: string, fn: (tx: Tx, ev: Emitter) => T, clientMutationId?: string): T {
  const pending: AppEventRow[] = [];
  const result = ctx.db.transaction((tx) => {
    const ev: Emitter = {
      emit(type, entityId, payload = {}) {
        const createdAt = nowIso();
        const row = tx
          .insert(schema.appEvents)
          .values({ ownerUserId: ownerId, eventType: type, entityId, payloadJson: JSON.stringify(payload), createdAt })
          .returning({ seq: schema.appEvents.seq })
          .get();
        pending.push({ seq: row.seq, ownerUserId: ownerId, eventType: type, entityId, payload, createdAt });
      },
      activity(a) {
        tx.insert(schema.activityEvents)
          .values({
            id: newId(),
            ownerUserId: ownerId,
            entityType: a.entityType,
            entityId: a.entityId,
            projectId: a.projectId ?? null,
            action: a.action,
            publicSummary: a.summary.slice(0, 500),
            deltaJson: a.delta ? JSON.stringify(a.delta) : null,
            clientMutationId: clientMutationId ?? null,
            createdAt: nowIso(),
          })
          .run();
      },
    };
    return fn(tx, ev);
  });
  for (const e of pending) ctx.bus.publish(e);
  return result;
}
