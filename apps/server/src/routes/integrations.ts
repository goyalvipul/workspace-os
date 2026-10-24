import { z } from 'zod';
import { ulid } from '@wos/shared';
import type { AppContext } from '../context.js';
import { AppError } from '../errors.js';
import { createApiToken, listApiTokens, revokeApiToken } from '../services/apitokens.js';
import { captureTask, todaySummary, todayTaskIds, updateTodayNote } from '../services/capture.js';
import type { Api } from './kit.js';

const formatQuery = z.object({ format: z.enum(['json', 'text']).optional() });

/** Siri / Apple Shortcuts / Apple Watch integration: personal access tokens plus the two capture endpoints they may call. */
export function registerIntegrations(api: Api, ctx: AppContext) {
  api({
    method: 'GET', url: '/api-tokens', summary: 'List personal access tokens (never returns the secret)', tag: 'integrations',
    handler: (c) => ({ items: listApiTokens(ctx, c.user.id) }),
  });
  api({
    method: 'POST', url: '/api-tokens', summary: 'Create a personal access token (scope "capture" for Siri / Shortcuts, "creatoros" for CreatorOS; the secret is shown once)', tag: 'integrations',
    body: z.object({ name: z.string().trim().min(1).max(60), scope: z.enum(['capture', 'creatoros']).default('capture') }), status: 201,
    rateLimit: { max: 20, timeWindow: '1 hour' },
    handler: (c) => c.tx((s) => createApiToken(s, c.body.name, c.body.scope)),
  });
  api({
    method: 'DELETE', url: '/api-tokens/:id', summary: 'Revoke a personal access token', tag: 'integrations',
    handler: (c) => {
      const id = ulid.safeParse(c.params.id);
      if (!id.success) throw new AppError(404, 'NOT_FOUND', 'Access token not found');
      c.tx((s) => revokeApiToken(s, id.data));
      return { ok: true };
    },
  });

  // These accept either the browser session or `Authorization: Bearer wos_...` (see the onRequest hook in app.ts).
  api({
    method: 'POST', url: '/capture', summary: 'Quick-capture a task from natural language (Siri, Shortcuts, Apple Watch)', tag: 'integrations',
    body: z.object({ text: z.string().trim().min(1).max(500) }), query: formatQuery, status: 201,
    rateLimit: { max: 60, timeWindow: '1 minute' },
    handler: (c) => {
      const r = c.tx((s) => captureTask(s, c.body.text));
      if (c.query.format === 'text') return c.reply.code(201).type('text/plain; charset=utf-8').send(r.message);
      return { ok: true, message: r.message, task: r.task };
    },
  });
  api({
    method: 'POST', url: '/capture/note', summary: "Replace the note on one of today's tasks, numbered as in GET /capture/today (Siri, Shortcuts, Apple Watch)", tag: 'integrations',
    body: z.object({ index: z.coerce.number().int().min(1).max(25), text: z.string().trim().min(1).max(20000) }),
    rateLimit: { max: 60, timeWindow: '1 minute' },
    handler: (c) => {
      const id = todayTaskIds(ctx, c.user)[c.body.index - 1];
      if (!id) throw new AppError(400, 'VALIDATION_ERROR', 'That number is not on today\'s list');
      const r = c.tx((s) => updateTodayNote(s, id, c.body.text));
      return { ok: true, message: r.message };
    },
  });
  api({
    method: 'GET', url: '/capture/today', summary: "Today's tasks as a speakable list (Siri, Shortcuts, Apple Watch)", tag: 'integrations',
    query: formatQuery,
    rateLimit: { max: 60, timeWindow: '1 minute' },
    handler: (c) => {
      const t = todaySummary(ctx, c.user);
      if (c.query.format === 'text') return c.reply.type('text/plain; charset=utf-8').send(t.text);
      return t;
    },
  });
}
