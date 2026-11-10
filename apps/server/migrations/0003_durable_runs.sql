CREATE TABLE `run_events` (
	`sequence` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`run_id` text NOT NULL,
	`event_key` text NOT NULL,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_run_events_cursor` ON `run_events` (`run_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_run_events_key` ON `run_events` (`run_id`,`event_key`);--> statement-breakpoint
CREATE TABLE `runs` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`request` text NOT NULL,
	`previous_version_id` text,
	`created_at` integer NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`deadline_at` integer NOT NULL,
	`error_code` text,
	`error` text,
	`version_id` text
);
--> statement-breakpoint
CREATE INDEX `idx_runs_project` ON `runs` (`project_id`,"created_at" desc);
--> statement-breakpoint
UPDATE `projects`
SET `status` = 'error', `error` = 'The previous generation was interrupted by an upgrade. Please retry.', `run_id` = NULL
WHERE `run_id` IS NOT NULL AND NOT EXISTS (SELECT 1 FROM `runs` WHERE `runs`.`id` = `projects`.`run_id`);