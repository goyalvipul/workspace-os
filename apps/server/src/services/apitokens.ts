import { and, desc, eq, isNull } from 'drizzle-orm';
import { newId } from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import { notFound } from '../errors.js';
import { MIN, nowIso, randomToken, sha256 } from '../util.js';
import type { SessionRow, UserRow } from './auth.js';
import type { Scope } from './tasks.js';

// Personal access tokens for Siri / Apple Shortcuts / Apple Watch. A token is only accepted by the
// /api/v1/capture* endpoints (add a task, read today's list) — it cannot read or change anything else.

export const TOKEN_PREFIX = 'wos_';
const T = schema.apiTokens;

export interface ApiTokenDTO {
  id: string;
  name: string;
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

const toDTO = (r: typeof T.$inferSelect): ApiTokenDTO => ({ id: r.id, name: r.name, hint: r.tokenHint, createdAt: r.createdAt, lastUsedAt: r.lastUsedAt });

export function listApiTokens(ctx: AppContext, ownerId: string): ApiTokenDTO[] {
  return ctx.db.select().from(T).where(and(eq(T.ownerUserId, ownerId), isNull(T.revokedAt))).orderBy(desc(T.createdAt)).all().map(toDTO);
}

/** Creates a token inside the caller's transaction. The plaintext is returned once and never stored. */
export function createApiToken(s: Scope, name: string): { token: string; item: ApiTokenDTO } {
  const token = `${TOKEN_PREFIX}${randomToken(30)}`;
  const id = newId();
  const now = nowIso();
  s.tx.insert(T).values({ id, ownerUserId: s.ownerId, name: name.trim(), tokenHash: sha256(token), tokenHint: `${token.slice(0, 8)}…${token.slice(-4)}`, createdAt: now }).run();
  s.ev.activity({ entityType: 'api_token', entityId: id, action: 'api_token.created', summary: `created an access token: ${name.trim()}` });
  s.ev.emit('settings.changed', id, { apiTokens: true });
  const row = s.tx.select().from(T).where(eq(T.id, id)).get() as typeof T.$inferSelect;
  return { token, item: toDTO(row) };
}

export function revokeApiToken(s: Scope, id: string): void {
  const row = s.tx.select().from(T).where(and(eq(T.id, id), eq(T.ownerUserId, s.ownerId), isNull(T.revokedAt))).get();
  if (!row) throw notFound('Access token');
  s.tx.update(T).set({ revokedAt: nowIso() }).where(eq(T.id, id)).run();
  s.ev.activity({ entityType: 'api_token', entityId: id, action: 'api_token.revoked', summary: `revoked an access token: ${row.name}` });
  s.ev.emit('settings.changed', id, { apiTokens: true });
}

/** Resolves a bearer token to its owner. Returns a synthetic session so the shared request plumbing keeps working. */
export function lookupApiToken(ctx: AppContext, token: string): { user: UserRow; session: SessionRow; tokenId: string } | null {
  if (!token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const row = ctx.db.select().from(T).where(eq(T.tokenHash, sha256(token))).get();
  if (!row || row.revokedAt) return null;
  const user = ctx.db.select().from(schema.users).where(eq(schema.users.id, row.ownerUserId)).get();
  if (!user || user.disabledAt) return null;
  const now = Date.now();
  if (!row.lastUsedAt || now - Date.parse(row.lastUsedAt) > MIN) ctx.db.update(T).set({ lastUsedAt: nowIso() }).where(eq(T.id, row.id)).run();
  const stamp = nowIso();
  const session: SessionRow = { id: `token:${row.id}`, userId: user.id, tokenHash: row.tokenHash, csrfSecretHash: '', userAgent: null, createdAt: row.createdAt, expiresAt: stamp, revokedAt: null, lastSeenAt: stamp };
  return { user, session, tokenId: row.id };
}
