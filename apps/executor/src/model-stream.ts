import { type Model, RunRawModelStreamEvent } from '@openai/agents-core'
import {
  isOpenAIChatCompletionsRawModelStreamEvent,
  isOpenAIResponsesRawModelStreamEvent,
} from '@openai/agents-openai'
import type { HarnessEmit } from './types'

/** Reads only a top-level HTML string. Tool/schema validation still owns complete JSON. */
export class ArtifactJsonStream {
  private depth = 0
  private expectingKey = false
  private key = ''
  private stringKind: 'key' | 'html' | 'other' | null = null
  private escape = false
  private unicode: string | null = null
  private invalid = false
  private length = 0
  private surrogate = ''

  push(chunk: string): string {
    let output = ''
    const append = (character: string) => {
      if (this.stringKind === 'key') {
        // Only the exact key "html" is interesting; do not retain arbitrary keys.
        this.key = this.key.length < 5 ? this.key + character : this.key
      } else if (this.stringKind === 'html') {
        this.length++
        if (this.length > 180000) {
          this.invalid = true
          return
        }
        const code = character.charCodeAt(0)
        if (this.surrogate) {
          output += this.surrogate + character
          this.surrogate = ''
        } else if (code >= 0xd800 && code <= 0xdbff) {
          // Never send half a UTF-16 pair through a JSON/UTF-8 event boundary.
          this.surrogate = character
        } else {
          output += character
        }
      }
    }
    for (let index = 0; index < chunk.length; index++) {
      const character = chunk[index] ?? ''
      if (this.invalid) break
      if (this.stringKind) {
        if (this.unicode !== null) {
          if (!/^[\da-f]$/i.test(character)) {
            this.invalid = true
            break
          }
          this.unicode += character
          if (this.unicode.length === 4) {
            append(String.fromCharCode(Number.parseInt(this.unicode, 16)))
            this.unicode = null
          }
        } else if (this.escape) {
          this.escape = false
          if (character === 'u') this.unicode = ''
          else {
            const decoded = jsonEscapes[character]
            if (decoded === undefined) this.invalid = true
            else append(decoded)
          }
        } else if (character === '\\') {
          this.escape = true
        } else if (character === '"') {
          this.stringKind = null
          this.surrogate = ''
        } else if (character.charCodeAt(0) < 0x20) {
          this.invalid = true
        } else {
          append(character)
        }
        continue
      }
      if (character === '"') {
        this.stringKind =
          this.depth === 1 && this.expectingKey
            ? 'key'
            : this.depth === 1 && this.key === 'html'
              ? 'html'
              : 'other'
        if (this.stringKind === 'key') this.key = ''
        this.expectingKey = false
      } else if (character === '{' || character === '[') {
        this.depth++
        if (this.depth === 1) this.expectingKey = character === '{'
      } else if (character === '}' || character === ']') {
        this.depth--
      } else if (character === ',' && this.depth === 1) {
        this.expectingKey = true
        this.key = ''
      }
    }
    return output
  }
}

const jsonEscapes: Record<string, string> = {
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
}

type Call = { name: string; pending: string; reader: ArtifactJsonStream; started: boolean }

/** Await observations at the provider boundary, before Runner can execute the completed tool. */
export function observeModelStream(
  model: Model,
  emit: HarnessEmit,
  signal: AbortSignal,
  agent: string,
  messageId: string,
) {
  let draft: string | null = null
  let pending = ''
  const flush = async () => {
    signal.throwIfAborted()
    if (!pending) return
    const text = pending
    pending = ''
    await emit('code', { text })
  }
  const append = async (call: Call, argumentsDelta: string) => {
    const text = call.reader.push(argumentsDelta)
    if (!text) return
    if (!call.started) {
      await flush()
      call.started = true
      draft = ''
      await emit('code_start', { path: 'index.html', agent })
    }
    draft = (draft ?? '') + text
    pending += text
    // Show the first actual fragment immediately, then batch durable writes.
    if (draft.length === text.length || pending.length >= 512) await flush()
  }
  const observed: Model = {
    supportsPromptModelSelection: model.supportsPromptModelSelection,
    getResponse: (request) => model.getResponse(request),
    getRetryAdvice: (request) => model.getRetryAdvice?.(request),
    async *getStreamedResponse(request) {
      pending = ''
      const calls = new Map<string | number, Call>()
      for await (const data of model.getStreamedResponse(request)) {
        signal.throwIfAborted()
        const event = new RunRawModelStreamEvent(data)
        if (isOpenAIChatCompletionsRawModelStreamEvent(event)) {
          const choice = event.data.event.choices.find((item) => item.index === 0)
          for (const delta of choice?.delta.tool_calls ?? []) {
            let call = calls.get(delta.index)
            if (!call) {
              call = { name: '', pending: '', reader: new ArtifactJsonStream(), started: false }
              calls.set(delta.index, call)
            }
            call.name += delta.function?.name ?? ''
            const argumentsDelta = delta.function?.arguments ?? ''
            if (call.name === 'write_artifact') {
              await append(call, call.pending + argumentsDelta)
              call.pending = ''
            } else if ('write_artifact'.startsWith(call.name)) {
              // A compatible provider can split the function name or send arguments first.
              if (call.pending.length + argumentsDelta.length <= 1200000)
                call.pending += argumentsDelta
            }
          }
        } else if (isOpenAIResponsesRawModelStreamEvent(event)) {
          const raw = event.data.event
          if (raw.type === 'response.output_item.added' && raw.item.type === 'function_call') {
            const call = {
              name: raw.item.name,
              pending: '',
              reader: new ArtifactJsonStream(),
              started: false,
            }
            calls.set(raw.item.id ?? raw.item.call_id, call)
            if (call.name === 'write_artifact') await append(call, raw.item.arguments)
          } else if (raw.type === 'response.function_call_arguments.delta') {
            const call = calls.get(raw.item_id)
            if (call?.name === 'write_artifact') await append(call, raw.delta)
          } else if (raw.type === 'response.reasoning_summary_text.delta' && raw.delta) {
            // This explicitly public summary is distinct from raw reasoning/text/content.
            await emit('reasoning_summary', { id: messageId, agent, text: raw.delta })
          }
        }
        if (data.type === 'response_done') await flush()
        yield data
      }
      await flush()
    },
  }
  return {
    model: observed,
    async commit(html: string) {
      signal.throwIfAborted()
      await flush()
      // Complete tool arguments may differ from a malformed/incomplete draft. Replace,
      // never append the entire artifact a second time after successful streaming.
      if (draft !== html) await emit('code_reset', { text: html })
      draft = html
    },
  }
}
