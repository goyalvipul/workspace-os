import { z } from 'zod';
import { ulid } from '@wos/shared';
import type { AppContext } from '../context.js';
import { AppError } from '../errors.js';
import {
  assertInboundEnabled,
  createFromCreatorOS,
  deleteFromCreatorOS,
  getPublished,
  getStatus,
  inboundCreate,
  inboundList,
  inboundPatch,
  listLinkStates,
  listPublished,
  newSecret,
  patchFromCreatorOS,
  publishTasks,
  removeConfig,
  saveConfig,
  sendPing,
  syncNow,
  unpublishTasks,
} from '../services/creatoros.js';
import type { Api } from './kit.js';

const taskIds = z.object({ taskIds: z.array(ulid).min(1).max(200), includeSubtasks: z.boolean().default(true) });
const configBody = z.object({
  webhookUrl: z.string().trim().min(1).max(500),
  enabled: z.boolean().default(true),
  autoLabelId: ulid.nullable().default(null),
  autoProjectId: ulid.nullable().default(null),
  /** Generate a new signing secret (always done the first time). The secret is returned once. */
  rotateSecret: z.boolean().default(false),
});

const idOf = (raw: string | undefined) => {
  const id = ulid.safeParse(raw);
  if (!id.success) throw new AppError(404, 'NOT_FOUND', 'Published task not found');
  return id.data;
};

/**
 * CreatorOS integration.
 *  - Configuration and publishing endpoints need the browser session.
 *  - `/integrations/creatoros/tasks*` also accepts `Authorization: Bearer wos_...` for a token created with scope "creatoros"
 *    (see the onRequest hook in app.ts). Those endpoints can only reach tasks that are published to CreatorOS.
 */
export function registerCreatoros(api: Api, ctx: AppContext) {
  // ---------- owner (browser session) ----------
  api({
    method: 'GET', url: '/integrations/creatoros', summary: 'CreatorOS link status', tag: 'creatoros',
    handler: (c) => ({ status: getStatus(ctx.db, c.user.id) }),
  });
  api({
    method: 'PUT', url: '/integrations/creatoros', summary: 'Create or update the CreatorOS link (the signing secret is returned once, when generated)', tag: 'creatoros',
    body: configBody,
    rateLimit: { max: 30, timeWindow: '1 hour' },
    handler: (c) => {
      const exists = getStatus(ctx.db, c.user.id).configured;
      const secret = !exists || c.body.rotateSecret ? newSecret(ctx, c.user.id) : null;
      c.tx((s) => saveConfig(s, c.body, secret ? { ciphertext: secret.ciphertext, keyVersion: secret.keyVersion } : undefined));
      return { status: getStatus(ctx.db, c.user.id), secret: secret?.plaintext ?? null };
    },
  });
  api({
    method: 'DELETE', url: '/integrations/creatoros', summary: 'Disconnect CreatorOS (removes the link, the queue and all published-task links)', tag: 'creatoros',
    handler: (c) => {
      c.tx((s) => removeConfig(s));
      return { ok: true };
    },
  });
  api({
    method: 'POST', url: '/integrations/creatoros/test', summary: 'Send a signed ping to CreatorOS to check the address and secret', tag: 'creatoros',
    rateLimit: { max: 20, timeWindow: '1 minute' },
    handler: async (c) => {
      const r = await sendPing(ctx, c.user.id);
      return { ok: r.ok, httpStatus: r.status, message: r.ok ? 'CreatorOS accepted the ping.' : r.message };
    },
  });
  api({
    method: 'POST', url: '/integrations/creatoros/sync', summary: 'Retry failed deliveries and send anything CreatorOS does not have yet', tag: 'creatoros',
    rateLimit: { max: 20, timeWindow: '1 minute' },
    handler: (c) => ({ ...c.tx((s) => syncNow(s)), status: getStatus(ctx.db, c.user.id) }),
  });
  api({
    method: 'POST', url: '/integrations/creatoros/publish', summary: 'Publish tasks (and by default their sub-tasks) to CreatorOS', tag: 'creatoros',
    body: taskIds,
    rateLimit: { max: 60, timeWindow: '1 minute' },
    handler: (c) => c.tx((s) => publishTasks(s, c.body.taskIds, c.body.includeSubtasks)),
  });
  api({
    method: 'POST', url: '/integrations/creatoros/unpublish', summary: 'Stop publishing tasks to CreatorOS (CreatorOS is told to remove them)', tag: 'creatoros',
    body: taskIds,
    rateLimit: { max: 60, timeWindow: '1 minute' },
    handler: (c) => c.tx((s) => unpublishTasks(s, c.body.taskIds, c.body.includeSubtasks)),
  });
  api({
    method: 'GET', url: '/integrations/creatoros/links', summary: 'Which tasks are published and whether CreatorOS has the latest version', tag: 'creatoros',
    handler: (c) => ({ items: listLinkStates(ctx.db, c.user.id) }),
  });

  // ---------- CreatorOS (bearer token with scope "creatoros", or the session) ----------
  const inboundLimit = { max: 240, timeWindow: '1 minute' };
  api({
    method: 'GET', url: '/integrations/creatoros/tasks', summary: 'List published tasks (soft-deleted ones included, with deletedAt) for reconciliation, oldest change first', tag: 'creatoros',
    query: inboundList, rateLimit: inboundLimit,
    handler: (c) => {
      assertInboundEnabled(ctx, c.user.id);
      const page = listPublished(ctx, c.user.id, c.query);
      // `tasks` is the name CreatorOS already reads. `items` stays for the documented contract.
      return { ...page, tasks: page.items };
    },
  });
  api({
    method: 'GET', url: '/integrations/creatoros/tasks/:id', summary: 'Get one published task', tag: 'creatoros',
    rateLimit: inboundLimit,
    handler: (c) => {
      assertInboundEnabled(ctx, c.user.id);
      return { task: getPublished(ctx, c.user.id, idOf(c.params.id)) };
    },
  });
  api({
    method: 'POST', url: '/integrations/creatoros/tasks', summary: 'Create a task from CreatorOS (idempotent on externalId; the task is published automatically)', tag: 'creatoros',
    body: inboundCreate, rateLimit: inboundLimit,
    handler: (c) => {
      const r = c.tx((s) => createFromCreatorOS(s, c.body));
      return c.reply.code(r.created ? 201 : 200).send({ task: r.task, created: r.created });
    },
  });
  api({
    method: 'PATCH', url: '/integrations/creatoros/tasks/:id', summary: 'Update or complete a published task. Send baseVersion to detect conflicts.', tag: 'creatoros',
    body: inboundPatch, rateLimit: inboundLimit,
    handler: (c) => {
      const id = idOf(c.params.id);
      return { task: c.tx((s) => patchFromCreatorOS(s, id, c.body)) };
    },
  });
  api({
    method: 'DELETE', url: '/integrations/creatoros/tasks/:id', summary: 'Delete a published task (soft delete, restorable in Workspace OS)', tag: 'creatoros',
    rateLimit: inboundLimit,
    handler: (c) => {
      const id = idOf(c.params.id);
      return { task: c.tx((s) => deleteFromCreatorOS(s, id)) };
    },
  });
}
