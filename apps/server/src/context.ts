import { EventEmitter } from 'node:events';
import type { FastifyBaseLogger } from 'fastify';
import type { Env } from './config/env.js';
import type { Db, DbHandle, SqliteDb } from './db/client.js';
import type { Keyring } from './security/crypto.js';
import type { CalendarProvider, ProviderId } from './calendar/types.js';

export interface AppEventRow {
  seq: number;
  ownerUserId: string;
  eventType: string;
  entityId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
}

export class EventBus extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(200);
  }
  publish(e: AppEventRow): void {
    this.emit('event', e);
  }
}

export interface AppContext {
  env: Env;
  handle: DbHandle;
  db: Db;
  sqlite: SqliteDb;
  keyring: Keyring;
  bus: EventBus;
  log: FastifyBaseLogger;
  providers: Record<ProviderId, CalendarProvider>;
  /** live-usage signals used to pick active vs idle polling cadence */
  presence: { sseClients: number; lastCalendarViewAt: number };
  /** set by the scheduler so routes can nudge it */
  nudgeSync?: () => void;
}
