# CreatorOS integration

Workspace OS publishes selected tasks to CreatorOS and accepts changes back. Both apps run on your own network. This page is the contract CreatorOS has to implement.

```
Workspace OS  --- signed webhook (task.upsert / task.remove / ping) --->  CreatorOS   (you build: 1 endpoint)
Workspace OS  <--- REST with a scoped Bearer token (list/create/patch/delete) ---  CreatorOS   (already built in Workspace OS)
```

Two independent credentials, so neither side can impersonate the other:

| Direction | Credential | Created in | Stored by Workspace OS |
| --- | --- | --- | --- |
| Workspace OS to CreatorOS | Signing secret `wos_whsec_...` (HMAC-SHA256) | Settings > CreatorOS > Connect (shown once) | AES-256-GCM encrypted (`DATA_ENCRYPTION_KEY`) |
| CreatorOS to Workspace OS | Access token `wos_...` with scope `creatoros` | Settings > CreatorOS > Create access token (shown once) | SHA-256 hash only |

A `creatoros` token is accepted on `/api/v1/integrations/creatoros/tasks*` and nowhere else. A Siri/Shortcuts token (`capture` scope) is rejected there. The link can be paused at any time (Settings > CreatorOS > Publishing on): the queue is dropped and inbound calls return `409 CREATOROS_DISABLED`.

## 1. What gets published

- **Manually**: open a task, `...` menu, *Publish to CreatorOS* (sub-tasks go with it). API: `POST /integrations/creatoros/publish { taskIds, includeSubtasks? }`. *Stop publishing* sends `task.remove` with `reason: "unpublished"`.
- **Automatically**: pick a label and/or a project in the settings. Open tasks that carry the label or sit in the project are published when created, when they gain the label, and when *Sync now* is pressed. Note: if a task still matches a rule, unpublishing it by hand is undone by its next edit. Remove the label or change the rule instead.
- Every change to a published task (edit, move, complete, archive, reopen) is queued in the same database transaction as the change, so nothing is lost if the app restarts. Rapid edits coalesce into one message carrying the latest state.
- Deleting a task sends `task.remove` with `reason: "deleted"`. Restoring it sends `task.upsert` again.

## 2. Webhook CreatorOS must expose

Any URL you choose; paste it into *CreatorOS webhook address*. Workspace OS sends `POST` with a JSON body and these headers:

| Header | Meaning |
| --- | --- |
| `X-WOS-Event-Id` | Unique per message. Same id on every retry, so use it to deduplicate. |
| `X-WOS-Timestamp` | Unix seconds when it was signed. |
| `X-WOS-Signature` | `v1=` + hex `HMAC_SHA256(secret, timestamp + "." + rawBody)` |

**Verify before parsing**: recompute the HMAC over the *raw* body bytes, compare in constant time, and reject timestamps more than 5 minutes old (replay protection). Return `401` or `403` when it does not match.

Reply `2xx` to acknowledge. The reply body is optional; if it is `{ "externalId": "<your id>" }` that id is stored against the task and sent back as `externalId` in later messages. Reply `5xx`, `408`, `425` or `429` to ask for a retry. Any other `4xx` (and any redirect) is treated as permanent for that message. Redirects are not followed.

Retries: after 5 s, 10 s, 20 s ... capped at 15 minutes, up to 10 attempts, then the message shows as failed in Settings. *Sync now* retries failed ones.

### Messages

`ping` (Settings > Send test):

```json
{ "id": "ping:01J...", "type": "ping", "occurredAt": "2026-10-24T08:00:00.000Z", "app": "workspace-os" }
```

`task.upsert` (create or update, keyed by `task.id`):

```json
{
  "id": "01J8...:3:task.upsert",
  "type": "task.upsert",
  "occurredAt": "2026-10-24T08:00:00.000Z",
  "task": {
    "id": "01J8...", "externalId": "co_123", "title": "Shoot video", "description": "markdown",
    "status": "open", "priority": 2, "completedAt": null,
    "dueDate": "2026-10-25", "dueAtUtc": "2026-10-25T16:00:00.000Z", "dueTimezone": "America/Vancouver",
    "scheduledDate": null, "scheduledAtUtc": null, "deadlineDate": null, "estimateMinutes": 90,
    "recurrence": { "rule": "FREQ=WEEKLY;BYDAY=MO", "mode": "fixed" },
    "projectId": "01J8...", "projectName": "Channel", "parentTaskId": null, "labels": ["creatoros"],
    "createdAt": "...", "updatedAt": "...", "deletedAt": null, "version": 3
  }
}
```

`status` is `open`, `completed` or `archived`. A recurring task stays `open` when completed and moves to its next due date. `version` increases on every change; ignore a message whose `version` is lower than what you hold for that `task.id`.

`task.remove`:

```json
{ "id": "01J8...:4:task.remove", "type": "task.remove", "occurredAt": "...", "reason": "unpublished", "task": { "id": "01J8...", "externalId": "co_123", "version": 4 } }
```

`reason` is `unpublished` or `deleted`.

### Minimal receiver (Node, no framework)

```js
import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

const SECRET = process.env.WOS_SIGNING_SECRET; // wos_whsec_...

createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    const ts = String(req.headers['x-wos-timestamp'] ?? '');
    const want = 'v1=' + createHmac('sha256', SECRET).update(`${ts}.${raw}`).digest('hex');
    const got = String(req.headers['x-wos-signature'] ?? '');
    const ok = got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want)) && Math.abs(Date.now() / 1000 - Number(ts)) < 300;
    if (!ok) return res.writeHead(401).end();
    const msg = JSON.parse(raw);
    // msg.type: 'ping' | 'task.upsert' | 'task.remove'. Upsert/delete by msg.task.id, ignore stale msg.task.version.
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ externalId: msg.task ? `co_${msg.task.id}` : undefined }));
  });
}).listen(3001, '0.0.0.0');
```

## 3. REST API CreatorOS can call

Base: `{WORKSPACE_OS_ADDRESS}/api/v1/integrations/creatoros`. Header: `Authorization: Bearer wos_...`. JSON in and out. Errors use the standard `{ "error": { "code", "message" } }` shape. Only published tasks are reachable; anything else is `404`.

| Call | Purpose |
| --- | --- |
| `GET /tasks?limit=200&cursor=` | All published tasks, oldest change first, soft-deleted ones included with `deletedAt`. The list is in `items` (also copied to `tasks`). Follow `nextCursor` until `null`. Use on startup and periodically to reconcile missed webhooks. |
| `GET /tasks/:id` | One published task (`:id` is the Workspace OS task id). |
| `POST /tasks` | Create a task. Body: `externalId` (required, your id), `title` (required), optional `description`, `priority` (1 is highest, 4 lowest), `projectId`, `labelIds`, `dueDate`, `dueAtUtc`, `dueTimezone`, `scheduledDate`, `scheduledAtUtc`, `deadlineDate`, `estimateMinutes`. Returns `201 { task, created: true }`, or `200 { created: false }` if that `externalId` already exists, so retries are safe. The task is published automatically. |
| `PATCH /tasks/:id` | Any of the fields above, plus `status` (`open`, `completed`, `archived`), `externalId`, and `baseVersion`. Null clears a date. |
| `DELETE /tasks/:id` | Soft delete (restorable in Workspace OS). |

**Conflicts.** Send `baseVersion` (the `version` you last received). If the task changed since, you get `409 VERSION_CONFLICT` with the current task in `error.current`; merge and retry. Omit `baseVersion` for last-writer-wins.

**No echo.** Changes made through this API are marked as already synced, so Workspace OS does not send them back to your webhook. A later edit made in Workspace OS is sent as usual.

Example:

```bash
curl -X PATCH "$WOS/api/v1/integrations/creatoros/tasks/$TASK_ID" \
  -H "Authorization: Bearer $WOS_TOKEN" -H 'Content-Type: application/json' \
  -d '{"baseVersion":3,"status":"completed"}'
```

## 4. Networking on one Ubuntu machine

- Workspace OS runs in Docker and publishes on `100.108.120.8:4390` (see `compose.yaml`). CreatorOS must call that address (or your LAN address), not `localhost`.
- For Workspace OS to reach CreatorOS, use the machine's LAN or Tailscale IP and CreatorOS's port. Inside the container `localhost` is the container itself, and a CreatorOS bound to `127.0.0.1` on the host is not reachable from it: bind it to `0.0.0.0` or the LAN/Tailscale IP. (If you prefer a name, add `extra_hosts: ["host.docker.internal:host-gateway"]` to the compose service and use `http://host.docker.internal:<port>/...`.)
- Plain `http://` is accepted for private networks. Use `https://` if the traffic leaves a network you trust. Workspace OS rejects addresses with embedded credentials and link-local/metadata addresses, and does not follow redirects.
- When the CreatorOS call to Workspace OS carries an `Origin` header it must be in `TRUSTED_ORIGINS`/`PUBLIC_BASE_URL`; server-to-server calls normally send none.

## 5. Operating it

- Settings > CreatorOS shows published / waiting / failed counts, the last delivery time and the last error.
- *New secret* invalidates the old one immediately. *Disconnect* deletes the address, secret, queue and links, but never touches your tasks.
- The activity log records `creatoros.configured`, `published`, `unpublished`, `received` and `disconnected`. The secret and tokens are never logged.
