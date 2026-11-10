import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import type { ExecutorConfig } from './config'

const contextSchema = z.object({
  projectId: z.string(),
  runId: z.string(),
  idea: z.string(),
  request: z.string(),
  previousHtml: z.string().nullable(),
})
export const claimSchema = z.object({
  job: z
    .object({
      context: contextSchema,
      leaseToken: z.string().min(1),
      deadline: z.number().finite(),
    })
    .nullable(),
})
export type Job = NonNullable<z.infer<typeof claimSchema>['job']>
export const checkpointSchema = z.object({ found: z.boolean(), result: z.unknown().optional() })
export const heartbeatSchema = z.object({
  active: z.boolean(),
  status: z.string().nullable(),
  deadline: z.number().nullable(),
})
export const acknowledgementSchema = z.object({ ok: z.literal(true) })

export class LeaseLost extends Error {
  constructor() {
    super('Run lease is no longer active.')
    this.name = 'LeaseLost'
  }
}

export class ControlPlaneError extends Error {
  constructor(readonly retryable: boolean) {
    super('The executor control plane is unavailable.')
    this.name = 'ControlPlaneError'
  }
}

export class ControlPlane {
  constructor(private readonly config: ExecutorConfig) {}

  async request<T>(
    path: string,
    schema: z.ZodType<T>,
    signal: AbortSignal,
    body?: Record<string, unknown>,
    method: 'GET' | 'POST' | 'PUT' = 'POST',
    leaseToken?: string,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted()
      try {
        const response = await fetch(
          new URL(`/internal/executor/${path}`, this.config.CONTROL_PLANE_URL),
          {
            method,
            headers: {
              authorization: `Bearer ${this.config.EXECUTOR_TOKEN}`,
              'content-type': 'application/json',
              ...(leaseToken ? { 'x-executor-lease': leaseToken } : {}),
            },
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: AbortSignal.any([signal, AbortSignal.timeout(5000)]),
            redirect: 'error',
          },
        )
        if (response.status === 409) {
          await response.body?.cancel()
          throw new LeaseLost()
        }
        if (!response.ok) {
          await response.body?.cancel()
          throw new ControlPlaneError(response.status === 429 || response.status >= 500)
        }
        const parsed = schema.safeParse(await response.json())
        if (!parsed.success) throw new ControlPlaneError(false)
        return parsed.data
      } catch (error) {
        signal.throwIfAborted()
        if (error instanceof LeaseLost) throw error
        const failure = error instanceof ControlPlaneError ? error : new ControlPlaneError(true)
        if (!failure.retryable || attempt >= 2) throw failure
        await delay(500 * 2 ** attempt, undefined, { signal })
      }
    }
  }
}
