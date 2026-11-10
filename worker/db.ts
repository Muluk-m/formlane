import type { AppVersion, ChatMessage, Project, ProjectStatus } from "../shared/types";
import { isAgentId } from "../shared/types";

export interface ProjectRow {
  id: string;
  owner_id: string;
  title: string;
  idea: string;
  status: ProjectStatus;
  error: string | null;
  current_version_id: string | null;
  published_slug: string | null;
  published_version_id: string | null;
  created_at: number;
  updated_at: number;
  version_count?: number | null;
}

interface MessageRow {
  id: string;
  role: ChatMessage["role"];
  agent: string | null;
  content: string;
  created_at: number;
}

interface VersionRow {
  id: string;
  number: number;
  prompt: string;
  created_at: number;
  html?: string;
}

const STALE_MS = 3 * 60 * 1000;

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
    versionCount: row.version_count ?? undefined,
  };
}

function toMessage(row: MessageRow): ChatMessage {
  return {
    id: row.id,
    role: row.role,
    agent: isAgentId(row.agent) ? row.agent : null,
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function listProjects(db: D1Database, ownerId: string): Promise<Project[]> {
  const result = await db
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM versions v WHERE v.project_id = p.id) AS version_count
       FROM projects p
       WHERE p.owner_id = ?
       ORDER BY p.updated_at DESC
       LIMIT 60`,
    )
    .bind(ownerId)
    .all<ProjectRow>();
  return (result.results ?? []).map(toProject);
}

export async function getProject(db: D1Database, id: string, ownerId: string): Promise<ProjectRow | null> {
  return db
    .prepare("SELECT * FROM projects WHERE id = ? AND owner_id = ?")
    .bind(id, ownerId)
    .first<ProjectRow>();
}

export async function createProject(
  db: D1Database,
  input: { id: string; ownerId: string; title: string; idea: string; messageId: string; now: number },
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `INSERT INTO projects
          (id, owner_id, title, idea, status, error, current_version_id, published_slug, published_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'idle', NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .bind(input.id, input.ownerId, input.title, input.idea, input.now, input.now),
    db
      .prepare(
        `INSERT INTO messages (id, project_id, role, agent, content, created_at)
         VALUES (?, ?, 'user', NULL, ?, ?)`,
      )
      .bind(input.messageId, input.id, input.idea, input.now + 1),
  ]);
}

export async function listMessages(db: D1Database, projectId: string): Promise<ChatMessage[]> {
  const result = await db
    .prepare(
      `SELECT id, role, agent, content, created_at
       FROM messages WHERE project_id = ? ORDER BY created_at ASC, rowid ASC`,
    )
    .bind(projectId)
    .all<MessageRow>();
  return (result.results ?? []).map(toMessage);
}

export async function insertMessage(
  db: D1Database,
  message: { id: string; projectId: string; role: ChatMessage["role"]; agent: string | null; content: string; createdAt: number },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO messages (id, project_id, role, agent, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(message.id, message.projectId, message.role, message.agent, message.content, message.createdAt)
    .run();
}

export async function listVersions(db: D1Database, projectId: string): Promise<AppVersion[]> {
  const result = await db
    .prepare(
      `SELECT id, number, prompt, created_at FROM versions
       WHERE project_id = ? ORDER BY number ASC`,
    )
    .bind(projectId)
    .all<VersionRow>();
  return (result.results ?? []).map((row) => ({
    id: row.id,
    number: row.number,
    prompt: row.prompt,
    createdAt: row.created_at,
  }));
}

export async function getVersion(
  db: D1Database,
  projectId: string,
  versionId: string,
): Promise<(AppVersion & { html: string }) | null> {
  const row = await db
    .prepare(
      `SELECT id, number, prompt, created_at, html FROM versions
       WHERE project_id = ? AND id = ?`,
    )
    .bind(projectId, versionId)
    .first<VersionRow>();
  if (!row || row.html == null) return null;
  return {
    id: row.id,
    number: row.number,
    prompt: row.prompt,
    createdAt: row.created_at,
    html: row.html,
  };
}

export async function currentHtml(db: D1Database, versionId: string | null): Promise<string | null> {
  if (!versionId) return null;
  const row = await db.prepare("SELECT html FROM versions WHERE id = ?").bind(versionId).first<{ html: string }>();
  return row?.html ?? null;
}

export async function versionCount(db: D1Database, projectId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM versions WHERE project_id = ?")
    .bind(projectId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function nextVersionNumber(db: D1Database, projectId: string): Promise<number> {
  const row = await db
    .prepare("SELECT COALESCE(MAX(number), 0) AS n FROM versions WHERE project_id = ?")
    .bind(projectId)
    .first<{ n: number }>();
  return (row?.n ?? 0) + 1;
}

export async function acquireLock(db: D1Database, projectId: string, ownerId: string, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE projects
       SET status = 'generating', error = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ?
         AND (status != 'generating' OR updated_at < ?)`,
    )
    .bind(now, projectId, ownerId, now - STALE_MS)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function setStatus(
  db: D1Database,
  projectId: string,
  status: ProjectStatus,
  error: string | null,
  now: number,
): Promise<void> {
  await db
    .prepare("UPDATE projects SET status = ?, error = ?, updated_at = ? WHERE id = ?")
    .bind(status, error, now, projectId)
    .run();
}

export async function touchProject(db: D1Database, projectId: string, now: number): Promise<void> {
  await db.prepare("UPDATE projects SET updated_at = ? WHERE id = ?").bind(now, projectId).run();
}

export async function renameProject(db: D1Database, projectId: string, title: string, now: number): Promise<void> {
  await db
    .prepare("UPDATE projects SET title = ?, updated_at = ? WHERE id = ?")
    .bind(title, now, projectId)
    .run();
}

export async function saveVersion(
  db: D1Database,
  input: {
    id: string;
    projectId: string;
    number: number;
    html: string;
    prompt: string;
    createdAt: number;
    systemMessageId: string;
    systemCreatedAt: number;
  },
): Promise<void> {
  const label = `Saved version ${input.number}.`;
  await db.batch([
    db
      .prepare(
        `INSERT INTO versions (id, project_id, number, html, prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .bind(input.id, input.projectId, input.number, input.html, input.prompt, input.createdAt),
    db
      .prepare(
        `UPDATE projects
         SET current_version_id = ?, updated_at = ?
         WHERE id = ?`,
      )
      .bind(input.id, input.createdAt, input.projectId),
    db
      .prepare(
        `INSERT INTO messages (id, project_id, role, agent, content, created_at)
         VALUES (?, ?, 'system', NULL, ?, ?)`,
      )
      .bind(input.systemMessageId, input.projectId, label, input.systemCreatedAt),
  ]);
}

export async function restoreVersion(
  db: D1Database,
  input: { projectId: string; ownerId: string; versionId: string; messageId: string; now: number },
): Promise<{ html: string; number: number } | null> {
  const project = await getProject(db, input.projectId, input.ownerId);
  if (!project) return null;
  const version = await getVersion(db, input.projectId, input.versionId);
  if (!version) return null;
  await db.batch([
    db
      .prepare("UPDATE projects SET current_version_id = ?, updated_at = ?, status = 'idle', error = NULL WHERE id = ?")
      .bind(version.id, input.now, input.projectId),
    db
      .prepare(
        `INSERT INTO messages (id, project_id, role, agent, content, created_at)
         VALUES (?, ?, 'system', NULL, ?, ?)`,
      )
      .bind(input.messageId, input.projectId, `Restored version ${version.number}.`, input.now),
  ]);
  return { html: version.html, number: version.number };
}

export async function deleteProject(db: D1Database, projectId: string, ownerId: string): Promise<boolean> {
  const project = await getProject(db, projectId, ownerId);
  if (!project) return false;
  await db.batch([
    db.prepare("DELETE FROM messages WHERE project_id = ?").bind(projectId),
    db.prepare("DELETE FROM versions WHERE project_id = ?").bind(projectId),
    db.prepare("DELETE FROM projects WHERE id = ? AND owner_id = ?").bind(projectId, ownerId),
  ]);
  return true;
}

export async function publishProject(
  db: D1Database,
  projectId: string,
  ownerId: string,
  slug: string,
  now: number,
): Promise<{ slug: string; versionId: string } | null> {
  const project = await getProject(db, projectId, ownerId);
  if (!project?.current_version_id) return null;
  const nextSlug = project.published_slug || slug;
  await db
    .prepare(
      `UPDATE projects
       SET published_slug = ?, published_version_id = ?, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    )
    .bind(nextSlug, project.current_version_id, now, projectId, ownerId)
    .run();
  return { slug: nextSlug, versionId: project.current_version_id };
}

export async function unpublishProject(db: D1Database, projectId: string, ownerId: string, now: number): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE projects
       SET published_slug = NULL, published_version_id = NULL, updated_at = ?
       WHERE id = ? AND owner_id = ?`,
    )
    .bind(now, projectId, ownerId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function getPublished(db: D1Database, slug: string): Promise<{ title: string; html: string } | null> {
  const row = await db
    .prepare(
      `SELECT p.title AS title, v.html AS html
       FROM projects p
       JOIN versions v ON v.id = p.published_version_id
       WHERE p.published_slug = ?`,
    )
    .bind(slug)
    .first<{ title: string; html: string }>();
  return row ?? null;
}

export async function remixProject(db: D1Database, sourceId: string, ownerId: string): Promise<Project | null> {
  const source = await getProject(db, sourceId, ownerId);
  if (!source) return null;
  const now = Date.now();
  const id = crypto.randomUUID();
  const messages = await listMessages(db, sourceId);
  const versions = await db
    .prepare("SELECT id, number, prompt, created_at, html FROM versions WHERE project_id = ? ORDER BY number ASC")
    .bind(sourceId)
    .all<VersionRow>();
  const versionRows = versions.results ?? [];
  const versionIds = new Map<string, string>();
  const statements: D1PreparedStatement[] = [
    db
      .prepare(
        `INSERT INTO projects
          (id, owner_id, title, idea, status, error, current_version_id, published_slug, published_version_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'idle', NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .bind(id, ownerId, `${source.title} remix`.slice(0, 80), source.idea, now, now),
  ];
  messages.forEach((message, index) => {
    statements.push(
      db
        .prepare(
          `INSERT INTO messages (id, project_id, role, agent, content, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(crypto.randomUUID(), id, message.role, message.agent, message.content, now + index + 1),
    );
  });
  versionRows.forEach((version, index) => {
    const versionId = crypto.randomUUID();
    versionIds.set(version.id, versionId);
    statements.push(
      db
        .prepare(
          `INSERT INTO versions (id, project_id, number, html, prompt, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(versionId, id, version.number, version.html ?? "", version.prompt, now + messages.length + index + 2),
    );
  });
  const current = source.current_version_id ? versionIds.get(source.current_version_id) ?? null : null;
  statements.push(
    db.prepare("UPDATE projects SET current_version_id = ? WHERE id = ?").bind(current, id),
    db
      .prepare(
        `INSERT INTO messages (id, project_id, role, agent, content, created_at)
         VALUES (?, ?, 'system', NULL, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        `Remixed from ${source.title}.`,
        now + messages.length + versionRows.length + 3,
      ),
  );
  const chunkSize = 40;
  for (let index = 0; index < statements.length; index += chunkSize) {
    await db.batch(statements.slice(index, index + chunkSize));
  }
  const created = await getProject(db, id, ownerId);
  return created ? toProject(created) : null;
}
