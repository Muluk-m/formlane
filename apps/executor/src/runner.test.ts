import { createServer } from 'node:http'
import type { Socket } from 'node:net'
import { expect, it } from 'vitest'
import { failureFor, providerRetryable } from './runner'

it('retries a response stream disconnected after headers and reports provider failure', async () => {
  let connection: Socket | undefined
  const server = createServer((request, response) => {
    connection = request.socket
    response.writeHead(200, { 'content-type': 'text/event-stream' })
    response.write('data: partial\n\n')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('Missing server address')
    const response = await fetch(`http://127.0.0.1:${address.port}`, {
      signal: AbortSignal.timeout(5000),
    })
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Missing response stream')
    await reader.read()
    connection?.destroy()
    const error = await reader.read().then(
      () => {
        throw new Error('Disconnected stream should reject')
      },
      (error: unknown) => error,
    )
    expect(error).toBeInstanceOf(TypeError)
    expect(providerRetryable(error)).toBe(true)
    expect(failureFor(error).code).toBe('provider')
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
})

it('keeps programming errors and authentication rejection out of retries', () => {
  const programmingError = new TypeError('Cannot read properties of undefined')
  const credentialsError = Object.assign(new Error('Invalid key'), {
    name: 'AuthenticationError',
    status: 401,
  })
  expect(providerRetryable(programmingError)).toBe(false)
  expect(failureFor(programmingError).code).toBe('internal')
  expect(providerRetryable(credentialsError)).toBe(false)
  expect(failureFor(credentialsError).code).toBe('provider')
})
