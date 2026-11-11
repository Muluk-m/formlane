import { makeSlug } from '@atoms-demo/core/html'
import { titleFromIdea } from '@atoms-demo/core/text'
import { ORPCError } from '@orpc/server'
import type { Db } from '../../db/client'
import type { Env } from '../../env'
import * as repo from './projects.repo'
import { getRun } from './runs.repo'
import { cancelGeneration } from './runs.service'

export type ProjectContext = { db: Db; ownerId: string; origin: string; env: Env }

export async function requireProject({ db, ownerId }: ProjectContext, id: string) {
  const row = await repo.getProject(db, id, ownerId)
  if (!row) throw new ORPCError('NOT_FOUND', { message: 'Project not found.' })
  return row
}

export const projectsService = {
  async list({ db, ownerId }: ProjectContext) {
    return { projects: await repo.listProjects(db, ownerId) }
  },
  async create(context: ProjectContext, idea: string) {
    const id = crypto.randomUUID()
    await repo.createProject(context.db, {
      id,
      ownerId: context.ownerId,
      title: titleFromIdea(idea).slice(0, 80),
      idea,
      messageId: crypto.randomUUID(),
      now: Date.now(),
    })
    return { project: repo.toProject(await requireProject(context, id)) }
  },
  async get(context: ProjectContext, id: string) {
    const row = await requireProject(context, id)
    const [messages, versions, current] = await Promise.all([
      repo.listMessages(context.db, id),
      repo.listVersions(context.db, id),
      repo.currentVersion(context.db, id, row.current_version_id),
    ])
    return {
      project: repo.toProject(row),
      messages,
      versions,
      html: current?.html ?? null,
      source: current?.source ?? null,
    }
  },
  async delete(context: ProjectContext, id: string) {
    await projectsService.cancel(context, id)
    if (!(await repo.deleteProject(context.db, id, context.ownerId)))
      throw new ORPCError('NOT_FOUND')
    return { ok: true as const }
  },
  async version(context: ProjectContext, id: string, versionId: string) {
    await requireProject(context, id)
    const version = await repo.getVersion(context.db, id, versionId)
    if (!version) throw new ORPCError('NOT_FOUND', { message: 'Version not found.' })
    return { version }
  },
  async publish(context: ProjectContext, id: string) {
    const row = await requireProject(context, id)
    if (!row.current_version_id)
      throw new ORPCError('BAD_REQUEST', { message: 'Build a version before publishing.' })
    let published: { slug: string; versionId: string } | null = null
    for (let attempt = 0; attempt < 3 && !published; attempt += 1) {
      try {
        published = await repo.publishProject(
          context.db,
          id,
          context.ownerId,
          makeSlug(),
          Date.now(),
        )
      } catch (error) {
        if (!(error instanceof Error) || !/unique/i.test(error.message) || row.published_slug)
          throw error
      }
    }
    if (!published) throw new ORPCError('INTERNAL_SERVER_ERROR')
    return { ...published, url: new URL(`/p/${published.slug}`, context.origin).toString() }
  },
  async unpublish(context: ProjectContext, id: string) {
    if (!(await repo.unpublishProject(context.db, id, context.ownerId, Date.now())))
      throw new ORPCError('NOT_FOUND')
    return { ok: true as const }
  },
  async remix(context: ProjectContext, id: string, versionId?: string) {
    const project = await repo.remixProject(context.db, id, context.ownerId, versionId)
    if (!project) throw new ORPCError('NOT_FOUND')
    return { project }
  },
  async restore(context: ProjectContext, id: string, versionId: string) {
    await requireProject(context, id)
    const restored = await repo.restoreVersion(context.db, {
      projectId: id,
      ownerId: context.ownerId,
      versionId,
      messageId: crypto.randomUUID(),
      now: Date.now(),
    })
    if (!restored) throw new ORPCError('NOT_FOUND', { message: 'Version not found.' })
    return { ...restored, project: repo.toProject(await requireProject(context, id)) }
  },
  async cancel(context: ProjectContext, id: string) {
    const row = await requireProject(context, id)
    const run = row.run_id ? await getRun(context.db, row.run_id) : null
    if (run) await cancelGeneration(context.db, run)
    return { ok: true as const }
  },
}
