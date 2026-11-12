ALTER TABLE `versions` ADD `parent_version_id` text;
--> statement-breakpoint
-- Recover recorded generation ancestry only; older copies without runs remain unknown.
UPDATE `versions`
SET `parent_version_id` = (
  SELECT r.previous_version_id FROM runs r
  JOIN versions parent ON parent.id = r.previous_version_id AND parent.project_id = r.project_id
  WHERE r.id = versions.id AND r.project_id = versions.project_id
);