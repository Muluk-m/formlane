import type { AppVersion, ChatMessage, Project, ProjectStatus } from '@atoms-demo/core/types'
import { isAgentId } from '@atoms-demo/core/types'
import { and, count, desc, eq, getTableColumns, lt, max, ne, or, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { messages, projects, versions } from '../../db/schema'

export type ProjectRow = typeof projects.$inferSelect & { version_count?: number }
export type Run = { projectId: string; runId: string }
const owned = (id: string, ownerId: string) =>
  and(eq(projects.id, id), eq(projects.owner_id, ownerId))
const active = (run: Run) =>
  and(
    eq(projects.id, run.projectId),
    eq(projects.run_id, run.runId),
    eq(projects.status, 'generating'),
  )

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
export async function insertMessage(
  db: Db,
  message: {
    id: string
    projectId: string
    role: ChatMessage['role']
    agent: string | null
    content: string
    createdAt: number
  },
  run?: Run,
) {
  const values = {
    id: message.id,
    project_id: message.projectId,
    role: message.role,
    agent: message.agent,
    content: message.content,
    created_at: message.createdAt,
  }
  if (!run) {
    await db.insert(messages).values(values)
    return
  }
  await db.insert(messages).select(
    db
      .select({
        id: sql<string>`${values.id}`.as('id'),
        project_id: sql<string>`${values.project_id}`.as('project_id'),
        role: sql<ChatMessage['role']>`${values.role}`.as('role'),
        agent: sql<string | null>`${values.agent}`.as('agent'),
        content: sql<string>`${values.content}`.as('content'),
        created_at: sql<number>`${values.created_at}`.as('created_at'),
      })
      .from(projects)
      .where(active(run)),
  )
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
export async function loadCurrentHtml(db: Db, projectId: string) {
  const row = await db
    .select({ current: projects.current_version_id })
    .from(projects)
    .where(eq(projects.id, projectId))
    .get()
  return currentHtml(db, row?.current ?? null)
}
export async function versionCount(db: Db, projectId: string) {
  return (
    (await db.select({ n: count() }).from(versions).where(eq(versions.project_id, projectId)).get())
      ?.n ?? 0
  )
}
export async function nextVersionNumber(db: Db, projectId: string) {
  return (
    ((
      await db
        .select({ n: max(versions.number) })
        .from(versions)
        .where(eq(versions.project_id, projectId))
        .get()
    )?.n ?? 0) + 1
  )
}
export async function acquireLock(
  db: Db,
  projectId: string,
  ownerId: string,
  now: number,
  runId: string,
) {
  const rows = await db
    .update(projects)
    .set({ status: 'generating', error: null, updated_at: now, run_id: runId })
    .where(
      and(
        owned(projectId, ownerId),
        or(ne(projects.status, 'generating'), lt(projects.updated_at, now - 180_000)),
      ),
    )
    .returning({ id: projects.id })
  return rows.length > 0
}
export async function isRunActive(db: Db, run: Run) {
  return Boolean(await db.select({ id: projects.id }).from(projects).where(active(run)).get())
}
export async function setStatus(
  db: Db,
  run: Run,
  status: ProjectStatus,
  error: string | null,
  now: number,
) {
  await db.update(projects).set({ status, error, updated_at: now, run_id: null }).where(active(run))
}
export async function cancelRun(db: Db, projectId: string, ownerId: string) {
  const now = Date.now()
  const generating = and(owned(projectId, ownerId), eq(projects.status, 'generating'))
  await db.batch([
    db.insert(messages).select(
      db
        .select({
          id: sql<string>`${crypto.randomUUID()}`.as('id'),
          project_id: sql<string>`${projectId}`.as('project_id'),
          role: sql<'system'>`'system'`.as('role'),
          agent: sql<null>`null`.as('agent'),
          content: sql<string>`'Generation stopped.'`.as('content'),
          created_at: sql<number>`${now}`.as('created_at'),
        })
        .from(projects)
        .where(generating),
    ),
    db
      .update(projects)
      .set({ status: 'idle', error: null, run_id: null, updated_at: now })
      .where(generating),
  ])
}
export async function touchProject(db: Db, run: Run, now: number) {
  await db.update(projects).set({ updated_at: now }).where(active(run))
}
export async function renameProject(db: Db, run: Run, title: string, now: number) {
  await db.update(projects).set({ title, updated_at: now }).where(active(run))
}
export async function saveVersion(
  db: Db,
  run: Run,
  input: {
    id: string
    projectId: string
    number: number
    html: string
    prompt: string
    createdAt: number
    systemMessageId: string
    systemCreatedAt: number
  },
) {
  await db.batch([
    db.insert(versions).select(
      db
        .select({
          id: sql<string>`${input.id}`.as('id'),
          project_id: sql<string>`${input.projectId}`.as('project_id'),
          number: sql<number>`${input.number}`.as('number'),
          html: sql<string>`${input.html}`.as('html'),
          prompt: sql<string>`${input.prompt}`.as('prompt'),
          created_at: sql<number>`${input.createdAt}`.as('created_at'),
        })
        .from(projects)
        .where(active(run)),
    ),
    db
      .update(projects)
      .set({ current_version_id: input.id, updated_at: input.createdAt })
      .where(active(run)),
    db.insert(messages).select(
      db
        .select({
          id: sql<string>`${input.systemMessageId}`.as('id'),
          project_id: sql<string>`${input.projectId}`.as('project_id'),
          role: sql<'system'>`'system'`.as('role'),
          agent: sql<null>`null`.as('agent'),
          content: sql<string>`${`Saved version ${input.number}.`}`.as('content'),
          created_at: sql<number>`${input.systemCreatedAt}`.as('created_at'),
        })
        .from(projects)
        .where(active(run)),
    ),
  ])
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
