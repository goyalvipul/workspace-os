import Dexie, { type Table } from 'dexie';

export type EntityType = 'task' | 'project' | 'section' | 'label';

export interface OutboxRow {
  seq?: number;
  id: string; // client op id
  kind: string;
  method: 'POST' | 'PATCH' | 'DELETE';
  url: string;
  body?: Record<string, unknown>;
  /** body.version is filled in at send time from the entity's latest known server version */
  needsVersion?: boolean;
  idem: string;
  entity: { type: EntityType; id: string };
  /** values of the touched fields when the edit was made (for 3-way conflict detection) */
  base?: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

interface KV {
  key: string;
  value: unknown;
}

class WosDb extends Dexie {
  kv!: Table<KV, string>;
  outbox!: Table<OutboxRow, number>;
  constructor() {
    super('workspace-os');
    this.version(1).stores({ kv: 'key', outbox: '++seq, id' });
  }
}

export const db = new WosDb();

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return (await db.kv.get(key))?.value as T | undefined;
  } catch {
    return undefined;
  }
}
export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    await db.kv.put({ key, value });
  } catch {
    /* storage unavailable or full: the app keeps working online */
  }
}
export async function wipeLocal(): Promise<void> {
  try {
    await db.kv.clear();
    await db.outbox.clear();
  } catch {
    /* ignore */
  }
}
