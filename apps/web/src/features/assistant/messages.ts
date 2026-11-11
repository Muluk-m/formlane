import type { MessageStatus, ThreadMessageLike } from '@assistant-ui/react'
import type { Run, RunEvent } from '@atoms-demo/contracts'
import type { ChatMessage } from '@atoms-demo/core/types'

export type ConversationMessage = Omit<ChatMessage, 'agent'> & {
  agent: string | null
  pending?: boolean
}

type Activity = {
  start: RunEvent
  end?: RunEvent
  superseded?: boolean
}

const complete: MessageStatus = { type: 'complete', reason: 'stop' }

function unfinishedStatus(status: Run['status'] | null): MessageStatus {
  if (status === 'queued' || status === 'running') return { type: 'running' }
  return {
    type: 'incomplete',
    reason: status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'error' : 'other',
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function failed(data: RunEvent['data']) {
  const output = isObject(data.output) ? data.output : undefined
  return (
    Boolean(data.error || output?.error) ||
    data.valid === false ||
    output?.valid === false ||
    data.ok === false ||
    output?.ok === false
  )
}

function identity(event: RunEvent): string | undefined {
  if (typeof event.data.id !== 'string') return undefined
  return JSON.stringify([
    event.runId,
    event.type.startsWith('tool_') ? 'tool' : 'agent',
    event.data.id,
    event.data.name,
    event.data.agent,
  ])
}

function pairActivity(events: readonly RunEvent[]): Activity[] {
  const runs = new Map<string, Map<number, RunEvent>>()
  for (const event of events) {
    let run = runs.get(event.runId)
    if (!run) {
      run = new Map()
      runs.set(event.runId, run)
    }
    // Reconnection replays the same durable event, not a new invocation.
    if (!run.has(event.sequence)) run.set(event.sequence, event)
  }

  const activities: Activity[] = []
  for (const run of runs.values()) {
    const open = new Map<string, Activity>()
    for (const event of [...run.values()].sort((a, b) => a.sequence - b.sequence)) {
      const isStart = event.type === 'tool_start' || event.type === 'agent_start'
      const isEnd = event.type === 'tool_end' || event.type === 'agent_end'
      if (!isStart && !isEnd) {
        if (
          event.type === 'validation' ||
          event.type === 'repair' ||
          event.type === 'build_result'
        ) {
          activities.push({ start: event })
        }
        continue
      }

      const key = identity(event)
      const previous = key === undefined ? undefined : open.get(key)
      if (isEnd && previous) {
        previous.end = event
        if (key !== undefined) open.delete(key)
        continue
      }

      // The executor reuses tool IDs when retrying an interrupted step. Only the
      // newest start can receive its end; the abandoned attempt is not a success.
      if (isStart && previous) previous.superseded = true
      const activity: Activity = { start: event, ...(isEnd ? { end: event } : {}) }
      activities.push(activity)
      if (isStart && key !== undefined) open.set(key, activity)
    }
  }
  return activities
}

function activityMessage(activity: Activity, runStatus: Run['status'] | null): ThreadMessageLike {
  const { start, end, superseded } = activity
  const event = end ?? start
  const data = end ? { ...start.data, ...end.data } : start.data
  const isTool = start.type === 'tool_start' || start.type === 'tool_end'
  const isAgent = start.type === 'agent_start' || start.type === 'agent_end'
  const isError = failed(data)
  const id = `activity:${start.runId}:${start.sequence}`
  const agent = isAgent
    ? typeof start.data.id === 'string'
      ? start.data.id
      : null
    : typeof start.data.agent === 'string'
      ? start.data.agent
      : null
  const status: MessageStatus = isError
    ? { type: 'incomplete', reason: 'error' }
    : end || (!isTool && !isAgent)
      ? complete
      : unfinishedStatus(superseded ? null : runStatus)

  if (isTool && typeof start.data.name === 'string') {
    const input = start.data.input
    // Use only the emitted input/output. Project source belongs to the files
    // surface, and missing tool arguments must not be reconstructed from it.
    const argsText = JSON.stringify(input === undefined ? {} : isObject(input) ? input : { input })
    return {
      id,
      role: 'assistant',
      createdAt: new Date(start.createdAt),
      status,
      metadata: { runId: start.runId, custom: { agent, kind: 'tool' } },
      content: [
        {
          type: 'tool-call',
          toolCallId: `tool:${start.runId}:${start.sequence}`,
          toolName: start.data.name,
          argsText,
          // A real end without a payload still settles the call. An unmatched
          // start never receives a fabricated result, even when the run finishes.
          ...(end ? { result: data.error ?? data.output ?? null, isError } : {}),
        },
      ],
    }
  }

  return {
    id,
    role: 'assistant',
    createdAt: new Date(start.createdAt),
    status,
    metadata: { runId: start.runId, custom: { agent, kind: 'activity' } },
    content: [{ type: 'data', name: 'activity', id, data: { type: event.type, data } }],
  }
}

function messageContent(message: ConversationMessage): ThreadMessageLike['content'] {
  if (message.role === 'agent' && !message.pending && /^[\s]*[[{]/.test(message.content)) {
    try {
      const value: unknown = JSON.parse(message.content)
      if (isObject(value) || Array.isArray(value)) {
        return [{ type: 'data', name: 'structured-output', data: value }]
      }
    } catch {
      // Incomplete JSON and ordinary prose remain readable text.
    }
  }
  return [{ type: 'text', text: message.content }]
}

/** Adapt persisted text and the observed run log without inventing backend events. */
export function toAssistantMessages(
  messages: readonly ConversationMessage[],
  activity: readonly RunEvent[],
  runStatus: Run['status'] | null,
): ThreadMessageLike[] {
  const converted: ThreadMessageLike[] = messages.map((message) => ({
    id: message.id,
    role: message.role === 'agent' ? 'assistant' : message.role,
    content: messageContent(message),
    createdAt: new Date(message.createdAt),
    ...(message.role === 'agent'
      ? { status: message.pending ? unfinishedStatus(runStatus) : complete }
      : {}),
    metadata: {
      custom: {
        agent: message.agent,
        ...(message.role === 'system' ? { kind: 'system' } : {}),
      },
    },
  }))

  // The supplied status belongs to the currently observed run. Older runs can
  // have unfinished attempts, but must not inherit a later run's running state.
  const latestEvent = activity.reduce<RunEvent | undefined>(
    (latest, event) =>
      !latest ||
      event.createdAt > latest.createdAt ||
      (event.createdAt === latest.createdAt && event.sequence >= latest.sequence)
        ? event
        : latest,
    undefined,
  )
  for (const item of pairActivity(activity)) {
    converted.push(
      activityMessage(item, item.start.runId === latestEvent?.runId ? runStatus : null),
    )
  }

  const summaries = new Map<string, { first: RunEvent; text: string }>()
  const seen = new Set<string>()
  for (const event of [...activity].sort((a, b) => a.sequence - b.sequence)) {
    if (event.type !== 'reasoning_summary' || typeof event.data.text !== 'string') continue
    const eventKey = `${event.runId}:${event.sequence}`
    if (seen.has(eventKey)) continue
    seen.add(eventKey)
    const key = `${event.runId}:${String(event.data.id)}`
    const summary = summaries.get(key)
    if (summary) summary.text += event.data.text
    else summaries.set(key, { first: event, text: event.data.text })
  }
  for (const [key, { first, text }] of summaries) {
    converted.push({
      id: `reasoning:${key}`,
      role: 'assistant',
      createdAt: new Date(first.createdAt),
      status: complete,
      content: [{ type: 'reasoning', text }],
      metadata: {
        runId: first.runId,
        custom: { kind: 'reasoning', agent: first.data.agent },
      },
    })
  }

  // Stable sorting keeps existing message order when actual timestamps tie.
  return converted.sort((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
}

/** Group adjacent execution records without losing each invocation's outcome. */
export function groupExecutionMessages(
  messages: readonly ThreadMessageLike[],
): ThreadMessageLike[] {
  const grouped: ThreadMessageLike[] = []
  type Part = Exclude<ThreadMessageLike['content'], string>[number]
  let group:
    | {
        source: ThreadMessageLike
        parts: Part[]
        states: Record<string, { agent: unknown; status: MessageStatus | undefined }>
        running: boolean
      }
    | undefined
  const flush = () => {
    if (!group) return
    grouped.push({
      ...group.source,
      id: `execution:${group.source.id}`,
      content: group.parts,
      status: group.running ? { type: 'running' } : complete,
      metadata: {
        ...group.source.metadata,
        custom: { kind: 'execution', partStates: group.states },
      },
    })
    group = undefined
  }
  for (const message of messages) {
    const parts = message.content
    if (
      typeof parts !== 'string' &&
      message.role === 'assistant' &&
      parts.every((part) => part.type === 'text' && !part.text.trim())
    )
      continue
    const kind = message.metadata?.custom?.kind
    if (
      kind === 'activity' &&
      message.status?.type === 'complete' &&
      typeof parts !== 'string' &&
      parts.every(
        (part) =>
          part.type === 'data' &&
          part.name === 'activity' &&
          (part.data.type === 'agent_start' || part.data.type === 'agent_end') &&
          !part.data.data.task,
      )
    )
      continue
    if (
      typeof parts === 'string' ||
      (kind !== 'activity' && kind !== 'tool' && kind !== 'reasoning')
    ) {
      flush()
      grouped.push(message)
      continue
    }
    if (group && group.source.metadata?.runId !== message.metadata?.runId) flush()
    group ??= { source: message, parts: [], states: {}, running: false }
    group.running ||= message.status?.type === 'running'
    for (const part of parts) {
      group.parts.push(part)
      const key = part.type === 'tool-call' ? part.toolCallId : 'id' in part ? part.id : undefined
      if (key)
        group.states[key] = { agent: message.metadata?.custom?.agent, status: message.status }
    }
  }
  flush()
  return grouped
}
