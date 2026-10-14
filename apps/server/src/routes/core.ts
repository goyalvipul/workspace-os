import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import {
  bootstrapOwnerInput,
  loginInput,
  passwordChangeInput,
  profilePatchInput,
  isValidTimezone,
} from '@wos/shared';
import type { AppContext } from '../context.js';
import { latestMigrationTag, migrationCount, schema } from '../db/client.js';
import { badRequest, notFound } from '../errors.js';
import {
  SESSION_COOKIE,
  ABSOLUTE_TTL_MS,
  changePassword,
  createOwner,
  createSession,
  csrfTokenFor,
  listSessions,
  login,
  ownerExists,
  revokeAllSessions,
  revokeSession,
} from '../services/auth.js';
import { eventsAfter } from '../services/events.js';
import { patchPreferences, getPreferences } from '../services/workspace.js';
import { snapshot } from '../services/queries.js';
import { userToDTO } from '../services/mappers.js';
import { nowIso } from '../util.js';
import { type Api, routeDocs } from './kit.js';
import { buildOpenApi } from '../openapi.js';

export function setSessionCookie(ctx: AppContext, req: FastifyRequest, reply: FastifyReply, token: string): void {
  reply.setCookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.protocol === 'https',
    path: '/',
    maxAge: Math.floor(ABSOLUTE_TTL_MS / 1000),
  });
}

export function registerCore(app: FastifyInstance, api: Api, ctx: AppContext, state: { schedulerHealthy: () => boolean }) {
  // ---------- health (no secrets, no auth) ----------
  app.get('/api/health/live', async () => ({ status: 'ok' }));
  app.get('/api/health/ready', async (_req, reply) => {
    let dbOk = false;
    let migrationsOk = false;
    try {
      ctx.sqlite.prepare('SELECT 1').get();
      dbOk = true;
      const applied = (ctx.sqlite.prepare('SELECT count(*) AS c FROM __drizzle_migrations').get() as { c: number }).c;
      migrationsOk = applied === migrationCount();
    } catch {
      /* reported below */
    }
    const scheduler = state.schedulerHealthy();
    const ok = dbOk && migrationsOk && scheduler;
    return reply.code(ok ? 200 : 503).send({ status: ok ? 'ready' : 'not_ready', db: dbOk, migrations: migrationsOk, scheduler });
  });

  api({
    method: 'GET', url: '/version', summary: 'Build/version information', tag: 'system', public: true,
    handler: () => ({ version: '1.0.0', gitSha: ctx.env.GIT_SHA, buildTime: ctx.env.BUILD_TIME || null, schemaVersion: migrationCount(), schemaTag: latestMigrationTag() }),
  });

  api({
    method: 'GET', url: '/openapi.json', summary: 'OpenAPI document', tag: 'system',
    handler: () => buildOpenApi(routeDocs),
  });

  // ---------- bootstrap ----------
  api({
    method: 'GET', url: '/bootstrap/status', summary: 'Is first-run setup still available?', tag: 'auth', public: true,
    handler: () => {
      const exists = ownerExists(ctx);
      return { ownerConfigured: exists, setupAllowed: !exists };
    },
  });

  api({
    method: 'POST', url: '/bootstrap/owner', summary: 'Create the owner account (once, needs the setup code from the host console)', tag: 'auth', public: true,
    body: bootstrapOwnerInput, rateLimit: { max: 10, timeWindow: '15 minutes' },
    handler: async (c) => {
      const user = await createOwner(ctx, c.body, c.req.ip);
      const { token, session } = createSession(ctx, user.id, c.req.headers['user-agent']);
      setSessionCookie(ctx, c.req, c.reply, token);
      c.reply.code(201);
      return { user, csrfToken: csrfTokenFor(ctx, session.id) };
    },
  });

  // ---------- auth ----------
  api({
    method: 'POST', url: '/auth/login', summary: 'Sign in', tag: 'auth', public: true,
    body: loginInput, rateLimit: { max: 20, timeWindow: '1 minute' },
    handler: async (c) => {
      // rotate: drop a pre-existing session cookie
      const old = c.req.cookies[SESSION_COOKIE];
      void old;
      const { token, session, user } = await login(ctx, c.body.username, c.body.password, c.req.ip, c.req.headers['user-agent']);
      if (c.req.auth) revokeSession(ctx, c.req.auth.session.id);
      setSessionCookie(ctx, c.req, c.reply, token);
      return { user: userToDTO(user), csrfToken: csrfTokenFor(ctx, session.id) };
    },
  });

  api({
    method: 'GET', url: '/auth/session', summary: 'Current session', tag: 'auth', public: true,
    handler: (c) => {
      if (!c.req.auth) return { authenticated: false, ownerConfigured: ownerExists(ctx) };
      return { authenticated: true, ownerConfigured: true, user: userToDTO(c.req.auth.user), csrfToken: csrfTokenFor(ctx, c.req.auth.session.id), sessionId: c.req.auth.session.id };
    },
  });

  api({
    method: 'POST', url: '/auth/logout', summary: 'Sign out this device', tag: 'auth',
    handler: (c) => {
      revokeSession(ctx, c.session.id);
      c.reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    },
  });

  api({
    method: 'POST', url: '/auth/logout-all', summary: 'Sign out every device', tag: 'auth',
    handler: (c) => {
      const n = revokeAllSessions(ctx, c.user.id);
      c.reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true, revoked: n };
    },
  });

  api({
    method: 'POST', url: '/auth/password', summary: 'Change password (signs out other devices)', tag: 'auth',
    body: passwordChangeInput, rateLimit: { max: 10, timeWindow: '15 minutes' },
    handler: async (c) => {
      const revoked = await changePassword(ctx, c.user, c.session.id, c.body.currentPassword, c.body.newPassword, c.body.logoutOthers);
      return { ok: true, otherSessionsRevoked: revoked };
    },
  });

  api({ method: 'GET', url: '/auth/sessions', summary: 'Active sessions', tag: 'auth', handler: (c) => ({ items: listSessions(ctx, c.user.id, c.session.id) }) });

  api({
    method: 'DELETE', url: '/auth/sessions/:id', summary: 'Revoke one session', tag: 'auth',
    handler: (c) => {
      const row = ctx.db.select().from(schema.sessions).where(eq(schema.sessions.id, c.params.id as string)).get();
      if (!row || row.userId !== c.user.id) throw notFound('Session');
      revokeSession(ctx, row.id);
      if (row.id === c.session.id) c.reply.clearCookie(SESSION_COOKIE, { path: '/' });
      return { ok: true };
    },
  });

  api({
    method: 'POST', url: '/auth/verify-password', summary: 'Re-authenticate for sensitive actions', tag: 'auth',
    body: z.object({ password: z.string().min(1) }), rateLimit: { max: 10, timeWindow: '15 minutes' },
    handler: async (c) => {
      const { verifyPassword } = await import('../security/password.js');
      if (!(await verifyPassword(c.user.passwordHash, c.body.password))) throw new (await import('../errors.js')).AppError(403, 'INVALID_CREDENTIALS', 'Password is incorrect');
      return { ok: true };
    },
  });

  api({
    method: 'PATCH', url: '/user/profile', summary: 'Update profile / appearance / date & time settings', tag: 'user',
    body: profilePatchInput,
    handler: (c) => {
      const b = c.body;
      if (b.timezone && !isValidTimezone(b.timezone)) throw badRequest('Unknown timezone');
      ctx.db.update(schema.users).set({ ...(b.displayName !== undefined ? { displayName: b.displayName } : {}), ...(b.email !== undefined ? { email: b.email ?? null } : {}), ...(b.timezone ? { timezone: b.timezone } : {}), ...(b.weekStartsOn !== undefined ? { weekStartsOn: b.weekStartsOn } : {}), ...(b.theme ? { theme: b.theme } : {}), ...(b.timeFormat ? { timeFormat: b.timeFormat } : {}), updatedAt: nowIso() }).where(eq(schema.users.id, c.user.id)).run();
      const fresh = ctx.db.select().from(schema.users).where(eq(schema.users.id, c.user.id)).get() as typeof schema.users.$inferSelect;
      c.tx((s) => s.ev.emit('preferences.changed', null, { profile: true }));
      return { user: userToDTO(fresh) };
    },
  });

  // ---------- preferences ----------
  api({ method: 'GET', url: '/preferences', summary: 'Typed user preferences', tag: 'user', handler: (c) => ({ preferences: getPreferences(ctx.db, c.user.id) }) });
  api({
    method: 'PATCH', url: '/preferences', summary: 'Update preferences (validated per key)', tag: 'user',
    body: z.record(z.string(), z.unknown()),
    handler: (c) => ({ preferences: c.tx((s) => patchPreferences(s, c.body)) }),
  });

  // ---------- sync snapshot ----------
  api({
    method: 'GET', url: '/sync/snapshot', summary: 'Workspace snapshot / delta for the client store', tag: 'sync',
    query: z.object({ since: z.string().optional() }),
    handler: (c) => snapshot(ctx, c.user, c.query.since),
  });

  // ---------- SSE ----------
  app.get('/api/v1/stream/events', async (req, reply) => {
    if (!req.auth) {
      return reply.code(401).send({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    }
    const user = req.auth.user;
    const q = req.query as { after?: string };
    const hdr = req.headers['last-event-id'];
    const afterRaw = q.after ?? (Array.isArray(hdr) ? hdr[0] : hdr);
    const after = Number(afterRaw ?? 0) || 0;

    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    let lastSent = after;
    const send = (seq: number | null, type: string, data: unknown) => {
      if (seq !== null) {
        if (seq <= lastSent) return;
        lastSent = seq;
      }
      res.write(`${seq !== null ? `id: ${seq}\n` : ''}event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };
    const buffer: import('../context.js').AppEventRow[] = [];
    let replaying = true;
    const onEvent = (e: import('../context.js').AppEventRow) => {
      if (e.ownerUserId !== user.id) return;
      if (replaying) buffer.push(e);
      else send(e.seq, e.eventType, { entityId: e.entityId, ...e.payload });
    };
    ctx.bus.on('event', onEvent);
    ctx.presence.sseClients++;
    res.write('retry: 5000\n\n');
    if (afterRaw !== undefined) {
      const replay = eventsAfter(ctx, user.id, after);
      if (replay.resyncRequired) send(null, 'server.resync_required', {});
      else for (const e of replay.events) send(e.seq, e.eventType, { entityId: e.entityId, ...e.payload });
    }
    replaying = false;
    for (const e of buffer) send(e.seq, e.eventType, { entityId: e.entityId, ...e.payload });
    send(null, 'ready', { serverTime: nowIso() });
    const hb = setInterval(() => res.write(`: heartbeat ${Date.now()}\n\n`), 30_000);
    const cleanup = () => {
      clearInterval(hb);
      ctx.bus.off('event', onEvent);
      ctx.presence.sseClients = Math.max(0, ctx.presence.sseClients - 1);
    };
    req.raw.on('close', cleanup);
    req.raw.on('error', cleanup);
  });
}
