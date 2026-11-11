import { isProjectPath } from '@atoms-demo/core/project'
import { type Model, RunRawModelStreamEvent } from '@openai/agents-core'
import {
  isOpenAIChatCompletionsRawModelStreamEvent,
  isOpenAIResponsesRawModelStreamEvent,
} from '@openai/agents-openai'
import type { HarnessEmit } from './types'

/** Observes top-level write_file strings. Complete tool/schema validation owns durable source. */
export class FileJsonStream {
  path: string | null = null
  private depth = 0
  private expectingKey = false
  private key = ''
  private stringKind: 'key' | 'path' | 'content' | 'other' | null = null
  private pathValue = ''
  private beforePath = ''
  private seenPath = false
  private seenContent = false
  private escape = false
  private unicode: string | null = null
  private invalid = false
  private length = 0
  private surrogate = ''

  push(chunk: string): { path: string | null; text: string } {
    let output = ''
    const append = (character: string) => {
      if (this.stringKind === 'key') {
        // Retain only enough to identify path/content, never arbitrary argument values.
        if (this.key.length < 8) this.key += character
      } else if (this.stringKind === 'path') {
        this.pathValue += character
        if (this.pathValue.length > 180) this.invalid = true
      } else if (this.stringKind === 'content') {
        this.length++
        if (this.length > 180000) {
          this.invalid = true
          return
        }
        const code = character.charCodeAt(0)
        let decoded = character
        if (this.surrogate) {
          decoded = this.surrogate + character
          this.surrogate = ''
        } else if (code >= 0xd800 && code <= 0xdbff) {
          // Never send half a UTF-16 pair through a JSON/UTF-8 event boundary.
          this.surrogate = character
          return
        }
        if (this.path) output += decoded
        else this.beforePath += decoded
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
          if (this.stringKind === 'path') {
            if (!isProjectPath(this.pathValue)) this.invalid = true
            else {
              this.path = this.pathValue
              output += this.beforePath
              this.beforePath = ''
            }
          }
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
            : this.depth === 1 && (this.key === 'path' || this.key === 'content')
              ? this.key
              : 'other'
        if (this.stringKind === 'key') this.key = ''
        if (this.stringKind === 'path') {
          if (this.seenPath) this.invalid = true
          this.seenPath = true
        }
        if (this.stringKind === 'content') {
          if (this.seenContent) this.invalid = true
          this.seenContent = true
        }
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
    return { path: this.path, text: output }
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

type Call = {
  name: string
  argumentsPending: string
  textPending: string
  reader: FileJsonStream
  started: boolean
}
const newCall = (name = ''): Call => ({
  name,
  argumentsPending: '',
  textPending: '',
  reader: new FileJsonStream(),
  started: false,
})

/** Await observations at the provider boundary, before Runner executes a completed tool. */
export function observeModelStream(
  model: Model,
  emit: HarnessEmit,
  signal: AbortSignal,
  agent: string,
  messageId: string,
) {
  let calls = new Map<string | number, Call>()
  const flush = async (call: Call) => {
    signal.throwIfAborted()
    if (!call.textPending || !call.reader.path) return
    const text = call.textPending
    call.textPending = ''
    await emit('file_delta', { path: call.reader.path, text })
  }
  const flushAll = async () => {
    for (const call of calls.values()) await flush(call)
  }
  const append = async (call: Call, argumentsDelta: string) => {
    const { path, text } = call.reader.push(argumentsDelta)
    if (!path || !text) return
    const first = !call.started
    if (first) {
      call.started = true
      await emit('file_start', { path, agent })
    }
    call.textPending += text
    // Show the first actual fragment immediately, then batch durable writes per file.
    if (first || call.textPending.length >= 512) await flush(call)
  }
  const observed: Model = {
    supportsPromptModelSelection: model.supportsPromptModelSelection,
    getResponse: (request) => model.getResponse(request),
    getRetryAdvice: (request) => model.getRetryAdvice?.(request),
    async *getStreamedResponse(request) {
      // A provider retry cannot flush the interrupted response's unsaved fragments.
      calls = new Map()
      for await (const data of model.getStreamedResponse(request)) {
        signal.throwIfAborted()
        const event = new RunRawModelStreamEvent(data)
        if (isOpenAIChatCompletionsRawModelStreamEvent(event)) {
          const choice = event.data.event.choices.find((item) => item.index === 0)
          for (const delta of choice?.delta.tool_calls ?? []) {
            let call = calls.get(delta.index)
            if (!call) {
              call = newCall()
              calls.set(delta.index, call)
            }
            call.name += delta.function?.name ?? ''
            const argumentsDelta = delta.function?.arguments ?? ''
            if (call.name === 'write_file') {
              await append(call, call.argumentsPending + argumentsDelta)
              call.argumentsPending = ''
            } else if ('write_file'.startsWith(call.name)) {
              // Compatible providers can split function names or send arguments first.
              if (call.argumentsPending.length + argumentsDelta.length <= 1200000)
                call.argumentsPending += argumentsDelta
            }
          }
        } else if (isOpenAIResponsesRawModelStreamEvent(event)) {
          const raw = event.data.event
          if (raw.type === 'response.output_item.added' && raw.item.type === 'function_call') {
            const call = newCall(raw.item.name)
            calls.set(raw.item.id ?? raw.item.call_id, call)
            if (call.name === 'write_file') await append(call, raw.item.arguments)
          } else if (raw.type === 'response.function_call_arguments.delta') {
            const call = calls.get(raw.item_id)
            if (call?.name === 'write_file') await append(call, raw.delta)
          } else if (raw.type === 'response.reasoning_summary_text.delta' && raw.delta) {
            // This explicitly public summary is distinct from raw reasoning/text/content.
            await emit('reasoning_summary', { id: messageId, agent, text: raw.delta })
          }
        }
        if (data.type === 'response_done') await flushAll()
        yield data
      }
      await flushAll()
    },
  }
  return {
    model: observed,
    async commit(path: string, content: string) {
      signal.throwIfAborted()
      await flushAll()
      signal.throwIfAborted()
      // Reconcile the complete, validated file by replacement; never append it twice.
      await emit('file_saved', { path, content })
    },
  }
}
