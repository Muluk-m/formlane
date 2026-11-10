export interface Env {
  API?: Fetcher
  API_ORIGIN?: string
}

/** Preserve streaming bodies and first-party session cookies through Pages. */
export const proxy: PagesFunction<Env> = async ({ request, env }) => {
  const incoming = new URL(request.url)
  if (!env.API && !env.API_ORIGIN)
    return Response.json(
      { error: 'Configure API or API_ORIGIN for this Pages environment.' },
      { status: 503 },
    )
  const target = new URL(
    incoming.pathname + incoming.search,
    env.API_ORIGIN || 'https://atoms-api.internal',
  )
  const headers = new Headers(request.headers)
  headers.set('x-forwarded-host', incoming.host)
  headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1))
  const ip = headers.get('cf-connecting-ip')
  if (ip) headers.set('x-forwarded-for', ip)
  const forwarded = new Request(target, {
    method: request.method,
    headers,
    body: request.method === 'GET' || request.method === 'HEAD' ? undefined : request.body,
    redirect: 'manual',
    signal: request.signal,
  })
  return env.API ? env.API.fetch(forwarded) : fetch(forwarded)
}
