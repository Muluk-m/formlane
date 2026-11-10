import { contract } from '@atoms-demo/contracts'
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

export async function streamEvents(
  path: string,
  body: unknown,
  signal: AbortSignal,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  const ownerId = await ensureOwner()
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'include',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-owner-id': ownerId,
    },
    body: body == null ? '{}' : JSON.stringify(body),
  })
  const type = response.headers.get('content-type') ?? ''
  if (!response.ok || !type.includes('text/event-stream') || !response.body) {
    throw new Error(await readError(response))
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''
    for (const part of parts) {
      if (!part.trim() || part.trimStart().startsWith(':')) continue
      let event = 'message'
      const dataLines: string[] = []
      for (const line of part.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) continue
      onEvent(event, JSON.parse(dataLines.join('\n')) as Record<string, unknown>)
    }
  }
}
