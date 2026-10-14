import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import pino from 'pino';
import type { Env } from './config/env.js';
import type { AppContext } from './context.js';
import { AppError } from './errors.js';
import { SESSION_COOKIE, csrfTokenFor, lookupSession } from './services/auth.js';
import { and, eq } from 'drizzle-orm';
import { schema } from './db/client.js';
import { nowIso, safeEqual, sha256 } from './util.js';
import { createApi, isUnsafe } from './routes/kit.js';
import { registerCore } from './routes/core.js';
import { registerWorkspace } from './routes/workspace.js';
import { registerCalendar } from './routes/calendar.js';
import { registerOps } from './routes/ops.js';

export function makeLogger(env: Env) {
  return pino({
    level: env.LOG_LEVEL,
    redact: { paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]', 'req.headers["x-csrf-token"]'], censor: '[redacted]' },
    serializers: {
      // never log query strings: the OAuth callback carries `code` and `state`
      req: (req: { id?: string; method?: string; url?: string }) => ({ id: req.id, method: req.method, url: (req.url ?? '').split('?')[0] }),
    },
  });
}

const IDEMPOTENCY = /^[A-Za-z0-9._:-]{8,100}$/;

export async function buildApp(ctx: AppContext, opts: { schedulerHealthy?: () => boolean } = {}): Promise<FastifyInstance> {
  const env = ctx.env;
  const app = Fastify({
    loggerInstance: ctx.log,
    trustProxy: 'loopback,linklocal,uniquelocal',
    bodyLimit: 4 * 1024 * 1024,
    genReqId: () => Math.random().toString(36).slice(2, 10),
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'self'"],
        'script-src': ["'self'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:', 'blob:'],
        'font-src': ["'self'", 'data:'],
        'connect-src': ["'self'"],
        'manifest-src': ["'self'"],
        'worker-src': ["'self'"],
        'object-src': ["'none'"],
        'base-uri': ["'self'"],
        'form-action': ["'self'"],
        'frame-ancestors': ["'none'"],
      },
    },
    strictTransportSecurity: env.secureCookies ? { maxAge: 15552000, includeSubDomains: false } : false,
    crossOriginEmbedderPolicy: false,
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute', allowList: () => env.DISABLE_RATE_LIMIT });

  app.decorateRequest('auth', null);
  app.decorateRequest('idemKey', null);
  app.decorateRequest('idemHash', null);

  // ---------- auth, origin, csrf, idempotency ----------
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url;
    if (!url.startsWith('/api/')) return;
    reply.header('cache-control', 'no-store');
    const token = req.cookies[SESSION_COOKIE];
    if (token) {
      const found = lookupSession(ctx, token);
      req.auth = found;
      if (!found) reply.clearCookie(SESSION_COOKIE, { path: '/' });
    }
    if (isUnsafe(req.method)) {
      const origin = req.headers.origin;
      if (origin && !env.trustedOrigins.includes(origin)) throw new AppError(403, 'ORIGIN_NOT_ALLOWED', 'Cross-origin request blocked');
      if (req.auth) {
        const sent = req.headers['x-csrf-token'];
        const expected = csrfTokenFor(ctx, req.auth.session.id);
        if (typeof sent !== 'string' || !safeEqual(sent, expected)) throw new AppError(403, 'CSRF_INVALID', 'Missing or invalid CSRF token. Reload the page and try again.');
      }
    }
    const key = req.headers['idempotency-key'];
    if (typeof key === 'string' && key) {
      if (!IDEMPOTENCY.test(key)) throw new AppError(400, 'VALIDATION_ERROR', 'Idempotency-Key must be 8-100 characters (letters, digits, . _ : -)');
      req.idemKey = key;
    }
  });

  // Idempotency: a retried unsafe request with the same key + same body replays the stored 2xx response instead of
  // applying twice (offline outbox retries, flaky mobile networks). Same key with a different body is rejected.
  app.addHook('preHandler', async (req, reply) => {
    if (!req.idemKey || !req.auth || !isUnsafe(req.method)) return;
    const hash = sha256(`${req.method}\n${req.url}\n${JSON.stringify(req.body ?? null)}`);
    const row = ctx.db.select().from(schema.clientMutations).where(and(eq(schema.clientMutations.ownerUserId, req.auth.user.id), eq(schema.clientMutations.clientMutationId, req.idemKey))).get();
    if (row) {
      if (row.requestHash !== hash) throw new AppError(422, 'IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request.');
      return reply.header('idempotent-replay', 'true').code(row.statusCode).type('application/json; charset=utf-8').send(row.responseJson);
    }
    req.idemHash = hash;
  });
  app.addHook('onSend', async (req, reply, payload) => {
    if (!req.idemKey || !req.idemHash || !req.auth || reply.statusCode < 200 || reply.statusCode >= 300) return payload;
    if (typeof payload !== 'string' || !String(reply.getHeader('content-type') ?? '').includes('json')) return payload;
    ctx.db.insert(schema.clientMutations).values({ clientMutationId: req.idemKey, ownerUserId: req.auth.user.id, requestHash: req.idemHash, statusCode: reply.statusCode, responseJson: payload, appliedAt: nowIso() }).onConflictDoNothing().run();
    return payload;
  });

  // ---------- errors ----------
  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown; code?: string }, req, reply) => {
    if (err instanceof AppError) {
      const retry = (err.extra as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (retry) reply.header('retry-after', String(retry));
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message, details: err.details, requestId: req.id, ...err.extra } });
    }
    const status = err.statusCode ?? 500;
    if (status === 429) return reply.code(429).send({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Slow down and try again shortly.', requestId: req.id } });
    if (status === 413) return reply.code(413).send({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'The request is too large', requestId: req.id } });
    if (status >= 400 && status < 500) return reply.code(status).send({ error: { code: 'VALIDATION_ERROR', message: err.message, requestId: req.id } });
    req.log.error({ err: { message: err.message, stack: env.isProd ? undefined : err.stack } }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong on the server', requestId: req.id } });
  });

  // ---------- routes ----------
  const api = createApi(app, ctx);
  registerCore(app, api, ctx, { schedulerHealthy: opts.schedulerHealthy ?? (() => true) });
  registerWorkspace(api, ctx);
  registerCalendar(api, ctx);
  registerOps(api, ctx);

  // ---------- static SPA ----------
  const dist = env.WEB_DIST_DIR ? resolve(env.WEB_DIST_DIR) : resolve(process.cwd(), 'apps/web/dist');
  const hasWeb = existsSync(join(dist, 'index.html'));
  if (hasWeb) {
    const indexPath = join(dist, 'index.html');
    // Read per request (tiny file) so a web rebuild is picked up without restarting the server; a cached copy would point at deleted hashed assets.
    const indexHtml = () => readFileSync(indexPath);
    await app.register(fastifyStatic, {
      root: dist,
      wildcard: false,
      index: false,
      setHeaders: (res, path) => {
        if (/(^|[\\/])(sw\.js|workbox-[^\\/]+\.js|index\.html|manifest\.webmanifest|registerSW\.js)$/.test(path)) res.setHeader('cache-control', 'no-cache, no-transform');
        else if (/[\\/]assets[\\/]/.test(path)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
      },
    });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'No such endpoint', requestId: req.id } });
      if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Not found', requestId: req.id } });
      // a missing asset must stay a 404 rather than turning into the app shell
      if (/\.[A-Za-z0-9]{1,8}$/.test(req.url.split('?')[0] as string)) return reply.code(404).send('Not found');
      return reply.header('cache-control', 'no-cache, no-transform').type('text/html; charset=utf-8').send(indexHtml());
    });
  } else {
    app.setNotFoundHandler((req, reply) =>
      reply.code(404).send({ error: { code: 'NOT_FOUND', message: req.url.startsWith('/api/') ? 'No such endpoint' : 'The web app has not been built (run pnpm build)', requestId: req.id } }),
    );
  }
  return app;
}
