import { Buffer } from 'node:buffer'
import { timingSafeEqual } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { type Context, Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { z } from 'zod'
import type { Db } from '../db/client'
import { projects } from '../db/schema'
import type { Env } from '../env'
import { publicRunFailure } from '../harness/errors'
import { currentHtml } from '../modules/projects/projects.repo'
import * as runs from '../modules/projects/runs.repo'
import { expireGeneration, maintainGenerations } from '../modules/projects/runs.service'

type ExecutorEnv = { Bindings: Env; Variables: { db: Db } }
export const executorRoutes = new Hono<ExecutorEnv>()
const leaseSchema = z.object({ leaseToken: z.string().uuid() })
const checkpointSchema = leaseSchema.extend({ result: z.unknown() })
const eventSchema = leaseSchema.extend({
  key: z
    .string()
    .min(1)
    .max(300)
    .refine((key) => key !== 'version' && !key.startsWith('state:')),
  type: z
    .string()
    .min(1)
    .max(100)
    .refine((type) => type !== 'run_state' && type !== 'version'),
  data: z.record(z.string(), z.unknown()),
})
const completeSchema = leaseSchema.extend({
  result: z.object({
    html: z.string().min(1).max(1_500_000),
    summary: z.string().min(1).max(20_000),
  }),
})
const failSchema = leaseSchema.extend({
  code: z.enum(['timeout', 'provider', 'validation', 'internal']),
  message: z.string().max(20_000),
})

executorRoutes.use('*', async (c, next) => {
  c.header('cache-control', 'no-store')
  const expected = c.env.EXECUTOR_TOKEN
  const authorization = c.req.header('authorization')
  if (!expected) return c.json({ error: 'Executor is not configured.' }, 503)
  const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : ''
  const supplied = Buffer.from(token)
  const secret = Buffer.from(expected)
  if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret))
    return c.json({ error: 'Unauthorized.' }, 401)
  await next()
})
executorRoutes.use('*', bodyLimit({ maxSize: 2 * 1024 * 1024 }))

executorRoutes.post('/claim', async (c) => {
  const input = z
    .object({ workerId: z.string().min(1).max(200) })
    .safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Invalid claim request.' }, 400)
  const db = c.get('db')
  await maintainGenerations(db)
  const run = await runs.claimRun(db, input.data.workerId, Date.now())
  if (!run) return c.json({ job: null })
  const project = await db.select().from(projects).where(eq(projects.id, run.project_id)).get()
  if (!project || project.run_id !== run.id) return c.json({ job: null })
  return c.json({
    job: {
      context: {
        projectId: run.project_id,
        runId: run.id,
        idea: project.idea,
        request: run.request,
        previousHtml: await currentHtml(db, run.previous_version_id),
      },
      leaseToken: run.lease_token,
      deadline: run.deadline_at,
    },
  })
})

executorRoutes.post('/runs/:runId/heartbeat', async (c) => {
  const input = leaseSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Invalid lease.' }, 400)
  const db = c.get('db')
  const runId = c.req.param('runId')
  const active = await runs.heartbeat(db, runId, input.data.leaseToken, Date.now())
  const row = await runs.getRun(db, runId)
  const current = row ? await expireGeneration(db, row) : null
  return c.json({
    active: active && current?.status === 'running',
    status: current?.status ?? null,
    deadline: current?.deadline_at ?? null,
  })
})

executorRoutes.get('/runs/:runId/checkpoint/:name', async (c) => {
  const input = leaseSchema.safeParse({ leaseToken: c.req.header('x-executor-lease') })
  const name = c.req.param('name')
  if (!input.success || name.length > 300)
    return c.json({ error: 'Invalid checkpoint request.' }, 400)
  const db = c.get('db')
  const runId = c.req.param('runId')
  const checkpoint = await runs.getCheckpoint(db, runId, input.data.leaseToken, name, Date.now())
  if (!(await runs.isLeaseActive(db, runId, input.data.leaseToken, Date.now())))
    return leaseLost(c, runId)
  return c.json(checkpoint ? { found: true, result: checkpoint.result } : { found: false })
})

executorRoutes.put('/runs/:runId/checkpoint/:name', async (c) => {
  const input = checkpointSchema.safeParse(await c.req.json().catch(() => null))
  const name = c.req.param('name')
  if (!input.success || input.data.result === undefined || name.length > 300)
    return c.json({ error: 'Invalid checkpoint request.' }, 400)
  const runId = c.req.param('runId')
  const accepted = await runs.putCheckpoint(
    c.get('db'),
    runId,
    input.data.leaseToken,
    name,
    input.data.result,
    Date.now(),
  )
  return accepted ? c.json({ ok: true }) : leaseLost(c, runId)
})

executorRoutes.post('/runs/:runId/events', async (c) => {
  const input = eventSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Invalid event request.' }, 400)
  const runId = c.req.param('runId')
  const { leaseToken, key, type, data } = input.data
  const accepted = await runs.appendEvent(
    c.get('db'),
    runId,
    leaseToken,
    key,
    type,
    data,
    Date.now(),
  )
  return accepted ? c.json({ ok: true }) : leaseLost(c, runId)
})

executorRoutes.post('/runs/:runId/complete', async (c) => {
  const input = completeSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Invalid completion request.' }, 400)
  const runId = c.req.param('runId')
  const row = await runs.completeRun(
    c.get('db'),
    runId,
    input.data.leaseToken,
    input.data.result,
    Date.now(),
  )
  return row?.status === 'completed' && row.lease_token === input.data.leaseToken
    ? c.json({ ok: true, status: row.status })
    : leaseLost(c, runId)
})

executorRoutes.post('/runs/:runId/fail', async (c) => {
  const input = failSchema.safeParse(await c.req.json().catch(() => null))
  if (!input.success) return c.json({ error: 'Invalid failure request.' }, 400)
  const runId = c.req.param('runId')
  // The executor's raw error message is never persisted or returned to browsers.
  const failure = publicRunFailure({ code: input.data.code })
  const row = await runs.finishRun(
    c.get('db'),
    runId,
    'failed',
    failure.code,
    failure.message,
    Date.now(),
    input.data.leaseToken,
  )
  return row?.status === 'failed' && row.lease_token === input.data.leaseToken
    ? c.json({ ok: true, status: row.status })
    : leaseLost(c, runId)
})

async function leaseLost(c: Context<ExecutorEnv>, runId: string) {
  const row = await runs.getRun(c.get('db'), runId)
  const current = row ? await expireGeneration(c.get('db'), row) : null
  return c.json({ error: 'Run lease is no longer active.', status: current?.status ?? null }, 409)
}
