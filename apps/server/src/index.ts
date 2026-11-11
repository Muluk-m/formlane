import { followupSchema, generateSchema } from '@atoms-demo/contracts'
import { isUuid, slugify } from '@atoms-demo/core/html'
import { strToU8, zipSync } from 'fflate'
import { type Context, Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import { type Db, openDb } from './db/client'
import type { Env } from './env'
import { executorRoutes } from './executor/routes'
import { getProject, getPublished, getVersion } from './modules/projects/projects.repo'
import * as runs from './modules/projects/runs.repo'
import {
  cancelGeneration,
  expireGeneration,
  maintainGenerations,
} from './modules/projects/runs.service'
import { rpcHandler } from './rpc/router'

type AppEnv = { Bindings: Env; Variables: { ownerId: string; db: Db } }
const app = new Hono<AppEnv>()
app.onError((_error, c) => {
  console.error(JSON.stringify({ event: 'worker_error' }))
  return c.json({ error: 'Something went wrong.' }, 500)
})
app.use('*', async (c, next) => {
  c.set('db', openDb(c.env.DB))
  await next()
})
app.route('/internal/executor', executorRoutes)
app.get('/p/:slug', async (c) => {
  const published = await getPublished(c.get('db'), c.req.param('slug'))
  if (!published)
    return c.html(
      '<!doctype html><html lang="en"><title>Not published · Atoms Demo</title><h1>This link is not published.</h1><p>Ask the owner to publish the project again.</p></html>',
      404,
    )
  return c.html(published.html, 200, {
    'cache-control': 'no-cache',
    'x-atoms-demo': 'published',
    'x-content-type-options': 'nosniff',
  })
})
app.use('/api/*', async (c, next) => {
  const cookie = getCookie(c, 'atoms_uid')
  const header = c.req.header('x-owner-id')
  const ownerId = isUuid(cookie) ? cookie : isUuid(header) ? header : crypto.randomUUID()
  c.set('ownerId', ownerId)
  setCookie(c, 'atoms_uid', ownerId, {
    path: '/',
    httpOnly: true,
    sameSite: 'Lax',
    maxAge: 60 * 60 * 24 * 365,
    secure: new URL(c.req.url).protocol === 'https:',
  })
  c.header('cache-control', 'no-store')
  await next()
})
app.get('/api/projects/:id/download', async (c) => {
  const db = c.get('db')
  const row = await getProject(db, c.req.param('id'), c.get('ownerId'))
  if (!row) return c.json({ error: 'Project not found.' }, 404)
  const versionId = c.req.query('version') || row.current_version_id
  if (!versionId) return c.json({ error: 'Nothing to download yet.' }, 400)
  const version = await getVersion(db, row.id, versionId)
  if (!version) return c.json({ error: 'Version not found.' }, 404)
  const archive = zipSync(
    Object.fromEntries(
      Object.entries(version.source.files).map(([path, content]) => [path, strToU8(content)]),
    ),
    { level: 0 },
  )
  return new Response(archive, {
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/zip',
      'content-disposition': `attachment; filename="${slugify(row.title)}-v${version.number}.zip"`,
      'x-content-type-options': 'nosniff',
    },
  })
})
app.post('/api/projects/:id/generate', (c) => beginRun(c, 'initial'))
app.post('/api/projects/:id/chat', (c) => beginRun(c, 'followup'))
app.get('/api/projects/:id/runs/latest', async (c) => {
  const db = c.get('db')
  if (!(await getProject(db, c.req.param('id'), c.get('ownerId'))))
    return c.json({ error: 'Project not found.' }, 404)
  const row = await runs.latestOwnedRun(db, c.req.param('id'), c.get('ownerId'))
  if (!row) return c.json({ run: null })
  return c.json({ run: await runs.runReceipt(db, await expireGeneration(db, row)) })
})
app.get('/api/projects/:id/runs/:runId', async (c) => {
  const db = c.get('db')
  const row = await runs.getOwnedRun(db, c.req.param('id'), c.req.param('runId'), c.get('ownerId'))
  if (!row) return c.json({ error: 'Run not found.' }, 404)
  return c.json({ run: await runs.runReceipt(db, await expireGeneration(db, row)) })
})
app.post('/api/projects/:id/runs/:runId/cancel', async (c) => {
  const db = c.get('db')
  const row = await runs.getOwnedRun(db, c.req.param('id'), c.req.param('runId'), c.get('ownerId'))
  if (!row) return c.json({ error: 'Run not found.' }, 404)
  await cancelGeneration(db, row)
  return c.json({ ok: true })
})
app.get('/api/projects/:id/runs/:runId/events', async (c) => {
  const db = c.get('db')
  const row = await runs.getOwnedRun(db, c.req.param('id'), c.req.param('runId'), c.get('ownerId'))
  if (!row) return c.json({ error: 'Run not found.' }, 404)
  const requested = c.req.query('after') ?? c.req.header('last-event-id') ?? '0'
  if (!/^\d+$/.test(requested) || !Number.isSafeInteger(Number(requested)))
    return c.json({ error: 'Invalid event cursor.' }, 400)
  let cursor = Number(requested)
  await expireGeneration(db, row)
  // This connection only observes D1. Its abort never reaches the executor or model request.
  return streamSSE(c, async (stream) => {
    let idle = 0
    while (!stream.aborted && !c.req.raw.signal.aborted) {
      const events = await runs.listRunEvents(db, row.id, cursor)
      for (const event of events) {
        await stream.writeSSE({
          id: String(event.sequence),
          event: event.type,
          data: JSON.stringify(event),
        })
        cursor = event.sequence
      }
      if (events.length === 100) continue
      const latest = await runs.getOwnedRun(db, row.project_id, row.id, c.get('ownerId'))
      if (!latest) break
      const current = await expireGeneration(db, latest)
      if (runs.isTerminal(current.status)) {
        const remaining = await runs.listRunEvents(db, row.id, cursor)
        for (const event of remaining) {
          await stream.writeSSE({
            id: String(event.sequence),
            event: event.type,
            data: JSON.stringify(event),
          })
          cursor = event.sequence
        }
        if (remaining.length < 100) break
        continue
      }
      if (++idle % 15 === 0) await stream.writeSSE({ event: 'heartbeat', data: '{}' })
      await stream.sleep(1000)
    }
  })
})
app.all('/api/*', async (c) => {
  const origin = new URL(c.req.url)
  // Pages overwrites these headers before forwarding through its service binding.
  if (origin.hostname === 'atoms-api.internal') {
    const host = c.req.header('x-forwarded-host')
    const protocol = c.req.header('x-forwarded-proto')
    if (host && (protocol === 'https' || protocol === 'http')) {
      origin.host = host
      origin.protocol = `${protocol}:`
    }
  }
  const result = await rpcHandler.handle(c.req.raw, {
    prefix: '/api',
    context: { db: c.get('db'), ownerId: c.get('ownerId'), origin: origin.origin, env: c.env },
  })
  return result.matched
    ? c.newResponse(result.response.body, result.response)
    : c.json({ error: 'Not found.' }, 404)
})
app.notFound((c) => c.json({ error: 'Not found.' }, 404))

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledController, env: Env) {
    await maintainGenerations(openDb(env.DB))
  },
} satisfies ExportedHandler<Env>

async function beginRun(c: Context<AppEnv>, mode: 'initial' | 'followup') {
  const db = c.get('db'),
    ownerId = c.get('ownerId')
  const row = await getProject(db, c.req.param('id') ?? '', ownerId)
  if (!row) return c.json({ error: 'Project not found.' }, 404)
  if (!c.env.EXECUTOR_TOKEN?.trim())
    return c.json({ error: 'Generation is unavailable: the executor is not configured.' }, 503)
  if (mode === 'initial' && row.current_version_id)
    return c.json({ error: 'This project already has a build. Send a follow-up instead.' }, 400)
  const body = await c.req.text()
  let input: unknown
  try {
    input = body ? JSON.parse(body) : {}
  } catch {
    return c.json({ error: 'Invalid JSON request.' }, 400)
  }
  const parsed = (mode === 'initial' ? generateSchema : followupSchema).safeParse(input)
  if (!parsed.success) return c.json({ error: 'Describe the change in 1 to 4000 characters.' }, 400)
  if (row.run_id) {
    const previous = await runs.getOwnedRun(db, row.id, row.run_id, ownerId)
    if (previous) await expireGeneration(db, previous)
  }
  const created = await runs.createRun(db, {
    id: crypto.randomUUID(),
    projectId: row.id,
    ownerId,
    request: parsed.data.content ?? row.idea,
    addMessage: Boolean(parsed.data.content),
    now: Date.now(),
  })
  if (!created) return c.json({ error: 'A generation is already running for this project.' }, 409)
  return c.json({ run: await runs.runReceipt(db, created) }, 202)
}
