import { createHmac } from 'node:crypto';
import { and, asc, eq, gt, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { dateStr, isoUtc, newId, priority, taskStatus, tzStr, ulid, type TaskPatchInput } from '@wos/shared';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { schema, type Db, type Tx } from '../db/client.js';
import { AppError, badRequest, conflict, notFound, versionConflict } from '../errors.js';
import { decryptString, encryptString } from '../security/crypto.js';
import { nowIso, randomToken } from '../util.js';
import { getConfigRow, queueChangedTasks, queueDelivery } from './creatoros-sync.js';
import { hydrateTasks, type Q } from './mappers.js';
import { archiveTask, completeTask, createTask, deleteTask, descendantRows, loadOwnedTask, patchTask, reopenTask, unarchiveTask, type Scope } from './tasks.js';
import { transact } from './tx.js';

// CreatorOS integration.
//   Outbound  Workspace OS -> CreatorOS: signed HTTPS/HTTP webhooks (task.upsert / task.remove / ping), queued in `creatoros_outbox`
//             in the same transaction as the task change, delivered by `deliverTick` with retries and backoff.
//   Inbound   CreatorOS -> Workspace OS: REST calls under /api/v1/integrations/creatoros/tasks* with a `creatoros`-scoped access
//             token. They can only touch tasks that are published (linked), and they never echo back to CreatorOS.
// Contract and examples: docs/CREATOROS_INTEGRATION.md

const CFG = schema.creatorosConfig;
const LINK = schema.creatorosTaskLinks;
const OUT = schema.creatorosOutbox;
const T = schema.tasks;
type TaskRow = typeof T.$inferSelect;

export const SECRET_PREFIX = 'wos_whsec_';
const MAX_ATTEMPTS = 10;
const BATCH = 10;
const TIMEOUT_MS = 10_000;
const aadFor = (ownerId: string) => `creatoros:${ownerId}`;

// ---------------------------------------------------------------- shapes
export interface PublishedTask {
  id: string;
  externalId: string | null;
  title: string;
  description: string;
  status: 'open' | 'completed' | 'archived';
  priority: number;
  completedAt: string | null;
  dueDate: string | null;
  dueAtUtc: string | null;
  dueTimezone: string | null;
  scheduledDate: string | null;
  scheduledAtUtc: string | null;
  deadlineDate: string | null;
  estimateMinutes: number | null;
  recurrence: { rule: string; mode: 'fixed' | 'after_completion' } | null;
  projectId: string | null;
  projectName: string | null;
  parentTaskId: string | null;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
}

export interface CreatorosStatus {
  configured: boolean;
  enabled: boolean;
  webhookUrl: string | null;
  autoLabelId: string | null;
  autoProjectId: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  counts: { published: number; pending: number; failed: number };
}

export interface LinkState {
  taskId: string;
  externalId: string | null;
  origin: string;
  state: 'synced' | 'pending' | 'failed';
}

export function toPublished(q: Q, ownerId: string, rows: TaskRow[]): PublishedTask[] {
  if (!rows.length) return [];
  const dtos = hydrateTasks(q, rows);
  const labelIds = [...new Set(dtos.flatMap((d) => d.labelIds))];
  const projectIds = [...new Set(dtos.map((d) => d.projectId).filter((x): x is string => !!x))];
  const labelName = new Map(labelIds.length ? q.select({ id: schema.labels.id, name: schema.labels.name }).from(schema.labels).where(inArray(schema.labels.id, labelIds)).all().map((l) => [l.id, l.name] as const) : []);
  const projectName = new Map(projectIds.length ? q.select({ id: schema.projects.id, name: schema.projects.name }).from(schema.projects).where(inArray(schema.projects.id, projectIds)).all().map((p) => [p.id, p.name] as const) : []);
  const links = new Map(q.select().from(LINK).where(and(eq(LINK.ownerUserId, ownerId), inArray(LINK.taskId, rows.map((r) => r.id)))).all().map((l) => [l.taskId, l.externalId] as const));
  return dtos.map((d) => ({
    id: d.id,
    externalId: links.get(d.id) ?? null,
    title: d.title,
    description: d.description,
    status: d.status,
    priority: d.priority,
    completedAt: d.completedAt,
    dueDate: d.dueDate,
    dueAtUtc: d.dueAtUtc,
    dueTimezone: d.dueTimezone,
    scheduledDate: d.scheduledDate,
    scheduledAtUtc: d.scheduledAtUtc,
    deadlineDate: d.deadlineDate,
    estimateMinutes: d.estimateMinutes,
    recurrence: d.recurrence ? { rule: d.recurrence.rule, mode: d.recurrence.mode } : null,
    projectId: d.projectId,
    projectName: d.projectId ? (projectName.get(d.projectId) ?? null) : null,
    parentTaskId: d.parentTaskId,
    labels: d.labelIds.map((id) => labelName.get(id)).filter((n): n is string => !!n).sort(),
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
    deletedAt: d.deletedAt,
    version: d.version,
  }));
}

// ---------------------------------------------------------------- configuration
/** Owner-supplied webhook address. Plain http(s) on the LAN is the expected case, so private addresses are allowed. */
export function parseWebhookUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw badRequest('That is not a valid address', [{ field: 'webhookUrl', message: 'Enter a full address such as http://192.168.1.20:3001/api/integrations/workspace-os' }]);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw badRequest('Only http:// and https:// addresses are supported', [{ field: 'webhookUrl', message: 'Use http:// or https://' }]);
  if (u.username || u.password) throw badRequest('Do not put a username or password in the address', [{ field: 'webhookUrl', message: 'Credentials are not allowed; requests are signed with the secret instead' }]);
  const host = u.hostname.toLowerCase();
  if (host.startsWith('169.254.') || host === 'metadata.google.internal' || host.includes('fd00:ec2')) throw badRequest('That address is not allowed', [{ field: 'webhookUrl', message: 'Link-local and cloud metadata addresses are blocked' }]);
  u.hash = '';
  return u.toString();
}

export function newSecret(ctx: AppContext, ownerId: string): { plaintext: string; ciphertext: string; keyVersion: number } {
  const plaintext = `${SECRET_PREFIX}${randomToken(32)}`;
  const enc = encryptString(ctx.keyring, plaintext, aadFor(ownerId));
  return { plaintext, ciphertext: enc.ciphertext, keyVersion: enc.keyVersion };
}

export function getStatus(q: Q, ownerId: string): CreatorosStatus {
  const cfg = q.select().from(CFG).where(eq(CFG.ownerUserId, ownerId)).get();
  const count = (where: ReturnType<typeof and>) => (q.select({ c: sql<number>`count(*)` }).from(OUT).where(where).get()?.c ?? 0);
  const published = q.select({ c: sql<number>`count(*)` }).from(LINK).innerJoin(T, eq(T.id, LINK.taskId)).where(and(eq(LINK.ownerUserId, ownerId), isNull(T.deletedAt))).get()?.c ?? 0;
  return {
    configured: !!cfg,
    enabled: !!cfg?.enabled,
    webhookUrl: cfg?.webhookUrl ?? null,
    autoLabelId: cfg?.autoLabelId ?? null,
    autoProjectId: cfg?.autoProjectId ?? null,
    lastSuccessAt: cfg?.lastSuccessAt ?? null,
    lastError: cfg?.lastError ?? null,
    counts: { published, pending: count(and(eq(OUT.ownerUserId, ownerId), eq(OUT.status, 'pending'))), failed: count(and(eq(OUT.ownerUserId, ownerId), eq(OUT.status, 'failed'))) },
  };
}

export function listLinkStates(q: Q, ownerId: string): LinkState[] {
  const queued = new Map(q.select({ taskId: OUT.taskId, status: OUT.status }).from(OUT).where(eq(OUT.ownerUserId, ownerId)).all().map((o) => [o.taskId, o.status] as const));
  return q
    .select()
    .from(LINK)
    .where(eq(LINK.ownerUserId, ownerId))
    .all()
    .map((l) => ({ taskId: l.taskId, externalId: l.externalId, origin: l.origin, state: queued.get(l.taskId) === 'failed' ? ('failed' as const) : queued.has(l.taskId) ? ('pending' as const) : ('synced' as const) }));
}

export interface ConfigInput {
  webhookUrl: string;
  enabled: boolean;
  autoLabelId: string | null;
  autoProjectId: string | null;
}

/** Create or update the link. A new secret is required the first time (and whenever the owner rotates it). */
export function saveConfig(s: Scope, input: ConfigInput, secret?: { ciphertext: string; keyVersion: number }): void {
  const url = parseWebhookUrl(input.webhookUrl);
  if (input.autoLabelId && !s.tx.select({ id: schema.labels.id }).from(schema.labels).where(and(eq(schema.labels.id, input.autoLabelId), eq(schema.labels.ownerUserId, s.ownerId))).get()) {
    throw badRequest('That label does not exist', [{ field: 'autoLabelId', message: 'Unknown label' }]);
  }
  if (input.autoProjectId && !s.tx.select({ id: schema.projects.id }).from(schema.projects).where(and(eq(schema.projects.id, input.autoProjectId), eq(schema.projects.ownerUserId, s.ownerId))).get()) {
    throw badRequest('That project does not exist', [{ field: 'autoProjectId', message: 'Unknown project' }]);
  }
  const existing = getConfigRow(s.tx, s.ownerId);
  if (!existing && !secret) throw badRequest('A signing secret is required for a new link');
  const now = nowIso();
  if (existing) {
    s.tx.update(CFG).set({ webhookUrl: url, enabled: input.enabled, autoLabelId: input.autoLabelId, autoProjectId: input.autoProjectId, ...(secret ? { secretCiphertext: secret.ciphertext, encryptionKeyVersion: secret.keyVersion } : {}), updatedAt: now }).where(eq(CFG.ownerUserId, s.ownerId)).run();
  } else if (secret) {
    s.tx.insert(CFG).values({ ownerUserId: s.ownerId, webhookUrl: url, secretCiphertext: secret.ciphertext, encryptionKeyVersion: secret.keyVersion, enabled: input.enabled, autoLabelId: input.autoLabelId, autoProjectId: input.autoProjectId, createdAt: now, updatedAt: now }).run();
  }
  if (!input.enabled) s.tx.delete(OUT).where(eq(OUT.ownerUserId, s.ownerId)).run();
  else resync(s);
  s.ev.activity({ entityType: 'creatoros', entityId: s.ownerId, action: 'creatoros.configured', summary: input.enabled ? 'saved the CreatorOS link' : 'paused the CreatorOS link' });
  s.ev.emit('settings.changed', s.ownerId, { creatoros: true });
}

export function removeConfig(s: Scope): void {
  s.tx.delete(OUT).where(eq(OUT.ownerUserId, s.ownerId)).run();
  s.tx.delete(LINK).where(eq(LINK.ownerUserId, s.ownerId)).run();
  s.tx.delete(CFG).where(eq(CFG.ownerUserId, s.ownerId)).run();
  s.ev.activity({ entityType: 'creatoros', entityId: s.ownerId, action: 'creatoros.disconnected', summary: 'disconnected CreatorOS' });
  s.ev.emit('settings.changed', s.ownerId, { creatoros: true });
}

function requireEnabled(tx: Db | Tx, ownerId: string) {
  const cfg = getConfigRow(tx, ownerId);
  if (!cfg) throw conflict('CREATOROS_NOT_CONFIGURED', 'CreatorOS is not connected. Set it up under Settings > CreatorOS.');
  if (!cfg.enabled) throw conflict('CREATOROS_DISABLED', 'The CreatorOS link is paused.');
  return cfg;
}

/** Retry failures, publish anything that newly matches the auto rule, and queue every task CreatorOS does not hold at its current version. */
function resync(s: Scope): number {
  const cfg = requireEnabled(s.tx, s.ownerId);
  const now = nowIso();
  // Tasks the auto rule selects (queueChangedTasks re-checks the rule and links them), plus everything already published.
  s.tx.update(OUT).set({ status: 'pending', attempts: 0, nextAttemptAt: now, updatedAt: now }).where(and(eq(OUT.ownerUserId, s.ownerId), eq(OUT.status, 'failed'))).run();
  const ids = new Set(s.tx.select({ id: LINK.taskId }).from(LINK).where(eq(LINK.ownerUserId, s.ownerId)).all().map((r) => r.id));
  const candidates = s.tx.select().from(T).where(and(eq(T.ownerUserId, s.ownerId), eq(T.status, 'open'), isNull(T.deletedAt), or(cfg.autoProjectId ? eq(T.projectId, cfg.autoProjectId) : sql`0=1`, cfg.autoLabelId ? sql`${T.id} IN (SELECT task_id FROM task_labels WHERE label_id = ${cfg.autoLabelId})` : sql`0=1`))).all();
  for (const c of candidates) ids.add(c.id);
  queueChangedTasks(s.tx, s.ownerId, [...ids]);
  return ids.size;
}

export function syncNow(s: Scope): { checked: number } {
  const checked = resync(s);
  s.ev.emit('settings.changed', s.ownerId, { creatoros: true });
  return { checked };
}

// ---------------------------------------------------------------- publish / unpublish (manual)
function expand(s: Scope, ids: string[], includeSubtasks: boolean): TaskRow[] {
  const out = new Map<string, TaskRow>();
  for (const id of [...new Set(ids)]) {
    const row = loadOwnedTask(s, id);
    if (row.deletedAt) throw notFound('Task');
    out.set(row.id, row);
    if (includeSubtasks) for (const d of descendantRows(s, id)) if (!d.deletedAt) out.set(d.id, d);
  }
  return [...out.values()];
}

export function publishTasks(s: Scope, ids: string[], includeSubtasks = true): { count: number } {
  requireEnabled(s.tx, s.ownerId);
  const rows = expand(s, ids, includeSubtasks);
  const now = nowIso();
  for (const r of rows) {
    s.tx.insert(LINK).values({ taskId: r.id, ownerUserId: s.ownerId, externalId: null, origin: 'manual', syncedVersion: 0, linkedAt: now }).onConflictDoNothing().run();
    const link = s.tx.select().from(LINK).where(eq(LINK.taskId, r.id)).get();
    queueDelivery(s.tx, s.ownerId, r.id, 'upsert', { externalId: link?.externalId ?? null });
  }
  s.ev.activity({ entityType: 'task', entityId: rows[0]?.id ?? ids[0] ?? s.ownerId, projectId: rows[0]?.projectId ?? null, action: 'creatoros.published', summary: `published ${rows.length} task${rows.length === 1 ? '' : 's'} to CreatorOS` });
  s.ev.emit('settings.changed', s.ownerId, { creatoros: true });
  return { count: rows.length };
}

export function unpublishTasks(s: Scope, ids: string[], includeSubtasks = true): { count: number } {
  requireEnabled(s.tx, s.ownerId);
  const rows = expand(s, ids, includeSubtasks);
  let count = 0;
  for (const r of rows) {
    const link = s.tx.select().from(LINK).where(and(eq(LINK.taskId, r.id), eq(LINK.ownerUserId, s.ownerId))).get();
    if (!link) continue;
    s.tx.delete(LINK).where(eq(LINK.taskId, r.id)).run();
    queueDelivery(s.tx, s.ownerId, r.id, 'remove', { reason: 'unpublished', externalId: link.externalId });
    count++;
  }
  if (count) s.ev.activity({ entityType: 'task', entityId: rows[0]?.id ?? ids[0] ?? s.ownerId, projectId: rows[0]?.projectId ?? null, action: 'creatoros.unpublished', summary: `stopped publishing ${count} task${count === 1 ? '' : 's'} to CreatorOS` });
  s.ev.emit('settings.changed', s.ownerId, { creatoros: true });
  return { count };
}

// ---------------------------------------------------------------- outbound delivery
export interface DeliveryResult {
  ok: boolean;
  status: number | null;
  retryable: boolean;
  message: string;
  externalId?: string;
}

/** Signature: hex HMAC-SHA256 of `${timestamp}.${rawBody}` with the shared secret, sent as `X-WOS-Signature: v1=<hex>`. */
export function signBody(secret: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');
}

export async function postSigned(ctx: AppContext, url: string, secret: string, eventId: string, body: Record<string, unknown>): Promise<DeliveryResult> {
  const raw = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  try {
    const res = await fetch(url, {
      method: 'POST',
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        'content-type': 'application/json',
        'user-agent': `WorkspaceOS/${ctx.env.GIT_SHA}`,
        'x-wos-event-id': eventId,
        'x-wos-timestamp': ts,
        'x-wos-signature': `v1=${signBody(secret, ts, raw)}`,
      },
      body: raw,
    });
    const text = (await res.text()).slice(0, 4096);
    let externalId: string | undefined;
    try {
      const parsed = JSON.parse(text) as { externalId?: unknown };
      if (typeof parsed.externalId === 'string' && parsed.externalId.length > 0 && parsed.externalId.length <= 200) externalId = parsed.externalId;
    } catch {
      /* the reply body is optional */
    }
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status, retryable: false, message: 'ok', externalId };
    const retryable = res.status >= 500 || res.status === 408 || res.status === 425 || res.status === 429;
    const hint = res.status >= 300 && res.status < 400 ? 'redirects are not followed; use the final address' : res.status === 401 || res.status === 403 ? 'CreatorOS rejected the signature or secret' : res.status === 404 ? 'CreatorOS has no endpoint at that address' : `HTTP ${res.status}`;
    return { ok: false, status: res.status, retryable, message: `HTTP ${res.status}: ${hint}` };
  } catch (e) {
    const err = e as { name?: string; cause?: { code?: string } };
    const why = err.name === 'TimeoutError' ? 'timed out' : (err.cause?.code ?? err.name ?? 'network error');
    return { ok: false, status: null, retryable: true, message: `Could not reach CreatorOS (${why})` };
  }
}

function secretFor(ctx: AppContext, cfg: typeof CFG.$inferSelect): string | null {
  try {
    return decryptString(ctx.keyring, cfg.secretCiphertext, aadFor(cfg.ownerUserId));
  } catch {
    return null;
  }
}

export async function sendPing(ctx: AppContext, ownerId: string): Promise<DeliveryResult> {
  const cfg = getConfigRow(ctx.db, ownerId);
  if (!cfg) throw conflict('CREATOROS_NOT_CONFIGURED', 'CreatorOS is not connected.');
  const secret = secretFor(ctx, cfg);
  if (!secret) throw new AppError(500, 'SECRET_UNREADABLE', 'The stored signing secret cannot be decrypted. Rotate the secret in Settings > CreatorOS.');
  const id = `ping:${newId()}`;
  const r = await postSigned(ctx, cfg.webhookUrl, secret, id, { id, type: 'ping', occurredAt: nowIso(), app: 'workspace-os' });
  ctx.db.update(CFG).set(r.ok ? { lastSuccessAt: nowIso(), lastError: null } : { lastError: r.message.slice(0, 300) }).where(eq(CFG.ownerUserId, ownerId)).run();
  return r;
}

const backoffMs = (attempt: number) => Math.min(5_000 * 2 ** attempt, 15 * 60_000);

/** Deliver due outbox rows (oldest first, one batch per tick). Returns how many were delivered. */
export async function deliverTick(ctx: AppContext, now = new Date()): Promise<number> {
  const due = ctx.db.select().from(OUT).where(and(eq(OUT.status, 'pending'), lte(OUT.nextAttemptAt, now.toISOString()))).orderBy(asc(OUT.nextAttemptAt)).limit(BATCH).all();
  let delivered = 0;
  const secrets = new Map<string, { cfg: typeof CFG.$inferSelect; secret: string | null }>();
  for (const row of due) {
    let ctxCfg = secrets.get(row.ownerUserId);
    if (!ctxCfg) {
      const cfg = getConfigRow(ctx.db, row.ownerUserId);
      if (!cfg || !cfg.enabled) {
        ctx.db.delete(OUT).where(eq(OUT.taskId, row.taskId)).run();
        continue;
      }
      ctxCfg = { cfg, secret: secretFor(ctx, cfg) };
      secrets.set(row.ownerUserId, ctxCfg);
    }
    const { cfg, secret } = ctxCfg;
    if (!secret) {
      fail(ctx, row, { ok: false, status: null, retryable: false, message: 'The stored signing secret cannot be decrypted. Rotate the secret.' });
      continue;
    }
    const task = ctx.db.select().from(T).where(eq(T.id, row.taskId)).get();
    const link = ctx.db.select().from(LINK).where(eq(LINK.taskId, row.taskId)).get();
    const removing = row.kind === 'remove' || !!task?.deletedAt;
    if (!removing && (!task || !link)) {
      ctx.db.delete(OUT).where(eq(OUT.taskId, row.taskId)).run();
      continue;
    }
    const version = task?.version ?? 0;
    const externalId = link?.externalId ?? row.externalId ?? null;
    const type = removing ? 'task.remove' : 'task.upsert';
    const id = `${row.taskId}:${version}:${type}`;
    const reason = row.kind === 'remove' ? (row.reason ?? 'deleted') : task?.deletedAt ? 'deleted' : null;
    const body: Record<string, unknown> = removing
      ? { id, type, occurredAt: nowIso(), reason, task: { id: row.taskId, externalId, version } }
      : { id, type, occurredAt: nowIso(), task: toPublished(ctx.db, row.ownerUserId, [task as TaskRow])[0] };
    const res = await postSigned(ctx, cfg.webhookUrl, secret, id, body);
    if (res.ok) {
      ack(ctx, row, version, res.externalId);
      delivered++;
    } else {
      fail(ctx, row, res);
    }
  }
  return delivered;
}

function ack(ctx: AppContext, row: typeof OUT.$inferSelect, sentVersion: number, externalId?: string): void {
  transact(ctx, row.ownerUserId, (tx, ev) => {
    const link = tx.select().from(LINK).where(eq(LINK.taskId, row.taskId)).get();
    if (link) {
      let ext = link.externalId;
      if (externalId && externalId !== ext) {
        const taken = tx.select({ t: LINK.taskId }).from(LINK).where(and(eq(LINK.ownerUserId, row.ownerUserId), eq(LINK.externalId, externalId))).get();
        if (!taken) ext = externalId;
      }
      tx.update(LINK).set({ syncedVersion: sentVersion, externalId: ext }).where(eq(LINK.taskId, row.taskId)).run();
    }
    // keep the row only if a newer change (or an explicit re-publish) replaced it while we were sending
    const current = tx.select().from(OUT).where(eq(OUT.taskId, row.taskId)).get();
    if (current && current.updatedAt === row.updatedAt) tx.delete(OUT).where(eq(OUT.taskId, row.taskId)).run();
    if (link) queueChangedTasks(tx, row.ownerUserId, [row.taskId]);
    tx.update(CFG).set({ lastSuccessAt: nowIso(), lastError: null }).where(eq(CFG.ownerUserId, row.ownerUserId)).run();
    ev.emit('settings.changed', row.ownerUserId, { creatoros: true });
  });
}

function fail(ctx: AppContext, row: typeof OUT.$inferSelect, res: DeliveryResult): void {
  const attempts = row.attempts + 1;
  const giveUp = !res.retryable || attempts >= MAX_ATTEMPTS;
  const msg = res.message.slice(0, 300);
  ctx.db
    .update(OUT)
    .set({ attempts, status: giveUp ? 'failed' : 'pending', nextAttemptAt: new Date(Date.now() + backoffMs(attempts)).toISOString(), lastError: msg, updatedAt: row.updatedAt })
    .where(and(eq(OUT.taskId, row.taskId), eq(OUT.updatedAt, row.updatedAt)))
    .run();
  ctx.db.update(CFG).set({ lastError: msg }).where(eq(CFG.ownerUserId, row.ownerUserId)).run();
  ctx.log.warn({ taskId: row.taskId, attempts, status: res.status }, 'creatoros delivery failed');
}

// ---------------------------------------------------------------- inbound (CreatorOS -> Workspace OS)
const nullableText = (max: number) => z.string().trim().max(max).nullish();
const taskFields = {
  title: z.string().trim().min(1).max(500),
  description: z.string().max(20000),
  priority,
  projectId: ulid.nullish(),
  labelIds: z.array(ulid).max(50),
  dueDate: dateStr.nullish(),
  dueAtUtc: isoUtc.nullish(),
  dueTimezone: tzStr.nullish(),
  scheduledDate: dateStr.nullish(),
  scheduledAtUtc: isoUtc.nullish(),
  deadlineDate: dateStr.nullish(),
  estimateMinutes: z.number().int().min(1).max(60 * 24 * 14).nullish(),
};

export const inboundCreate = z.object({
  externalId: z.string().trim().min(1).max(200),
  title: taskFields.title,
  description: taskFields.description.optional(),
  priority: taskFields.priority.optional(),
  projectId: taskFields.projectId,
  labelIds: taskFields.labelIds.optional(),
  dueDate: taskFields.dueDate,
  dueAtUtc: taskFields.dueAtUtc,
  dueTimezone: taskFields.dueTimezone,
  scheduledDate: taskFields.scheduledDate,
  scheduledAtUtc: taskFields.scheduledAtUtc,
  deadlineDate: taskFields.deadlineDate,
  estimateMinutes: taskFields.estimateMinutes,
});
export type InboundCreate = z.infer<typeof inboundCreate>;

export const inboundPatch = z.object({
  /** The `version` CreatorOS last saw. If set and stale, the call fails with 409 and the current task. Omit for last-writer-wins. */
  baseVersion: z.number().int().min(1).optional(),
  externalId: nullableText(200),
  title: taskFields.title.optional(),
  description: taskFields.description.optional(),
  priority: taskFields.priority.optional(),
  projectId: taskFields.projectId,
  labelIds: taskFields.labelIds.optional(),
  dueDate: taskFields.dueDate,
  dueAtUtc: taskFields.dueAtUtc,
  dueTimezone: taskFields.dueTimezone,
  scheduledDate: taskFields.scheduledDate,
  scheduledAtUtc: taskFields.scheduledAtUtc,
  deadlineDate: taskFields.deadlineDate,
  estimateMinutes: taskFields.estimateMinutes,
  status: taskStatus.optional(),
});
export type InboundPatch = z.infer<typeof inboundPatch>;

export const inboundList = z.object({
  cursor: z.string().max(80).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
});

function publishedOne(s: Scope, id: string): PublishedTask {
  const row = loadOwnedTask(s, id);
  return toPublished(s.tx, s.ownerId, [row])[0] as PublishedTask;
}

function setSynced(s: Scope, taskId: string, externalId?: string | null): void {
  const row = loadOwnedTask(s, taskId);
  const set: Partial<typeof LINK.$inferInsert> = { syncedVersion: row.version };
  if (externalId) {
    const taken = s.tx.select({ t: LINK.taskId }).from(LINK).where(and(eq(LINK.ownerUserId, s.ownerId), eq(LINK.externalId, externalId))).get();
    if (taken && taken.t !== taskId) throw conflict('EXTERNAL_ID_IN_USE', 'That externalId already belongs to another task.');
    set.externalId = externalId;
  }
  s.tx.update(LINK).set(set).where(eq(LINK.taskId, taskId)).run();
}

export function assertInboundEnabled(ctx: AppContext, ownerId: string): void {
  requireEnabled(ctx.db, ownerId);
}

/** Published tasks for reconciliation (includes soft-deleted ones with `deletedAt` set), ordered by (updatedAt, id). */
export function listPublished(ctx: AppContext, ownerId: string, q: { cursor?: string; limit: number }): { items: PublishedTask[]; nextCursor: string | null } {
  let after: { at: string; id: string } | null = null;
  if (q.cursor) {
    const i = q.cursor.indexOf('~');
    if (i < 1) throw badRequest('The cursor is invalid', [{ field: 'cursor', message: 'Invalid cursor' }]);
    after = { at: q.cursor.slice(0, i), id: q.cursor.slice(i + 1) };
  }
  const where = and(eq(LINK.ownerUserId, ownerId), after ? or(gt(T.updatedAt, after.at), and(eq(T.updatedAt, after.at), gt(T.id, after.id))) : undefined);
  const rows = ctx.db.select({ t: T }).from(LINK).innerJoin(T, eq(T.id, LINK.taskId)).where(where).orderBy(asc(T.updatedAt), asc(T.id)).limit(q.limit).all().map((r) => r.t);
  const last = rows[rows.length - 1];
  return { items: toPublished(ctx.db, ownerId, rows), nextCursor: rows.length === q.limit && last ? `${last.updatedAt}~${last.id}` : null };
}

export function getPublished(ctx: AppContext, ownerId: string, id: string): PublishedTask {
  const link = ctx.db.select().from(LINK).where(and(eq(LINK.taskId, id), eq(LINK.ownerUserId, ownerId))).get();
  const row = link ? ctx.db.select().from(T).where(eq(T.id, id)).get() : undefined;
  if (!row) throw notFound('Published task');
  return toPublished(ctx.db, ownerId, [row])[0] as PublishedTask;
}

/** Create a task from CreatorOS. Idempotent on externalId: repeating the call returns the same task. */
export function createFromCreatorOS(s: Scope, input: InboundCreate): { task: PublishedTask; created: boolean } {
  requireEnabled(s.tx, s.ownerId);
  const existing = s.tx.select().from(LINK).where(and(eq(LINK.ownerUserId, s.ownerId), eq(LINK.externalId, input.externalId))).get();
  if (existing) return { task: publishedOne(s, existing.taskId), created: false };
  const { externalId, ...rest } = input;
  const { task } = createTask(s, rest);
  s.tx.insert(LINK).values({ taskId: task.id, ownerUserId: s.ownerId, externalId, origin: 'creatoros', syncedVersion: task.version, linkedAt: nowIso() }).run();
  s.ev.activity({ entityType: 'task', entityId: task.id, projectId: task.projectId, action: 'creatoros.received', summary: `CreatorOS added a task: ${task.title}` });
  return { task: publishedOne(s, task.id), created: true };
}

/** Apply a change from CreatorOS to a published task. The result is marked as synced so it is not sent back. */
export function patchFromCreatorOS(s: Scope, id: string, input: InboundPatch): PublishedTask {
  requireEnabled(s.tx, s.ownerId);
  const link = s.tx.select().from(LINK).where(and(eq(LINK.taskId, id), eq(LINK.ownerUserId, s.ownerId))).get();
  if (!link) throw notFound('Published task');
  const row = loadOwnedTask(s, id);
  if (row.deletedAt) throw notFound('Published task');
  if (input.baseVersion !== undefined && input.baseVersion !== row.version) throw versionConflict(publishedOne(s, id), input.baseVersion);

  const { baseVersion: _b, externalId, status, ...fields } = input;
  void _b;
  const defined = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(defined).length) patchTask(s, id, { version: row.version, ...(defined as Omit<TaskPatchInput, 'version'>) });

  if (status) {
    const cur = loadOwnedTask(s, id);
    if (status !== cur.status) {
      if (status === 'completed') completeTask(s, id, { version: cur.version });
      else if (status === 'archived') archiveTask(s, id);
      else if (cur.status === 'completed') reopenTask(s, id, {});
      else unarchiveTask(s, id);
    }
  }
  setSynced(s, id, externalId);
  s.ev.activity({ entityType: 'task', entityId: id, projectId: row.projectId, action: 'creatoros.received', summary: `CreatorOS updated a task: ${row.title}` });
  return publishedOne(s, id);
}

export function deleteFromCreatorOS(s: Scope, id: string): PublishedTask {
  requireEnabled(s.tx, s.ownerId);
  const link = s.tx.select().from(LINK).where(and(eq(LINK.taskId, id), eq(LINK.ownerUserId, s.ownerId))).get();
  if (!link) throw notFound('Published task');
  deleteTask(s, id);
  setSynced(s, id);
  return publishedOne(s, id);
}
