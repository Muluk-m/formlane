import type { RunErrorCode } from '@atoms-demo/contracts'
import type { ProjectSource } from '@atoms-demo/core/project'
import { sql } from 'drizzle-orm'
import { index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    owner_id: text('owner_id').notNull(),
    title: text('title').notNull(),
    idea: text('idea').notNull(),
    status: text('status', { enum: ['idle', 'generating', 'error'] })
      .notNull()
      .default('idle'),
    error: text('error'),
    current_version_id: text('current_version_id'),
    published_slug: text('published_slug'),
    published_version_id: text('published_version_id'),
    created_at: integer('created_at').notNull(),
    updated_at: integer('updated_at').notNull(),
    run_id: text('run_id'),
  },
  (table) => [
    index('idx_projects_owner').on(table.owner_id, sql`${table.updated_at} desc`),
    uniqueIndex('idx_projects_slug').on(table.published_slug),
  ],
)

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id').notNull(),
    role: text('role', { enum: ['user', 'agent', 'system'] }).notNull(),
    agent: text('agent'),
    content: text('content').notNull(),
    created_at: integer('created_at').notNull(),
  },
  (table) => [index('idx_messages_project').on(table.project_id, table.created_at)],
)

export const versions = sqliteTable(
  'versions',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id').notNull(),
    number: integer('number').notNull(),
    html: text('html').notNull(),
    prompt: text('prompt').notNull(),
    created_at: integer('created_at').notNull(),
    source: text('source', { mode: 'json' }).$type<ProjectSource>().notNull(),
    parent_version_id: text('parent_version_id'),
  },
  (table) => [uniqueIndex('idx_versions_number').on(table.project_id, table.number)],
)

export const runs = sqliteTable(
  'runs',
  {
    id: text('id').primaryKey(),
    project_id: text('project_id').notNull(),
    status: text('status', { enum: ['queued', 'running', 'completed', 'failed', 'cancelled'] })
      .notNull()
      .default('queued'),
    request: text('request').notNull(),
    previous_version_id: text('previous_version_id'),
    created_at: integer('created_at').notNull(),
    started_at: integer('started_at'),
    finished_at: integer('finished_at'),
    deadline_at: integer('deadline_at').notNull(),
    error_code: text('error_code').$type<RunErrorCode>(),
    error: text('error'),
    version_id: text('version_id'),
    lease_token: text('lease_token'),
    lease_owner: text('lease_owner'),
    lease_expires_at: integer('lease_expires_at'),
  },
  (table) => [
    index('idx_runs_project').on(table.project_id, sql`${table.created_at} desc`),
    index('idx_runs_queue').on(table.status, table.lease_expires_at, table.created_at),
  ],
)

export const runEvents = sqliteTable(
  'run_events',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    run_id: text('run_id').notNull(),
    event_key: text('event_key').notNull(),
    type: text('type').notNull(),
    data: text('data', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
    created_at: integer('created_at').notNull(),
  },
  (table) => [
    index('idx_run_events_cursor').on(table.run_id, table.sequence),
    uniqueIndex('idx_run_events_key').on(table.run_id, table.event_key),
  ],
)

export const runCheckpoints = sqliteTable(
  'run_checkpoints',
  {
    run_id: text('run_id').notNull(),
    name: text('name').notNull(),
    result: text('result', { mode: 'json' }).$type<unknown>().notNull(),
    created_at: integer('created_at').notNull(),
  },
  (table) => [uniqueIndex('idx_run_checkpoints_key').on(table.run_id, table.name)],
)
