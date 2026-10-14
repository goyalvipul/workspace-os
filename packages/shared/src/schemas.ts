import { z } from 'zod';
import { isValidDateStr, isValidTimezone, TIME_REGEX } from './dates.js';
import { ULID_REGEX } from './ids.js';
import { validateRule } from './recurrence.js';

export const ulid = z.string().regex(ULID_REGEX, 'Invalid id');
export const dateStr = z.string().refine(isValidDateStr, 'Expected a valid YYYY-MM-DD date');
export const timeStr = z.string().regex(TIME_REGEX, 'Expected HH:mm');
export const tzStr = z.string().refine(isValidTimezone, 'Unknown IANA timezone');
export const isoUtc = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Expected an ISO timestamp');
export const colorStr = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Expected #RRGGBB');

export const TASK_STATUS = ['open', 'completed', 'archived'] as const;
export const taskStatus = z.enum(TASK_STATUS);
export const priority = z.number().int().min(1).max(4);
export const viewKind = z.enum(['list', 'board']);

export const recurrenceSchema = z
  .object({
    rule: z.string().min(5).max(300).refine((r) => validateRule(r).ok, 'Invalid recurrence rule'),
    mode: z.enum(['fixed', 'after_completion']).default('fixed'),
    timezone: tzStr.nullish(),
  })
  .nullable();
export type RecurrenceDTO = z.infer<typeof recurrenceSchema>;

export const reminderSchema = z.object({
  id: ulid,
  kind: z.enum(['relative', 'absolute']),
  offsetMinutes: z.number().int().min(0).max(60 * 24 * 30).nullable(),
  atUtc: isoUtc.nullable(),
  channel: z.enum(['inapp', 'webpush']),
  enabled: z.boolean(),
});
export type ReminderDTO = z.infer<typeof reminderSchema>;

export const reminderInput = z
  .object({
    id: ulid.optional(),
    kind: z.enum(['relative', 'absolute']),
    offsetMinutes: z.number().int().min(0).max(60 * 24 * 30).nullish(),
    atUtc: isoUtc.nullish(),
    channel: z.enum(['inapp', 'webpush']).default('inapp'),
    enabled: z.boolean().default(true),
  })
  .refine((r) => (r.kind === 'relative' ? r.offsetMinutes != null : r.atUtc != null), 'Reminder needs an offset or a time');
export type ReminderInput = z.infer<typeof reminderInput>;

// ---------- Tasks ----------
export const taskSchema = z.object({
  id: ulid,
  projectId: ulid.nullable(),
  sectionId: ulid.nullable(),
  parentTaskId: ulid.nullable(),
  title: z.string(),
  description: z.string(),
  priority,
  status: taskStatus,
  position: z.string(),
  scheduledDate: dateStr.nullable(),
  scheduledAtUtc: isoUtc.nullable(),
  dueDate: dateStr.nullable(),
  dueAtUtc: isoUtc.nullable(),
  dueTimezone: z.string().nullable(),
  deadlineDate: dateStr.nullable(),
  estimateMinutes: z.number().int().nullable(),
  recurrence: recurrenceSchema,
  nextOccurrenceKey: z.string().nullable(),
  labelIds: z.array(ulid),
  reminders: z.array(reminderSchema),
  completedAt: isoUtc.nullable(),
  deletedAt: isoUtc.nullable(),
  createdAt: isoUtc,
  updatedAt: isoUtc,
  version: z.number().int().min(1),
});
export type TaskDTO = z.infer<typeof taskSchema>;

const titleField = z.string().trim().min(1, 'Title is required').max(500);

const dueFields = {
  scheduledDate: dateStr.nullish(),
  scheduledAtUtc: isoUtc.nullish(),
  dueDate: dateStr.nullish(),
  dueAtUtc: isoUtc.nullish(),
  dueTimezone: tzStr.nullish(),
  deadlineDate: dateStr.nullish(),
  estimateMinutes: z.number().int().min(1).max(60 * 24 * 14).nullish(),
  recurrence: recurrenceSchema.optional(),
};

export const taskCreateInput = z.object({
  id: ulid.optional(),
  title: titleField,
  description: z.string().max(20000).optional(),
  projectId: ulid.nullish(),
  sectionId: ulid.nullish(),
  parentTaskId: ulid.nullish(),
  priority: priority.optional(),
  labelIds: z.array(ulid).max(50).optional(),
  reminders: z.array(reminderInput).max(10).optional(),
  ...dueFields,
});
export type TaskCreateInput = z.infer<typeof taskCreateInput>;

export const taskPatchInput = z.object({
  version: z.number().int().min(1),
  title: titleField.optional(),
  description: z.string().max(20000).optional(),
  projectId: ulid.nullish(),
  sectionId: ulid.nullish(),
  parentTaskId: ulid.nullish(),
  priority: priority.optional(),
  labelIds: z.array(ulid).max(50).optional(),
  reminders: z.array(reminderInput).max(10).optional(),
  ...dueFields,
});
export type TaskPatchInput = z.infer<typeof taskPatchInput>;

export const completeInput = z.object({
  version: z.number().int().min(1),
  occurrenceKey: z.string().max(40).optional(),
  completeSubtasks: z.boolean().optional(),
});
export const reopenInput = z.object({
  version: z.number().int().min(1).optional(),
  occurrenceKey: z.string().max(40).optional(),
});

export const bulkInput = z.object({
  ids: z.array(ulid).min(1).max(200),
  action: z.enum(['complete', 'reopen', 'delete', 'restore', 'move', 'priority', 'addLabels', 'removeLabels', 'schedule', 'due']),
  projectId: ulid.nullish(),
  sectionId: ulid.nullish(),
  priority: priority.optional(),
  labelIds: z.array(ulid).optional(),
  date: dateStr.nullish(),
});

export const reorderInput = z.object({
  taskId: ulid,
  projectId: ulid.nullable(),
  sectionId: ulid.nullable(),
  parentTaskId: ulid.nullish(),
  beforeTaskId: ulid.nullish(),
  afterTaskId: ulid.nullish(),
});

// ---------- Projects / sections / labels ----------
export const projectSchema = z.object({
  id: ulid,
  parentProjectId: ulid.nullable(),
  name: z.string(),
  description: z.string(),
  outcome: z.string(),
  color: z.string(),
  icon: z.string().nullable(),
  favorite: z.boolean(),
  archivedAt: isoUtc.nullable(),
  sortOrder: z.number(),
  defaultView: viewKind,
  createdAt: isoUtc,
  updatedAt: isoUtc,
  version: z.number().int(),
});
export type ProjectDTO = z.infer<typeof projectSchema>;

export const projectCreateInput = z.object({
  id: ulid.optional(),
  name: z.string().trim().min(1, 'Name is required').max(120),
  description: z.string().max(5000).optional(),
  outcome: z.string().max(1000).optional(),
  color: colorStr.optional(),
  icon: z.string().max(40).nullish(),
  favorite: z.boolean().optional(),
  parentProjectId: ulid.nullish(),
  defaultView: viewKind.optional(),
});
export const projectPatchInput = projectCreateInput.partial().extend({
  version: z.number().int().min(1),
  archived: z.boolean().optional(),
});

export const sectionSchema = z.object({
  id: ulid,
  projectId: ulid,
  name: z.string(),
  sortOrder: z.number(),
  archivedAt: isoUtc.nullable(),
  createdAt: isoUtc,
  updatedAt: isoUtc,
  version: z.number().int(),
});
export type SectionDTO = z.infer<typeof sectionSchema>;
export const sectionCreateInput = z.object({ id: ulid.optional(), name: z.string().trim().min(1).max(120) });
export const sectionPatchInput = z.object({ version: z.number().int().min(1), name: z.string().trim().min(1).max(120).optional(), archived: z.boolean().optional() });

export const labelSchema = z.object({
  id: ulid,
  name: z.string(),
  color: z.string(),
  sortOrder: z.number(),
  favorite: z.boolean(),
  createdAt: isoUtc,
  updatedAt: isoUtc,
});
export type LabelDTO = z.infer<typeof labelSchema>;
export const labelCreateInput = z.object({
  id: ulid.optional(),
  name: z.string().trim().min(1).max(60).regex(/^[^\s@#]+(?: [^\s@#]+)*$/, 'Label names cannot contain @ or #'),
  color: colorStr.optional(),
  favorite: z.boolean().optional(),
});
export const labelPatchInput = labelCreateInput.partial().extend({ mergeIntoId: ulid.optional() });

export const commentSchema = z.object({ id: ulid, taskId: ulid, body: z.string(), createdAt: isoUtc, updatedAt: isoUtc });
export type CommentDTO = z.infer<typeof commentSchema>;
export const commentInput = z.object({ id: ulid.optional(), body: z.string().trim().min(1).max(10000) });

// ---------- Filters ----------
export type FilterNode =
  | { op: 'and'; children: FilterNode[] }
  | { op: 'or'; children: FilterNode[] }
  | { op: 'not'; child: FilterNode }
  | { field: FilterField; cmp: FilterCmp; value?: unknown };

export const FILTER_FIELDS = [
  'project', 'priority', 'label', 'status', 'due', 'scheduled', 'deadline', 'text', 'overdue', 'plannedToday', 'noDate', 'hasRecurrence',
] as const;
export type FilterField = (typeof FILTER_FIELDS)[number];
export const FILTER_CMPS = ['is', 'isNot', 'in', 'lt', 'lte', 'gt', 'gte', 'between', 'contains', 'exists'] as const;
export type FilterCmp = (typeof FILTER_CMPS)[number];

export const filterNodeSchema: z.ZodType<FilterNode> = z.lazy(() =>
  z.union([
    z.object({ op: z.enum(['and', 'or']), children: z.array(filterNodeSchema).min(1).max(30) }),
    z.object({ op: z.literal('not'), child: filterNodeSchema }),
    z.object({ field: z.enum(FILTER_FIELDS), cmp: z.enum(FILTER_CMPS), value: z.unknown().optional() }),
  ]),
) as z.ZodType<FilterNode>;

export const savedFilterSchema = z.object({
  id: ulid,
  name: z.string(),
  description: z.string(),
  ast: filterNodeSchema,
  sort: z.enum(['position', 'due', 'priority', 'created', 'title']),
  favorite: z.boolean(),
  createdAt: isoUtc,
  updatedAt: isoUtc,
});
export type SavedFilterDTO = z.infer<typeof savedFilterSchema>;
export const savedFilterInput = z.object({
  id: ulid.optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  ast: filterNodeSchema,
  sort: z.enum(['position', 'due', 'priority', 'created', 'title']).optional(),
  favorite: z.boolean().optional(),
});

// ---------- Templates ----------
export interface TemplateTask {
  title: string;
  description?: string;
  priority?: number;
  dueOffsetDays?: number;
  subtasks?: TemplateTask[];
}
export const templateTaskSchema: z.ZodType<TemplateTask> = z.lazy(() =>
  z.object({
    title: z.string().min(1).max(500),
    description: z.string().max(5000).optional(),
    priority: priority.optional(),
    dueOffsetDays: z.number().int().min(0).max(3650).optional(),
    subtasks: z.array(templateTaskSchema).max(50).optional(),
  }),
) as z.ZodType<TemplateTask>;

export const templateBodySchema = z.object({
  version: z.literal(1),
  project: z
    .object({ name: z.string().min(1).max(120), description: z.string().max(5000).optional(), outcome: z.string().max(1000).optional(), color: colorStr.optional(), defaultView: viewKind.optional() })
    .optional(),
  sections: z.array(z.object({ name: z.string().min(1).max(120), tasks: z.array(templateTaskSchema).max(100) })).max(30).default([]),
  tasks: z.array(templateTaskSchema).max(100).default([]),
});
export type TemplateBody = z.infer<typeof templateBodySchema>;

export const templateSchema = z.object({
  id: ulid,
  name: z.string(),
  description: z.string(),
  kind: z.enum(['project', 'task']),
  isBuiltin: z.boolean(),
  body: templateBodySchema,
  createdAt: isoUtc,
  updatedAt: isoUtc,
});
export type TemplateDTO = z.infer<typeof templateSchema>;
export const templateInput = z.object({
  id: ulid.optional(),
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  kind: z.enum(['project', 'task']),
  body: templateBodySchema,
});
export const templateApplyInput = z.object({
  dryRun: z.boolean().optional(),
  projectName: z.string().trim().min(1).max(120).optional(),
  projectId: ulid.nullish(),
  startDate: dateStr.optional(),
});

// ---------- Preferences ----------
export const preferenceSchemas = {
  'display.todayShowCompleted': z.boolean(),
  'display.todaySort': z.enum(['time', 'priority', 'project', 'manual']),
  'display.todayShowFutureRecurring': z.boolean(),
  'display.todayProjectFilter': ulid.nullable(),
  'display.todayLabelFilter': ulid.nullable(),
  'display.todayShowEvents': z.boolean(),
  'display.todayShowTasks': z.boolean(),
  'display.upcomingLayout': z.enum(['agenda', 'week', 'month']),
  'display.inboxSort': z.enum(['manual', 'due', 'priority', 'created']),
  'focus.taskIds': z.array(ulid).max(3),
  'tasks.defaultPriority': priority,
  'tasks.defaultReminderTime': timeStr,
  'tasks.rememberLastProject': z.boolean(),
  'tasks.lastProjectId': ulid.nullable(),
  'tasks.completeParentPrompt': z.boolean(),
  'notifications.lateGraceMinutes': z.number().int().min(0).max(1440),
  'calendar.hiddenSources': z.array(z.string()).max(200),
  'shortcuts.quickAdd': z.string().min(1).max(1),
  'ui.reducedMotion': z.enum(['system', 'on', 'off']),
  'ui.sidebarCollapsed': z.boolean(),
  'ui.browseOrder': z.array(z.string()).max(20),
} as const;
export type PreferenceKey = keyof typeof preferenceSchemas;
export const preferenceKeys = Object.keys(preferenceSchemas) as PreferenceKey[];
export const preferenceDefaults: Record<PreferenceKey, unknown> = {
  'display.todayShowCompleted': false,
  'display.todaySort': 'time',
  'display.todayShowFutureRecurring': false,
  'display.todayProjectFilter': null,
  'display.todayLabelFilter': null,
  'display.todayShowEvents': true,
  'display.todayShowTasks': true,
  'display.upcomingLayout': 'agenda',
  'display.inboxSort': 'manual',
  'focus.taskIds': [],
  'tasks.defaultPriority': 4,
  'tasks.defaultReminderTime': '09:00',
  'tasks.rememberLastProject': false,
  'tasks.lastProjectId': null,
  'tasks.completeParentPrompt': true,
  'notifications.lateGraceMinutes': 60,
  'calendar.hiddenSources': [],
  'shortcuts.quickAdd': 'q',
  'ui.reducedMotion': 'system',
  'ui.sidebarCollapsed': false,
  'ui.browseOrder': [],
};

// ---------- Auth / user ----------
export const passwordSchema = z
  .string()
  .min(12, 'Use at least 12 characters')
  .max(200)
  .refine((p) => /[a-z]/.test(p) && /[A-Z]/.test(p) && /\d/.test(p), 'Include upper case, lower case and a number');

export const userSchema = z.object({
  id: ulid,
  username: z.string(),
  email: z.string().nullable(),
  displayName: z.string(),
  timezone: z.string(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]),
  theme: z.enum(['dark', 'light', 'system']),
  timeFormat: z.enum(['12h', '24h']),
});
export type UserDTO = z.infer<typeof userSchema>;

export const bootstrapOwnerInput = z.object({
  setupCode: z.string().min(8).max(64),
  username: z.string().trim().min(3).max(40).regex(/^[a-zA-Z0-9._-]+$/, 'Letters, numbers, . _ - only'),
  displayName: z.string().trim().min(1).max(80),
  password: passwordSchema,
  timezone: tzStr.default('America/Vancouver'),
  theme: z.enum(['dark', 'light', 'system']).default('dark'),
});
export const loginInput = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) });
export const passwordChangeInput = z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema, logoutOthers: z.boolean().optional() });
export const profilePatchInput = z.object({
  displayName: z.string().trim().min(1).max(80).optional(),
  email: z.string().email().max(200).nullish(),
  timezone: tzStr.optional(),
  weekStartsOn: z.union([z.literal(0), z.literal(1)]).optional(),
  theme: z.enum(['dark', 'light', 'system']).optional(),
  timeFormat: z.enum(['12h', '24h']).optional(),
});

// ---------- Calendar (read-only external events) ----------
export const calendarEventSchema = z.object({
  id: z.string(),
  calendarId: ulid,
  accountId: ulid,
  provider: z.enum(['google', 'microsoft']),
  providerEventId: z.string(),
  subject: z.string(),
  description: z.string(),
  location: z.string(),
  url: z.string().nullable(),
  isAllDay: z.boolean(),
  startUtc: isoUtc.nullable(),
  endUtc: isoUtc.nullable(),
  startDate: dateStr.nullable(),
  endDateExclusive: dateStr.nullable(),
  timezone: z.string(),
  isCancelled: z.boolean(),
  isPrivate: z.boolean(),
  availability: z.string(),
  color: z.string(),
  calendarName: z.string(),
  accountLabel: z.string(),
  isStale: z.boolean(),
});
export type CalendarEventDTO = z.infer<typeof calendarEventSchema>;

export const calendarPatchInput = z.object({
  isSelected: z.boolean().optional(),
  color: colorStr.optional(),
  displayName: z.string().max(100).nullish(),
});

// ---------- Activity & reports ----------
export const activitySchema = z.object({
  id: ulid,
  entityType: z.string(),
  entityId: z.string(),
  action: z.string(),
  summary: z.string(),
  projectId: z.string().nullable(),
  projectName: z.string().nullable(),
  projectColor: z.string().nullable(),
  delta: z.record(z.string(), z.unknown()).nullable(),
  createdAt: isoUtc,
});
export type ActivityDTO = z.infer<typeof activitySchema>;

// ---------- API errors ----------
export const apiErrorSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
    requestId: z.string().optional(),
    current: z.unknown().optional(),
    expectedVersion: z.number().optional(),
  }),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const COLORS = ['#e5484d', '#f76b15', '#f5a623', '#46a758', '#12a594', '#3e63dd', '#8e4ec6', '#d6409f', '#8b8d98', '#ab6e5a'];
