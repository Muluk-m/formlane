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
import { ArtifactJsonStream, observeModelStream } from './model-stream'

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
function code(events: { type: string; data: Record<string, unknown> }[]) {
  return events
    .filter((event) => event.type === 'code')
    .map((event) => event.data.text)
    .join('')
}

it.each([1, 2, 3, 7, 31, 512])(
  'decodes JSON across %i-character boundaries without exposing checks',
  (size) => {
    const html = '<script>const text = "a\\b";\nconst unicode = "你好😀";</script>\t\r\b\f/'
    const json = JSON.stringify({
      checks: [{ html: 'not the artifact', expected: '\\"html\\"' }],
      html,
    })
      .replace('你好😀', '\\u4f60\\u597d\\ud83d\\ude00')
      .replace('"html":"<', '"h\\u0074ml":"<')
    const reader = new ArtifactJsonStream()
    const chunks: string[] = []
    for (let index = 0; index < json.length; index += size)
      chunks.push(reader.push(json.slice(index, index + size)))
    expect(chunks.join('')).toBe(html)
    for (const chunk of chunks) expect(chunk).not.toMatch(/[\ud800-\udbff]$/u)
  },
)

it('stops malformed escapes and incomplete unicode without inventing text', () => {
  const reader = new ArtifactJsonStream()
  expect(reader.push('{"html":"<main>\\u00')).toBe('<main>')
  expect(reader.push('ZZinvalid"}')).toBe('')
  expect(reader.push('{"html":"ignored"}')).toBe('')
  const oversized = new ArtifactJsonStream()
  expect(oversized.push(`{"html":"${'a'.repeat(180001)}`).length).toBe(180000)
})

it('streams the actual write tool HTML before SDK tool execution and does not duplicate its final artifact', async () => {
  const html = `<!doctype html><html><body>${'Visible content '.repeat(100)}</body></html>`
  const args = JSON.stringify({ html })
  const underlying = modelWith(async function* () {
    for (let index = 0; index < args.length; index += 113) {
      yield chat(args.slice(index, index + 113), index === 0 ? 'write_artifact' : '')
    }
    yield {
      type: 'response_done',
      response: {
        id: 'response-1',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        output: [
          { type: 'function_call', name: 'write_artifact', arguments: args, callId: 'call-1' },
        ],
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
        name: 'write_artifact',
        description: 'Store the candidate',
        parameters: z.object({ html: z.string() }),
        execute: async ({ html: candidate }) => {
          beforeTool = code(observed.events)
          await observed.commit(candidate)
          return 'Candidate stored, still requires validation'
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
  expect(beforeTool).toBe(html)
  expect(code(observed.events)).toBe(html)
  expect(observed.events.filter((event) => event.type === 'code_start')).toHaveLength(1)
  expect(observed.events.some((event) => event.type === 'code_reset')).toBe(false)
  expect(stream.finalOutput).toContain('still requires validation')
})

it('emits an initial draft before the next provider chunk and handles split tool names', async () => {
  let firstDraft = ''
  const observed = observations(
    modelWith(async function* () {
      yield chat('{"html":"<main>', 'write_')
      yield chat('Hello', 'artifact')
      firstDraft = code(observed.events)
      yield chat('</main>"}')
      yield complete
    }),
  )
  await consume(observed.model)
  expect(firstDraft).toBe('<main>Hello')
  await observed.commit('<main>Hello</main>')
  expect(code(observed.events)).toBe('<main>Hello</main>')
  expect(observed.events.map((event) => event.type)).toEqual(['code_start', 'code', 'code'])
})

it('keeps interrupted drafts unsaved and clears buffered fragments on a provider retry', async () => {
  let attempt = 0
  const observed = observations(
    modelWith(async function* () {
      if (attempt++ === 0) {
        yield chat('{"html":"<main>Old', 'write_artifact')
        yield chat(' pending')
        throw new TypeError('terminated')
      }
      yield chat('{"html":"<main>New</main>"}', 'write_artifact')
      yield complete
    }),
  )
  await expect(consume(observed.model)).rejects.toThrow('terminated')
  expect(observed.events.map((event) => event.type)).toEqual(['code_start', 'code'])
  await consume(observed.model)
  await observed.commit('<main>New</main>')
  expect(observed.events.filter((event) => event.type === 'code_start')).toHaveLength(2)
  expect(code(observed.events)).not.toContain('pending')
  expect(observed.events.some((event) => event.type === 'code_reset')).toBe(false)
})

it('fences draft emission and candidate replacement after cancellation', async () => {
  const controller = new AbortController()
  const observed = observations(
    modelWith(async function* () {
      yield chat('{"html":"<main>Draft', 'write_artifact')
      controller.abort(new Error('Cancelled'))
      yield chat(' late</main>"}')
    }),
    controller.signal,
  )
  await expect(consume(observed.model)).rejects.toThrow('Cancelled')
  await expect(observed.commit('late artifact')).rejects.toThrow('Cancelled')
  expect(code(observed.events)).toBe('<main>Draft')
  expect(observed.events.some((event) => event.type === 'code_reset')).toBe(false)
})

it('replaces rather than appends an authoritative artifact when no complete draft was available', async () => {
  const observed = observations(
    modelWith(async function* () {
      yield chat('{"html":"<main>draft', 'write_artifact')
      yield complete
    }),
  )
  await consume(observed.model)
  await observed.commit('<main>Authoritative tool value</main>')
  expect(observed.events.at(-1)).toEqual({
    type: 'code_reset',
    data: { text: '<main>Authoritative tool value</main>' },
  })
})

it('emits only explicitly public reasoning summaries, never raw provider reasoning', async () => {
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

it('ignores other tools and scopes repeated call indexes to each model response', async () => {
  let response = 0
  const observed = observations(
    modelWith(async function* () {
      yield chat('{"html":"not an artifact"}', 'other_tool', 1)
      yield chat(`{"html":"<main>${++response}</main>"}`, 'write_artifact')
      yield complete
    }),
  )
  await consume(observed.model)
  await observed.commit('<main>1</main>')
  await consume(observed.model)
  await observed.commit('<main>2</main>')
  expect(code(observed.events)).toBe('<main>1</main><main>2</main>')
  expect(observed.events.filter((event) => event.type === 'code_start')).toHaveLength(2)
  expect(observed.events.some((event) => event.type === 'code_reset')).toBe(false)
})

it('streams Responses function arguments by item ID without repeating done payloads', async () => {
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
            name: 'write_artifact',
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
          delta: '{"html":"<main>Public artifact</main>"}',
        },
      }
      yield {
        type: 'model',
        providerData,
        event: {
          type: 'response.function_call_arguments.done',
          item_id: 'item-1',
          arguments: '{"html":"<main>Public artifact</main>"}',
        },
      }
      yield complete
    }),
  )
  await consume(observed.model)
  await observed.commit('<main>Public artifact</main>')
  expect(code(observed.events)).toBe('<main>Public artifact</main>')
  expect(observed.events.map((event) => event.type)).toEqual(['code_start', 'code'])
})
