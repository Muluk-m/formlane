import { describe, expect, it } from 'vitest'
import { publicRunFailure, RunTimeout } from './errors'

describe('durable run failures', () => {
  it('distinguishes deadline expiry, provider failures, and exhausted validation', () => {
    expect(publicRunFailure(new RunTimeout()).code).toBe('timeout')
    expect(
      publicRunFailure(Object.assign(new Error('secret provider payload'), { code: 'provider' }))
        .code,
    ).toBe('provider')
    expect(
      publicRunFailure(
        Object.assign(new Error('failed interaction details'), { code: 'validation' }),
      ).code,
    ).toBe('validation')
    expect(publicRunFailure(new DOMException('disconnected', 'AbortError')).code).toBe('internal')
  })
  it('never exposes raw provider payloads or unexpected exception details', () => {
    for (const code of ['provider', 'validation', 'timeout', 'internal']) {
      const error = Object.assign(new Error('test-secret upstream debug'), { code })
      expect(publicRunFailure(error).message).not.toContain('test-secret')
      expect(publicRunFailure(error).message).not.toContain('upstream debug')
    }
  })
})
