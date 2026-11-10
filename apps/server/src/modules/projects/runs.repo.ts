import type { Run, RunErrorCode, RunEvent } from '@atoms-demo/contracts'
import { and, desc, eq, gt, inArray, lte, max, type SQL, sql } from 'drizzle-orm'
import type { Db } from '../../db/client'
import { messages, projects, runCheckpoints, runEvents, runs, versions } from '../../db/schema'
import { stableUuid } from '../../harness/errors'

export const RUN_BUDGET_MS = 15 * 60 * 1000
export const LEASE_DURATION_MS = 60_000
export type RunRow = typeof runs.$inferSelect
export const isTerminal = (status: Run['status']) =>
  status === 'completed' || status === 'failed' || status === 'cancelled'
const pending = inArray(runs.status, ['queued', 'running'])
const fence = (runId: string) => sql`exists (
  select 1 from runs r join projects p on p.id = r.project_id
  where r.id = ${runId} and r.status in ('queued', 'running')
    and p.run_id = r.id and p.status = 'generating'
)`
const runnable = (runId: string, now: number) =>
  sql`${fence(runId)} and exists (select 1 from runs where id = ${runId} and deadline_at > ${now})`
const leased = (runId: string, leaseToken: string, now: number) => sql`
  ${runnable(runId, now)} and exists (
    select 1 from runs where id = ${runId} and status = 'running'
      and lease_token = ${leaseToken} and lease_expires_at > ${now}
  )`

export function toRun(row: RunRow, cursor: number): Run {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    request: row.request,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    errorCode: row.error_code,
    error: row.error,
    versionId: row.version_id,
    cursor,
  }
}

export async function getRun(db: Db, runId: string) {
  return (await db.select().from(runs).where(eq(runs.id, runId)).get()) ?? null
}

export async function getOwnedRun(db: Db, projectId: string, runId: string, ownerId: string) {
  return (
    (
      await db
        .select({ run: runs })
        .from(runs)
        .innerJoin(projects, eq(projects.id, runs.project_id))
        .where(and(eq(runs.id, runId), eq(projects.id, projectId), eq(projects.owner_id, ownerId)))
        .get()
    )?.run ?? null
  )
}

export async function latestOwnedRun(db: Db, projectId: string, ownerId: string) {
  return (
    (
      await db
        .select({ run: runs })
        .from(runs)
        .innerJoin(projects, eq(projects.id, runs.project_id))
        .where(and(eq(projects.id, projectId), eq(projects.owner_id, ownerId)))
        .orderBy(desc(runs.created_at), desc(runs.id))
        .get()
    )?.run ?? null
  )
}

export async function runReceipt(db: Db, row: RunRow): Promise<Run> {
  const cursor = await db
    .select({ value: max(runEvents.sequence) })
    .from(runEvents)
    .where(eq(runEvents.run_id, row.id))
    .get()
  return toRun(row, cursor?.value ?? 0)
}

/** D1 batch is a transaction: only the winning project fence may insert a run. */
export async function createRun(
  db: Db,
  input: {
    id: string
    projectId: string
    ownerId: string
    request: string
    addMessage: boolean
    now: number
  },
) {
  const owned = and(eq(projects.id, input.projectId), eq(projects.owner_id, input.ownerId))
  await db.batch([
    db
      .update(projects)
      .set({ status: 'generating', run_id: input.id, error: null, updated_at: input.now })
      .where(and(owned, sql`${projects.run_id} is null`)),
    db
      .insert(runs)
      .select(sql`
      select ${input.id}, id, 'queued', ${input.request}, current_version_id,
        ${input.now}, null, null, ${input.now + RUN_BUDGET_MS}, null, null, null, null, null, null
      from projects where id = ${input.projectId} and owner_id = ${input.ownerId} and run_id = ${input.id}
    `)
      .onConflictDoNothing({ target: runs.id }),
    db
      .insert(messages)
      .select(sql`
      select ${input.id}, project_id, 'user', null, request, ${input.now}
      from runs where id = ${input.id} and ${input.addMessage ? 1 : 0} = 1
    `)
      .onConflictDoNothing({ target: messages.id }),
    stateEvent(db, input.id, 'queued', input.now),
  ])
  return getRun(db, input.id)
}

// State payload and its cursor are a snapshot at the transition, not at replay time.
export function stateEvent(db: Db, runId: string | SQL, state: Run['status'], now: number) {
  return db
    .insert(runEvents)
    .select(sql`
    select null, id, ${`state:${state}`}, 'run_state', json_object(
      'id', id, 'projectId', project_id, 'status', status, 'request', request,
      'createdAt', created_at, 'startedAt', started_at, 'finishedAt', finished_at,
      'errorCode', error_code, 'error', error, 'versionId', version_id,
      'cursor', (select coalesce(max(sequence), 0) from run_events where run_id = ${runId})
    ), ${now} from runs where id = ${runId} and status = ${state}
  `)
    .onConflictDoNothing({ target: [runEvents.run_id, runEvents.event_key] })
}

/** One atomic UPDATE selects and leases a job; a live lease enforces executor concurrency one. */
export async function claimRun(db: Db, workerId: string, now: number) {
  const leaseToken = crypto.randomUUID()
  const [, , active] = await db.batch([
    db
      .update(runs)
      .set({
        status: 'running',
        started_at: sql`coalesce(${runs.started_at}, ${now})`,
        lease_token: leaseToken,
        lease_owner: workerId,
        lease_expires_at: sql`min(${runs.deadline_at}, ${now + LEASE_DURATION_MS})`,
      })
      .where(sql`${runs.id} = (
        select r.id from runs r join projects p on p.id = r.project_id
        where r.status in ('queued', 'running') and r.deadline_at > ${now}
          and (r.lease_expires_at is null or r.lease_expires_at <= ${now})
          and p.run_id = r.id and p.status = 'generating'
          and not exists (
            select 1 from runs active join projects owner on owner.id = active.project_id
            where active.status = 'running' and active.lease_expires_at > ${now}
              and active.deadline_at > ${now} and owner.run_id = active.id
              and owner.status = 'generating'
          )
        order by r.created_at, r.id limit 1
      )`),
    stateEvent(db, sql`(select id from runs where lease_token = ${leaseToken})`, 'running', now),
    db
      .select()
      .from(runs)
      .where(
        and(
          eq(runs.lease_owner, workerId),
          eq(runs.status, 'running'),
          gt(runs.lease_expires_at, now),
          gt(runs.deadline_at, now),
          sql`exists (select 1 from projects where run_id = ${runs.id} and status = 'generating')`,
        ),
      )
      .limit(1),
  ])
  return active[0] ?? null
}

export async function isLeaseActive(db: Db, runId: string, leaseToken: string, now: number) {
  return Boolean(
    await db
      .select({ id: runs.id })
      .from(runs)
      .where(and(eq(runs.id, runId), leased(runId, leaseToken, now)))
      .get(),
  )
}

export async function heartbeat(db: Db, runId: string, leaseToken: string, now: number) {
  const rows = await db
    .update(runs)
    .set({ lease_expires_at: sql`min(${runs.deadline_at}, ${now + LEASE_DURATION_MS})` })
    .where(and(eq(runs.id, runId), leased(runId, leaseToken, now)))
    .returning({ id: runs.id })
  return rows.length > 0
}

export async function getCheckpoint(
  db: Db,
  runId: string,
  leaseToken: string,
  name: string,
  now: number,
) {
  return (
    (await db
      .select({ result: runCheckpoints.result })
      .from(runCheckpoints)
      .where(
        and(
          eq(runCheckpoints.run_id, runId),
          eq(runCheckpoints.name, name),
          leased(runId, leaseToken, now),
        ),
      )
      .get()) ?? null
  )
}

/** Checkpoints are immutable and survive lease reclamation; only the active lease can insert. */
export async function putCheckpoint(
  db: Db,
  runId: string,
  leaseToken: string,
  name: string,
  result: unknown,
  now: number,
) {
  const json = JSON.stringify(result)
  if (json === undefined) throw new TypeError('Checkpoints require a JSON value.')
  await db
    .insert(runCheckpoints)
    .select(sql`
    select id, ${name}, ${json}, ${now} from runs
    where id = ${runId} and ${leased(runId, leaseToken, now)}
  `)
    .onConflictDoNothing({ target: [runCheckpoints.run_id, runCheckpoints.name] })
  return isLeaseActive(db, runId, leaseToken, now)
}

export async function appendEvent(
  db: Db,
  runId: string,
  leaseToken: string,
  key: string,
  type: string,
  data: Record<string, unknown>,
  now: number,
) {
  const event = db
    .insert(runEvents)
    .select(sql`
    select null, id, ${key}, ${type}, ${JSON.stringify(data)}, ${now} from runs
    where id = ${runId} and ${leased(runId, leaseToken, now)}
  `)
    .onConflictDoNothing({ target: [runEvents.run_id, runEvents.event_key] })
  if (type === 'message_done' && typeof data.id === 'string' && typeof data.content === 'string') {
    const role = data.role === 'system' ? 'system' : 'agent'
    const agent = typeof data.agent === 'string' ? data.agent : null
    await db.batch([
      event,
      db
        .insert(messages)
        .select(sql`
        select ${data.id}, r.project_id, ${role}, ${agent}, json_extract(e.data, '$.content'), e.created_at
        from runs r join run_events e on e.run_id = r.id
        where r.id = ${runId} and e.event_key = ${key} and ${leased(runId, leaseToken, now)}
          and json_extract(e.data, '$.id') = ${data.id}
      `)
        .onConflictDoUpdate({
          target: messages.id,
          set: { content: sql`excluded.content`, created_at: sql`excluded.created_at` },
        }),
    ])
  } else {
    await event
  }
  return isLeaseActive(db, runId, leaseToken, now)
}

export async function listRunEvents(db: Db, runId: string, after: number): Promise<RunEvent[]> {
  return db
    .select({
      runId: runEvents.run_id,
      sequence: runEvents.sequence,
      type: runEvents.type,
      data: runEvents.data,
      createdAt: runEvents.created_at,
    })
    .from(runEvents)
    .where(and(eq(runEvents.run_id, runId), gt(runEvents.sequence, after)))
    .orderBy(runEvents.sequence)
    .limit(100)
}

/** Cancellation and failure invalidate executor writes in the same transaction as their public state. */
export async function finishRun(
  db: Db,
  runId: string,
  status: 'failed' | 'cancelled',
  code: RunErrorCode | null,
  message: string,
  now: number,
  leaseToken?: string,
) {
  const messageId = await stableUuid(`${runId}:terminal`)
  const terminalLease = leaseToken === undefined ? sql`1` : eq(runs.lease_token, leaseToken)
  await db.batch([
    db
      .update(runs)
      .set({
        status,
        error_code: code,
        error: status === 'failed' ? message : null,
        finished_at: now,
        lease_expires_at: null,
      })
      .where(
        and(
          eq(runs.id, runId),
          pending,
          leaseToken === undefined ? undefined : leased(runId, leaseToken, now),
        ),
      ),
    db
      .insert(messages)
      .select(sql`
      select ${messageId}, project_id, 'system', null, ${message}, ${now}
      from runs where id = ${runId} and status = ${status} and ${terminalLease}
      and exists (select 1 from projects where id = project_id)
    `)
      .onConflictDoNothing({ target: messages.id }),
    db
      .update(projects)
      .set({
        run_id: null,
        status: status === 'failed' ? 'error' : 'idle',
        error: status === 'failed' ? message : null,
        updated_at: now,
      })
      .where(
        and(
          eq(projects.run_id, runId),
          sql`exists (select 1 from runs where id = ${runId} and status = ${status} and ${terminalLease})`,
        ),
      ),
    stateEvent(
      db,
      sql`(select id from runs where id = ${runId} and ${terminalLease})`,
      status,
      now,
    ),
  ])
  return getRun(db, runId)
}

/** Only the validated result reaches this transaction. The run ID is the version's idempotency key. */
export async function completeRun(
  db: Db,
  runId: string,
  leaseToken: string,
  result: { html: string; summary: string },
  now: number,
) {
  const messageId = await stableUuid(`${runId}:complete`)
  await db.batch([
    db
      .insert(versions)
      .select(sql`
      select r.id, r.project_id, (select coalesce(max(number), 0) + 1 from versions where project_id = r.project_id),
        ${result.html}, r.request, ${now} from runs r
      where r.id = ${runId} and ${leased(runId, leaseToken, now)}
    `)
      .onConflictDoNothing({ target: versions.id }),
    db
      .insert(messages)
      .select(sql`
      select ${messageId}, project_id, 'system', null, ${result.summary}, ${now}
      from runs where id = ${runId} and ${leased(runId, leaseToken, now)}
    `)
      .onConflictDoNothing({ target: messages.id }),
    db
      .insert(runEvents)
      .select(sql`
      select null, ${runId}, 'version', 'version', json_object('id', id, 'number', number,
        'prompt', prompt, 'createdAt', created_at), ${now} from versions
      where id = ${runId} and ${leased(runId, leaseToken, now)}
    `)
      .onConflictDoNothing({ target: [runEvents.run_id, runEvents.event_key] }),
    db
      .update(runs)
      .set({ status: 'completed', finished_at: now, version_id: runId, lease_expires_at: null })
      .where(
        and(
          eq(runs.id, runId),
          leased(runId, leaseToken, now),
          sql`exists (select 1 from versions where id = ${runId})`,
        ),
      ),
    db
      .update(projects)
      .set({
        current_version_id: runId,
        status: 'idle',
        run_id: null,
        error: null,
        updated_at: now,
      })
      .where(
        and(
          eq(projects.run_id, runId),
          sql`exists (select 1 from runs where id = ${runId} and status = 'completed' and lease_token = ${leaseToken})`,
        ),
      ),
    stateEvent(
      db,
      sql`(select id from runs where id = ${runId} and lease_token = ${leaseToken})`,
      'completed',
      now,
    ),
  ])
  return getRun(db, runId)
}

export async function expiredRuns(db: Db, now: number) {
  return db
    .select()
    .from(runs)
    .where(and(pending, lte(runs.deadline_at, now)))
    .limit(100)
}
