import type { FastifyInstance, FastifyReply, FastifyRequest, HTTPMethods } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { AppError, badRequest, unauthorized } from '../errors.js';
import type { SessionRow, UserRow } from '../services/auth.js';
import { transact, type Emitter } from '../services/tx.js';
import type { Scope } from '../services/tasks.js';

declare module 'fastify' {
  interface FastifyRequest {
    auth: { user: UserRow; session: SessionRow } | null;
    idemKey: string | null;
  }
}

export interface RouteDoc {
  method: string;
  url: string;
  summary: string;
  tag: string;
  public: boolean;
  body?: z.ZodType;
  query?: z.ZodType;
}
export const routeDocs: RouteDoc[] = [];

export interface RouteCtx<B = unknown, Q = unknown> {
  req: FastifyRequest;
  reply: FastifyReply;
  body: B;
  query: Q;
  params: Record<string, string>;
  user: UserRow;
  session: SessionRow;
  app: AppContext;
  /** Run a synchronous domain mutation in one transaction (activity + app_events included). */
  tx<T>(fn: (s: Scope, ev: Emitter) => T): T;
}

export interface RouteSpec<B, Q> {
  method: HTTPMethods;
  url: string; // relative to /api/v1
  summary: string;
  tag: string;
  public?: boolean;
  body?: z.ZodType<B>;
  query?: z.ZodType<Q>;
  status?: number;
  rateLimit?: { max: number; timeWindow: string };
  handler: (c: RouteCtx<B, Q>) => unknown | Promise<unknown>;
}

export function parseWith<T>(schema: z.ZodType<T>, data: unknown, where: 'body' | 'query' = 'body'): T {
  const r = schema.safeParse(data ?? {});
  if (r.success) return r.data;
  throw badRequest(
    where === 'body' ? 'The request body is invalid' : 'The query string is invalid',
    r.error.issues.map((i) => ({ field: i.path.join('.') || where, message: i.message })),
  );
}

export function createApi(app: FastifyInstance, ctx: AppContext, prefix = '/api/v1') {
  return function api<B = unknown, Q = unknown>(spec: RouteSpec<B, Q>): void {
    routeDocs.push({ method: spec.method, url: prefix + spec.url, summary: spec.summary, tag: spec.tag, public: !!spec.public, body: spec.body, query: spec.query });
    app.route({
      method: spec.method,
      url: prefix + spec.url,
      config: { rateLimit: ctx.env.DISABLE_RATE_LIMIT ? false : spec.rateLimit },
      handler: async (req, reply) => {
        if (!spec.public && !req.auth) throw unauthorized();
        const body = spec.body ? parseWith(spec.body, req.body, 'body') : (req.body as B);
        const query = spec.query ? parseWith(spec.query, req.query, 'query') : (req.query as Q);
        const auth = req.auth;
        const c: RouteCtx<B, Q> = {
          req,
          reply,
          body,
          query,
          params: req.params as Record<string, string>,
          user: auth?.user as UserRow,
          session: auth?.session as SessionRow,
          app: ctx,
          tx: (fn) =>
            transact(ctx, (auth as NonNullable<typeof auth>).user.id, (tx, ev) => fn({ tx, ev, ownerId: (auth as NonNullable<typeof auth>).user.id, tz: (auth as NonNullable<typeof auth>).user.timezone }, ev), req.idemKey ?? undefined),
        };
        const result = await spec.handler(c);
        if (reply.sent) return reply;
        if (spec.status) reply.code(spec.status);
        if (result === undefined) return reply.code(spec.status ?? 204).send();
        return reply.send(result);
      },
    });
  };
}

export type Api = ReturnType<typeof createApi>;

export function isUnsafe(method: string): boolean {
  return !['GET', 'HEAD', 'OPTIONS'].includes(method.toUpperCase());
}

export { AppError };
