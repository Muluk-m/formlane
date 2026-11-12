import type { MessageStatus, ThreadMessageLike } from '@assistant-ui/react'
import type { Run, RunEvent } from '@atoms-demo/contracts'
import { expect, it } from 'vitest'
import { type ConversationMessage, groupExecutionMessages, toAssistantMessages } from './messages'

const firstRun = '00000000-0000-4000-8000-000000000001'
const secondRun = '00000000-0000-4000-8000-000000000002'
const toolData = { id: 'delegate-0-alex:edit', name: 'edit_file', agent: 'alex' }

function event(
  sequence: number,
  type: string,
  data: RunEvent['data'],
  runId = firstRun,
  createdAt = sequence * 100,
): RunEvent {
  return { runId, sequence, type, data, createdAt }
}

function tool(message: ThreadMessageLike | undefined) {
  if (!message || typeof message.content === 'string') return undefined
  return message.content.find((part) => part.type === 'tool-call')
}

it('deduplicates replay and pairs repeated tool IDs in durable sequence order', () => {
  const firstStart = event(1, 'tool_start', toolData)
  const firstEnd = event(2, 'tool_end', {
    ...toolData,
    output: { error: 'Edit target was not found. Read the current workspace.' },
  })
  const secondStart = event(3, 'tool_start', toolData)
  const secondEnd = event(4, 'tool_end', { ...toolData, output: { revision: 2 } })
  const messages = toAssistantMessages(
    [],
    [secondEnd, firstStart, firstEnd, secondStart, firstStart, secondEnd],
    'completed',
  )

  expect(messages).toHaveLength(2)
  expect(tool(messages[0])).toMatchObject({
    toolCallId: `tool:${firstRun}:1`,
    result: firstEnd.data.output,
    isError: true,
  })
  expect(messages[0]?.status).toEqual({ type: 'incomplete', reason: 'error' })
  expect(tool(messages[1])).toMatchObject({
    toolCallId: `tool:${firstRun}:3`,
    result: { revision: 2 },
    isError: false,
  })
  expect(messages[1]?.status).toEqual({ type: 'complete', reason: 'stop' })
  expect(messages.map((message) => message.createdAt?.getTime())).toEqual([100, 300])
})

it('leaves interrupted attempts unfinished and never pairs events across runs', () => {
  const messages = toAssistantMessages(
    [],
    [
      event(1, 'tool_start', toolData),
      event(2, 'tool_start', toolData),
      event(3, 'tool_end', { ...toolData, output: { revision: 2 } }),
      event(1, 'tool_end', { ...toolData, output: { revision: 3 } }, secondRun, 400),
    ],
    'completed',
  )

  expect(messages).toHaveLength(3)
  expect(messages[0]?.status).toEqual({ type: 'incomplete', reason: 'other' })
  expect(tool(messages[0])).not.toHaveProperty('result')
  expect(tool(messages[1])).toMatchObject({
    toolCallId: `tool:${firstRun}:2`,
    result: { revision: 2 },
  })
  expect(tool(messages[2])).toMatchObject({
    toolCallId: `tool:${secondRun}:1`,
    result: { revision: 3 },
  })
})

const lifecycleCases: { runStatus: Run['status'] | null; status: MessageStatus }[] = [
  { runStatus: null, status: { type: 'incomplete', reason: 'other' } },
  { runStatus: 'queued', status: { type: 'running' } },
  { runStatus: 'running', status: { type: 'running' } },
  { runStatus: 'completed', status: { type: 'incomplete', reason: 'other' } },
  { runStatus: 'failed', status: { type: 'incomplete', reason: 'error' } },
  { runStatus: 'cancelled', status: { type: 'incomplete', reason: 'cancelled' } },
]

it.each(lifecycleCases)(
  'keeps pending text and tools truthful when the run is $runStatus',
  ({ runStatus, status }) => {
    const pending: ConversationMessage = {
      id: 'pending-message',
      role: 'agent',
      agent: 'specialist-from-server',
      content: 'Partial response',
      createdAt: 50,
      pending: true,
    }
    const saved: ConversationMessage = { ...pending, id: 'saved-message', pending: false }
    const messages = toAssistantMessages(
      [pending, saved],
      [event(1, 'tool_start', toolData)],
      runStatus,
    )

    expect(messages[0]).toMatchObject({
      id: pending.id,
      content: [{ type: 'text', text: pending.content }],
      metadata: { custom: { agent: pending.agent } },
      status,
    })
    expect(messages[1]?.status).toEqual({ type: 'complete', reason: 'stop' })
    expect(messages[2]?.status).toEqual(status)
    expect(tool(messages[2])).not.toHaveProperty('result')
  },
)

it('keeps a failed validation result failed even if the run later completes', () => {
  const report = {
    valid: false,
    artifactHash: 'candidate-hash',
    issues: ['Save did not update the visible name'],
    checks: [{ name: 'save name', passed: false, actual: 'Ada' }],
  }
  const validationTool = { id: 'delegate-0-alex:validate', name: 'validate_preview', agent: 'alex' }
  const validation = event(2, 'validation', report)
  const messages = toAssistantMessages(
    [],
    [
      event(1, 'tool_start', validationTool),
      validation,
      event(3, 'tool_end', { ...validationTool, output: report }),
    ],
    'completed',
  )

  expect(tool(messages[0])).toMatchObject({ result: report, isError: true })
  expect(messages[0]?.status).toEqual({ type: 'incomplete', reason: 'error' })
  expect(messages[1]).toMatchObject({
    status: { type: 'incomplete', reason: 'error' },
    metadata: { custom: { agent: null } },
    content: [{ type: 'data', name: 'activity', data: { type: 'validation', data: report } }],
  })
})

it('pairs agent retries without inventing identity or completion for repair notices', () => {
  const agentData = { id: 'alex', name: 'Alex' }
  const repair = { attempt: 2, issues: ['Save did not update the visible name'] }
  const messages = toAssistantMessages(
    [],
    [
      event(1, 'agent_start', agentData),
      event(2, 'agent_start', agentData),
      event(3, 'repair', repair),
      event(4, 'agent_end', agentData),
    ],
    'running',
  )

  expect(messages).toHaveLength(3)
  expect(messages[0]?.status).toEqual({ type: 'incomplete', reason: 'other' })
  expect(messages[1]).toMatchObject({
    id: `activity:${firstRun}:2`,
    metadata: { custom: { agent: 'alex' } },
    content: [{ type: 'data', data: { type: 'agent_end', data: agentData } }],
  })
  expect(messages[2]).toMatchObject({
    metadata: { custom: { agent: null } },
    content: [{ type: 'data', data: { type: 'repair', data: repair } }],
  })
})

it('discloses complete structured agent output without rewriting user text or partial streams', () => {
  const report: ConversationMessage = {
    id: 'report',
    role: 'agent',
    agent: 'david',
    content: '{"accepted":false,"findings":"Reset does not work"}',
    createdAt: 1,
  }
  const output = toAssistantMessages(
    [
      report,
      { ...report, id: 'user', role: 'user', agent: null },
      { ...report, id: 'pending', pending: true },
      { ...report, id: 'partial', content: '{"accepted":' },
    ],
    [],
    'completed',
  )
  expect(output[0]?.content).toEqual([
    {
      type: 'data',
      name: 'structured-output',
      data: { accepted: false, findings: 'Reset does not work' },
    },
  ])
  expect(output[1]?.content).toEqual([{ type: 'text', text: report.content }])
  expect(output[2]?.content).toEqual([{ type: 'text', text: report.content }])
  expect(output[3]?.content).toEqual([{ type: 'text', text: '{"accepted":' }])
})

it('groups execution without promoting an interrupted attempt to a later successful outcome', () => {
  const converted = toAssistantMessages(
    [],
    [
      event(1, 'tool_start', toolData),
      event(2, 'tool_start', toolData),
      event(3, 'tool_end', { ...toolData, output: { revision: 2 } }),
    ],
    'completed',
  )
  const grouped = groupExecutionMessages(converted)
  expect(grouped).toHaveLength(1)
  expect(grouped[0]?.metadata?.custom).toMatchObject({
    kind: 'execution',
    partStates: {
      [`tool:${firstRun}:1`]: { agent: 'alex', status: { type: 'incomplete', reason: 'other' } },
      [`tool:${firstRun}:2`]: { agent: 'alex', status: { type: 'complete', reason: 'stop' } },
    },
  })
  expect(grouped[0]?.content).toMatchObject([
    { type: 'tool-call', toolCallId: `tool:${firstRun}:1` },
    { type: 'tool-call', result: { revision: 2 } },
  ])
})

it('keeps user turns and separate runs outside a shared execution group', () => {
  const user: ConversationMessage = {
    id: 'request',
    role: 'user',
    agent: null,
    content: 'Change the title',
    createdAt: 150,
  }
  const grouped = groupExecutionMessages(
    toAssistantMessages(
      [user],
      [
        event(1, 'tool_start', toolData),
        event(2, 'tool_end', { ...toolData, output: { revision: 1 } }),
        event(1, 'tool_start', toolData, secondRun, 300),
      ],
      'cancelled',
    ),
  )
  expect(grouped.map((message) => message.role)).toEqual(['assistant', 'user', 'assistant'])
  expect(grouped[0]?.metadata?.runId).toBe(firstRun)
  expect(grouped[2]?.metadata?.runId).toBe(secondRun)
  expect(grouped[2]?.metadata?.custom?.partStates).toMatchObject({
    [`tool:${secondRun}:1`]: { status: { type: 'incomplete', reason: 'cancelled' } },
  })
})

it('retains the delegated task after agent completion and removes empty writing bubbles', () => {
  const pending: ConversationMessage = {
    id: 'empty',
    role: 'agent',
    agent: 'alex',
    content: '',
    pending: true,
    createdAt: 150,
  }
  const grouped = groupExecutionMessages(
    toAssistantMessages(
      [pending],
      [
        event(1, 'agent_start', {
          id: 'alex',
          name: 'Alex',
          task: 'Implement the keyboard-accessible map',
        }),
        event(2, 'agent_end', { id: 'alex', name: 'Alex' }),
      ],
      'completed',
    ),
  )
  expect(grouped).toHaveLength(1)
  expect(grouped[0]?.content).toMatchObject([
    {
      type: 'data',
      data: { type: 'agent_end', data: { task: 'Implement the keyboard-accessible map' } },
    },
  ])
})

it('replays only public reasoning summaries without duplicating chunks or exposing raw reasoning', () => {
  const summary = event(2, 'reasoning_summary', {
    id: 'message',
    agent: 'alex',
    text: 'Inspect the current app. ',
  })
  const converted = toAssistantMessages(
    [],
    [
      event(3, 'reasoning_summary', {
        id: 'message',
        agent: 'alex',
        text: 'Then validate the change.',
      }),
      summary,
      summary,
      event(1, 'reasoning', { id: 'message', agent: 'alex', text: 'PRIVATE_RAW_CONTENT' }),
    ],
    'completed',
  )
  expect(converted).toHaveLength(1)
  expect(converted[0]?.content).toEqual([
    { type: 'reasoning', text: 'Inspect the current app. Then validate the change.' },
  ])
})

it('shows actual project tool inputs and build failures without source prose', () => {
  const build = { id: 'build-1', name: 'build_project', agent: 'alex' }
  const failure = { ok: false, issues: ['src/App.tsx: Unterminated string'] }
  const messages = toAssistantMessages(
    [],
    [
      event(1, 'tool_start', { id: 'read-1', name: 'read_file', input: { path: 'src/App.tsx' } }),
      event(2, 'tool_end', {
        id: 'read-1',
        name: 'read_file',
        output: { path: 'src/App.tsx', content: 'export default App' },
      }),
      event(3, 'tool_start', build),
      event(4, 'build_result', failure),
      event(5, 'tool_end', { ...build, output: failure }),
      event(6, 'file_delta', { path: 'src/App.tsx', text: 'private source draft' }),
    ],
    'failed',
  )
  expect(messages).toHaveLength(3)
  expect(tool(messages[0])?.argsText).toBe(JSON.stringify({ path: 'src/App.tsx' }))
  expect(tool(messages[1])).toMatchObject({
    toolName: 'build_project',
    isError: true,
    result: failure,
  })
  expect(messages[2]).toMatchObject({
    status: { type: 'incomplete', reason: 'error' },
    content: [{ type: 'data', data: { type: 'build_result', data: failure } }],
  })
})

it('summarizes active tools without exposing delegation instructions in the summary', () => {
  const grouped = groupExecutionMessages(
    toAssistantMessages(
      [],
      [
        event(1, 'agent_start', {
          id: 'david',
          name: 'David',
          task: 'Review all QA evidence independently',
        }),
        event(2, 'tool_start', {
          id: 'baseline',
          agent: 'david',
          name: 'read_previous_file',
          input: { path: 'src/App.tsx' },
        }),
      ],
      'running',
    ),
  )

  expect(grouped).toHaveLength(1)
  expect(grouped[0]?.status).toEqual({ type: 'running' })
  expect(grouped[0]?.metadata?.custom?.focus).toEqual({
    toolName: 'read_previous_file',
    agent: 'david',
  })
  expect(grouped[0]?.content).toMatchObject([
    { type: 'data', data: { data: { task: 'Review all QA evidence independently' } } },
    { type: 'tool-call', toolName: 'read_previous_file' },
  ])
})

it.each([
  ['failed', 'error'],
  ['cancelled', 'cancelled'],
] as const)('keeps a %s execution group terminal when observation ends', (runStatus, reason) => {
  const grouped = groupExecutionMessages(
    toAssistantMessages([], [event(1, 'tool_start', toolData)], runStatus),
  )

  expect(grouped[0]?.status).toEqual({ type: 'incomplete', reason })
  expect(grouped[0]?.metadata?.custom?.focus).toBeUndefined()
  expect(tool(grouped[0])).not.toHaveProperty('result')
})

it('keeps failed attempts visible in a settled summary after a successful retry', () => {
  const grouped = groupExecutionMessages(
    toAssistantMessages(
      [],
      [
        event(1, 'tool_start', toolData),
        event(2, 'tool_end', { ...toolData, output: { error: 'Target was not found' } }),
        event(3, 'tool_start', toolData),
        event(4, 'tool_end', { ...toolData, output: { revision: 2 } }),
      ],
      'completed',
    ),
  )

  expect(grouped[0]?.status).toEqual({ type: 'incomplete', reason: 'error' })
  expect(grouped[0]?.metadata?.custom?.partStates).toMatchObject({
    [`tool:${firstRun}:1`]: { status: { type: 'incomplete', reason: 'error' } },
    [`tool:${firstRun}:3`]: { status: { type: 'complete', reason: 'stop' } },
  })
})

it('moves only known system terminal notices into execution evidence and preserves actual replies', () => {
  const failure =
    'Generation could not complete. Your previous version is unchanged. Please try again.'
  const base: ConversationMessage = {
    id: 'terminal',
    role: 'system',
    agent: null,
    content: failure,
    createdAt: 300,
  }
  const grouped = groupExecutionMessages(
    toAssistantMessages(
      [
        base,
        { ...base, id: 'user', role: 'user', createdAt: 400 },
        { ...base, id: 'result', role: 'agent', agent: 'alex', createdAt: 500 },
        {
          ...base,
          id: 'other-system',
          content: 'A specific diagnostic remains available',
          createdAt: 600,
        },
      ],
      [
        event(1, 'tool_start', toolData),
        event(3, 'run_state', { status: 'failed', error: failure }),
      ],
      'failed',
    ),
  )

  expect(grouped).toHaveLength(4)
  expect(grouped[0]).toMatchObject({
    role: 'assistant',
    status: { type: 'incomplete', reason: 'error' },
    metadata: { runId: firstRun, custom: { kind: 'execution' } },
    content: [
      { type: 'tool-call' },
      {
        type: 'data',
        name: 'activity',
        data: { type: 'run_terminal', data: { status: 'failed', error: failure } },
      },
    ],
  })
  expect(grouped.slice(1).map((message) => message.id)).toEqual(['user', 'result', 'other-system'])
  expect(grouped[1]?.content).toEqual([{ type: 'text', text: failure }])
  expect(grouped[2]?.content).toEqual([{ type: 'text', text: failure }])
  expect(grouped[3]?.role).toBe('system')
})

it('retains cancellation evidence when the event log is unavailable', () => {
  const grouped = groupExecutionMessages(
    toAssistantMessages(
      [
        {
          id: 'cancel',
          role: 'system',
          agent: null,
          content: 'Generation cancelled.',
          createdAt: 100,
        },
      ],
      [],
      null,
    ),
  )

  expect(grouped[0]).toMatchObject({
    status: { type: 'incomplete', reason: 'cancelled' },
    metadata: { custom: { kind: 'execution' } },
    content: [
      { type: 'data', data: { type: 'run_terminal', data: { error: 'Generation cancelled.' } } },
    ],
  })
})

it('does not summarize a rejected independent review as completed execution', () => {
  const review = { id: 'review', agent: 'david', name: 'record_review' }
  const grouped = groupExecutionMessages(
    toAssistantMessages(
      [],
      [
        event(1, 'tool_start', review),
        event(2, 'tool_end', {
          ...review,
          output: { accepted: false, findings: 'Reset is broken' },
        }),
      ],
      'completed',
    ),
  )

  expect(grouped[0]?.status).toEqual({ type: 'incomplete', reason: 'error' })
  expect(tool(grouped[0])).toMatchObject({ isError: true, result: { accepted: false } })
})

it('keeps step-limit failures in terminal execution details without losing the diagnostic', () => {
  const content =
    'The agent reached its step limit before validation and review could finish. Your previous version is unchanged.'
  const grouped = groupExecutionMessages(
    toAssistantMessages(
      [{ id: 'step-limit', role: 'system', agent: null, content, createdAt: 100 }],
      [],
      'failed',
    ),
  )

  expect(grouped).toHaveLength(1)
  expect(grouped[0]).toMatchObject({
    role: 'assistant',
    status: { type: 'incomplete', reason: 'error' },
    metadata: { custom: { kind: 'execution' } },
    content: [
      {
        type: 'data',
        name: 'activity',
        data: { type: 'run_terminal', data: { status: 'failed', error: content } },
      },
    ],
  })
})
