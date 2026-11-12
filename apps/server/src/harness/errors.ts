import type { RunErrorCode } from '@atoms-demo/contracts'

export class RunTimeout extends Error {
  readonly code = 'timeout'
  constructor() {
    super('Generation exceeded its 15-minute execution budget.')
    this.name = 'RunTimeout'
  }
}

export function publicRunFailure(error: unknown): { code: RunErrorCode; message: string } {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  const name = error instanceof Error ? error.name : ''
  if (code === 'timeout' || name === 'TimeoutError')
    return {
      code: 'timeout',
      message:
        'Generation exceeded its 15-minute execution budget. Your previous version is unchanged.',
    }
  if (code === 'step_limit')
    return {
      code: 'step_limit',
      message:
        'The agent reached its step limit before validation and review could finish. Your previous version is unchanged.',
    }
  if (code === 'validation' || name === 'HarnessValidationError')
    return {
      code: 'validation',
      message:
        'The generated app did not pass validation after repair. Your previous version is unchanged.',
    }
  if (
    code === 'provider' ||
    [
      'HarnessProviderError',
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
    ].includes(name)
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

/** Stable UUIDs let retries reuse message identities without leaking non-UUID IDs into the API. */
export async function stableUuid(value: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  )
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80
  const hex = Array.from(bytes.subarray(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  )
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
