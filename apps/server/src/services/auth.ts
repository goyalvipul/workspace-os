import { createHmac, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, lt, ne, or } from 'drizzle-orm';
import { newId, BUILTIN_TEMPLATES, type UserDTO } from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import { AppError, badRequest } from '../errors.js';
import { hashPassword, verifyPassword, dummyVerify } from '../security/password.js';
import { addMs, DAY, MIN, nowIso, randomToken, safeEqual, sha256 } from '../util.js';
import { userToDTO } from './mappers.js';

export const SESSION_COOKIE = 'wos_session';
export const IDLE_TTL_MS = 14 * DAY;
export const ABSOLUTE_TTL_MS = 60 * DAY;

export type UserRow = typeof schema.users.$inferSelect;
export type SessionRow = typeof schema.sessions.$inferSelect;

export function csrfTokenFor(ctx: AppContext, sessionId: string): string {
  return createHmac('sha256', ctx.env.SESSION_SECRET as string).update(`csrf:${sessionId}`).digest('base64url');
}

export function createSession(ctx: AppContext, userId: string, userAgent: string | undefined): { token: string; session: SessionRow } {
  const token = randomToken(32);
  const id = newId();
  const now = nowIso();
  const csrf = csrfTokenFor(ctx, id);
  ctx.db
    .insert(schema.sessions)
    .values({ id, userId, tokenHash: sha256(token), csrfSecretHash: sha256(csrf), userAgent: userAgent?.slice(0, 300) ?? null, createdAt: now, expiresAt: addMs(now, ABSOLUTE_TTL_MS), lastSeenAt: now })
    .run();
  const session = ctx.db.select().from(schema.sessions).where(eq(schema.sessions.id, id)).get() as SessionRow;
  return { token, session };
}

export function lookupSession(ctx: AppContext, token: string): { session: SessionRow; user: UserRow } | null {
  const row = ctx.db.select().from(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token))).get();
  if (!row || row.revokedAt) return null;
  const now = Date.now();
  if (Date.parse(row.expiresAt) <= now) return null;
  if (Date.parse(row.lastSeenAt) + IDLE_TTL_MS <= now) return null;
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.id, row.userId)).get();
  if (!user || user.disabledAt) return null;
  if (now - Date.parse(row.lastSeenAt) > 5 * MIN) {
    ctx.db.update(schema.sessions).set({ lastSeenAt: nowIso() }).where(eq(schema.sessions.id, row.id)).run();
  }
  return { session: row, user };
}

export function revokeSession(ctx: AppContext, sessionId: string): void {
  ctx.db.update(schema.sessions).set({ revokedAt: nowIso() }).where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt))).run();
}

export function revokeAllSessions(ctx: AppContext, userId: string, exceptId?: string): number {
  const where = and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), exceptId ? ne(schema.sessions.id, exceptId) : undefined);
  return ctx.db.update(schema.sessions).set({ revokedAt: nowIso() }).where(where).run().changes;
}

export function listSessions(ctx: AppContext, userId: string, currentId: string) {
  return ctx.db
    .select()
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt), gt(schema.sessions.expiresAt, nowIso())))
    .all()
    .map((s) => ({ id: s.id, userAgent: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === currentId }));
}

export function pruneSessions(ctx: AppContext): number {
  const cutoff = addMs(nowIso(), -30 * DAY);
  return ctx.db.delete(schema.sessions).where(or(lt(schema.sessions.expiresAt, cutoff), lt(schema.sessions.revokedAt, cutoff))).run().changes;
}

// ---------- login throttling (in memory; resets on restart, which is acceptable for a single-owner app) ----------
const failures = new Map<string, number[]>();
const WINDOW = 15 * MIN;
const MAX_FAILS = 8;

export function throttleKey(ip: string, username: string): string {
  return `${ip}|${username.toLowerCase()}`;
}
export function throttleCheck(key: string): number {
  const now = Date.now();
  const arr = (failures.get(key) ?? []).filter((t) => now - t < WINDOW);
  failures.set(key, arr);
  if (arr.length >= MAX_FAILS) return Math.ceil((WINDOW - (now - (arr[0] as number))) / 1000);
  return 0;
}
export function throttleFail(key: string): void {
  const arr = failures.get(key) ?? [];
  arr.push(Date.now());
  failures.set(key, arr);
}
export function throttleClear(key: string): void {
  failures.delete(key);
}
export function resetThrottleForTests(): void {
  failures.clear();
}

export async function login(ctx: AppContext, username: string, password: string, ip: string, userAgent: string | undefined) {
  const key = throttleKey(ip, username);
  const wait = throttleCheck(key);
  if (wait > 0) throw new AppError(429, 'RATE_LIMITED', 'Too many failed sign-in attempts. Try again later.', undefined, { retryAfterSeconds: wait });
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.username, username.trim().toLowerCase())).get();
  // Same work for unknown users to avoid user enumeration through timing
  const ok = user ? await verifyPassword(user.passwordHash, password) : (await dummyVerify(password), false);
  if (!user || !ok || user.disabledAt) {
    throttleFail(key);
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect username or password');
  }
  throttleClear(key);
  const { token, session } = createSession(ctx, user.id, userAgent);
  return { token, session, user };
}

// ---------- first-run setup ----------
export function ownerExists(ctx: AppContext): boolean {
  return !!ctx.db.select({ id: schema.users.id }).from(schema.users).limit(1).get();
}

const SETUP_KEY = 'setup_code_hash';

/** Generates a fresh one-time setup code (stored hashed). Plaintext is only returned here (printed to the host console). */
export function issueSetupCode(ctx: AppContext): string | null {
  if (ownerExists(ctx)) return null;
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  const raw = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  const code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
  const now = nowIso();
  ctx.db
    .insert(schema.appSettings)
    .values({ key: SETUP_KEY, value: sha256(code), updatedAt: now })
    .onConflictDoUpdate({ target: schema.appSettings.key, set: { value: sha256(code), updatedAt: now } })
    .run();
  return code;
}

export async function createOwner(
  ctx: AppContext,
  input: { setupCode: string; username: string; displayName: string; password: string; timezone: string; theme: 'dark' | 'light' | 'system' },
  ip: string,
): Promise<UserDTO> {
  const key = `bootstrap|${ip}`;
  const wait = throttleCheck(key);
  if (wait > 0) throw new AppError(429, 'RATE_LIMITED', 'Too many attempts. Try again later.');
  const stored = ctx.db.select().from(schema.appSettings).where(eq(schema.appSettings.key, SETUP_KEY)).get();
  const normalized = input.setupCode.trim().toUpperCase();
  if (ownerExists(ctx) || !stored || !safeEqual(sha256(normalized), stored.value)) {
    throttleFail(key);
    throw new AppError(403, 'SETUP_FORBIDDEN', 'Setup is not available or the setup code is wrong');
  }
  const passwordHash = await hashPassword(input.password);
  const now = nowIso();
  const id = newId();
  ctx.db.transaction((tx) => {
    if (tx.select({ id: schema.users.id }).from(schema.users).limit(1).get()) throw new AppError(403, 'SETUP_FORBIDDEN', 'Setup is not available');
    tx.insert(schema.users).values({ id, username: input.username.toLowerCase(), displayName: input.displayName, passwordHash, timezone: input.timezone, theme: input.theme, createdAt: now, updatedAt: now }).run();
    tx.delete(schema.appSettings).where(eq(schema.appSettings.key, SETUP_KEY)).run();
  });
  throttleClear(key);
  return userToDTO(ctx.db.select().from(schema.users).where(eq(schema.users.id, id)).get() as UserRow);
}

export async function changePassword(ctx: AppContext, user: UserRow, currentSessionId: string, current: string, next: string, logoutOthers = true) {
  if (!(await verifyPassword(user.passwordHash, current))) throw new AppError(403, 'INVALID_CREDENTIALS', 'Current password is incorrect');
  if (current === next) throw badRequest('New password must differ from the current one');
  const hash = await hashPassword(next);
  ctx.db.update(schema.users).set({ passwordHash: hash, updatedAt: nowIso() }).where(eq(schema.users.id, user.id)).run();
  // Policy: a password change always invalidates every other session.
  void logoutOthers;
  return revokeAllSessions(ctx, user.id, currentSessionId);
}

export function seedBuiltinTemplates(ctx: AppContext): void {
  const now = nowIso();
  for (const t of BUILTIN_TEMPLATES) {
    const ex = ctx.db.select().from(schema.templates).where(eq(schema.templates.builtinKey, t.key)).get();
    const bodyJson = JSON.stringify(t.body);
    if (!ex) {
      ctx.db.insert(schema.templates).values({ id: newId(), ownerUserId: null, builtinKey: t.key, name: t.name, description: t.description, kind: t.kind, schemaVersion: 1, bodyJson, isBuiltin: true, createdAt: now, updatedAt: now }).run();
    } else if (ex.bodyJson !== bodyJson || ex.name !== t.name) {
      ctx.db.update(schema.templates).set({ name: t.name, description: t.description, bodyJson, updatedAt: now }).where(eq(schema.templates.id, ex.id)).run();
    }
  }
}
