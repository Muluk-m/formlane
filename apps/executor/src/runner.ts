import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { executeHarness } from './agents'
import type { ExecutorConfig } from './config'
import {
  acknowledgementSchema,
  ControlPlane,
  ControlPlaneError,
  checkpointSchema,
  claimSchema,
  heartbeatSchema,
  type Job,
  LeaseLost,
} from './control-plane'
import type { DurableExecutor, HarnessEmit } from './types'

class RunTimeout extends Error {
  readonly code = 'timeout'
  constructor() {
    super('Generation exceeded its execution deadline.')
    this.name = 'RunTimeout'
  }
}

export function providerRetryable(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if ('status' in error && typeof error.status === 'number')
    return error.status === 429 || error.status >= 500
  // Fetch can fail mid-stream after the SDK has already accepted response headers.
  if (error instanceof TypeError && error.message === 'terminated') return true
  return (
    [
      'APIConnectionError',
      'APIConnectionTimeoutError',
      'RateLimitError',
      'InternalServerError',
    ].includes(error.name) ||
    /overloaded|try again later|temporarily unavailable|concurrency limit exceeded/i.test(
      error.message,
    )
  )
}

export function failureFor(error: unknown): {
  code: 'provider' | 'validation' | 'timeout' | 'internal'
  message: string
} {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  if (code === 'timeout')
    return {
      code,
      message: 'Generation exceeded its execution budget. Your previous version is unchanged.',
    }
  if (code === 'validation')
    return {
      code,
      message:
        'The generated app did not pass validation after repair. Your previous version is unchanged.',
    }
  if (
    error instanceof Error &&
    /overloaded|try again later|temporarily unavailable|concurrency limit exceeded/i.test(
      error.message,
    )
  )
    return {
      code: 'provider',
      message:
        'The model provider is temporarily overloaded. Check the provider configuration and try again.',
    }
  if (
    providerRetryable(error) ||
    code === 'provider' ||
    (error instanceof Error &&
      [
        'APIError',
        'APIConnectionError',
        'APIConnectionTimeoutError',
        'RateLimitError',
        'AuthenticationError',
        'PermissionDeniedError',
        'BadRequestError',
        'NotFoundError',
        'UnprocessableEntityError',
        'InternalServerError',
      ].includes(error.name))
  )
    return {
      code: 'provider',
      message:
        'The model provider could not complete this run. Check the provider configuration and try again.',
    }
  return {
    code: 'internal',
    message: 'Generation could not complete. Your previous version is unchanged. Please try again.',
  }
}

async function executeJob(
  config: ExecutorConfig,
  api: ControlPlane,
  job: Job,
  shutdown: AbortSignal,
) {
  const controller = new AbortController()
  const signal = AbortSignal.any([shutdown, controller.signal])
  const heartbeatStop = new AbortController()
  const heartbeatSignal = AbortSignal.any([signal, heartbeatStop.signal])
  const base = `runs/${encodeURIComponent(job.context.runId)}`
  const scope = new AsyncLocalStorage<{ name: string; attempt: number; index: number }>()
  // A fresh event namespace distinguishes an interrupted turn from its replacement.
  const executionId = randomUUID()
  const timer = setTimeout(
    () => controller.abort(new RunTimeout()),
    Math.max(1, job.deadline - Date.now()),
  )
  const heartbeat = (async () => {
    try {
      while (!heartbeatSignal.aborted) {
        const state = await api.request(`${base}/heartbeat`, heartbeatSchema, heartbeatSignal, {
          leaseToken: job.leaseToken,
        })
        if (!state.active) throw new LeaseLost()
        await delay(10_000, undefined, { signal: heartbeatSignal })
      }
    } catch (error) {
      if (!heartbeatSignal.aborted) controller.abort(error)
    }
  })()
  const durable: DurableExecutor = {
    async run<T>(name: string, fn: () => Promise<T>): Promise<T> {
      signal.throwIfAborted()
      const path = `${base}/checkpoint/${encodeURIComponent(name)}`
      const checkpoint = await api.request(
        path,
        checkpointSchema,
        signal,
        undefined,
        'GET',
        job.leaseToken,
      )
      if (checkpoint.found) return checkpoint.result as T
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await scope.run({ name, attempt, index: 0 }, fn)
          signal.throwIfAborted()
          const serialized = JSON.stringify(result)
          if (serialized === undefined) throw new Error('Checkpoint must be JSON serializable.')
          // Persist before moving to another turn; restart replays saved results only.
          await api.request(
            path,
            acknowledgementSchema,
            signal,
            {
              leaseToken: job.leaseToken,
              result: JSON.parse(serialized),
            },
            'PUT',
          )
          return result
        } catch (error) {
          signal.throwIfAborted()
          if (!providerRetryable(error) || attempt >= 4) throw error
          await delay(Math.min(60_000, 10_000 * 2 ** attempt), undefined, { signal })
        }
      }
    },
  }
  const emit: HarnessEmit = async (type, data) => {
    signal.throwIfAborted()
    const current = scope.getStore()
    if (!current) throw new Error('Harness events require a checkpoint scope.')
    await api.request(`${base}/events`, acknowledgementSchema, signal, {
      leaseToken: job.leaseToken,
      key: `${executionId}:${current.name}:${current.attempt}:${current.index++}`,
      type,
      data,
    })
  }
  try {
    const result = await executeHarness(config, job.context, durable, emit, signal)
    signal.throwIfAborted()
    await api.request(`${base}/complete`, acknowledgementSchema, signal, {
      leaseToken: job.leaseToken,
      result,
    })
    console.info(JSON.stringify({ event: 'run_completed', runId: job.context.runId }))
  } catch (error) {
    const cause: unknown = signal.aborted ? signal.reason : error
    // Lost connectivity or supervisor shutdown must preserve resumability, not fail the run.
    if (shutdown.aborted || cause instanceof LeaseLost || cause instanceof ControlPlaneError) {
      console.info(JSON.stringify({ event: 'run_released', runId: job.context.runId }))
      return
    }
    const failure = failureFor(cause)
    try {
      await api.request(`${base}/fail`, acknowledgementSchema, shutdown, {
        leaseToken: job.leaseToken,
        ...failure,
      })
    } catch (reportError) {
      if (!(reportError instanceof LeaseLost) && !shutdown.aborted)
        console.error(
          JSON.stringify({ event: 'failure_report_unavailable', runId: job.context.runId }),
        )
    }
    console.error(
      JSON.stringify({
        event: 'run_failed',
        runId: job.context.runId,
        code: failure.code,
        cause:
          cause instanceof Error
            ? { name: cause.name, message: cause.message.slice(0, 300) }
            : { name: typeof cause },
      }),
    )
  } finally {
    clearTimeout(timer)
    heartbeatStop.abort()
    await heartbeat
  }
}

export async function runExecutor(config: ExecutorConfig, shutdown: AbortSignal) {
  const api = new ControlPlane(config)
  const workerId = `${hostname()}:${randomUUID()}`
  while (!shutdown.aborted) {
    try {
      const { job } = await api.request('claim', claimSchema, shutdown, { workerId })
      if (job) await executeJob(config, api, job, shutdown)
      else await delay(2000, undefined, { signal: shutdown })
    } catch {
      if (shutdown.aborted) break
      console.error(JSON.stringify({ event: 'executor_poll_unavailable' }))
      await delay(5000, undefined, { signal: shutdown }).catch(() => undefined)
    }
  }
}
