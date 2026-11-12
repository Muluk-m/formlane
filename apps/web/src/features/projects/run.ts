import { type Run, type RunEvent, runSchema } from '@atoms-demo/contracts'

export function isActiveRun(run: Pick<Run, 'status'> | null) {
  return run?.status === 'queued' || run?.status === 'running'
}

/** Snapshots authorize a new attempt; replay cannot reopen a settled attempt. */
export function reconcileRun(current: Run | null, incoming: Run): Run {
  if (!current || current.id !== incoming.id) return incoming
  if (incoming.attempt < current.attempt) return current
  if (incoming.attempt > current.attempt) return current.status === 'completed' ? current : incoming
  if (incoming.cursor < current.cursor) return current
  if (!isActiveRun(current) && isActiveRun(incoming)) return current
  if (current.status === 'running' && incoming.status === 'queued') return current
  return incoming
}

export function reconcileRunEvent(current: Run | null, event: RunEvent): Run | null {
  if (!current || current.id !== event.runId || event.type !== 'run_state') return current
  const incoming = runSchema.parse(event.data)
  if (incoming.id !== event.runId || incoming.attempt !== event.attempt) return current
  return reconcileRun(current, {
    ...incoming,
    resumable: Object.hasOwn(event.data, 'resumable') ? incoming.resumable : current.resumable,
    cursor: Math.max(incoming.cursor, event.sequence),
  })
}

export function hasReplayedRun(run: Run | null, cursor: { runId: string; sequence: number }) {
  return Boolean(
    run && run.id === cursor.runId && !isActiveRun(run) && cursor.sequence >= run.cursor,
  )
}
