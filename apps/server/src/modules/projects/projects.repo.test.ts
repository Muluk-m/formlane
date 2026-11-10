import { readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../db/client'
import * as schema from '../../db/schema'
import * as repo from './projects.repo'
import { projectsService } from './projects.service'

let runtime: Miniflare
let db: Db
const ownerId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'

beforeEach(async () => {
  runtime = new Miniflare({
    workers: [
      {
        config: {
          name: 'atoms-test',
          compatibilityDate: '2026-11-10',
          manifest: {
            mainModule: 'index.js',
            modules: {
              'index.js': {
                type: 'esm',
                contents: 'export default { fetch() { return new Response("test") } }',
              },
            },
          },
          env: { DB: { type: 'd1', name: 'atoms-test' } },
        },
      },
    ],
  })
  const binding = await runtime.getD1Database('DB')
  for (const name of ['0001_init.sql', '0002_run_fence.sql']) {
    const source = await readFile(
      fileURLToPath(new URL(`../../../migrations/${name}`, import.meta.url)),
      'utf8',
    )
    for (const statement of source
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((sql) => sql.trim())
      .filter(Boolean))
      await binding.prepare(statement).run()
  }
  db = drizzle(binding, { schema })
  await repo.createProject(db, {
    id: projectId,
    ownerId,
    idea: 'Build a planner',
    title: 'Planner',
    messageId: crypto.randomUUID(),
    now: 1,
  })
})
afterEach(async () => {
  await runtime.dispose()
})

const run = { projectId, runId: 'run-one' }
async function save(runId: string, number = 1) {
  const id = crypto.randomUUID()
  await repo.saveVersion(
    db,
    { projectId, runId },
    {
      id,
      projectId,
      number,
      html: `<!doctype html><html><body>Version ${number}</body></html>`,
      prompt: 'Build',
      createdAt: 10 + number,
      systemMessageId: crypto.randomUUID(),
      systemCreatedAt: 20 + number,
    },
  )
  return id
}

describe('project ownership and generation persistence', () => {
  it('does not reveal or mutate another anonymous owner’s projects', async () => {
    const stranger = { db, ownerId: crypto.randomUUID(), origin: 'https://atoms.example' }
    await expect(projectsService.get(stranger, projectId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    await expect(projectsService.delete(stranger, projectId)).rejects.toMatchObject({
      code: 'NOT_FOUND',
    })
    expect(await repo.getProject(db, projectId, ownerId)).not.toBeNull()
  })
  it('serializes runs and fences all stale writes after cancellation and restart', async () => {
    expect(await repo.acquireLock(db, projectId, ownerId, 2, run.runId)).toBe(true)
    expect(await repo.acquireLock(db, projectId, ownerId, 3, 'competing')).toBe(false)
    await repo.cancelRun(db, projectId, ownerId)
    expect(await repo.acquireLock(db, projectId, ownerId, 4, 'run-two')).toBe(true)
    await save(run.runId)
    await repo.setStatus(db, run, 'error', 'stale error', 5)
    await repo.renameProject(db, run, 'Stale title', 5)
    await repo.insertMessage(
      db,
      {
        id: crypto.randomUUID(),
        projectId,
        role: 'agent',
        agent: 'alex',
        content: 'stale',
        createdAt: 6,
      },
      run,
    )
    expect(await repo.versionCount(db, projectId)).toBe(0)
    expect(await repo.getProject(db, projectId, ownerId)).toMatchObject({
      title: 'Planner',
      status: 'generating',
      run_id: 'run-two',
      error: null,
    })
    expect((await repo.listMessages(db, projectId)).map((message) => message.content)).toEqual([
      'Build a planner',
      'Generation stopped.',
    ])
  })
  it('keeps the last saved and published version when a follow-up fails', async () => {
    await repo.acquireLock(db, projectId, ownerId, 2, run.runId)
    const versionId = await save(run.runId)
    await repo.setStatus(db, run, 'idle', null, 30)
    await repo.publishProject(db, projectId, ownerId, 'planner', 31)
    await repo.acquireLock(db, projectId, ownerId, 32, 'failed-followup')
    await repo.setStatus(
      db,
      { projectId, runId: 'failed-followup' },
      'error',
      'Provider failed.',
      33,
    )
    const row = await repo.getProject(db, projectId, ownerId)
    expect(row?.current_version_id).toBe(versionId)
    expect((await repo.getPublished(db, 'planner'))?.html).toContain('Version 1')
    expect(await repo.versionCount(db, projectId)).toBe(1)
  })
  it('restores an older version while retaining all versions and fencing an active run', async () => {
    await repo.acquireLock(db, projectId, ownerId, 2, run.runId)
    const first = await save(run.runId)
    await save(run.runId, 2)
    await repo.restoreVersion(db, {
      projectId,
      ownerId,
      versionId: first,
      messageId: crypto.randomUUID(),
      now: 40,
    })
    await save(run.runId, 3)
    expect((await repo.getProject(db, projectId, ownerId))?.current_version_id).toBe(first)
    expect(await repo.versionCount(db, projectId)).toBe(2)
  })
})
