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
  },
  (table) => [uniqueIndex('idx_versions_number').on(table.project_id, table.number)],
)
