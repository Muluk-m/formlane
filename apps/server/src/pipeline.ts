import { AlexOutput, parseAlexOutput } from '@atoms-demo/core/alex-stream'
import { extractHtml } from '@atoms-demo/core/html'
import { mockAlexRaw, mockSpeech } from '@atoms-demo/core/mock'
import {
  alexPrompt,
  bobPrompt,
  davidPrompt,
  emmaPrompt,
  mikePrompt,
} from '@atoms-demo/core/prompts'
import { titleFromIdea } from '@atoms-demo/core/text'
import type { AgentId } from '@atoms-demo/core/types'
import type { Db } from './db/client'
import type { Env } from './env'
import { mockEnabled, modelName } from './env'
import type { Run } from './modules/projects/projects.repo'
import {
  insertMessage,
  isRunActive,
  loadCurrentHtml,
  nextVersionNumber,
  renameProject,
  saveVersion,
  setStatus,
  touchProject,
} from './modules/projects/projects.repo'
import { type ChatTurn, streamChat } from './openai'

const INITIAL: AgentId[] = ['mike', 'emma', 'bob', 'alex', 'david']
const FOLLOWUP: AgentId[] = ['mike', 'alex']

export type PipelineOptions = {
  env: Env
  db: Db
  run: Run
  projectId: string
  idea: string
  mode: 'initial' | 'followup'
  requestText: string
  signal: AbortSignal
  emit: (event: string, data: unknown) => Promise<void>
}

export async function runPipeline(opts: PipelineOptions): Promise<void> {
  const agents = opts.mode === 'initial' ? INITIAL : FOLLOWUP
  const mock = mockEnabled(opts.env)
  await opts.emit('pipeline', {
    agents,
    mock,
    model: mock ? 'mock' : modelName(opts.env),
  })

  const clock = makeClock()
  const previousHtml =
    opts.mode === 'followup' ? await loadCurrentHtml(opts.db, opts.projectId) : null
  const ctx = { idea: opts.idea, request: opts.requestText, previousHtml }
  const title = titleFromIdea(opts.idea)
  let plan = ''
  let spec = ''
  let architecture = ''

  for (const agent of agents) {
    await ensureActive(opts)
    await touchProject(opts.db, opts.run, clock())
    await opts.emit('status', { agent })
    if (agent === 'alex') {
      await runAlex(opts, clock, ctx, title, plan, spec, architecture)
      continue
    }
    const messages = messagesFor(
      agent,
      opts.idea,
      opts.requestText,
      plan,
      spec,
      architecture,
      opts.mode,
    )
    const result = await runTextAgent(
      opts,
      clock,
      agent,
      messages,
      ctx,
      title,
      agent === 'mike' && opts.mode === 'initial',
    )
    if (agent === 'mike') {
      plan = result.content
      if (result.title) {
        await renameProject(opts.db, opts.run, result.title, clock())
        await opts.emit('title', { title: result.title })
      }
    } else if (agent === 'emma') {
      spec = result.content
    } else if (agent === 'bob') {
      architecture = result.content
    }
  }

  await ensureActive(opts)
  await setStatus(opts.db, opts.run, 'idle', null, clock())
  await opts.emit('done', { status: 'idle' })
}

function messagesFor(
  agent: AgentId,
  idea: string,
  request: string,
  plan: string,
  spec: string,
  architecture: string,
  mode: 'initial' | 'followup',
): ChatTurn[] {
  if (agent === 'mike') return mikePrompt(idea, mode === 'followup' ? request : null)
  if (agent === 'emma') return emmaPrompt(idea, plan)
  if (agent === 'bob') return bobPrompt(idea, plan, spec)
  if (agent === 'david') return davidPrompt(idea, spec || plan)
  return alexPrompt({ idea, plan, spec, architecture, request, currentHtml: null })
}

async function runTextAgent(
  opts: PipelineOptions,
  clock: () => number,
  agent: 'mike' | 'emma' | 'bob' | 'david',
  messages: ChatTurn[],
  ctx: { idea: string; request: string; previousHtml: string | null },
  title: string,
  captureTitle: boolean,
): Promise<{ content: string; title: string | null }> {
  const id = crypto.randomUUID()
  await opts.emit('message_start', { id, role: 'agent', agent })
  const capture = new TitleCapture(captureTitle)
  const push = async (delta: string) => {
    throwIfAborted(opts.signal)
    const out = capture.push(delta)
    if (out.replace != null) await opts.emit('message_replace', { id, content: out.replace })
    else if (out.delta) await opts.emit('token', { id, text: out.delta })
  }
  if (mockEnabled(opts.env)) {
    await speak(mockSpeech(agent, ctx, title), push, opts.signal, opts.env)
  } else {
    await streamChat(opts.env, messages, 700, 0.7, opts.signal, push)
  }
  const content = capture.visible.trim() || '…'
  await ensureActive(opts)
  await insertMessage(
    opts.db,
    {
      id,
      projectId: opts.projectId,
      role: 'agent',
      agent,
      content,
      createdAt: clock(),
    },
    opts.run,
  )
  await opts.emit('message_done', { id, content })
  return { content, title: capture.title }
}

async function runAlex(
  opts: PipelineOptions,
  clock: () => number,
  ctx: { idea: string; request: string; previousHtml: string | null },
  title: string,
  plan: string,
  spec: string,
  architecture: string,
): Promise<void> {
  const id = crypto.randomUUID()
  await opts.emit('message_start', { id, role: 'agent', agent: 'alex' })
  await opts.emit('code_start', {})
  const output = new AlexOutput()
  let previewed = false
  const push = async (delta: string) => {
    throwIfAborted(opts.signal)
    const parsed = output.push(delta)
    if (parsed.replaceNote != null)
      await opts.emit('message_replace', { id, content: parsed.replaceNote })
    else if (parsed.noteDelta) await opts.emit('token', { id, text: parsed.noteDelta })
    if (parsed.replaceCode) await opts.emit('code_reset', { text: parsed.parsed.code })
    else if (parsed.codeDelta) await opts.emit('code', { text: parsed.codeDelta })
    if (!previewed) {
      const html = extractHtml(parsed.parsed.code)
      if (html) {
        previewed = true
        await opts.emit('preview', { html })
      }
    }
  }
  if (mockEnabled(opts.env)) {
    await speak(mockAlexRaw(ctx, title), push, opts.signal, opts.env)
  } else {
    await streamChat(
      opts.env,
      alexPrompt({
        idea: opts.idea,
        plan,
        spec,
        architecture,
        request: opts.requestText,
        currentHtml: ctx.previousHtml,
      }),
      12000,
      0.4,
      opts.signal,
      push,
    )
  }
  await ensureActive(opts)
  const html = extractHtml(output.raw)
  if (!html) {
    throw new Error('Alex did not return a complete HTML document. Try the build again.')
  }
  const note = parseFinalNote(output.raw)
  const createdAt = clock()
  await insertMessage(
    opts.db,
    {
      id,
      projectId: opts.projectId,
      role: 'agent',
      agent: 'alex',
      content: note,
      createdAt,
    },
    opts.run,
  )
  await opts.emit('message_done', { id, content: note })

  const number = await nextVersionNumber(opts.db, opts.projectId)
  const versionId = crypto.randomUUID()
  const systemId = crypto.randomUUID()
  const prompt = opts.requestText.trim().slice(0, 500)
  const versionAt = clock()
  const systemAt = clock()
  await saveVersion(opts.db, opts.run, {
    id: versionId,
    projectId: opts.projectId,
    number,
    html,
    prompt,
    createdAt: versionAt,
    systemMessageId: systemId,
    systemCreatedAt: systemAt,
  })
  await ensureActive(opts)
  await opts.emit('version', {
    id: versionId,
    number,
    prompt,
    createdAt: versionAt,
    html,
  })
  const saved = `Saved version ${number}.`
  await opts.emit('message_start', { id: systemId, role: 'system', agent: null })
  await opts.emit('message_done', { id: systemId, content: saved })
  await opts.emit('preview', { html })
}

async function ensureActive(opts: PipelineOptions) {
  throwIfAborted(opts.signal)
  if (!(await isRunActive(opts.db, opts.run))) {
    throw new DOMException('Generation stopped.', 'AbortError')
  }
}

async function speak(
  text: string,
  onDelta: (delta: string) => Promise<void>,
  signal: AbortSignal,
  env: Env,
): Promise<void> {
  const delay = Number(env.MOCK_DELAY_MS ?? '0')
  const wait = Number.isFinite(delay) ? Math.max(0, delay) : 0
  const size = 64
  for (let index = 0; index < text.length; index += size) {
    throwIfAborted(signal)
    await onDelta(text.slice(index, index + size))
    if (wait > 0) await sleep(wait)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('Aborted')
    error.name = 'AbortError'
    throw error
  }
}

function parseFinalNote(raw: string): string {
  const note = parseAlexOutput(raw).note.trim()
  return note || 'Built index.html.'
}

function makeClock(): () => number {
  let current = Date.now()
  return () => {
    current = Math.max(Date.now(), current + 1)
    return current
  }
}

class TitleCapture {
  enabled: boolean
  title: string | null = null
  visible = ''
  private buffer = ''
  private decided = false

  constructor(enabled: boolean) {
    this.enabled = enabled
    this.decided = !enabled
  }

  push(delta: string): { delta: string; replace: string | null } {
    if (!this.enabled) {
      this.visible += delta
      return { delta, replace: null }
    }
    if (this.decided) {
      this.visible += delta
      return { delta, replace: null }
    }
    this.buffer += delta
    const newline = this.buffer.search(/\r?\n/)
    const ready = newline !== -1 || this.buffer.length > 180
    if (!ready) return { delta: '', replace: null }
    const line = newline === -1 ? this.buffer : this.buffer.slice(0, newline)
    const rest = newline === -1 ? '' : this.buffer.slice(newline).replace(/^\r?\n/, '')
    const match = line.match(/^\s*TITLE:\s*(.+)\s*$/i)
    this.decided = true
    if (match?.[1]) {
      this.title = match[1]
        .trim()
        .replace(/^["']|["']$/g, '')
        .slice(0, 80)
      this.visible = rest
      return { delta: '', replace: rest }
    }
    this.visible = this.buffer
    return { delta: '', replace: this.buffer }
  }
}
