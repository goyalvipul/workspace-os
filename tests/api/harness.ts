import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp, makeLogger } from '../../apps/server/src/app.js';
import { createContext, openAppDatabase } from '../../apps/server/src/bootstrap.js';
import { loadEnv, type Env } from '../../apps/server/src/config/env.js';
import type { AppContext } from '../../apps/server/src/context.js';
import type { CalendarProvider, ProviderId } from '../../apps/server/src/calendar/types.js';
import { issueSetupCode, seedBuiltinTemplates } from '../../apps/server/src/services/auth.js';

export const ORIGIN = 'http://localhost:4390';
export const PASSWORD = 'Correct-Horse-Battery-9';

export interface Harness {
  app: FastifyInstance;
  ctx: AppContext;
  env: Env;
  dir: string;
  close(): Promise<void>;
  client(): Client;
}

export interface Res<T = any> { status: number; json: T; text: string; headers: Record<string, string | string[] | number | undefined> }

export interface Client {
  cookie: string;
  csrf: string;
  call<T = any>(method: string, url: string, body?: unknown, headers?: Record<string, string>): Promise<Res<T>>;
  signup(username?: string): Promise<void>;
}

export async function startHarness(opts: { providers?: Partial<Record<ProviderId, CalendarProvider>>; env?: Record<string, string> } = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'wos-test-'));
  const env = loadEnv({
    NODE_ENV: 'test',
    DATABASE_PATH: join(dir, 'db.sqlite'),
    BACKUP_DIR: join(dir, 'backups'),
    PUBLIC_BASE_URL: ORIGIN,
    LOG_LEVEL: 'silent',
    DISABLE_RATE_LIMIT: 'true',
    DISABLE_SCHEDULER: 'true',
    ...(opts.env ?? {}),
  } as NodeJS.ProcessEnv);
  const log = makeLogger(env);
  const handle = openAppDatabase(env, log);
  const ctx = createContext({ env, handle, log, providers: opts.providers });
  seedBuiltinTemplates(ctx);
  const app = await buildApp(ctx, { schedulerHealthy: () => true });
  await app.ready();

  const mk = (): Client => {
    const c: Client = {
      cookie: '',
      csrf: '',
      async call(method, url, body, headers = {}) {
        const h: Record<string, string> = { origin: ORIGIN };
        if (c.cookie) h.cookie = c.cookie;
        if (c.csrf && method !== 'GET') h['x-csrf-token'] = c.csrf;
        Object.assign(h, headers); // explicit headers win, so tests can send a bad token or origin
        if (body !== undefined) h['content-type'] = 'application/json';
        const r = await app.inject({ method: method as 'GET', url, headers: h, payload: body === undefined ? undefined : JSON.stringify(body) });
        for (const sc of [r.headers['set-cookie']].flat().filter(Boolean) as string[]) {
          const pair = sc.split(';')[0] as string;
          if (pair.startsWith('wos_session=')) c.cookie = pair.endsWith('=') ? '' : pair;
        }
        let json: any = null;
        try { json = r.body ? JSON.parse(r.body) : null; } catch { /* not json */ }
        return { status: r.statusCode, json, text: r.body, headers: r.headers };
      },
      async signup(username = 'owner') {
        const code = issueSetupCode(ctx);
        const r = await c.call('POST', '/api/v1/bootstrap/owner', { setupCode: code, username, displayName: 'Owner', password: PASSWORD, timezone: 'America/Vancouver', theme: 'dark' });
        if (r.status !== 201) throw new Error(`signup failed ${r.status} ${r.text}`);
        c.csrf = r.json.csrfToken;
      },
    };
    return c;
  };

  return {
    app, ctx, env, dir,
    client: mk,
    async close() {
      await app.close();
      handle.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export const today = (tz = 'America/Vancouver') => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
