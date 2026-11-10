import { afterEach, describe, expect, it, vi } from 'vitest'
import { mockEnabled } from './env'
import { ProviderError, publicGenerationError, streamChat, takeContentDelta } from './openai'

// Provider tests do not use the database binding.
const env = { OPENAI_API_KEY: 'test-secret', OPENAI_MODEL: 'test-model' }

afterEach(() => vi.unstubAllGlobals())
describe('provider streaming', () => {
  it('redacts provider error payloads and unexpected exceptions', () => {
    expect(() => takeContentDelta('{"error":{"message":"test-secret upstream debug"}}')).toThrow(
      ProviderError,
    )
    expect(publicGenerationError(new Error('test-secret'))).not.toContain('test-secret')
    expect(publicGenerationError(new ProviderError('test-secret'))).not.toContain('test-secret')
  })
  it('parses split SSE events and an unterminated final event', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                for (const chunk of [
                  'data: {"choices":[{"delta":{"content":"hel',
                  'lo"}}]}\r\n\r\n',
                  'data: {"choices":[{"delta":{"content":" world"}}]}',
                ])
                  controller.enqueue(new TextEncoder().encode(chunk))
                controller.close()
              },
            }),
          ),
      ),
    )
    const deltas: string[] = []
    const result = await streamChat(
      env,
      [{ role: 'user', content: 'Build a planner' }],
      100,
      0.4,
      new AbortController().signal,
      async (delta) => {
        deltas.push(delta)
      },
    )
    expect(result).toBe('hello world')
    expect(deltas).toEqual(['hello', ' world'])
  })
  it('requires an explicitly local mock configuration', () => {
    expect(mockEnabled({ MOCK_LLM: 'true', ENVIRONMENT: 'production' })).toBe(false)
    expect(mockEnabled({ MOCK_LLM: 'true' })).toBe(false)
    expect(mockEnabled({ MOCK_LLM: 'true', ENVIRONMENT: 'local' })).toBe(true)
  })
  it('fails when credentials are missing instead of silently using mock output', async () => {
    await expect(
      streamChat({}, [], 100, 0.4, new AbortController().signal, async () => {}),
    ).rejects.toThrow('OPENAI_API_KEY')
  })
})
