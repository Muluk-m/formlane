import {
  contract,
  type Run,
  type RunEvent,
  runEventSchema,
  runReceiptSchema,
  runSchema,
} from '@atoms-demo/contracts'
import { readLocale, translate } from '@atoms-demo/i18n'
import { createORPCClient } from '@orpc/client'
import type { ContractRouterClient } from '@orpc/contract'
import type { JsonifiedClient } from '@orpc/openapi-client'
import { OpenAPILink } from '@orpc/openapi-client/fetch'
import { createTanstackQueryUtils } from '@orpc/tanstack-query'

const link = new OpenAPILink(contract, {
  url: () => new URL('/api', window.location.origin),
  headers: () => {
    const headers = new Headers()
    const owner = localStorage.getItem('atoms_uid')
    if (owner) headers.set('x-owner-id', owner)
    return headers
  },
  fetch: (request, init) => fetch(request, { ...init, credentials: 'same-origin' }),
})

export const api: JsonifiedClient<ContractRouterClient<typeof contract>> = createORPCClient(link)
export const orpc = createTanstackQueryUtils(api)

export function requestError() {
  return translate(readLocale(localStorage), 'atoms.requestError')
}

let ownerPromise: Promise<string> | null = null

export function ensureOwner(): Promise<string> {
  if (!ownerPromise) {
    ownerPromise = (async () => {
      const data = await api.me({})
      localStorage.setItem('atoms_uid', data.ownerId)
      return data.ownerId
    })().catch((error: unknown) => {
      ownerPromise = null
      throw error
    })
  }
  return ownerPromise
}

async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const ownerId = await ensureOwner()
  const headers = new Headers(init.headers)
  headers.set('x-owner-id', ownerId)
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json')
  return fetch(path, { ...init, headers, credentials: 'include' })
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string; message?: string }
    if (data.error || data.message) return data.error ?? data.message ?? requestError()
  } catch {
    /* ignore */
  }
  return `${requestError()} (${response.status})`
}

export async function downloadProject(
  id: string,
  filename: string,
  versionId?: string,
): Promise<void> {
  const query = versionId ? `?version=${encodeURIComponent(versionId)}` : ''
  const response = await request(`/api/projects/${id}/download${query}`)
  if (!response.ok) throw new Error(await readError(response))
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export class RunConnectionError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

export async function latestRun(id: string, signal?: AbortSignal): Promise<Run | null> {
  const response = await request(`/api/projects/${id}/runs/latest`, { signal })
  if (!response.ok) throw new RunConnectionError(await readError(response), response.status)
  const result = (await response.json()) as { run: unknown }
  return runSchema.nullable().parse(result.run)
}

export async function startRun(id: string, initial: boolean, content?: string): Promise<Run> {
  const response = await request(`/api/projects/${id}/${initial ? 'generate' : 'chat'}`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  })
  if (!response.ok) throw new RunConnectionError(await readError(response), response.status)
  const result = runReceiptSchema.parse(await response.json())
  return result.run
}

export async function cancelRun(id: string, runId: string): Promise<void> {
  const response = await request(`/api/projects/${id}/runs/${runId}/cancel`, { method: 'POST' })
  if (!response.ok) throw new RunConnectionError(await readError(response), response.status)
}

export async function streamRunEvents(
  id: string,
  runId: string,
  after: number,
  signal: AbortSignal,
  onEvent: (event: RunEvent) => void,
): Promise<void> {
  const response = await request(`/api/projects/${id}/runs/${runId}/events?after=${after}`, {
    signal,
    headers: { accept: 'text/event-stream', 'Last-Event-ID': String(after) },
  })
  if (!response.ok) throw new RunConnectionError(await readError(response), response.status)
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) {
    throw new Error(requestError())
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      const parts = buffer.split(/\r?\n\r?\n/)
      buffer = parts.pop() ?? ''
      for (const part of parts) {
        const lines = part.split(/\r?\n/)
        const eventType = lines
          .find((line) => line.startsWith('event:'))
          ?.slice(6)
          .trim()
        if (eventType === 'heartbeat') continue
        const data = lines
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n')
        if (data) onEvent(runEventSchema.parse(JSON.parse(data)))
      }
      if (done) break
    }
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
