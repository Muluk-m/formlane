import type { AppVersion, ChatMessage, Project } from '@atoms-demo/core/types'
import { isAgentId } from '@atoms-demo/core/types'
import { and, desc, eq, getTableColumns, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { messages, projects, runCheckpoints, runEvents, runs, versions } from '../../db/schema'
import { stateEvent } from './runs.repo'

export type ProjectRow = typeof projects.$inferSelect & { version_count?: number }
const owned = (id: string, ownerId: string) =>
  and(eq(projects.id, id), eq(projects.owner_id, ownerId))

export function toProject(row: ProjectRow): Project {
  return {
    id: row.id,
    title: row.title,
    idea: row.idea,
    status: row.status,
    error: row.error,
    currentVersionId: row.current_version_id,
    publishedSlug: row.published_slug,
    publishedVersionId: row.published_version_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.version_count === undefined ? {} : { versionCount: row.version_count }),
  }
}
export async function listProjects(db: Db, ownerId: string) {
  const rows = await db
    .select({
      ...getTableColumns(projects),
      version_count: db.$count(versions, eq(versions.project_id, projects.id)),
    })
    .from(projects)
    .where(eq(projects.owner_id, ownerId))
    .orderBy(desc(projects.updated_at))
    .limit(60)
  return rows.map(toProject)
}
export async function getProject(db: Db, id: string, ownerId: string) {
  return (await db.select().from(projects).where(owned(id, ownerId)).get()) ?? null
}
export async function createProject(
  db: Db,
  input: {
    id: string
    ownerId: string
    title: string
    idea: string
    messageId: string
    now: number
  },
) {
  await db.batch([
    db.insert(projects).values({
      id: input.id,
      owner_id: input.ownerId,
      title: input.title,
      idea: input.idea,
      created_at: input.now,
      updated_at: input.now,
    }),
    db.insert(messages).values({
      id: input.messageId,
      project_id: input.id,
      role: 'user',
      content: input.idea,
      created_at: input.now + 1,
    }),
  ])
}
export async function listMessages(db: Db, projectId: string): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.project_id, projectId))
    .orderBy(messages.created_at, sql`rowid`)
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    agent: isAgentId(row.agent) ? row.agent : null,
    content: row.content,
    createdAt: row.created_at,
  }))
}
const versionFields = {
  id: versions.id,
  number: versions.number,
  prompt: versions.prompt,
  createdAt: versions.created_at,
}
export async function listVersions(db: Db, projectId: string): Promise<AppVersion[]> {
  return db
    .select(versionFields)
    .from(versions)
    .where(eq(versions.project_id, projectId))
    .orderBy(versions.number)
}
export async function getVersion(db: Db, projectId: string, versionId: string) {
  return (
    (await db
      .select({ ...versionFields, html: versions.html })
      .from(versions)
      .where(and(eq(versions.project_id, projectId), eq(versions.id, versionId)))
      .get()) ?? null
  )
}
export async function currentHtml(db: Db, versionId: string | null) {
  if (!versionId) return null
  return (
    (
      await db
        .select({ html: versions.html })
        .from(versions)
        .where(eq(versions.id, versionId))
        .get()
    )?.html ?? null
  )
}
export async function restoreVersion(
  db: Db,
  input: { projectId: string; ownerId: string; versionId: string; messageId: string; now: number },
) {
  const project = await getProject(db, input.projectId, input.ownerId)
  if (!project) return null
  const version = await getVersion(db, input.projectId, input.versionId)
  if (!version) return null
  await db.batch([
    db
      .update(runs)
      .set({ status: 'cancelled', finished_at: input.now, lease_expires_at: null })
      .where(
        and(eq(runs.project_id, input.projectId), sql`${runs.status} in ('queued', 'running')`),
      ),
    stateEvent(
      db,
      sql`(select run_id from projects where id = ${input.projectId})`,
      'cancelled',
      input.now,
    ),
    db
      .update(projects)
      .set({
        current_version_id: version.id,
        updated_at: input.now,
        status: 'idle',
        error: null,
        run_id: null,
      })
      .where(owned(input.projectId, input.ownerId)),
    db.insert(messages).values({
      id: input.messageId,
      project_id: input.projectId,
      role: 'system',
      content: `Restored version ${version.number}.`,
      created_at: input.now,
    }),
  ])
  return { html: version.html, number: version.number }
}
export async function deleteProject(db: Db, projectId: string, ownerId: string) {
  if (!(await getProject(db, projectId, ownerId))) return false
  await db.batch([
    db
      .delete(runEvents)
      .where(sql`${runEvents.run_id} in (select id from runs where project_id = ${projectId})`),
    db
      .delete(runCheckpoints)
      .where(
        sql`${runCheckpoints.run_id} in (select id from runs where project_id = ${projectId})`,
      ),
    db.delete(runs).where(eq(runs.project_id, projectId)),
    db.delete(messages).where(eq(messages.project_id, projectId)),
    db.delete(versions).where(eq(versions.project_id, projectId)),
    db.delete(projects).where(owned(projectId, ownerId)),
  ])
  return true
}
export async function publishProject(
  db: Db,
  projectId: string,
  ownerId: string,
  slug: string,
  now: number,
) {
  const row = await getProject(db, projectId, ownerId)
  if (!row?.current_version_id) return null
  const nextSlug = row.published_slug || slug
  await db
    .update(projects)
    .set({
      published_slug: nextSlug,
      published_version_id: row.current_version_id,
      updated_at: now,
    })
    .where(owned(projectId, ownerId))
  return { slug: nextSlug, versionId: row.current_version_id }
}
export async function unpublishProject(db: Db, projectId: string, ownerId: string, now: number) {
  return (
    (
      await db
        .update(projects)
        .set({ published_slug: null, published_version_id: null, updated_at: now })
        .where(owned(projectId, ownerId))
        .returning({ id: projects.id })
    ).length > 0
  )
}
export async function getPublished(db: Db, slug: string) {
  return (
    (await db
      .select({ title: projects.title, html: versions.html })
      .from(projects)
      .innerJoin(versions, eq(versions.id, projects.published_version_id))
      .where(eq(projects.published_slug, slug))
      .get()) ?? null
  )
}
export async function remixProject(db: Db, sourceId: string, ownerId: string) {
  const source = await getProject(db, sourceId, ownerId)
  if (!source) return null
  const now = Date.now(),
    id = crypto.randomUUID()
  const history = await listMessages(db, sourceId)
  const builds = await db
    .select()
    .from(versions)
    .where(eq(versions.project_id, sourceId))
    .orderBy(versions.number)
  const copied = builds.map((version) => ({ ...version, id: crypto.randomUUID(), project_id: id }))
  const current =
    copied[builds.findIndex((version) => version.id === source.current_version_id)]?.id ?? null
  // Every statement in a D1 batch commits together, including large histories.
  const statements = [
    db.insert(projects).values({
      id,
      owner_id: ownerId,
      title: `${source.title} remix`.slice(0, 80),
      idea: source.idea,
      current_version_id: current,
      created_at: now,
      updated_at: now,
    }),
    ...history.map((message, index) =>
      db.insert(messages).values({
        id: crypto.randomUUID(),
        project_id: id,
        role: message.role,
        agent: message.agent,
        content: message.content,
        created_at: now + index + 1,
      }),
    ),
    ...copied.map((version) => db.insert(versions).values(version)),
    db.insert(messages).values({
      id: crypto.randomUUID(),
      project_id: id,
      role: 'system',
      content: `Remixed from ${source.title}.`,
      created_at: now + history.length + 1,
    }),
  ] as const
  await db.batch(statements)
  const created = await getProject(db, id, ownerId)
  return created ? toProject(created) : null
}
