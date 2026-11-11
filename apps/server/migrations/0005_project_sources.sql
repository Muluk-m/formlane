-- Stop HTML-only executors before applying this migration and starting source-aware workers.
-- Preserve saved previews verbatim. Legacy projects use the canonical Vanilla package manifest.
CREATE TABLE `__new_versions` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `number` integer NOT NULL,
  `html` text NOT NULL,
  `prompt` text NOT NULL,
  `created_at` integer NOT NULL,
  `source` text NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_versions` (`id`, `project_id`, `number`, `html`, `prompt`, `created_at`, `source`)
SELECT `id`, `project_id`, `number`, `html`, `prompt`, `created_at`,
  json_object('template', 'vanilla', 'files', json_object('index.html', `html`, 'package.json', '{
  "name": "generated-app",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite --host 127.0.0.1",
    "build": "vite build",
    "preview": "vite preview --host 127.0.0.1"
  },
  "devDependencies": {
    "vite": "8.3.7"
  }
}
'))
FROM `versions`;
--> statement-breakpoint
DROP TABLE `versions`;
--> statement-breakpoint
ALTER TABLE `__new_versions` RENAME TO `versions`;
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_versions_number` ON `versions` (`project_id`, `number`);