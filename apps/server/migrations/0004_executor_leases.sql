ALTER TABLE `runs` ADD `lease_token` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `lease_owner` text;
--> statement-breakpoint
ALTER TABLE `runs` ADD `lease_expires_at` integer;
--> statement-breakpoint
CREATE INDEX `idx_runs_queue` ON `runs` (`status`, `lease_expires_at`, `created_at`);
--> statement-breakpoint
CREATE TABLE `run_checkpoints` (
  `run_id` text NOT NULL,
  `name` text NOT NULL,
  `result` text NOT NULL,
  `created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_run_checkpoints_key` ON `run_checkpoints` (`run_id`, `name`);
