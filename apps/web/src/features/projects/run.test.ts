import { type Run, type RunEvent, runEventSchema, runSchema } from '@atoms-demo/contracts'
import { describe, expect, it } from 'vitest'
import { hasReplayedRun, isActiveRun, reconcileRun, reconcileRunEvent } from './run'

const runId = '00000000-0000-4000-8000-000000000001'
const projectId = '00000000-0000-4000-8000-000000000002'

function snapshot(overrides: Partial<Run> = {}): Run {
  return runSchema.parse({
    id: runId,
    projectId,
    status: 'failed',
    attempt: 1,
    resumable: true,
    request: 'Build a planner',
    createdAt: 100,
    startedAt: 200,
    finishedAt: 300,
    errorCode: 'timeout',
    error: 'Time limit reached',
    versionId: null,
    cursor: 10,
    ...overrides,
  })
}

function stateEvent(run: Run, sequence = run.cursor): RunEvent {
  return {
    runId: run.id,
    attempt: run.attempt,
    sequence,
    type: 'run_state',
    data: { ...run, cursor: sequence - 1 },
    createdAt: sequence * 100,
  }
}

describe('durable run observation', () => {
  it('preserves snapshot eligibility when replaying an unchanged legacy terminal event', () => {
    const current = snapshot()
    const { resumable: _resumable, attempt: _attempt, ...legacy } = current
    const event = runEventSchema.parse({
      runId,
      sequence: current.cursor,
      type: 'run_state',
      data: legacy,
      createdAt: 300,
    })
    expect(reconcileRunEvent(current, event)?.resumable).toBe(true)
  })
  it.each(['failed', 'cancelled'] as const)(
    'accepts a same-ID resume receipt after %s',
    (status) => {
      const previous = snapshot({ status })
      const receipt = snapshot({
        status: 'queued',
        attempt: 2,
        resumable: false,
        cursor: 11,
        finishedAt: null,
        errorCode: null,
        error: null,
      })
      const resumed = reconcileRun(previous, receipt)
      expect(resumed).toBe(receipt)
      expect(resumed.id).toBe(previous.id)
      expect(resumed.request).toBe(previous.request)
      expect(isActiveRun(resumed)).toBe(true)
      expect(hasReplayedRun(resumed, { runId, sequence: 10 })).toBe(false)
    },
  )

  it('fences terminal replay from an older attempt after resume and after reload', () => {
    const failed = snapshot()
    const receipt = snapshot({ status: 'running', attempt: 2, resumable: false, cursor: 12 })
    for (const resumed of [reconcileRun(failed, receipt), receipt]) {
      const replayed = reconcileRunEvent(resumed, stateEvent(failed))
      expect(replayed).toBe(resumed)
      expect(hasReplayedRun(replayed, { runId, sequence: 10 })).toBe(false)
      // Even a delayed prior-attempt snapshot cannot settle this attempt.
      expect(reconcileRun(resumed, { ...failed, cursor: 20 })).toBe(resumed)
    }
  })

  it('uses the envelope cursor to settle the current attempt and reconnect without replay gaps', () => {
    const running = snapshot({ status: 'running', attempt: 2, cursor: 15 })
    const terminal = stateEvent(snapshot({ attempt: 2, cursor: 18 }))
    const settled = reconcileRunEvent(running, terminal)
    expect(settled).toMatchObject({ status: 'failed', attempt: 2, cursor: 18 })
    expect(hasReplayedRun(settled, { runId, sequence: 17 })).toBe(false)
    expect(hasReplayedRun(settled, { runId, sequence: 18 })).toBe(true)
    expect(hasReplayedRun(settled, { runId: projectId, sequence: 18 })).toBe(false)
    expect(reconcileRunEvent(settled, stateEvent(running))).toBe(settled)
  })

  it('does not reopen a settled attempt with historical active events or complete runs with resume', () => {
    const terminal = snapshot()
    expect(reconcileRun(terminal, snapshot({ status: 'queued', cursor: 11 }))).toBe(terminal)
    expect(reconcileRun(terminal, snapshot({ status: 'running', cursor: 11 }))).toBe(terminal)
    const completed = snapshot({ status: 'completed', resumable: false })
    expect(reconcileRun(completed, snapshot({ status: 'queued', attempt: 2 }))).toBe(completed)
  })

  it('keeps running state through queued replay and ignores mismatched event identities', () => {
    const running = snapshot({ status: 'running', attempt: 2, cursor: 15 })
    expect(reconcileRun(running, snapshot({ status: 'queued', attempt: 2, cursor: 16 }))).toBe(
      running,
    )
    const terminal = stateEvent(snapshot({ attempt: 2, cursor: 18 }))
    expect(reconcileRunEvent(running, { ...terminal, runId: projectId })).toBe(running)
    expect(reconcileRunEvent(running, { ...terminal, attempt: 1 })).toBe(running)
  })

  it('loads historical states as attempt one without inventing resume eligibility', () => {
    const { attempt: _attempt, resumable: _resumable, ...historical } = snapshot()
    const previous = runSchema.parse(historical)
    const terminal = runEventSchema.parse({
      runId,
      sequence: 10,
      type: 'run_state',
      data: { ...historical, cursor: 9 },
      createdAt: 300,
    })
    expect(reconcileRunEvent(previous, terminal)).toMatchObject({ attempt: 1, resumable: false })
    const receipt = snapshot({ attempt: 2, status: 'queued', cursor: 11 })
    expect(reconcileRunEvent(receipt, terminal)).toBe(receipt)
  })
})
