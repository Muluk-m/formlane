import { followupSchema } from '@atoms-demo/contracts'
import { isUuid, slugify } from '@atoms-demo/core/html'
import { type Context, Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { streamSSE } from 'hono/streaming'
import { type Db, openDb } from './db/client'
import type { Env } from './env'
import { mockEnabled } from './env'
import {
  acquireLock,
  currentHtml,
  getProject,
  getPublished,
  getVersion,
  insertMessage,
  isRunActive,
  setStatus,
  versionCount,
} from './modules/projects/projects.repo'
import { publicGenerationError } from './openai'
import { runPipeline } from './pipeline'
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
  return c.body(version.html, 200, {
    'content-type': 'text/html; charset=utf-8',
    'content-disposition': `attachment; filename="${slugify(row.title)}-v${version.number}.html"`,
  })
})
app.post('/api/projects/:id/generate', (c) => beginStream(c, 'initial'))
app.post('/api/projects/:id/chat', (c) => beginStream(c, 'followup'))
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
export default app

async function beginStream(c: Context<AppEnv>, mode: 'initial' | 'followup') {
  const db = c.get('db'),
    ownerId = c.get('ownerId')
  const row = await getProject(db, c.req.param('id') ?? '', ownerId)
  if (!row) return c.json({ error: 'Project not found.' }, 404)
  if (!mockEnabled(c.env) && !c.env.OPENAI_API_KEY?.trim())
    return c.json({ error: 'Generation is unavailable: OPENAI_API_KEY is not configured.' }, 503)
  const count = await versionCount(db, row.id)
  if (mode === 'initial' && count > 0)
    return c.json({ error: 'This project already has a build. Send a follow-up instead.' }, 400)
  if (mode === 'followup' && count === 0)
    return c.json({ error: 'Build the first version before asking for changes.' }, 400)
  let requestText = row.idea
  if (mode === 'followup') {
    const parsed = followupSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success)
      return c.json({ error: 'Describe the change in 1 to 4000 characters.' }, 400)
    requestText = parsed.data.content
  }
  const run = { projectId: row.id, runId: crypto.randomUUID() }
  if (!(await acquireLock(db, row.id, ownerId, Date.now(), run.runId)))
    return c.json({ error: 'The team is already working on this project.' }, 409)
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 120_000)
  const onClientAbort = () => controller.abort()
  c.req.raw.signal.addEventListener('abort', onClientAbort)
  if (c.req.raw.signal.aborted) controller.abort()
  return streamSSE(c, async (stream) => {
    stream.onAbort(onClientAbort)
    const emit = async (event: string, data: unknown) => {
      await stream.writeSSE({ event, data: JSON.stringify(data) })
    }
    // A database fence handles cancellation across isolates; abort the upstream fetch promptly.
    let checking = false
    const cancellation = setInterval(() => {
      if (checking) return
      checking = true
      void isRunActive(db, run)
        .then((active) => {
          if (!active) controller.abort()
        })
        .catch(() => controller.abort())
        .finally(() => {
          checking = false
        })
    }, 1000)
    try {
      if (mode === 'followup')
        await insertMessage(
          db,
          {
            id: crypto.randomUUID(),
            projectId: row.id,
            role: 'user',
            agent: null,
            content: requestText,
            createdAt: Date.now(),
          },
          run,
        )
      await runPipeline({
        env: c.env,
        db,
        run,
        projectId: row.id,
        idea: row.idea,
        mode,
        requestText,
        signal: controller.signal,
        emit,
      })
    } catch (error) {
      const active = await isRunActive(db, run)
      const aborted =
        controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      const message = aborted ? 'Generation stopped.' : publicGenerationError(error)
      if (active) {
        await insertMessage(
          db,
          {
            id: crypto.randomUUID(),
            projectId: row.id,
            role: 'system',
            agent: null,
            content: message,
            createdAt: Date.now(),
          },
          run,
        )
        await setStatus(db, run, aborted ? 'idle' : 'error', aborted ? null : message, Date.now())
      }
      if (!aborted)
        console.error(JSON.stringify({ event: 'pipeline_error', projectId: row.id, message }))
      // The previous version remains available after failed or cancelled generation.
      try {
        const latest = await getProject(db, row.id, ownerId)
        const html = await currentHtml(db, latest?.current_version_id ?? null)
        if (html) await emit('preview', { html })
        if (!aborted) await emit('error', { message })
        await emit('done', { status: aborted ? 'idle' : 'error' })
      } catch {
        /* The client may already have disconnected. */
      }
    } finally {
      clearInterval(cancellation)
      clearTimeout(timer)
      c.req.raw.signal.removeEventListener('abort', onClientAbort)
    }
  })
}
