import { and, desc, eq, inArray, isNull, lt, sql } from 'drizzle-orm';
import webpush from 'web-push';
import { localDateOf, localTimeOf, localToUtc, newId, todayLocal } from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import { decryptString, encryptString } from '../security/crypto.js';
import { nowIso, sha256 } from '../util.js';
import { emitEvent } from './events.js';
import { viewToday } from './queries.js';
import { getPreferences } from './workspace.js';

let vapidReady: string | null = null;

export function pushConfigured(ctx: AppContext): boolean {
  return !!(ctx.env.VAPID_PUBLIC_KEY && ctx.env.VAPID_PRIVATE_KEY && ctx.env.VAPID_CONTACT_EMAIL);
}

function initVapid(ctx: AppContext): boolean {
  if (!pushConfigured(ctx)) return false;
  const sig = `${ctx.env.VAPID_PUBLIC_KEY}:${ctx.env.VAPID_CONTACT_EMAIL}`;
  if (vapidReady !== sig) {
    const contact = ctx.env.VAPID_CONTACT_EMAIL as string;
    webpush.setVapidDetails(contact.startsWith('mailto:') || contact.startsWith('https:') ? contact : `mailto:${contact}`, ctx.env.VAPID_PUBLIC_KEY as string, ctx.env.VAPID_PRIVATE_KEY as string);
    vapidReady = sig;
  }
  return true;
}

export interface PushSub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export function savePushSubscription(ctx: AppContext, ownerId: string, sub: PushSub, deviceName: string | null): string {
  let host: string;
  try {
    const u = new URL(sub.endpoint);
    if (u.protocol !== 'https:') throw new Error('not https');
    host = u.hostname;
  } catch {
    throw new Error('Invalid push endpoint');
  }
  void host;
  const id = newId();
  const now = nowIso();
  const hash = sha256(sub.endpoint);
  const enc = encryptString(ctx.keyring, JSON.stringify(sub), `push:${hash}`).ciphertext;
  const existing = ctx.db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.endpointHash, hash)).get();
  if (existing) {
    ctx.db.update(schema.pushSubscriptions).set({ ownerUserId: ownerId, subscriptionCiphertext: enc, deviceName, isActive: true, lastError: null, updatedAt: now }).where(eq(schema.pushSubscriptions.id, existing.id)).run();
    return existing.id;
  }
  ctx.db.insert(schema.pushSubscriptions).values({ id, ownerUserId: ownerId, endpointHash: hash, subscriptionCiphertext: enc, deviceName, createdAt: now, updatedAt: now }).run();
  return id;
}

export function removePushSubscription(ctx: AppContext, ownerId: string, endpoint: string): void {
  ctx.db.delete(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.ownerUserId, ownerId), eq(schema.pushSubscriptions.endpointHash, sha256(endpoint)))).run();
}

export function countPushSubscriptions(ctx: AppContext, ownerId: string): number {
  return ctx.db.select({ c: sql<number>`count(*)` }).from(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.ownerUserId, ownerId), eq(schema.pushSubscriptions.isActive, true))).get()?.c ?? 0;
}

export async function sendPush(ctx: AppContext, ownerId: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<{ sent: number; failed: number }> {
  if (!initVapid(ctx)) return { sent: 0, failed: 0 };
  const subs = ctx.db.select().from(schema.pushSubscriptions).where(and(eq(schema.pushSubscriptions.ownerUserId, ownerId), eq(schema.pushSubscriptions.isActive, true))).all();
  let sent = 0;
  let failed = 0;
  for (const s of subs) {
    try {
      const sub = JSON.parse(decryptString(ctx.keyring, s.subscriptionCiphertext, `push:${s.endpointHash}`)) as PushSub;
      await webpush.sendNotification(sub, JSON.stringify(payload), { TTL: 3600 });
      sent++;
    } catch (e) {
      failed++;
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) ctx.db.delete(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.id, s.id)).run(); // permanent: subscription is gone
      else ctx.db.update(schema.pushSubscriptions).set({ lastError: `HTTP ${status ?? 'error'}`, updatedAt: nowIso() }).where(eq(schema.pushSubscriptions.id, s.id)).run();
    }
  }
  return { sent, failed };
}

// ---------- reminders ----------
export interface ReminderRunResult {
  delivered: number;
  expired: number;
}

export async function reminderTick(ctx: AppContext, now: Date = new Date()): Promise<ReminderRunResult> {
  const R = schema.taskReminders;
  const T = schema.tasks;
  const rows = ctx.db
    .select({ r: R, t: T, u: schema.users })
    .from(R)
    .innerJoin(T, eq(T.id, R.taskId))
    .innerJoin(schema.users, eq(schema.users.id, T.ownerUserId))
    .where(and(eq(R.enabled, true), eq(T.status, 'open'), isNull(T.deletedAt)))
    .all();
  const prefsCache = new Map<string, Record<string, unknown>>();
  const out: ReminderRunResult = { delivered: 0, expired: 0 };
  const pushes: { owner: string; title: string; body: string; tag: string }[] = [];

  for (const { r, t, u } of rows) {
    const tz = t.dueTimezone ?? u.timezone;
    let prefs = prefsCache.get(u.id);
    if (!prefs) {
      prefs = getPreferences(ctx.db, u.id);
      prefsCache.set(u.id, prefs);
    }
    const graceMin = Number(prefs['notifications.lateGraceMinutes'] ?? 60);
    const defaultTime = String(prefs['tasks.defaultReminderTime'] ?? '09:00');

    let fireAt: Date | null = null;
    let occ = t.nextOccurrenceKey ?? 'once';
    if (r.kind === 'absolute') {
      if (r.atUtc) fireAt = new Date(r.atUtc);
      occ = `abs:${r.atUtc}`;
    } else {
      const base = t.dueAtUtc ?? t.scheduledAtUtc;
      if (base) fireAt = new Date(new Date(base).getTime() - (r.offsetMinutes ?? 0) * 60_000);
      else {
        const d = t.dueDate ?? t.scheduledDate;
        if (d) fireAt = new Date(localToUtc(d, defaultTime, tz).getTime() - (r.offsetMinutes ?? 0) * 60_000);
      }
    }
    if (!fireAt || Number.isNaN(fireAt.getTime())) continue;
    if (fireAt.getTime() > now.getTime()) continue;
    if (r.lastSentOccurrenceKey === occ) continue;

    const tooLate = now.getTime() - fireAt.getTime() > graceMin * 60_000;
    const dedupeKey = `reminder:${r.id}:${occ}:${r.channel}`;
    const nowStr = now.toISOString();
    const inserted = ctx.db
      .insert(schema.notifications)
      .values({
        id: newId(),
        ownerUserId: u.id,
        kind: 'reminder',
        taskId: t.id,
        occurrenceKey: occ,
        title: t.title,
        body: t.dueDate ? `Due ${t.dueDate === todayLocal(tz, now) ? 'today' : t.dueDate}` : 'Reminder',
        scheduledAt: fireAt.toISOString(),
        deliveredAt: tooLate ? null : nowStr,
        channel: r.channel,
        status: tooLate ? 'expired' : 'delivered',
        dedupeKey,
        createdAt: nowStr,
      })
      .onConflictDoNothing()
      .run();
    ctx.db.update(R).set({ lastSentOccurrenceKey: occ }).where(eq(R.id, r.id)).run();
    if (inserted.changes === 0) continue;
    if (tooLate) {
      out.expired++;
      continue;
    }
    out.delivered++;
    emitEvent(ctx, u.id, 'notification', t.id, { kind: 'reminder', taskId: t.id });
    if (r.channel === 'webpush') pushes.push({ owner: u.id, title: t.title, body: 'Reminder', tag: dedupeKey });
  }
  for (const p of pushes) await sendPush(ctx, p.owner, { title: p.title, body: p.body, url: '/today', tag: p.tag });
  return out;
}

// ---------- morning overview / evening review ----------
const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

/** Sends the optional daily digests once per local day, at or shortly after the chosen time (never as a late backlog). */
export async function digestTick(ctx: AppContext, now: Date = new Date()): Promise<number> {
  let made = 0;
  const pushes: { owner: string; title: string; body: string; tag: string }[] = [];
  for (const u of ctx.db.select().from(schema.users).all()) {
    if (u.disabledAt) continue;
    const prefs = getPreferences(ctx.db, u.id);
    if (prefs['productivity.vacation']) continue;
    const today = todayLocal(u.timezone, now);
    const nowMin = toMinutes(localTimeOf(now, u.timezone));
    for (const kind of ['morning', 'evening'] as const) {
      if (!prefs[`notifications.${kind}Enabled`]) continue;
      const at = toMinutes(String(prefs[`notifications.${kind}Time`] ?? (kind === 'morning' ? '08:00' : '18:00')));
      if (nowMin < at || nowMin - at > 180) continue;
      const dedupeKey = `digest:${u.id}:${kind}:${today}`;
      if (ctx.db.select({ id: schema.notifications.id }).from(schema.notifications).where(and(eq(schema.notifications.ownerUserId, u.id), eq(schema.notifications.dedupeKey, dedupeKey))).get()) continue;
      const v = viewToday(ctx, u, today);
      const open = v.dueToday.length + v.overdue.length;
      const done = v.completedToday.length;
      const title = kind === 'morning' ? 'Good morning: your day ahead' : 'Evening review';
      const body =
        kind === 'morning'
          ? open ? `${open} task${open === 1 ? '' : 's'} on your plate today${v.overdue.length ? `, ${v.overdue.length} overdue` : ''}.` : 'Nothing is due today.'
          : `${done} completed today. ${open ? `${open} still open: reschedule or finish them.` : 'Everything due today is done.'}`;
      const stamp = now.toISOString();
      const ins = ctx.db.insert(schema.notifications).values({ id: newId(), ownerUserId: u.id, kind: 'digest', title, body, scheduledAt: stamp, deliveredAt: stamp, channel: 'inapp', status: 'delivered', dedupeKey, createdAt: stamp }).onConflictDoNothing().run();
      if (ins.changes === 0) continue;
      made++;
      emitEvent(ctx, u.id, 'notification', null, { kind: 'digest' });
      if (prefs['reminders.via'] !== 'inapp') pushes.push({ owner: u.id, title, body, tag: dedupeKey });
    }
  }
  for (const p of pushes) await sendPush(ctx, p.owner, { title: p.title, body: p.body, url: '/today', tag: p.tag });
  return made;
}

/** Snooze: re-deliver a notification's reminder after N minutes (inserted as a new pending reminder notification). */
export function snoozeNotification(ctx: AppContext, ownerId: string, id: string, minutes: number): boolean {
  const N = schema.notifications;
  const n = ctx.db.select().from(N).where(and(eq(N.id, id), eq(N.ownerUserId, ownerId))).get();
  if (!n) return false;
  const at = new Date(Date.now() + minutes * 60_000).toISOString();
  ctx.db.update(N).set({ readAt: n.readAt ?? nowIso() }).where(eq(N.id, id)).run();
  ctx.db.insert(N).values({ id: newId(), ownerUserId: ownerId, kind: n.kind, taskId: n.taskId, title: n.title, body: n.body, scheduledAt: at, channel: n.channel, status: 'pending', dedupeKey: `snooze:${id}:${at}`, createdAt: nowIso() }).onConflictDoNothing().run();
  emitEvent(ctx, ownerId, 'notification', n.taskId, { snoozed: true });
  return true;
}

/** Delivers snoozed notifications whose time has come. */
export async function snoozeTick(ctx: AppContext, now: Date = new Date()): Promise<number> {
  const N = schema.notifications;
  const due = ctx.db.select().from(N).where(and(eq(N.status, 'pending'), lt(N.scheduledAt, new Date(now.getTime() + 1).toISOString()))).all();
  const pushes: { owner: string; title: string; body: string; tag: string }[] = [];
  for (const n of due) {
    const stamp = now.toISOString();
    ctx.db.update(N).set({ status: 'delivered', deliveredAt: stamp }).where(eq(N.id, n.id)).run();
    emitEvent(ctx, n.ownerUserId, 'notification', n.taskId, { kind: n.kind });
    if (n.channel === 'webpush') pushes.push({ owner: n.ownerUserId, title: n.title, body: n.body || 'Reminder', tag: n.dedupeKey });
  }
  for (const p of pushes) await sendPush(ctx, p.owner, { title: p.title, body: p.body, url: '/today', tag: p.tag });
  return due.length;
}

export function listNotifications(ctx: AppContext, ownerId: string, limit = 50) {
  const N = schema.notifications;
  const rows = ctx.db.select().from(N).where(and(eq(N.ownerUserId, ownerId), inArray(N.status, ['delivered', 'expired']))).orderBy(desc(N.createdAt)).limit(limit).all();
  const unread = ctx.db.select({ c: sql<number>`count(*)` }).from(N).where(and(eq(N.ownerUserId, ownerId), eq(N.status, 'delivered'), isNull(N.readAt))).get()?.c ?? 0;
  return {
    unread,
    items: rows.map((n) => ({ id: n.id, kind: n.kind, taskId: n.taskId, title: n.title, body: n.body, status: n.status, createdAt: n.createdAt, readAt: n.readAt })),
  };
}

export function markRead(ctx: AppContext, ownerId: string, id: string | null): void {
  const N = schema.notifications;
  ctx.db.update(N).set({ readAt: nowIso() }).where(and(eq(N.ownerUserId, ownerId), isNull(N.readAt), id ? eq(N.id, id) : undefined)).run();
  emitEvent(ctx, ownerId, 'notification', null, { read: true });
}

export function pruneNotifications(ctx: AppContext): number {
  const cutoff = new Date(Date.now() - 60 * 86_400_000).toISOString();
  return ctx.db.delete(schema.notifications).where(lt(schema.notifications.createdAt, cutoff)).run().changes;
}

export { localDateOf };
