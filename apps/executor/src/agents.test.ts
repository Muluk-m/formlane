import {
  createProjectSource,
  type ProjectSource,
  projectSourceHash,
} from '@atoms-demo/core/project'
import { type Model, type ModelResponse, Usage } from '@openai/agents-core'
import type * as OpenAIModule from '@openai/agents-openai'
import { beforeEach, expect, it, vi } from 'vitest'
import { executeHarness } from './agents'
import type { ExecutorConfig } from './config'
import { claimSchema } from './control-plane'
import type { DurableExecutor, HarnessContext } from './types'
import type * as ValidatorModule from './validator'
import { artifactHash } from './validator'

const provider = vi.hoisted(() => ({ getModel: vi.fn(), close: vi.fn() }))
const execution = vi.hoisted(() => ({ compile: vi.fn(), validate: vi.fn() }))
vi.mock('@openai/agents-openai', async (importOriginal) => ({
  ...(await importOriginal<typeof OpenAIModule>()),
  OpenAIProvider: class {
    getModel = provider.getModel
    close = provider.close
  },
}))
vi.mock('./project-build', () => ({ compileProject: execution.compile }))
vi.mock('./validator', async (importOriginal) => ({
  ...(await importOriginal<typeof ValidatorModule>()),
  validateArtifact: execution.validate,
}))

const config: ExecutorConfig = {
  OPENAI_API_KEY: 'unit-test-provider-key',
  ENDPOINT: 'https://provider.invalid/v1',
  MODEL: 'test-model',
  CONTROL_PLANE_URL: 'https://control.invalid',
  EXECUTOR_TOKEN: 'unit-test-executor-token-0000000000',
}
const context: HarnessContext = {
  projectId: 'project',
  runId: 'run',
  idea: 'Build a counter',
  request: 'Add a counter',
  previousSource: null,
}
const preview = '<!doctype html><html><body><button>Count</button><output>0</output></body></html>'
const checks = [
  {
    name: 'increments',
    actions: [{ kind: 'click', selector: 'button', value: null }],
    assertions: [{ kind: 'text', selector: 'output', expected: '1' }],
  },
  {
    name: 'starts at zero',
    actions: [],
    assertions: [{ kind: 'text', selector: 'output', expected: '0' }],
  },
]
type Step =
  | { kind: 'manager'; role: string }
  | { kind: 'call'; name: string; args: Record<string, unknown> }
  | { kind: 'text'; text: string }
const dispatch = (role: string): Step => ({ kind: 'manager', role })
const call = (name: string, args: Record<string, unknown> = {}): Step => ({
  kind: 'call',
  name,
  args,
})
const say = (text: string): Step => ({ kind: 'text', text })
const initialize = () => [
  dispatch('bob'),
  call('initialize_project', { template: 'react-ts', reason: 'Interactive components' }),
  say('Use small React components and local CSS.'),
]
const review = () => [
  dispatch('david'),
  call('validate_preview'),
  call('record_review', { accepted: true, findings: 'The counter satisfies the brief.' }),
  dispatch('complete'),
]

beforeEach(() => {
  vi.clearAllMocks()
  execution.compile.mockImplementation(async (source: ProjectSource) => ({
    html: preview,
    sourceHash: await projectSourceHash(source),
  }))
  execution.validate.mockImplementation(async (html: string) => ({
    valid: true,
    artifactHash: await artifactHash(html),
    issues: [],
    checks: [],
  }))
})

function harness(
  steps: Step[],
  previousSource: ProjectSource | null = null,
  durableOverride?: DurableExecutor,
) {
  const queue = [...steps]
  const modelInputs: unknown[] = []
  let sequence = 0
  const response = (output: ModelResponse['output']): ModelResponse => ({
    output,
    usage: new Usage(),
    responseId: `response-${sequence++}`,
  })
  const model: Model = {
    async getResponse(request) {
      modelInputs.push(request.input)
      const step = queue.shift() ?? dispatch('complete')
      if (step.kind !== 'manager')
        throw new Error(`Expected a manager decision, received ${step.kind}`)
      return response([
        {
          type: 'function_call',
          callId: `call-${sequence}`,
          name: `delegate_${step.role}`,
          arguments: JSON.stringify({ task: `Perform ${step.role}` }),
        },
      ])
    },
    async *getStreamedResponse(request) {
      modelInputs.push(request.input)
      const step = queue.shift()
      if (!step || step.kind === 'manager') throw new Error('Expected a specialist response')
      if (step.kind === 'call') {
        yield {
          type: 'response_done',
          response: {
            id: `response-${sequence++}`,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            output: [
              {
                type: 'function_call',
                callId: `call-${sequence}`,
                name: step.name,
                arguments: JSON.stringify(step.args),
              },
            ],
          },
        }
      } else {
        yield { type: 'output_text_delta', delta: step.text }
        yield {
          type: 'response_done',
          response: {
            id: `response-${sequence++}`,
            usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            output: [
              {
                type: 'message',
                role: 'assistant',
                status: 'completed',
                content: [{ type: 'output_text', text: step.text }],
              },
            ],
          },
        }
      }
    },
  }
  provider.getModel.mockResolvedValue(model)
  const events: { type: string; data: Record<string, unknown> }[] = []
  const checkpoints = new Map<string, unknown>([
    ['manager-0', { role: 'complete', task: 'Old HTML-only checkpoint' }],
  ])
  const durable: DurableExecutor = durableOverride ?? {
    async run<T>(name: string, fn: () => Promise<T>): Promise<T> {
      if (checkpoints.has(name)) return checkpoints.get(name) as T
      const result = await fn()
      checkpoints.set(name, structuredClone(result))
      return result
    },
  }
  return {
    events,
    checkpoints,
    modelInputs,
    queue,
    run: (signal = new AbortController().signal) =>
      executeHarness(
        config,
        { ...context, previousSource },
        durable,
        async (type, data) => {
          events.push({ type, data: structuredClone(data) })
        },
        signal,
      ),
  }
}
function outputs(events: { type: string; data: Record<string, unknown> }[], name: string) {
  return events
    .filter((event) => event.type === 'tool_end' && event.data.name === name)
    .map((event) => event.data.output)
}

it('initializes a real template, performs more than six file operations and accepts only a built independently validated project', async () => {
  const source = 'export default function App() { return <button>Count</button> }'
  const run = harness([
    ...initialize(),
    dispatch('alex'),
    call('read_workspace'),
    call('read_file', { path: 'src/App.tsx' }),
    call('write_file', { path: 'src/App.tsx', content: source }),
    call('write_file', { path: 'src/counter.ts', content: 'export const initial = 0' }),
    call('write_file', { path: 'src/obsolete.ts', content: 'export const unused = 0' }),
    call('edit_file', { path: 'src/counter.ts', edits: [{ find: '0', replacement: '1' }] }),
    call('delete_file', { path: 'src/obsolete.ts' }),
    call('set_acceptance_checks', { checks }),
    call('build_project'),
    call('validate_preview'),
    ...review(),
  ])
  const result = await run.run()
  expect(result.source.template).toBe('react-ts')
  expect(result.source.files['src/App.tsx']).toBe(source)
  expect(result.source.files['src/counter.ts']).toBe('export const initial = 1')
  expect(result.source.files['src/obsolete.ts']).toBeUndefined()
  expect(result.html).toBe(preview)
  expect(execution.compile).toHaveBeenCalledWith(result.source, expect.any(AbortSignal))
  expect(execution.validate).toHaveBeenCalledTimes(2)
  expect(run.events.find((event) => event.type === 'project_initialized')?.data.source).toEqual(
    createProjectSource('react-ts'),
  )
  expect(run.events).toContainEqual({ type: 'file_deleted', data: { path: 'src/obsolete.ts' } })
  expect(run.events).toContainEqual({
    type: 'build_result',
    data: { ok: true, issues: [], sourceHash: await projectSourceHash(result.source) },
  })
  expect(
    [...run.checkpoints.keys()]
      .filter((name) => name !== 'manager-0')
      .every((name) => name.startsWith('project-v1-')),
  ).toBe(true)
  expect(run.queue).toHaveLength(0)
  expect(provider.close).toHaveBeenCalledOnce()
})

it('preserves follow-up source and rejects resets, manifest changes, required-file deletion and partial edits atomically', async () => {
  const previous = createProjectSource('vanilla')
  previous.files['src/feature.js'] = 'export const count = 1; export const keep = true'
  const original = structuredClone(previous)
  const run = harness(
    [
      dispatch('bob'),
      call('initialize_project', { template: 'react-ts', reason: 'Try a reset' }),
      say('Preserve Vanilla.'),
      dispatch('alex'),
      call('read_workspace'),
      call('write_file', {
        path: 'package.json',
        content: '{"scripts":{"build":"curl external.invalid"}}',
      }),
      call('delete_file', { path: 'index.html' }),
      call('delete_file', { path: 'package.json' }),
      call('edit_file', {
        path: 'src/feature.js',
        edits: [
          { find: 'count = 1', replacement: 'count = 2' },
          { find: 'missing', replacement: 'changed' },
        ],
      }),
      call('read_file', { path: 'src/feature.js' }),
      call('write_file', { path: 'src/new.js', content: 'export const added = true' }),
      call('set_acceptance_checks', { checks }),
      call('build_project'),
      call('validate_preview'),
      ...review(),
    ],
    previous,
  )
  const result = await run.run()
  expect(result.source).toEqual({
    ...original,
    files: { ...original.files, 'src/new.js': 'export const added = true' },
  })
  expect(previous).toEqual(original)
  expect(outputs(run.events, 'initialize_project')[0]).toHaveProperty('error')
  expect(outputs(run.events, 'write_file')[0]).toHaveProperty('error')
  expect(
    outputs(run.events, 'delete_file').every(
      (output) => output && typeof output === 'object' && 'error' in output,
    ),
  ).toBe(true)
  expect(outputs(run.events, 'edit_file')[0]).toHaveProperty('error')
  expect(run.events.some((event) => event.type === 'project_initialized')).toBe(false)
  expect(run.events.filter((event) => event.type === 'file_saved')).toEqual([
    { type: 'file_saved', data: { path: 'src/new.js', content: 'export const added = true' } },
  ])
  expect(JSON.stringify(run.modelInputs)).toContain(
    'export const count = 1; export const keep = true',
  )
})

it('returns actual build errors to the model and emits evidence before a repaired build is accepted', async () => {
  execution.compile.mockRejectedValueOnce(new Error('src/App.tsx: unresolved ./missing'))
  const run = harness([
    ...initialize(),
    dispatch('alex'),
    call('set_acceptance_checks', { checks }),
    call('build_project'),
    call('write_file', { path: 'src/missing.ts', content: 'export default 1' }),
    call('build_project'),
    call('validate_preview'),
    ...review(),
  ])
  await run.run()
  expect(outputs(run.events, 'build_project')[0]).toEqual({
    ok: false,
    issues: ['src/App.tsx: unresolved ./missing'],
  })
  expect(JSON.stringify(run.modelInputs)).toContain('src/App.tsx: unresolved ./missing')
  expect(
    run.events.filter((event) => event.type === 'build_result').map((event) => event.data.ok),
  ).toEqual([false, true])
})

it('invalidates a prior build after a file change and requires Alex to build and validate again', async () => {
  const run = harness([
    ...initialize(),
    dispatch('alex'),
    call('set_acceptance_checks', { checks }),
    call('build_project'),
    call('write_file', { path: 'src/new.ts', content: 'export const changed = true' }),
    call('validate_preview'),
    dispatch('complete'),
    dispatch('alex'),
    call('build_project'),
    call('validate_preview'),
    ...review(),
  ])
  const result = await run.run()
  expect(result.source.files['src/new.ts']).toContain('changed')
  expect(outputs(run.events, 'validate_preview')[0]).toHaveProperty('error')
  expect(execution.compile).toHaveBeenCalledTimes(2)
  expect(execution.validate).toHaveBeenCalledTimes(2)
})

it('rejects review acceptance that reuses Alex evidence without David browser validation', async () => {
  const run = harness([
    ...initialize(),
    dispatch('alex'),
    call('set_acceptance_checks', { checks }),
    call('build_project'),
    call('validate_preview'),
    dispatch('david'),
    call('record_review', { accepted: true, findings: 'Trust implementation report' }),
    dispatch('complete'),
  ])
  await expect(run.run()).rejects.toMatchObject({ code: 'validation' })
  expect(outputs(run.events, 'record_review')[0]).toMatchObject({
    accepted: false,
    error: expect.any(String),
  })
  expect(execution.validate).toHaveBeenCalledTimes(1)
})

it('requires Alex validation even if a built project later passes independent review', async () => {
  const run = harness([
    ...initialize(),
    dispatch('alex'),
    call('set_acceptance_checks', { checks }),
    call('build_project'),
    say('Implementation finished without running browser validation.'),
    ...review(),
  ])
  await expect(run.run()).rejects.toMatchObject({ code: 'validation' })
  expect(execution.validate).toHaveBeenCalledTimes(1)
})

it.each(['source', 'html'])(
  'rejects restored acceptance evidence when current %s no longer matches the successful build',
  async (changed) => {
    const durable: DurableExecutor = {
      async run<T>(name: string, fn: () => Promise<T>): Promise<T> {
        const result = await fn()
        if (name.endsWith('-david') && result && typeof result === 'object') {
          if (changed === 'source' && 'source' in result) {
            const parsed = claimSchema.parse({
              job: {
                context: { ...context, previousSource: result.source },
                leaseToken: 'lease',
                deadline: 1,
              },
            })
            const source = parsed.job?.context.previousSource
            if (!source) throw new Error('Missing checkpoint source')
            source.files['src/unbuilt.ts'] = 'export const unbuilt = true'
            Object.assign(result, { source })
          } else Object.assign(result, { html: preview.replace('Count', 'Stale') })
        }
        return result
      },
    }
    const run = harness(
      [
        ...initialize(),
        dispatch('alex'),
        call('set_acceptance_checks', { checks }),
        call('build_project'),
        call('validate_preview'),
        ...review(),
      ],
      null,
      durable,
    )
    await expect(run.run()).rejects.toMatchObject({ code: 'validation' })
  },
)

it('fences a completed compiler result after cancellation without emitting a successful build', async () => {
  const controller = new AbortController()
  execution.compile.mockImplementationOnce(async (source: ProjectSource) => {
    controller.abort(new Error('Cancelled'))
    return { html: preview, sourceHash: await projectSourceHash(source) }
  })
  const run = harness([...initialize(), dispatch('alex'), call('build_project')])
  await expect(run.run(controller.signal)).rejects.toThrow()
  expect(run.events.some((event) => event.type === 'build_result')).toBe(false)
  expect(execution.validate).not.toHaveBeenCalled()
})

it('requires source in claimed follow-ups and rejects old HTML-only contexts', () => {
  const job = {
    context: { ...context, previousSource: createProjectSource('vanilla') },
    leaseToken: 'lease',
    deadline: 1,
  }
  expect(claimSchema.parse({ job }).job?.context.previousSource).toEqual(job.context.previousSource)
  const { previousSource: _, ...oldContext } = context
  expect(
    claimSchema.safeParse({ job: { ...job, context: { ...oldContext, previousHtml: preview } } })
      .success,
  ).toBe(false)
})
