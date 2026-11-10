import type { ChatTurn } from '@atoms-demo/core/types'
import { z } from 'zod'
import type { ProviderConfig } from './env'
import { mockEnabled, modelName, openAiBase } from './env'

export type { ChatTurn }

const chunkSchema = z.object({
  choices: z
    .array(z.object({ delta: z.object({ content: z.string().nullable().optional() }).optional() }))
    .optional(),
  error: z.unknown().optional(),
})
export class ProviderError extends Error {}
export function publicGenerationError(error: unknown) {
  if (error instanceof ProviderError)
    return 'The model provider could not complete this generation. Check the provider configuration and try again.'
  return 'The team could not complete this generation. Your previous version is still available. Please try again.'
}
export function takeContentDelta(payload: string): string | null {
  if (!payload || payload === '[DONE]') return null
  let value: unknown
  try {
    value = JSON.parse(payload)
  } catch {
    throw new ProviderError('Invalid provider stream.')
  }
  const parsed = chunkSchema.safeParse(value)
  if (!parsed.success || parsed.data.error !== undefined)
    throw new ProviderError('Provider stream failed.')
  return parsed.data.choices?.[0]?.delta?.content ?? ''
}
export async function streamChat(
  env: ProviderConfig,
  messages: ChatTurn[],
  maxTokens: number,
  temperature: number,
  signal: AbortSignal,
  onDelta: (text: string) => Promise<void>,
): Promise<string> {
  if (mockEnabled(env)) throw new ProviderError('Local mock mode must not call the provider.')
  const key = env.OPENAI_API_KEY?.trim()
  if (!key) throw new ProviderError('OPENAI_API_KEY is not configured.')
  const response = await fetch(`${openAiBase(env)}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: modelName(env),
      messages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    }),
    signal,
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new ProviderError('Provider request failed.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = '',
    full = '',
    eventData: string[] = []
  const dispatch = async () => {
    if (eventData.length === 0) return
    const delta = takeContentDelta(eventData.join('\n'))
    eventData = []
    if (delta) {
      full += delta
      await onDelta(delta)
    }
  }
  const consume = async (line: string) => {
    if (line === '') {
      await dispatch()
      return
    }
    if (line.startsWith('data:')) eventData.push(line.slice(5).replace(/^ /, ''))
  }
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '')
        buffer = buffer.slice(newline + 1)
        await consume(line)
        newline = buffer.indexOf('\n')
      }
      if (done) break
    }
    if (buffer) await consume(buffer.replace(/\r$/, ''))
    await dispatch()
    return full
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
