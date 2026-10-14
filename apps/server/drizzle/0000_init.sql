CREATE TABLE `activity_events` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`project_id` text,
	`action` text NOT NULL,
	`public_summary` text NOT NULL,
	`delta_json` text,
	`client_mutation_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `activity_owner_created_idx` ON `activity_events` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_project_idx` ON `activity_events` (`owner_user_id`,`project_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `app_events` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`entity_id` text,
	`payload_json` text,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `app_events_owner_idx` ON `app_events` (`owner_user_id`,`seq`);--> statement-breakpoint
CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `backups` (
	`id` text PRIMARY KEY NOT NULL,
	`started_at` text NOT NULL,
	`finished_at` text,
	`filename` text,
	`size_bytes` integer,
	`sha256` text,
	`status` text DEFAULT 'running' NOT NULL,
	`trigger` text DEFAULT 'manual' NOT NULL,
	`schema_version` integer,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`external_calendar_id` text NOT NULL,
	`provider_event_id` text NOT NULL,
	`provider_ical_uid` text,
	`provider_series_id` text,
	`occurrence_identity` text NOT NULL,
	`subject` text DEFAULT '' NOT NULL,
	`description_plain` text DEFAULT '' NOT NULL,
	`location_text` text DEFAULT '' NOT NULL,
	`url` text,
	`start_utc` text,
	`end_utc` text,
	`start_date_local` text,
	`end_date_local_exclusive` text,
	`timezone` text DEFAULT 'UTC' NOT NULL,
	`is_all_day` integer DEFAULT false NOT NULL,
	`is_cancelled` integer DEFAULT false NOT NULL,
	`is_private` integer DEFAULT false NOT NULL,
	`availability` text DEFAULT 'busy' NOT NULL,
	`etag` text,
	`last_modified_at` text,
	`last_seen_generation` integer DEFAULT 0 NOT NULL,
	`deleted_at` text,
	`meta_json` text,
	FOREIGN KEY (`external_calendar_id`) REFERENCES `external_calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_events_identity_uq` ON `calendar_events` (`external_calendar_id`,`provider_event_id`,`occurrence_identity`);--> statement-breakpoint
CREATE INDEX `calendar_events_range_idx` ON `calendar_events` (`external_calendar_id`,`start_utc`,`end_utc`);--> statement-breakpoint
CREATE INDEX `calendar_events_date_idx` ON `calendar_events` (`external_calendar_id`,`start_date_local`);--> statement-breakpoint
CREATE TABLE `client_mutations` (
	`client_mutation_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`device_id` text,
	`request_hash` text NOT NULL,
	`status_code` integer NOT NULL,
	`response_json` text NOT NULL,
	`applied_at` text NOT NULL,
	PRIMARY KEY(`owner_user_id`, `client_mutation_id`)
);
--> statement-breakpoint
CREATE TABLE `connected_accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`provider` text NOT NULL,
	`provider_subject` text NOT NULL,
	`display_email` text,
	`display_name` text,
	`scopes_json` text DEFAULT '[]' NOT NULL,
	`token_ciphertext` text NOT NULL,
	`encryption_key_version` integer DEFAULT 1 NOT NULL,
	`token_expires_at` text,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_refresh_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connected_accounts_uq` ON `connected_accounts` (`owner_user_id`,`provider`,`provider_subject`);--> statement-breakpoint
CREATE TABLE `external_calendars` (
	`id` text PRIMARY KEY NOT NULL,
	`connected_account_id` text NOT NULL,
	`provider_calendar_id` text NOT NULL,
	`name` text NOT NULL,
	`display_name` text,
	`color` text DEFAULT '#3e63dd' NOT NULL,
	`timezone` text,
	`is_selected` integer DEFAULT true NOT NULL,
	`is_primary` integer DEFAULT false NOT NULL,
	`read_only` integer DEFAULT true NOT NULL,
	`provider_etag` text,
	`last_success_at` text,
	`last_attempt_at` text,
	`last_error_code` text,
	`last_error_redacted` text,
	`sync_health` text DEFAULT 'pending' NOT NULL,
	`coverage_start` text,
	`coverage_end` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`connected_account_id`) REFERENCES `connected_accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `external_calendars_uq` ON `external_calendars` (`connected_account_id`,`provider_calendar_id`);--> statement-breakpoint
CREATE TABLE `import_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`source_type` text NOT NULL,
	`checksum` text NOT NULL,
	`dry_run_summary_json` text,
	`applied_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'previewed' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `job_leases` (
	`name` text PRIMARY KEY NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`last_run_at` text,
	`last_status` text
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`name_lower` text NOT NULL,
	`color` text DEFAULT '#8b8d98' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_owner_name_uq` ON `labels` (`owner_user_id`,`name_lower`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`task_id` text,
	`occurrence_key` text,
	`title` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`scheduled_at` text NOT NULL,
	`delivered_at` text,
	`read_at` text,
	`channel` text DEFAULT 'inapp' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`dedupe_key` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_key_unique` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_owner_idx` ON `notifications` (`owner_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_due_idx` ON `notifications` (`status`,`scheduled_at`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`parent_project_id` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`outcome` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#8b8d98' NOT NULL,
	`icon` text,
	`favorite` integer DEFAULT false NOT NULL,
	`archived_at` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`default_view` text DEFAULT 'list' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "projects_not_self_parent" CHECK("projects"."parent_project_id" IS NULL OR "projects"."parent_project_id" <> "projects"."id")
);
--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_user_id`,`archived_at`,`sort_order`);--> statement-breakpoint
CREATE TABLE `push_subscriptions` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`endpoint_hash` text NOT NULL,
	`subscription_ciphertext` text NOT NULL,
	`device_name` text,
	`is_active` integer DEFAULT true NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_hash_unique` ON `push_subscriptions` (`endpoint_hash`);--> statement-breakpoint
CREATE TABLE `saved_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`filter_ast_json` text NOT NULL,
	`sort` text DEFAULT 'position' NOT NULL,
	`favorite` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `saved_filters_owner_idx` ON `saved_filters` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `sections` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`name` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sections_project_idx` ON `sections` (`project_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`csrf_secret_hash` text NOT NULL,
	`user_agent` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`revoked_at` text,
	`last_seen_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_token_hash_unique` ON `sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `sync_cursors` (
	`id` text PRIMARY KEY NOT NULL,
	`external_calendar_id` text NOT NULL,
	`provider` text NOT NULL,
	`window_start_date` text,
	`window_end_date` text,
	`cursor_kind` text NOT NULL,
	`cursor_value` text NOT NULL,
	`query_fingerprint` text NOT NULL,
	`generation` integer DEFAULT 1 NOT NULL,
	`last_full_sync_at` text,
	`last_incremental_at` text,
	`status` text DEFAULT 'ok' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`external_calendar_id`) REFERENCES `external_calendars`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_cursors_uq` ON `sync_cursors` (`external_calendar_id`,`window_start_date`,`window_end_date`,`cursor_kind`);--> statement-breakpoint
CREATE TABLE `sync_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_kind` text NOT NULL,
	`account_id` text,
	`calendar_id` text,
	`requested_at` text NOT NULL,
	`next_attempt_at` text NOT NULL,
	`lease_owner` text,
	`lease_expires_at` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`last_error_code` text,
	`last_success_at` text,
	`dedupe_key` text NOT NULL,
	`payload_json` text,
	`finished_at` text
);
--> statement-breakpoint
CREATE INDEX `sync_jobs_due_idx` ON `sync_jobs` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `sync_jobs_dedupe_idx` ON `sync_jobs` (`dedupe_key`,`status`);--> statement-breakpoint
CREATE TABLE `task_comments` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`body` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_comments_task_idx` ON `task_comments` (`task_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `task_completions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`occurrence_key` text NOT NULL,
	`completed_at` text NOT NULL,
	`original_due_date` text,
	`original_due_at_utc` text,
	`completed_by` text NOT NULL,
	`undone_at` text,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_completions_active_uq` ON `task_completions` (`task_id`,`occurrence_key`) WHERE "task_completions"."undone_at" IS NULL;--> statement-breakpoint
CREATE INDEX `task_completions_owner_idx` ON `task_completions` (`owner_user_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `task_labels` (
	`task_id` text NOT NULL,
	`label_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `label_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_labels_label_idx` ON `task_labels` (`label_id`);--> statement-breakpoint
CREATE TABLE `task_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`offset_minutes` integer,
	`at_utc` text,
	`timezone` text NOT NULL,
	`channel` text DEFAULT 'inapp' NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`last_sent_occurrence_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `task_reminders_task_idx` ON `task_reminders` (`task_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`project_id` text,
	`section_id` text,
	`parent_task_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`priority` integer DEFAULT 4 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`position` text DEFAULT '0000001000' NOT NULL,
	`scheduled_date` text,
	`scheduled_at_utc` text,
	`due_date` text,
	`due_at_utc` text,
	`due_timezone` text,
	`deadline_date` text,
	`estimate_minutes` integer,
	`recurrence_rule` text,
	`recurrence_mode` text DEFAULT 'fixed' NOT NULL,
	`recurrence_anchor` text,
	`recurrence_timezone` text,
	`next_occurrence_key` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	`deleted_at` text,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`section_id`) REFERENCES `sections`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`parent_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tasks_priority_range" CHECK("tasks"."priority" BETWEEN 1 AND 4),
	CONSTRAINT "tasks_title_nonempty" CHECK(length(trim("tasks"."title")) > 0),
	CONSTRAINT "tasks_not_own_parent" CHECK("tasks"."parent_task_id" IS NULL OR "tasks"."parent_task_id" <> "tasks"."id"),
	CONSTRAINT "tasks_status_valid" CHECK("tasks"."status" IN ('open','completed','archived')),
	CONSTRAINT "tasks_version_min" CHECK("tasks"."version" >= 1)
);
--> statement-breakpoint
CREATE INDEX `tasks_owner_status_idx` ON `tasks` (`owner_user_id`,`status`,`deleted_at`);--> statement-breakpoint
CREATE INDEX `tasks_due_date_idx` ON `tasks` (`owner_user_id`,`due_date`);--> statement-breakpoint
CREATE INDEX `tasks_due_at_idx` ON `tasks` (`due_at_utc`);--> statement-breakpoint
CREATE INDEX `tasks_scheduled_idx` ON `tasks` (`owner_user_id`,`scheduled_date`);--> statement-breakpoint
CREATE INDEX `tasks_position_idx` ON `tasks` (`owner_user_id`,`project_id`,`section_id`,`position`);--> statement-breakpoint
CREATE INDEX `tasks_parent_idx` ON `tasks` (`parent_task_id`);--> statement-breakpoint
CREATE INDEX `tasks_updated_idx` ON `tasks` (`owner_user_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `templates` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text,
	`builtin_key` text,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`kind` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`body_json` text NOT NULL,
	`is_builtin` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `templates_builtin_key_unique` ON `templates` (`builtin_key`);--> statement-breakpoint
CREATE INDEX `templates_owner_idx` ON `templates` (`owner_user_id`);--> statement-breakpoint
CREATE TABLE `user_preferences` (
	`user_id` text NOT NULL,
	`key` text NOT NULL,
	`json_value` text NOT NULL,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`user_id`, `key`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`email` text,
	`display_name` text NOT NULL,
	`password_hash` text NOT NULL,
	`timezone` text DEFAULT 'America/Vancouver' NOT NULL,
	`week_starts_on` integer DEFAULT 1 NOT NULL,
	`theme` text DEFAULT 'dark' NOT NULL,
	`time_format` text DEFAULT '12h' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`disabled_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_unique` ON `users` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);