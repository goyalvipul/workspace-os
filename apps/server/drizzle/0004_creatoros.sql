ALTER TABLE `api_tokens` ADD `scope` text DEFAULT 'capture' NOT NULL;
--> statement-breakpoint
CREATE TABLE `creatoros_config` (
	`owner_user_id` text PRIMARY KEY NOT NULL,
	`webhook_url` text NOT NULL,
	`secret_ciphertext` text NOT NULL,
	`encryption_key_version` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`auto_label_id` text,
	`auto_project_id` text,
	`last_success_at` text,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`auto_label_id`) REFERENCES `labels`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`auto_project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE TABLE `creatoros_task_links` (
	`task_id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`external_id` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`synced_version` integer DEFAULT 0 NOT NULL,
	`linked_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `creatoros_task_links_external_uq` ON `creatoros_task_links` (`owner_user_id`,`external_id`) WHERE "creatoros_task_links"."external_id" IS NOT NULL;
--> statement-breakpoint
CREATE TABLE `creatoros_outbox` (
	`task_id` text PRIMARY KEY NOT NULL,
	`owner_user_id` text NOT NULL,
	`kind` text NOT NULL,
	`reason` text,
	`external_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` text NOT NULL,
	`last_error` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `creatoros_outbox_due_idx` ON `creatoros_outbox` (`status`,`next_attempt_at`);
