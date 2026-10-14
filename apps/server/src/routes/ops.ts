import { createReadStream } from 'node:fs';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { newId, ulid } from '@wos/shared';
import type { AppContext } from '../context.js';
import { schema } from '../db/client.js';
import { AppError, badRequest } from '../errors.js';
import { verifyPassword } from '../security/password.js';
import { backupFilePath, listBackups, runBackup } from '../services/backup.js';
import {
  applyImportPlan, buildImportPlan, exportTasksCsv, exportWorkspace, importWorkspaceJson, planSummary, signImportToken, verifyImportToken,
} from '../services/dataio.js';
import { countPushSubscriptions, listNotifications, markRead, pushConfigured, removePushSubscription, savePushSubscription, snoozeNotification } from '../services/notifications.js';
import { nowIso, sha256 } from '../util.js';
import { transact } from '../services/tx.js';
import type { Api } from './kit.js';

const importKind = z.enum(['todoist_csv', 'wos_csv']);

export function registerOps(api: Api, ctx: AppContext) {
  // ---------- exports ----------
  api({
    method: 'GET', url: '/export/workspace.json', summary: 'Full workspace export (no secrets, no tokens)', tag: 'data-io',
    handler: (c) => {
      c.reply.header('content-disposition', `attachment; filename="workspace-os-export-${nowIso().slice(0, 10)}.json"`);
      return exportWorkspace(ctx, c.user);
    },
  });
  api({
    method: 'GET', url: '/export/tasks.csv', summary: 'Tasks as CSV (formula-injection safe)', tag: 'data-io',
    handler: (c) => {
      c.reply.header('content-type', 'text/csv; charset=utf-8');
      c.reply.header('content-disposition', `attachment; filename="workspace-os-tasks-${nowIso().slice(0, 10)}.csv"`);
      return exportTasksCsv(ctx, c.user);
    },
  });

  // ---------- imports ----------
  const importBody = z.object({ kind: importKind, content: z.string().min(1), projectName: z.string().max(100).optional(), previewToken: z.string().optional() });
  api({
    method: 'POST', url: '/imports/preview', summary: 'Dry-run a CSV import', tag: 'data-io', body: importBody,
    handler: (c) => {
      const plan = buildImportPlan(ctx, c.user, c.body.kind, c.body.content, { projectName: c.body.projectName });
      const summary = planSummary(plan);
      ctx.db.insert(schema.importRuns).values({ id: newId(), ownerUserId: c.user.id, sourceType: c.body.kind, checksum: sha256(c.body.content), dryRunSummaryJson: JSON.stringify(summary), status: 'previewed', createdAt: nowIso(), updatedAt: nowIso() }).run();
      return { summary, previewToken: signImportToken(ctx, c.user.id, c.body.kind, c.body.content, c.body.projectName ?? '') };
    },
  });
  api({
    method: 'POST', url: '/imports/apply', summary: 'Apply a previewed CSV import (needs the preview token)', tag: 'data-io', body: importBody,
    handler: (c) => {
      if (!c.body.previewToken || !verifyImportToken(ctx, c.user.id, c.body.kind, c.body.content, c.body.projectName ?? '', c.body.previewToken)) {
        throw new AppError(400, 'IMPORT_NOT_PREVIEWED', 'Preview this exact file first, then apply (preview tokens expire after 15 minutes).');
      }
      const plan = buildImportPlan(ctx, c.user, c.body.kind, c.body.content, { projectName: c.body.projectName });
      const result = c.tx((s) => applyImportPlan(s, plan));
      const checksum = sha256(c.body.content);
      const run = ctx.db.select().from(schema.importRuns).where(and(eq(schema.importRuns.ownerUserId, c.user.id), eq(schema.importRuns.checksum, checksum))).orderBy(desc(schema.importRuns.createdAt)).get();
      if (run) ctx.db.update(schema.importRuns).set({ status: 'applied', appliedCount: result.created, updatedAt: nowIso() }).where(eq(schema.importRuns.id, run.id)).run();
      return { ...result, duplicatesSkipped: plan.duplicates };
    },
  });
  api({
    method: 'POST', url: '/imports/workspace', summary: 'Restore a workspace JSON export (merge; reports id conflicts)', tag: 'data-io',
    body: z.object({ data: z.unknown(), confirm: z.literal(true) }),
    handler: (c) => c.tx((s) => importWorkspaceJson(s, c.body.data)),
  });

  // ---------- backups ----------
  api({ method: 'GET', url: '/backups', summary: 'Backup history', tag: 'backups', handler: () => ({ items: listBackups(ctx) }) });
  api({
    method: 'POST', url: '/backups', summary: 'Create a backup now', tag: 'backups', rateLimit: { max: 6, timeWindow: '1 hour' },
    handler: async (c) => {
      const b = await runBackup(ctx, 'manual');
      c.reply.code(b.status === 'ok' ? 201 : 500);
      return { backup: b };
    },
  });
  // POST (not GET) so the owner's password can be required to download a data-bearing file.
  api({
    method: 'POST', url: '/backups/:id/download', summary: 'Download a backup (password re-entry required)', tag: 'backups',
    body: z.object({ password: z.string().min(1) }), rateLimit: { max: 10, timeWindow: '15 minutes' },
    handler: async (c) => {
      if (!(await verifyPassword(c.user.passwordHash, c.body.password))) throw new AppError(403, 'INVALID_CREDENTIALS', 'Password is incorrect');
      const f = backupFilePath(ctx, c.params.id as string);
      c.reply.header('content-type', 'application/gzip');
      c.reply.header('content-disposition', `attachment; filename="${f.filename}"`);
      return c.reply.send(createReadStream(f.path));
    },
  });

  // ---------- notifications / push ----------
  api({
    method: 'GET', url: '/notifications', summary: 'In-app notifications', tag: 'notifications',
    handler: (c) => {
      return listNotifications(ctx, c.user.id);
    },
  });
  api({ method: 'POST', url: '/notifications/read', summary: 'Mark one (or all) notifications read', tag: 'notifications', body: z.object({ id: ulid.nullable().default(null) }), handler: (c) => { markRead(ctx, c.user.id, c.body.id); return { ok: true }; } });

  api({
    method: 'POST', url: '/notifications/:id/snooze', summary: 'Snooze a reminder (re-delivers after N minutes)', tag: 'notifications',
    body: z.object({ minutes: z.number().int().min(1).max(1440) }),
    handler: (c) => {
      const id = ulid.safeParse(c.params.id);
      if (!id.success || !snoozeNotification(ctx, c.user.id, id.data, c.body.minutes)) throw new AppError(404, 'NOT_FOUND', 'Notification not found');
      return { ok: true };
    },
  });

  api({
    method: 'GET', url: '/push/config', summary: 'Web-push availability + VAPID public key', tag: 'notifications',
    handler: (c) => ({ configured: pushConfigured(ctx), publicKey: pushConfigured(ctx) ? ctx.env.VAPID_PUBLIC_KEY : null, subscriptions: countPushSubscriptions(ctx, c.user.id) }),
  });
  api({
    method: 'POST', url: '/push/subscribe', summary: 'Register this device for web push', tag: 'notifications',
    body: z.object({ endpoint: z.string().url().max(2000), keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }), deviceName: z.string().max(100).nullish() }),
    handler: (c) => {
      if (!pushConfigured(ctx)) throw new AppError(503, 'PUSH_NOT_CONFIGURED', 'Web push is not configured on this server (VAPID keys missing).');
      try {
        const id = savePushSubscription(ctx, c.user.id, { endpoint: c.body.endpoint, keys: c.body.keys }, c.body.deviceName ?? null);
        c.reply.code(201);
        return { id };
      } catch {
        throw badRequest('That push endpoint is not valid (must be https)');
      }
    },
  });
  api({ method: 'POST', url: '/push/unsubscribe', summary: 'Remove this device', tag: 'notifications', body: z.object({ endpoint: z.string().url() }), handler: (c) => { removePushSubscription(ctx, c.user.id, c.body.endpoint); return { ok: true }; } });
  api({
    method: 'POST', url: '/push/test', summary: 'Send a test notification', tag: 'notifications', rateLimit: { max: 5, timeWindow: '1 minute' },
    handler: async (c) => {
      const { sendPush } = await import('../services/notifications.js');
      if (!pushConfigured(ctx)) throw new AppError(503, 'PUSH_NOT_CONFIGURED', 'Web push is not configured on this server.');
      return sendPush(ctx, c.user.id, { title: 'Workspace OS', body: 'Test notification - push is working.', url: '/', tag: 'test' });
    },
  });

  void transact;
}
