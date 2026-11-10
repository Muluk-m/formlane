import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath, URL } from 'node:url'
import { messageSchema, runEventSchema, runSchema } from '@atoms-demo/contracts'
import { sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/d1'
import { Miniflare } from 'miniflare'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Db } from '../../db/client'
import * as schema from '../../db/schema'
import worker from '../../index'
import * as projects from './projects.repo'
import * as runs from './runs.repo'

let runtime: Miniflare
let db: Db
let binding: D1Database
const ownerId = '11111111-1111-4111-8111-111111111111'
const projectId = '22222222-2222-4222-8222-222222222222'
const result = {
  html: '<!doctype html><html><body><button>Save</button></body></html>',
  summary: 'Saved the validated app.',
}

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
  binding = await runtime.getD1Database('DB')
  const directory = fileURLToPath(new URL('../../../migrations/', import.meta.url))
  for (const name of (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()) {
    const source = await readFile(`${directory}/${name}`, 'utf8')
    for (const statement of source
      .replace(/--[^\n]*/g, '')
      .split(';')
      .map((sql) => sql.trim())
      .filter(Boolean))
      await binding.prepare(statement).run()
  }
  db = drizzle(binding, { schema })
  await projects.createProject(db, {
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

async function create(now = 2, request = 'Build the app') {
  const run = await runs.createRun(db, {
    id: crypto.randomUUID(),
    projectId,
    ownerId,
    request,
    addMessage: true,
    now,
  })
  if (!run) throw new Error('Expected run creation to win the project fence.')
  return run
}

async function claim(now = 3, workerId = crypto.randomUUID()) {
  const run = await runs.claimRun(db, workerId, now)
  if (!run?.lease_token) throw new Error('Expected a leased run.')
  return { ...run, lease_token: run.lease_token }
}

describe('durable generation persistence on real D1', () => {
  it('restricts executor routes to the bearer and preserves the browser cancellation fence', async () => {
    const queued = await create(Date.now())
    const env = { DB: binding, EXECUTOR_TOKEN: crypto.randomUUID() }
    const request = (
      path: string,
      method: string,
      body?: unknown,
      headers: Record<string, string> = {},
    ) =>
      worker.fetch(
        new Request(`http://localhost/internal/executor${path}`, {
          method,
          headers: {
            authorization: `Bearer ${env.EXECUTOR_TOKEN}`,
            'content-type': 'application/json',
            ...headers,
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        env,
      )
    expect(
      (await request('/claim', 'POST', { workerId: 'vm' }, { authorization: '' })).status,
    ).toBe(401)
    expect(
      (
        await request(
          '/claim',
          'POST',
          { workerId: 'vm' },
          { authorization: 'Bearer invalid-token-token' },
        )
      ).status,
    ).toBe(401)
    const claimed = await request('/claim', 'POST', { workerId: 'vm' })
    expect(claimed.status).toBe(200)
    const payload = (await claimed.json()) as {
      job: {
        context: { runId: string; idea: string; request: string; previousHtml: string | null }
        leaseToken: string
        deadline: number
      }
    }
    expect(payload.job.context).toMatchObject({
      runId: queued.id,
      idea: 'Build a planner',
      request: 'Build the app',
      previousHtml: null,
    })
    const path = `/runs/${queued.id}`
    const leaseToken = payload.job.leaseToken
    expect(
      await (
        await request(`${path}/checkpoint/draft`, 'GET', undefined, {
          'x-executor-lease': leaseToken,
        })
      ).json(),
    ).toEqual({ found: false })
    expect(
      (await request(`${path}/checkpoint/draft`, 'PUT', { leaseToken, result: null })).status,
    ).toBe(200)
    expect(
      await (
        await request(`${path}/checkpoint/draft`, 'GET', undefined, {
          'x-executor-lease': leaseToken,
        })
      ).json(),
    ).toEqual({ found: true, result: null })
    expect(
      (
        await request(`${path}/events`, 'POST', {
          leaseToken,
          key: 'state:completed',
          type: 'run_state',
          data: {},
        })
      ).status,
    ).toBe(400)
    const cancelled = await worker.fetch(
      new Request(`http://localhost/api/projects/${projectId}/runs/${queued.id}/cancel`, {
        method: 'POST',
        headers: { 'x-owner-id': ownerId },
      }),
      env,
    )
    expect(cancelled.status).toBe(200)
    expect(await (await request(`${path}/heartbeat`, 'POST', { leaseToken })).json()).toMatchObject(
      { active: false, status: 'cancelled' },
    )
    expect(
      (
        await request(`${path}/checkpoint/draft`, 'GET', undefined, {
          'x-executor-lease': leaseToken,
        })
      ).status,
    ).toBe(409)
    expect((await request(`${path}/complete`, 'POST', { leaseToken, result })).status).toBe(409)
    expect(
      (
        await request(`${path}/fail`, 'POST', {
          leaseToken,
          code: 'provider',
          message: 'private payload',
        })
      ).status,
    ).toBe(409)
    expect(await projects.listVersions(db, projectId)).toEqual([])
  })

  it('returns replay-safe completion and only sanitized failures over the executor API', async () => {
    const first = await create(Date.now())
    const leased = await claim(Date.now())
    const env = { DB: binding, EXECUTOR_TOKEN: crypto.randomUUID() }
    const complete = () =>
      worker.fetch(
        new Request(`http://localhost/internal/executor/runs/${first.id}/complete`, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${env.EXECUTOR_TOKEN}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ leaseToken: leased.lease_token, result }),
        }),
        env,
      )
    expect((await complete()).status).toBe(200)
    expect((await complete()).status).toBe(200)
    await projects.publishProject(db, projectId, ownerId, 'planner', Date.now())
    const followup = await create(Date.now(), 'Follow up')
    const followupLease = await claim(Date.now())
    expect(followup.previous_version_id).toBe(first.id)
    const replay = await worker.fetch(
      new Request('http://localhost/internal/executor/claim', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.EXECUTOR_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ workerId: followupLease.lease_owner }),
      }),
      env,
    )
    expect(await replay.json()).toMatchObject({
      job: { context: { runId: followup.id, request: 'Follow up', previousHtml: result.html } },
    })
    const failure = await worker.fetch(
      new Request(`http://localhost/internal/executor/runs/${followup.id}/fail`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${env.EXECUTOR_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          leaseToken: followupLease.lease_token,
          code: 'provider',
          message: 'private upstream secret',
        }),
      }),
      env,
    )
    expect(failure.status).toBe(200)
    expect((await runs.getRun(db, followup.id))?.error).not.toContain('private upstream secret')
    expect((await projects.getPublished(db, 'planner'))?.html).toBe(result.html)
    expect(await projects.listVersions(db, projectId)).toHaveLength(1)
  })

  it('claims exactly once across pollers and replays a lost claim response for the same worker', async () => {
    const queued = await create()
    const attempts = await Promise.all(
      ['worker-a', 'worker-b', 'worker-c'].map((worker) => runs.claimRun(db, worker, 3)),
    )
    const winners = attempts.filter((run) => run !== null)
    expect(winners).toHaveLength(1)
    const winner = winners[0]
    if (!winner?.lease_owner) throw new Error('Expected one claim winner.')
    expect(winner.id).toBe(queued.id)
    expect(await runs.claimRun(db, winner.lease_owner, 4)).toMatchObject({
      id: winner.id,
      lease_token: winner.lease_token,
      lease_expires_at: winner.lease_expires_at,
    })
    expect(await runs.claimRun(db, 'worker-other', 4)).toBeNull()
    expect(
      (await runs.listRunEvents(db, queued.id, 0)).filter(
        (event) => event.data.status === 'running',
      ),
    ).toHaveLength(1)
    const receipt = await runs.runReceipt(db, winner)
    expect(receipt).not.toHaveProperty('lease_token')
    expect(receipt).not.toHaveProperty('lease_owner')
  })

  it('keeps the queue concurrency at one and claims the next project after completion', async () => {
    const first = await create()
    const otherId = crypto.randomUUID()
    await projects.createProject(db, {
      id: otherId,
      ownerId,
      idea: 'Another app',
      title: 'Other',
      messageId: crypto.randomUUID(),
      now: 3,
    })
    const second = await runs.createRun(db, {
      id: crypto.randomUUID(),
      projectId: otherId,
      ownerId,
      request: 'Build',
      addMessage: false,
      now: 4,
    })
    const leased = await claim(5, 'first-worker')
    expect(leased.id).toBe(first.id)
    expect(await runs.claimRun(db, 'second-worker', 6)).toBeNull()
    await runs.completeRun(db, first.id, leased.lease_token, result, 7)
    expect((await claim(8, 'second-worker')).id).toBe(second?.id)
  })

  it('renews live leases but cannot revive an expired lease or mutate through a stale token', async () => {
    const run = await create()
    const first = await claim(3, 'old-worker')
    expect(await runs.heartbeat(db, run.id, first.lease_token, 10_000)).toBe(true)
    expect(await runs.claimRun(db, 'new-worker', 60_003)).toBeNull()
    expect(await runs.heartbeat(db, run.id, first.lease_token, 70_000)).toBe(false)
    const replacement = await claim(70_000, 'new-worker')
    expect(replacement.id).toBe(first.id)
    expect(replacement.started_at).toBe(3)
    expect(replacement.lease_token).not.toBe(first.lease_token)
    expect(await runs.heartbeat(db, run.id, first.lease_token, 70_001)).toBe(false)
    expect(
      await runs.appendEvent(
        db,
        run.id,
        first.lease_token,
        'stale',
        'token',
        { text: 'old' },
        70_001,
      ),
    ).toBe(false)
    expect(
      await runs.putCheckpoint(db, run.id, first.lease_token, 'stale', { old: true }, 70_001),
    ).toBe(false)
    await runs.completeRun(db, run.id, first.lease_token, result, 70_001)
    await runs.finishRun(
      db,
      run.id,
      'failed',
      'provider',
      'Stale failure',
      70_001,
      first.lease_token,
    )
    expect((await runs.getRun(db, run.id))?.status).toBe('running')
    expect(await projects.listVersions(db, projectId)).toEqual([])
    expect((await runs.listRunEvents(db, run.id, 0)).map((event) => event.type)).toEqual([
      'run_state',
      'run_state',
    ])
    expect(
      await runs.getCheckpoint(db, run.id, replacement.lease_token, 'stale', 70_002),
    ).toBeNull()
    await runs.completeRun(db, run.id, replacement.lease_token, result, 70_002)
    expect(await projects.listVersions(db, projectId)).toHaveLength(1)
  })

  it('preserves immutable JSON checkpoints across crashes, including JSON null', async () => {
    const run = await create()
    const first = await claim()
    const draft = { html: result.html, notes: ['validated'], nested: { ok: true } }
    expect(await runs.putCheckpoint(db, run.id, first.lease_token, 'draft', draft, 4)).toBe(true)
    expect(await runs.putCheckpoint(db, run.id, first.lease_token, 'nullable', null, 4)).toBe(true)
    await runs.putCheckpoint(db, run.id, first.lease_token, 'draft', { overwrite: true }, 5)
    const replacement = await claim(60_003)
    expect(await runs.getCheckpoint(db, run.id, first.lease_token, 'draft', 60_004)).toBeNull()
    expect(await runs.getCheckpoint(db, run.id, replacement.lease_token, 'draft', 60_004)).toEqual({
      result: draft,
    })
    expect(
      await runs.getCheckpoint(db, run.id, replacement.lease_token, 'nullable', 60_004),
    ).toEqual({ result: null })
    expect(
      await runs.getCheckpoint(db, run.id, replacement.lease_token, 'missing', 60_004),
    ).toBeNull()
    await runs.finishRun(db, run.id, 'cancelled', null, 'Generation cancelled.', 60_005)
    expect(await runs.heartbeat(db, run.id, replacement.lease_token, 60_006)).toBe(false)
    expect(
      await runs.putCheckpoint(db, run.id, replacement.lease_token, 'after-cancel', 'late', 60_006),
    ).toBe(false)
    expect(
      await runs.getCheckpoint(db, run.id, replacement.lease_token, 'draft', 60_006),
    ).toBeNull()
  })

  it('scopes run receipts and histories to their project owner', async () => {
    const run = await create()
    const stranger = crypto.randomUUID()
    expect(await projects.getProject(db, projectId, stranger)).toBeNull()
    expect(await runs.getOwnedRun(db, projectId, run.id, stranger)).toBeNull()
    expect(await runs.latestOwnedRun(db, projectId, stranger)).toBeNull()
    expect(await runs.getOwnedRun(db, crypto.randomUUID(), run.id, ownerId)).toBeNull()
    expect(runSchema.parse(await runs.runReceipt(db, run)).status).toBe('queued')
  })

  it('allows exactly one concurrent run and does not steal a live run after three minutes', async () => {
    const contenders = await Promise.all(
      Array.from({ length: 3 }, () =>
        runs.createRun(db, {
          id: crypto.randomUUID(),
          projectId,
          ownerId,
          request: 'Build',
          addMessage: false,
          now: 2,
        }),
      ),
    )
    expect(contenders.filter(Boolean)).toHaveLength(1)
    expect(
      await runs.createRun(db, {
        id: crypto.randomUUID(),
        projectId,
        ownerId,
        request: 'Steal',
        addMessage: false,
        now: 200_000,
      }),
    ).toBeNull()
    const current = await projects.getProject(db, projectId, ownerId)
    expect(current?.run_id).toBe(contenders.find(Boolean)?.id)
  })

  it('replays committed events after the cursor without rerunning generation or duplicating messages', async () => {
    const run = await create()
    const leased = await claim()
    const message = {
      id: crypto.randomUUID(),
      role: 'agent',
      agent: 'alex',
      content: 'Implementation complete.',
      createdAt: 4,
    }
    await runs.appendEvent(db, run.id, leased.lease_token, 'delegate:0', 'message_done', message, 4)
    await runs.appendEvent(db, run.id, leased.lease_token, 'delegate:0', 'message_done', message, 5)
    const before = await runs.listRunEvents(db, run.id, 0)
    expect(before.map((event) => event.type)).toEqual(['run_state', 'run_state', 'message_done'])
    for (const event of before) expect(runEventSchema.safeParse(event).success).toBe(true)
    const runningEvent = before[1]
    if (!runningEvent) throw new Error('Expected a persisted running event.')
    const cursor = runningEvent.sequence
    // A new observer only reads the existing durable log; no new create/start call occurs.
    expect(await runs.listRunEvents(db, run.id, cursor)).toEqual([before[2]])
    expect(
      (await projects.listMessages(db, projectId)).filter((entry) => entry.id === message.id),
    ).toHaveLength(1)
    expect((await runs.getRun(db, run.id))?.status).toBe('running')
  })

  it('commits one final version and one terminal event under checkpoint replay', async () => {
    const run = await create()
    const leased = await claim()
    await runs.completeRun(db, run.id, leased.lease_token, result, 4)
    await runs.completeRun(db, run.id, leased.lease_token, { ...result, html: 'late replay' }, 5)
    expect(await projects.listVersions(db, projectId)).toHaveLength(1)
    expect((await projects.getVersion(db, projectId, run.id))?.html).toBe(result.html)
    expect(await projects.getProject(db, projectId, ownerId)).toMatchObject({
      status: 'idle',
      run_id: null,
      current_version_id: run.id,
    })
    expect(await runs.getRun(db, run.id)).toMatchObject({ status: 'completed', version_id: run.id })
    const events = await runs.listRunEvents(db, run.id, 0)
    expect(events.filter((event) => event.type === 'version')).toHaveLength(1)
    expect(events.filter((event) => event.data.status === 'completed')).toHaveLength(1)
    for (const message of await projects.listMessages(db, projectId))
      expect(messageSchema.safeParse(message).success).toBe(true)
  })

  it('persists cancellation before late writes and permits an initial retry with new instruction', async () => {
    const first = await create()
    const leased = await claim()
    await runs.finishRun(db, first.id, 'cancelled', null, 'Generation cancelled.', 3)
    const second = await create(4, 'Build a calendar instead')
    await runs.completeRun(db, first.id, leased.lease_token, result, 5)
    await runs.appendEvent(db, first.id, leased.lease_token, 'late', 'token', { text: 'stale' }, 6)
    await runs.finishRun(db, first.id, 'failed', 'provider', 'Stale failure', 7)
    expect(await projects.listVersions(db, projectId)).toHaveLength(0)
    expect(await projects.getProject(db, projectId, ownerId)).toMatchObject({
      status: 'generating',
      run_id: second.id,
      error: null,
    })

    expect(second).toMatchObject({ request: 'Build a calendar instead', previous_version_id: null })
    expect((await runs.listRunEvents(db, first.id, 0)).map((event) => event.data.status)).toEqual([
      'queued',
      'running',
      'cancelled',
    ])
    expect(await runs.getRun(db, first.id)).toMatchObject({ status: 'cancelled', error_code: null })
  })
  it('rolls back version and event inserts when final publication cannot commit', async () => {
    const run = await create()
    const leased = await claim()
    await db.run(sql`create trigger reject_publication before update of current_version_id on projects
      begin select raise(abort, 'publication blocked'); end`)
    await expect(runs.completeRun(db, run.id, leased.lease_token, result, 4)).rejects.toThrow()
    expect(await projects.listVersions(db, projectId)).toHaveLength(0)
    expect((await runs.getRun(db, run.id))?.status).toBe('running')
    expect((await runs.listRunEvents(db, run.id, 0)).map((event) => event.type)).toEqual([
      'run_state',
      'run_state',
    ])
    expect((await projects.getProject(db, projectId, ownerId))?.current_version_id).toBeNull()
  })

  it('keeps current and published versions on provider failure and reports a distinct failed run', async () => {
    const first = await create()
    const firstLease = await claim()
    await runs.completeRun(db, first.id, firstLease.lease_token, result, 3)
    await projects.publishProject(db, projectId, ownerId, 'planner', 4)
    const followup = await create(5, 'Improve the planner')
    const followupLease = await claim(5)
    await runs.finishRun(
      db,
      followup.id,
      'failed',
      'provider',
      'Provider unavailable.',
      6,
      followupLease.lease_token,
    )
    await runs.completeRun(db, followup.id, followupLease.lease_token, result, 7)
    expect(await projects.getProject(db, projectId, ownerId)).toMatchObject({
      current_version_id: first.id,
      published_version_id: first.id,
      status: 'error',
    })
    expect((await projects.getPublished(db, 'planner'))?.html).toBe(result.html)
    expect(await projects.listVersions(db, projectId)).toHaveLength(1)
    expect(await runs.getRun(db, followup.id)).toMatchObject({
      status: 'failed',
      error_code: 'provider',
    })
  })

  it('enforces the persisted fifteen-minute deadline on writes before the scheduler runs', async () => {
    const run = await create()
    const deadline = 2 + 15 * 60 * 1000
    const leased = await claim(deadline - 1)
    expect(await runs.isLeaseActive(db, run.id, leased.lease_token, deadline - 1)).toBe(true)
    expect(await runs.isLeaseActive(db, run.id, leased.lease_token, deadline)).toBe(false)
    await runs.completeRun(db, run.id, leased.lease_token, result, deadline)
    expect(await projects.listVersions(db, projectId)).toHaveLength(0)
    expect((await runs.expiredRuns(db, deadline)).map((entry) => entry.id)).toEqual([run.id])
    await runs.finishRun(db, run.id, 'failed', 'timeout', 'Execution budget exceeded.', deadline)
    expect(await runs.getRun(db, run.id)).toMatchObject({ status: 'failed', error_code: 'timeout' })
  })

  it('restores a saved version and atomically fences the active executor', async () => {
    const first = await create()
    const firstLease = await claim()
    await runs.completeRun(db, first.id, firstLease.lease_token, result, 3)
    const second = await create(4)
    const secondLease = await claim(4)
    await runs.completeRun(
      db,
      second.id,
      secondLease.lease_token,
      { ...result, html: '<html>Second version</html>' },
      5,
    )
    const active = await create(6)
    const activeLease = await claim(6)
    await projects.restoreVersion(db, {
      projectId,
      ownerId,
      versionId: first.id,
      messageId: crypto.randomUUID(),
      now: 7,
    })
    await runs.completeRun(db, active.id, activeLease.lease_token, result, 8)
    expect(await runs.heartbeat(db, active.id, activeLease.lease_token, 8)).toBe(false)
    expect((await projects.getProject(db, projectId, ownerId))?.current_version_id).toBe(first.id)
    expect(await projects.listVersions(db, projectId)).toHaveLength(2)
    expect((await runs.getRun(db, active.id))?.status).toBe('cancelled')
    expect((await runs.listRunEvents(db, active.id, 0)).at(-1)?.data.status).toBe('cancelled')
  })

  it('remixes saved history and deletes run events with a project', async () => {
    const run = await create()
    const leased = await claim()
    await runs.putCheckpoint(db, run.id, leased.lease_token, 'draft', { html: result.html }, 3)
    await runs.completeRun(db, run.id, leased.lease_token, result, 3)
    const remix = await projects.remixProject(db, projectId, ownerId)
    if (!remix) throw new Error('Expected the saved project to remix.')
    expect(remix.currentVersionId).not.toBe(run.id)
    expect(await projects.listVersions(db, remix.id)).toHaveLength(1)
    await projects.deleteProject(db, projectId, ownerId)
    expect(await runs.getRun(db, run.id)).toBeNull()
    expect(await runs.listRunEvents(db, run.id, 0)).toEqual([])
    expect(await db.select().from(schema.runCheckpoints)).toEqual([])
    expect(await projects.getProject(db, remix.id, ownerId)).not.toBeNull()
  })
})
