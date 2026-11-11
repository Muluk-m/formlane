import type { MessageStatus, ThreadMessageLike } from '@assistant-ui/react'
import type { Run, RunEvent } from '@atoms-demo/contracts'
import { expect, it } from 'vitest'
import { type ConversationMessage, toAssistantMessages } from './messages'

const firstRun = '00000000-0000-4000-8000-000000000001'
const secondRun = '00000000-0000-4000-8000-000000000002'
const toolData = { id: 'delegate-0-alex:edit', name: 'edit_artifact', agent: 'alex' }

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
