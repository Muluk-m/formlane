import {
  Agent,
  type Model,
  type ModelRequest,
  Runner,
  type StreamEvent,
  tool,
} from '@openai/agents-core'
import { expect, it } from 'vitest'
import { z } from 'zod'
import { FileJsonStream, observeModelStream } from './model-stream'

const request: ModelRequest = {
  input: 'Build an app',
  modelSettings: {},
  tools: [],
  outputType: 'text',
  handoffs: [],
  tracing: false,
}
const complete: StreamEvent = {
  type: 'response_done',
  response: {
    id: 'response-1',
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    output: [],
  },
}
function chat(argumentsDelta: string, name = '', index = 0): StreamEvent {
  return {
    type: 'model',
    providerData: { rawModelEventSource: 'openai-chat-completions' },
    event: {
      choices: [
        {
          index: 0,
          delta: { tool_calls: [{ index, function: { name, arguments: argumentsDelta } }] },
        },
      ],
    },
  }
}
function modelWith(getStreamedResponse: Model['getStreamedResponse']): Model {
  return {
    async getResponse() {
      throw new Error('This fixture only streams')
    },
    getStreamedResponse,
  }
}
function observations(model: Model, signal = new AbortController().signal) {
  const events: { type: string; data: Record<string, unknown> }[] = []
  const observed = observeModelStream(
    model,
    async (type, data) => {
      events.push({ type, data })
    },
    signal,
    'alex',
    'message-1',
  )
  return { ...observed, events }
}
async function consume(model: Model) {
  const events: StreamEvent[] = []
  for await (const event of model.getStreamedResponse(request)) events.push(event)
  return events
}
function code(events: { type: string; data: Record<string, unknown> }[], path = 'src/main.js') {
  return events
    .filter((event) => event.type === 'file_delta' && event.data.path === path)
    .map((event) => event.data.text)
    .join('')
}

it.each([1, 2, 3, 7, 31, 512])(
  'decodes file JSON across %i-character boundaries without exposing nested fields',
  (size) => {
    const content = 'const text = "a\\b";\nconst unicode = "你好😀";\t\r\b\f/'
    const json = JSON.stringify({
      metadata: [{ path: 'wrong.js', content: 'not the file' }],
      path: 'src/main.js',
      content,
    })
      .replace('你好😀', '\\u4f60\\u597d\\ud83d\\ude00')
      .replace('"content":"const', '"co\\u006etent":"const')
    const reader = new FileJsonStream()
    const chunks: string[] = []
    for (let index = 0; index < json.length; index += size) {
      const result = reader.push(json.slice(index, index + size))
      if (result.text) expect(result.path).toBe('src/main.js')
      chunks.push(result.text)
    }
    expect(chunks.join('')).toBe(content)
    for (const chunk of chunks) expect(chunk).not.toMatch(/[\ud800-\udbff]$/u)
  },
)

it('buffers content until a complete valid path arrives, including escaped path keys', () => {
  const reader = new FileJsonStream()
  expect(reader.push('{"content":"export default 1","pa\\u0074h":"src/')).toEqual({
    path: null,
    text: '',
  })
  expect(reader.push('main.js"}')).toEqual({ path: 'src/main.js', text: 'export default 1' })
})

it.each(['../escape.js', '/absolute.js', 'src\\unsafe.js', '.env', 'package-lock.json/../main.js'])(
  'never streams content for unsafe path %s',
  (path) => {
    const reader = new FileJsonStream()
    expect(reader.push(JSON.stringify({ content: 'secret', path }))).toEqual({
      path: null,
      text: '',
    })
  },
)

it('stops malformed escapes and incomplete unicode without inventing content', () => {
  const reader = new FileJsonStream()
  expect(reader.push('{"path":"src/main.js","content":"before\\u00').text).toBe('before')
  expect(reader.push('ZZinvalid"}').text).toBe('')
  expect(reader.push('{"content":"ignored"}').text).toBe('')
  const oversized = new FileJsonStream()
  expect(oversized.push(`{"path":"src/main.js","content":"${'a'.repeat(180001)}`).text.length).toBe(
    180000,
  )
})

it('streams file content before actual Runner tool execution and reconciles without appending twice', async () => {
  const content = `export const text = ${JSON.stringify('Visible content '.repeat(100))}`
  const args = JSON.stringify({ path: 'src/main.js', content })
  const underlying = modelWith(async function* () {
    for (let index = 0; index < args.length; index += 113)
      yield chat(args.slice(index, index + 113), index === 0 ? 'write_file' : '')
    yield {
      type: 'response_done',
      response: {
        id: 'response-1',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        output: [{ type: 'function_call', name: 'write_file', arguments: args, callId: 'call-1' }],
      },
    }
  })
  const observed = observations(underlying)
  let beforeTool = ''
  const agent = new Agent({
    name: 'Alex',
    model: observed.model,
    toolUseBehavior: 'stop_on_first_tool',
    tools: [
      tool({
        name: 'write_file',
        description: 'Store a source file',
        parameters: z.object({ path: z.string(), content: z.string() }),
        execute: async ({ path, content: candidate }) => {
          beforeTool = code(observed.events)
          await observed.commit(path, candidate)
          return 'File saved, still requires build and validation'
        },
      }),
    ],
  })
  const runner = new Runner({ tracingDisabled: true })
  const stream = await runner.run(agent, 'Build an app', { stream: true })
  const received = []
  for await (const event of stream) received.push(event)
  await stream.completed
  expect(received.length).toBeGreaterThan(0)
  expect(beforeTool).toBe(content)
  expect(code(observed.events)).toBe(content)
  expect(observed.events.filter((event) => event.type === 'file_start')).toHaveLength(1)
  expect(observed.events.filter((event) => event.type === 'file_saved')).toEqual([
    { type: 'file_saved', data: { path: 'src/main.js', content } },
  ])
  expect(stream.finalOutput).toContain('still requires build and validation')
})

it('emits the first draft before the next provider chunk with split tool names', async () => {
  let firstDraft = ''
  const observed = observations(
    modelWith(async function* () {
      yield chat('{"path":"src/main.js","content":"const ', 'write_')
      yield chat('hello', 'file')
      firstDraft = code(observed.events)
      yield chat(' = 1"}')
      yield complete
    }),
  )
  await consume(observed.model)
  expect(firstDraft).toBe('const hello')
  await observed.commit('src/main.js', 'const hello = 1')
  expect(code(observed.events)).toBe('const hello = 1')
  expect(observed.events.map((event) => event.type)).toEqual([
    'file_start',
    'file_delta',
    'file_delta',
    'file_saved',
  ])
})

it('keeps interrupted drafts unsaved and clears buffered fragments on provider retry', async () => {
  let attempt = 0
  const observed = observations(
    modelWith(async function* () {
      if (attempt++ === 0) {
        yield chat('{"path":"src/main.js","content":"old', 'write_file')
        yield chat(' pending')
        throw new TypeError('terminated')
      }
      yield chat('{"path":"src/main.js","content":"new"}', 'write_file')
      yield complete
    }),
  )
  await expect(consume(observed.model)).rejects.toThrow('terminated')
  expect(observed.events.map((event) => event.type)).toEqual(['file_start', 'file_delta'])
  await consume(observed.model)
  await observed.commit('src/main.js', 'new')
  expect(observed.events.filter((event) => event.type === 'file_start')).toHaveLength(2)
  expect(code(observed.events)).not.toContain('pending')
  expect(observed.events.filter((event) => event.type === 'file_saved')).toHaveLength(1)
})

it('fences draft emission and durable file reconciliation after cancellation', async () => {
  const controller = new AbortController()
  const observed = observations(
    modelWith(async function* () {
      yield chat('{"path":"src/main.js","content":"draft', 'write_file')
      controller.abort(new Error('Cancelled'))
      yield chat(' late"}')
    }),
    controller.signal,
  )
  await expect(consume(observed.model)).rejects.toThrow('Cancelled')
  await expect(observed.commit('src/main.js', 'late file')).rejects.toThrow('Cancelled')
  expect(code(observed.events)).toBe('draft')
  expect(observed.events.some((event) => event.type === 'file_saved')).toBe(false)
})

it('reconciles the canonical file when an incomplete draft differs or content is empty', async () => {
  const observed = observations(
    modelWith(async function* () {
      yield chat('{"path":"src/main.js","content":"draft', 'write_file')
      yield complete
    }),
  )
  await consume(observed.model)
  await observed.commit('src/main.js', '')
  expect(observed.events.at(-1)).toEqual({
    type: 'file_saved',
    data: { path: 'src/main.js', content: '' },
  })
  expect(code(observed.events)).toBe('draft')
})

it('emits explicitly public reasoning summaries and never raw provider reasoning', async () => {
  const observed = observations(
    modelWith(async function* () {
      yield {
        type: 'model',
        providerData: { rawModelEventSource: 'openai-chat-completions' },
        event: {
          choices: [
            {
              index: 0,
              delta: { reasoning: 'private reasoning', reasoning_content: 'private content' },
            },
          ],
        },
      }
      yield {
        type: 'model',
        providerData: { rawModelEventSource: 'openai-responses' },
        event: { type: 'response.reasoning_text.delta', delta: 'private text' },
      }
      yield {
        type: 'model',
        providerData: { rawModelEventSource: 'openai-responses' },
        event: { type: 'response.reasoning_summary_text.delta', delta: 'Public summary' },
      }
    }),
  )
  await consume(observed.model)
  expect(observed.events).toEqual([
    { type: 'reasoning_summary', data: { id: 'message-1', agent: 'alex', text: 'Public summary' } },
  ])
})

it('isolates interleaved file calls and repeated call indexes in subsequent responses', async () => {
  let response = 0
  const observed = observations(
    modelWith(async function* () {
      yield chat('{"path":"wrong.js","content":"ignored"}', 'other_tool', 2)
      yield chat(`{"path":"src/main.js","content":"main${++response}`, 'write_file')
      yield chat('{"path":"src/styles.css","content":"body {}"}', 'write_file', 1)
      yield chat(' done"}')
      yield complete
    }),
  )
  await consume(observed.model)
  await observed.commit('src/main.js', 'main1 done')
  await consume(observed.model)
  await observed.commit('src/main.js', 'main2 done')
  expect(code(observed.events)).toBe('main1 donemain2 done')
  expect(code(observed.events, 'src/styles.css')).toBe('body {}body {}')
  expect(code(observed.events, 'wrong.js')).toBe('')
  expect(observed.events.filter((event) => event.type === 'file_start')).toHaveLength(4)
})

it('streams Responses arguments by item ID without repeating done payloads', async () => {
  const observed = observations(
    modelWith(async function* () {
      const providerData = { rawModelEventSource: 'openai-responses' }
      yield {
        type: 'model',
        providerData,
        event: {
          type: 'response.output_item.added',
          item: {
            type: 'function_call',
            id: 'item-1',
            call_id: 'call-1',
            name: 'write_file',
            arguments: '',
          },
        },
      }
      yield {
        type: 'model',
        providerData,
        event: {
          type: 'response.function_call_arguments.delta',
          item_id: 'item-1',
          delta: '{"path":"src/main.js","content":"const value = 1"}',
        },
      }
      yield {
        type: 'model',
        providerData,
        event: {
          type: 'response.function_call_arguments.done',
          item_id: 'item-1',
          arguments: '{"path":"src/main.js","content":"const value = 1"}',
        },
      }
      yield complete
    }),
  )
  await consume(observed.model)
  await observed.commit('src/main.js', 'const value = 1')
  expect(code(observed.events)).toBe('const value = 1')
  expect(observed.events.map((event) => event.type)).toEqual([
    'file_start',
    'file_delta',
    'file_saved',
  ])
})
