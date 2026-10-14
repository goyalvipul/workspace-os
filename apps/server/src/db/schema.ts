import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

// Conventions: ids are ULIDs (client-generatable), timestamps are ISO-8601 UTC text,
// local dates are 'YYYY-MM-DD' text, booleans are 0/1 integers.

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull().unique(),
  email: text('email').unique(),
  displayName: text('display_name').notNull(),
  passwordHash: text('password_hash').notNull(),
  timezone: text('timezone').notNull().default('America/Vancouver'),
  weekStartsOn: integer('week_starts_on').notNull().default(1),
  theme: text('theme').notNull().default('dark'),
  timeFormat: text('time_format').notNull().default('12h'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  disabledAt: text('disabled_at'),
});

export const sessions = sqliteTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    csrfSecretHash: text('csrf_secret_hash').notNull(),
    userAgent: text('user_agent'),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    revokedAt: text('revoked_at'),
    lastSeenAt: text('last_seen_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId, t.revokedAt)],
);

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    parentProjectId: text('parent_project_id').references((): any => projects.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    outcome: text('outcome').notNull().default(''),
    color: text('color').notNull().default('#8b8d98'),
    icon: text('icon'),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    archivedAt: text('archived_at'),
    sortOrder: integer('sort_order').notNull().default(0),
    defaultView: text('default_view').notNull().default('list'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('projects_owner_idx').on(t.ownerUserId, t.archivedAt, t.sortOrder),
    check('projects_not_self_parent', sql`${t.parentProjectId} IS NULL OR ${t.parentProjectId} <> ${t.id}`),
  ],
);

export const sections = sqliteTable(
  'sections',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: text('archived_at'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    version: integer('version').notNull().default(1),
  },
  (t) => [index('sections_project_idx').on(t.projectId, t.sortOrder)],
);

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    // NULL project = Inbox (virtual). Deleting a project never cascades to tasks (service moves them first).
    projectId: text('project_id').references(() => projects.id, { onDelete: 'restrict' }),
    sectionId: text('section_id').references(() => sections.id, { onDelete: 'set null' }),
    parentTaskId: text('parent_task_id').references((): any => tasks.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    priority: integer('priority').notNull().default(4),
    status: text('status').notNull().default('open'),
    position: text('position').notNull().default('0000001000'),
    scheduledDate: text('scheduled_date'),
    scheduledAtUtc: text('scheduled_at_utc'),
    dueDate: text('due_date'),
    dueAtUtc: text('due_at_utc'),
    dueTimezone: text('due_timezone'),
    deadlineDate: text('deadline_date'),
    estimateMinutes: integer('estimate_minutes'),
    recurrenceRule: text('recurrence_rule'),
    recurrenceMode: text('recurrence_mode').notNull().default('fixed'),
    recurrenceAnchor: text('recurrence_anchor'),
    recurrenceTimezone: text('recurrence_timezone'),
    nextOccurrenceKey: text('next_occurrence_key'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at'),
    deletedAt: text('deleted_at'),
    version: integer('version').notNull().default(1),
  },
  (t) => [
    index('tasks_owner_status_idx').on(t.ownerUserId, t.status, t.deletedAt),
    index('tasks_due_date_idx').on(t.ownerUserId, t.dueDate),
    index('tasks_due_at_idx').on(t.dueAtUtc),
    index('tasks_scheduled_idx').on(t.ownerUserId, t.scheduledDate),
    index('tasks_position_idx').on(t.ownerUserId, t.projectId, t.sectionId, t.position),
    index('tasks_parent_idx').on(t.parentTaskId),
    index('tasks_updated_idx').on(t.ownerUserId, t.updatedAt),
    check('tasks_priority_range', sql`${t.priority} BETWEEN 1 AND 4`),
    check('tasks_title_nonempty', sql`length(trim(${t.title})) > 0`),
    check('tasks_not_own_parent', sql`${t.parentTaskId} IS NULL OR ${t.parentTaskId} <> ${t.id}`),
    check('tasks_status_valid', sql`${t.status} IN ('open','completed','archived')`),
    check('tasks_version_min', sql`${t.version} >= 1`),
  ],
);

export const taskCompletions = sqliteTable(
  'task_completions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    occurrenceKey: text('occurrence_key').notNull(),
    completedAt: text('completed_at').notNull(),
    originalDueDate: text('original_due_date'),
    originalDueAtUtc: text('original_due_at_utc'),
    completedBy: text('completed_by').notNull(),
    undoneAt: text('undone_at'),
  },
  (t) => [
    // One ACTIVE completion per (task, occurrence). Undone rows are history.
    uniqueIndex('task_completions_active_uq').on(t.taskId, t.occurrenceKey).where(sql`${t.undoneAt} IS NULL`),
    index('task_completions_owner_idx').on(t.ownerUserId, t.completedAt),
  ],
);

export const labels = sqliteTable(
  'labels',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    nameLower: text('name_lower').notNull(),
    color: text('color').notNull().default('#8b8d98'),
    sortOrder: integer('sort_order').notNull().default(0),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('labels_owner_name_uq').on(t.ownerUserId, t.nameLower)],
);

export const taskLabels = sqliteTable(
  'task_labels',
  {
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    labelId: text('label_id').notNull().references(() => labels.id, { onDelete: 'cascade' }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.labelId] }), index('task_labels_label_idx').on(t.labelId)],
);

export const taskComments = sqliteTable(
  'task_comments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    body: text('body').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [index('task_comments_task_idx').on(t.taskId, t.createdAt)],
);

export const taskReminders = sqliteTable(
  'task_reminders',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'relative' | 'absolute'
    offsetMinutes: integer('offset_minutes'),
    atUtc: text('at_utc'),
    timezone: text('timezone').notNull(),
    channel: text('channel').notNull().default('inapp'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
    lastSentOccurrenceKey: text('last_sent_occurrence_key'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('task_reminders_task_idx').on(t.taskId)],
);

export const savedFilters = sqliteTable(
  'saved_filters',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    filterAstJson: text('filter_ast_json').notNull(),
    sort: text('sort').notNull().default('position'),
    favorite: integer('favorite', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('saved_filters_owner_idx').on(t.ownerUserId)],
);

export const templates = sqliteTable(
  'templates',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').references(() => users.id, { onDelete: 'cascade' }),
    builtinKey: text('builtin_key').unique(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    kind: text('kind').notNull(),
    schemaVersion: integer('schema_version').notNull().default(1),
    bodyJson: text('body_json').notNull(),
    isBuiltin: integer('is_builtin', { mode: 'boolean' }).notNull().default(false),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [index('templates_owner_idx').on(t.ownerUserId)],
);

export const userPreferences = sqliteTable(
  'user_preferences',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    jsonValue: text('json_value').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.key] })],
);

export const activityEvents = sqliteTable(
  'activity_events',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').notNull(),
    entityId: text('entity_id').notNull(),
    projectId: text('project_id'),
    action: text('action').notNull(),
    publicSummary: text('public_summary').notNull(),
    deltaJson: text('delta_json'),
    clientMutationId: text('client_mutation_id'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('activity_owner_created_idx').on(t.ownerUserId, t.createdAt), index('activity_project_idx').on(t.ownerUserId, t.projectId, t.createdAt)],
);

export const connectedAccounts = sqliteTable(
  'connected_accounts',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(), // google | microsoft
    providerSubject: text('provider_subject').notNull(),
    displayEmail: text('display_email'),
    displayName: text('display_name'),
    scopesJson: text('scopes_json').notNull().default('[]'),
    tokenCiphertext: text('token_ciphertext').notNull(),
    encryptionKeyVersion: integer('encryption_key_version').notNull().default(1),
    tokenExpiresAt: text('token_expires_at'),
    status: text('status').notNull().default('connected'),
    lastRefreshAt: text('last_refresh_at'),
    lastError: text('last_error'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('connected_accounts_uq').on(t.ownerUserId, t.provider, t.providerSubject)],
);

export const externalCalendars = sqliteTable(
  'external_calendars',
  {
    id: text('id').primaryKey(),
    connectedAccountId: text('connected_account_id').notNull().references(() => connectedAccounts.id, { onDelete: 'cascade' }),
    providerCalendarId: text('provider_calendar_id').notNull(),
    name: text('name').notNull(),
    displayName: text('display_name'),
    color: text('color').notNull().default('#3e63dd'),
    timezone: text('timezone'),
    isSelected: integer('is_selected', { mode: 'boolean' }).notNull().default(true),
    isPrimary: integer('is_primary', { mode: 'boolean' }).notNull().default(false),
    readOnly: integer('read_only', { mode: 'boolean' }).notNull().default(true),
    providerEtag: text('provider_etag'),
    lastSuccessAt: text('last_success_at'),
    lastAttemptAt: text('last_attempt_at'),
    lastErrorCode: text('last_error_code'),
    lastErrorRedacted: text('last_error_redacted'),
    syncHealth: text('sync_health').notNull().default('pending'),
    coverageStart: text('coverage_start'),
    coverageEnd: text('coverage_end'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('external_calendars_uq').on(t.connectedAccountId, t.providerCalendarId)],
);

export const calendarEvents = sqliteTable(
  'calendar_events',
  {
    id: text('id').primaryKey(),
    externalCalendarId: text('external_calendar_id').notNull().references(() => externalCalendars.id, { onDelete: 'cascade' }),
    providerEventId: text('provider_event_id').notNull(),
    providerIcalUid: text('provider_ical_uid'),
    providerSeriesId: text('provider_series_id'),
    occurrenceIdentity: text('occurrence_identity').notNull(), // canonical, never NULL
    subject: text('subject').notNull().default(''),
    descriptionPlain: text('description_plain').notNull().default(''),
    locationText: text('location_text').notNull().default(''),
    url: text('url'),
    startUtc: text('start_utc'),
    endUtc: text('end_utc'),
    startDateLocal: text('start_date_local'),
    endDateLocalExclusive: text('end_date_local_exclusive'),
    timezone: text('timezone').notNull().default('UTC'),
    isAllDay: integer('is_all_day', { mode: 'boolean' }).notNull().default(false),
    isCancelled: integer('is_cancelled', { mode: 'boolean' }).notNull().default(false),
    isPrivate: integer('is_private', { mode: 'boolean' }).notNull().default(false),
    availability: text('availability').notNull().default('busy'),
    etag: text('etag'),
    lastModifiedAt: text('last_modified_at'),
    lastSeenGeneration: integer('last_seen_generation').notNull().default(0),
    deletedAt: text('deleted_at'),
    metaJson: text('meta_json'),
  },
  (t) => [
    uniqueIndex('calendar_events_identity_uq').on(t.externalCalendarId, t.providerEventId, t.occurrenceIdentity),
    index('calendar_events_range_idx').on(t.externalCalendarId, t.startUtc, t.endUtc),
    index('calendar_events_date_idx').on(t.externalCalendarId, t.startDateLocal),
  ],
);

export const syncCursors = sqliteTable(
  'sync_cursors',
  {
    id: text('id').primaryKey(),
    externalCalendarId: text('external_calendar_id').notNull().references(() => externalCalendars.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    windowStartDate: text('window_start_date'),
    windowEndDate: text('window_end_date'),
    cursorKind: text('cursor_kind').notNull(), // google_sync_token | ms_delta_link
    cursorValueCiphertext: text('cursor_value').notNull(),
    queryFingerprint: text('query_fingerprint').notNull(),
    generation: integer('generation').notNull().default(1),
    lastFullSyncAt: text('last_full_sync_at'),
    lastIncrementalAt: text('last_incremental_at'),
    status: text('status').notNull().default('ok'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => [uniqueIndex('sync_cursors_uq').on(t.externalCalendarId, t.windowStartDate, t.windowEndDate, t.cursorKind)],
);

export const syncJobs = sqliteTable(
  'sync_jobs',
  {
    id: text('id').primaryKey(),
    jobKind: text('job_kind').notNull(),
    accountId: text('account_id'),
    calendarId: text('calendar_id'),
    requestedAt: text('requested_at').notNull(),
    nextAttemptAt: text('next_attempt_at').notNull(),
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: text('lease_expires_at'),
    attemptCount: integer('attempt_count').notNull().default(0),
    status: text('status').notNull().default('queued'), // queued | running | succeeded | failed
    lastErrorCode: text('last_error_code'),
    lastSuccessAt: text('last_success_at'),
    dedupeKey: text('dedupe_key').notNull(),
    payloadJson: text('payload_json'),
    finishedAt: text('finished_at'),
  },
  (t) => [index('sync_jobs_due_idx').on(t.status, t.nextAttemptAt), index('sync_jobs_dedupe_idx').on(t.dedupeKey, t.status)],
);

export const appEvents = sqliteTable(
  'app_events',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    ownerUserId: text('owner_user_id').notNull(),
    eventType: text('event_type').notNull(),
    entityId: text('entity_id'),
    payloadJson: text('payload_json'),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('app_events_owner_idx').on(t.ownerUserId, t.seq)],
);

export const clientMutations = sqliteTable(
  'client_mutations',
  {
    clientMutationId: text('client_mutation_id').notNull(),
    ownerUserId: text('owner_user_id').notNull(),
    deviceId: text('device_id'),
    requestHash: text('request_hash').notNull(),
    statusCode: integer('status_code').notNull(),
    responseJson: text('response_json').notNull(),
    appliedAt: text('applied_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.ownerUserId, t.clientMutationId] })],
);

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  endpointHash: text('endpoint_hash').notNull().unique(),
  subscriptionCiphertext: text('subscription_ciphertext').notNull(),
  deviceName: text('device_name'),
  isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const notifications = sqliteTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // reminder | sync_error | import | system
    taskId: text('task_id'),
    occurrenceKey: text('occurrence_key'),
    title: text('title').notNull(),
    body: text('body').notNull().default(''),
    scheduledAt: text('scheduled_at').notNull(),
    deliveredAt: text('delivered_at'),
    readAt: text('read_at'),
    channel: text('channel').notNull().default('inapp'),
    status: text('status').notNull().default('pending'), // pending | delivered | expired | failed
    attempts: integer('attempts').notNull().default(0),
    dedupeKey: text('dedupe_key').notNull().unique(),
    createdAt: text('created_at').notNull(),
  },
  (t) => [index('notifications_owner_idx').on(t.ownerUserId, t.createdAt), index('notifications_due_idx').on(t.status, t.scheduledAt)],
);

export const backups = sqliteTable('backups', {
  id: text('id').primaryKey(),
  startedAt: text('started_at').notNull(),
  finishedAt: text('finished_at'),
  filename: text('filename'),
  sizeBytes: integer('size_bytes'),
  sha256: text('sha256'),
  status: text('status').notNull().default('running'),
  trigger: text('trigger').notNull().default('manual'),
  schemaVersion: integer('schema_version'),
  error: text('error'),
});

export const importRuns = sqliteTable('import_runs', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  sourceType: text('source_type').notNull(),
  checksum: text('checksum').notNull(),
  dryRunSummaryJson: text('dry_run_summary_json'),
  appliedCount: integer('applied_count').notNull().default(0),
  status: text('status').notNull().default('previewed'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const jobLeases = sqliteTable('job_leases', {
  name: text('name').primaryKey(),
  leaseOwner: text('lease_owner'),
  leaseExpiresAt: text('lease_expires_at'),
  lastRunAt: text('last_run_at'),
  lastStatus: text('last_status'),
});
