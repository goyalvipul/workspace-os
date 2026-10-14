import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { calendarPatchInput, dateStr, ulid } from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import { AppError } from '../errors.js';
import { queryEvents } from '../calendar/store.js';
import {
  completeConnect, disconnectAccount, enqueue, getJob, listAccounts, listCalendars, loadOwnedAccount, loadOwnedCalendar,
  providerInfos, requestCalendarSync, requestSyncAll, startConnect, syncStatus, calendarDTO,
} from '../calendar/service.js';
import { emitEvent } from '../services/events.js';
import { nowIso } from '../util.js';
import type { Api } from './kit.js';
import { touchCalendarView } from './workspace.js';

const provider = z.enum(['google', 'microsoft']);

export function registerCalendar(api: Api, ctx: AppContext) {
  api({ method: 'GET', url: '/calendar/providers', summary: 'Providers and whether they are configured', tag: 'calendar', handler: () => ({ items: providerInfos(ctx) }) });
  api({ method: 'GET', url: '/calendar/accounts', summary: 'Connected accounts', tag: 'calendar', handler: (c) => ({ items: listAccounts(ctx, c.user.id) }) });

  api({
    method: 'POST', url: '/calendar/accounts/connect', summary: 'Start OAuth (Authorization Code + PKCE)', tag: 'calendar',
    body: z.object({ provider, reconnectAccountId: ulid.optional() }),
    handler: (c) => startConnect(ctx, c.user.id, c.session.id, c.body.provider, c.body.reconnectAccountId ?? null),
  });

  // OAuth redirect target: top-level GET navigation, SameSite=Lax cookie identifies the session.
  api({
    method: 'GET', url: '/calendar/oauth/:provider/callback', summary: 'OAuth redirect URI', tag: 'calendar', public: true,
    query: z.object({ code: z.string().optional(), state: z.string().optional(), error: z.string().optional(), error_description: z.string().optional() }),
    handler: async (c) => {
      const back = (q: string) => c.reply.redirect(`/settings/accounts?${q}`);
      const p = provider.safeParse(c.params.provider);
      if (!c.req.auth) return c.reply.redirect('/login');
      if (!p.success) return back('error=unknown_provider');
      if (c.query.error) return back(`error=${encodeURIComponent(c.query.error === 'access_denied' ? 'access_denied' : 'provider_error')}`);
      if (!c.query.code || !c.query.state) return back('error=missing_code');
      try {
        await completeConnect(ctx, c.req.auth.user.id, c.req.auth.session.id, p.data, c.query.code, c.query.state);
        return back('connected=1');
      } catch (e) {
        const code = e instanceof AppError ? e.code : 'oauth_failed';
        ctx.log.warn({ code }, 'oauth callback failed');
        return back(`error=${encodeURIComponent(code)}`);
      }
    },
  });

  api({
    method: 'DELETE', url: '/calendar/accounts/:id', summary: 'Disconnect an account; optionally delete cached events', tag: 'calendar',
    query: z.object({ deleteCache: z.enum(['true', 'false']).optional().transform((v) => v === 'true') }),
    handler: async (c) => {
      await disconnectAccount(ctx, c.user.id, c.params.id as string, c.query.deleteCache);
      return { ok: true };
    },
  });
  api({
    method: 'POST', url: '/calendar/accounts/:id/discover', summary: 'Re-discover calendars for an account', tag: 'calendar',
    handler: (c) => {
      loadOwnedAccount(ctx, c.user.id, c.params.id as string);
      const jobId = enqueue(ctx, { kind: 'discover', accountId: c.params.id as string });
      ctx.nudgeSync?.();
      c.reply.code(202);
      return { jobId };
    },
  });

  api({ method: 'GET', url: '/calendar/calendars', summary: 'External calendars', tag: 'calendar', handler: (c) => ({ items: listCalendars(ctx, c.user.id) }) });
  api({
    method: 'PATCH', url: '/calendar/calendars/:id', summary: 'Show/hide, recolor or rename a calendar (local only; providers are never written)', tag: 'calendar', body: calendarPatchInput,
    handler: (c) => {
      const { c: cal, a } = loadOwnedCalendar(ctx, c.user.id, c.params.id as string);
      const b = c.body;
      ctx.db.update(schema.externalCalendars).set({ ...(b.isSelected !== undefined ? { isSelected: b.isSelected } : {}), ...(b.color ? { color: b.color } : {}), ...(b.displayName !== undefined ? { displayName: b.displayName } : {}), updatedAt: nowIso() }).where(eq(schema.externalCalendars.id, cal.id)).run();
      const fresh = ctx.db.select().from(schema.externalCalendars).where(eq(schema.externalCalendars.id, cal.id)).get() as typeof cal;
      if (b.isSelected) {
        enqueue(ctx, { kind: 'sync', calendarId: cal.id });
        ctx.nudgeSync?.();
      }
      emitEvent(ctx, c.user.id, 'calendar.changed', cal.id, { calendars: true });
      return { calendar: calendarDTO(ctx, fresh, a) };
    },
  });

  api({
    method: 'POST', url: '/calendar/sync', summary: 'Sync all selected calendars now', tag: 'calendar',
    handler: (c) => {
      const jobIds = requestSyncAll(ctx, c.user.id);
      ctx.nudgeSync?.();
      c.reply.code(202);
      return { jobIds };
    },
  });
  api({
    method: 'POST', url: '/calendar/calendars/:id/sync', summary: 'Sync one calendar now', tag: 'calendar',
    handler: (c) => {
      const jobId = requestCalendarSync(ctx, c.user.id, c.params.id as string);
      ctx.nudgeSync?.();
      c.reply.code(202);
      return { jobId };
    },
  });
  api({ method: 'GET', url: '/calendar/jobs/:id', summary: 'Sync job status', tag: 'calendar', handler: (c) => ({ job: getJob(ctx, c.user.id, c.params.id as string) }) });
  api({ method: 'GET', url: '/calendar/status', summary: 'Sync diagnostics (redacted)', tag: 'calendar', handler: (c) => syncStatus(ctx, c.user.id) });

  api({
    method: 'GET', url: '/calendar/events', summary: 'Cached read-only events in a date range', tag: 'calendar',
    query: z.object({ start: dateStr, end: dateStr, calendarIds: z.string().optional().transform((v) => (v ? v.split(',').filter(Boolean) : undefined)) }),
    handler: (c) => {
      const refresh = touchCalendarView(ctx, c.user.id, c.query);
      return { items: queryEvents(ctx, c.user, c.query.start, c.query.end, { calendarIds: c.query.calendarIds }), ...refresh };
    },
  });
}
