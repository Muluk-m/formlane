import type { Db } from '../../db/client'
import { publicRunFailure, RunTimeout } from '../../harness/errors'
import * as repo from './runs.repo'

/** The database fence stops every executor write; the next heartbeat stops remote work. */
export async function cancelGeneration(db: Db, run: repo.RunRow) {
  await repo.finishRun(db, run.id, 'cancelled', null, 'Generation cancelled.', Date.now())
}

export async function expireGeneration(db: Db, run: repo.RunRow) {
  if (repo.isTerminal(run.status) || run.deadline_at > Date.now()) return run
  const failure = publicRunFailure(new RunTimeout())
  const expired = await repo.finishRun(
    db,
    run.id,
    'failed',
    failure.code,
    failure.message,
    Date.now(),
  )
  return expired ?? run
}

/** Claims recover expired leases directly; cron only closes jobs beyond their total budget. */
export async function maintainGenerations(db: Db) {
  for (const run of await repo.expiredRuns(db, Date.now())) await expireGeneration(db, run)
}
