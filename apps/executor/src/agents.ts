import { Agent, Runner, tool } from '@openai/agents-core'
import { OpenAIProvider } from '@openai/agents-openai'
import { z } from 'zod'
import type { ExecutorConfig } from './config'
import type { DurableExecutor, HarnessContext, HarnessResult } from './types'
import {
  artifactHash,
  type BrowserCheck,
  browserCheckSchema,
  type ValidationReport,
  validateArtifact,
} from './validator'

type Emit = (type: string, data: Record<string, unknown>) => Promise<void>
const actionSchema = z.object({
  role: z.enum(['emma', 'bob', 'alex', 'david', 'complete']),
  task: z.string().min(1),
})
type Action = z.infer<typeof actionSchema>
type Workspace = {
  brief: string
  architecture: string
  html: string
  checks: BrowserCheck[]
  report: ValidationReport | null
  review: { accepted: boolean; findings: string } | null
  lastOutput: string
  revision: number
}
const roles = { emma: 'Emma', bob: 'Bob', alex: 'Alex', david: 'David' } as const

export async function executeHarness(
  env: ExecutorConfig,
  context: HarnessContext,
  durable: DurableExecutor,
  emit: Emit,
  signal: AbortSignal,
): Promise<HarnessResult> {
  if (!env.OPENAI_API_KEY)
    throw Object.assign(new Error('Model credentials are missing.'), { code: 'provider' })
  const provider = new OpenAIProvider({
    apiKey: env.OPENAI_API_KEY,
    baseURL: env.ENDPOINT,
    useResponses: false,
  })
  const model = await provider.getModel(env.MODEL)
  const runner = new Runner({
    tracingDisabled: true,
    traceIncludeSensitiveData: false,
    toolExecution: { maxFunctionToolConcurrency: 1 },
  })
  let workspace: Workspace = {
    brief: '',
    architecture: '',
    html: context.previousHtml ?? '',
    checks: [],
    report: null,
    review: null,
    lastOutput: '',
    revision: 0,
  }
  const history: { role: string; task: string; result: string }[] = []
  try {
    for (let turn = 0; turn < 14; turn++) {
      signal.throwIfAborted()
      const action = await durable.run(`manager-${turn}`, async () => {
        await emit('agent_start', { id: 'mike', name: 'Mike' })
        const choose = (role: Action['role'], description: string) =>
          tool({
            name: `delegate_${role}`,
            description,
            parameters: z.object({ task: z.string() }),
            execute: async ({ task }) => JSON.stringify({ role, task }),
          })
        const manager = new Agent({
          name: 'Mike',
          model,
          toolUseBehavior: 'stop_on_first_tool',
          modelSettings: { toolChoice: 'required', parallelToolCalls: false },
          instructions: `You manage a real application build. Choose ONE specialist tool per turn based on results. Emma defines acceptance criteria; Bob designs architecture; Alex writes or repairs the app with tools; David independently validates interactions and reviews requirements. Never complete until the latest browser report passes and David accepts it. If tests fail, delegate repair to Alex with exact failures, then David again. Initial work needs Emma and Bob before Alex; followups preserve existing behavior. Do not blindly repeat successful work. At most 14 delegations. Tools return a durable dispatch receipt; the next turn contains the actual specialist result.`,
          tools: [
            choose('emma', 'Delegate product requirements and acceptance criteria'),
            choose('bob', 'Delegate architecture planning'),
            choose('alex', 'Delegate implementation or targeted repair'),
            choose('david', 'Delegate independent browser validation and review'),
            choose('complete', 'Finish only after actual validation passes and review accepts'),
          ],
        })
        const result = await runner.run(
          manager,
          JSON.stringify({
            idea: context.idea,
            request: context.request,
            hasPreviousApp: Boolean(context.previousHtml),
            history,
            workspace: {
              brief: workspace.brief,
              architecture: workspace.architecture,
              revision: workspace.revision,
              report: workspace.report,
              review: workspace.review,
            },
          }),
          { maxTurns: 3, signal },
        )
        const decision = actionSchema.parse(JSON.parse(result.finalOutput ?? '{}'))
        await emit('agent_end', { id: 'mike', name: 'Mike' })
        return decision
      })
      if (action.role === 'complete') {
        if (
          workspace.html &&
          workspace.report?.valid &&
          workspace.report.artifactHash === (await artifactHash(workspace.html)) &&
          workspace.review?.accepted === true
        )
          return { html: workspace.html, summary: action.task }
        history.push({
          role: 'system',
          task: action.task,
          result:
            'Completion rejected: current artifact needs passing browser checks and independent acceptance.',
        })
        continue
      }
      const role = action.role
      const stepName = `delegate-${turn}-${role}`
      workspace = await durable.run(stepName, async () => {
        const current: Workspace = structuredClone(workspace)
        const bytes = new Uint8Array(
          await crypto.subtle.digest(
            'SHA-256',
            new TextEncoder().encode(`${context.runId}:${stepName}`),
          ),
        )
        bytes[6] = ((bytes[6] ?? 0) & 15) | 64
        bytes[8] = ((bytes[8] ?? 0) & 63) | 128
        const hex = [...bytes.slice(0, 16)]
          .map((value) => value.toString(16).padStart(2, '0'))
          .join('')
        const messageId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
        await emit('tool_start', {
          id: stepName,
          name: `delegate_${role}`,
          agent: 'mike',
          childAgent: role,
          input: action.task,
        })
        await emit('agent_start', { id: role, name: roles[role] })
        await emit('message_start', { id: messageId, role: 'agent', agent: role })
        const read = tool({
          name: 'read_workspace',
          description:
            'Read the actual current files, brief and validation findings before doing work.',
          parameters: z.object({}),
          execute: async () => {
            await emit('tool_start', {
              id: `${stepName}:read`,
              name: 'read_workspace',
              agent: role,
            })
            await emit('tool_end', {
              id: `${stepName}:read`,
              name: 'read_workspace',
              agent: role,
              output: { revision: current.revision },
            })
            return { ...current, originalIdea: context.idea, userRequest: context.request }
          },
        })
        const write = tool({
          name: 'write_artifact',
          description:
            'Write the complete index.html candidate and behavioral acceptance checks. Does not publish or mark complete.',
          parameters: z.object({
            html: z.string().min(80).max(180000),
            checks: z.array(browserCheckSchema).min(2).max(6),
          }),
          execute: async ({ html, checks }) => {
            signal.throwIfAborted()
            await emit('tool_start', {
              id: `${stepName}:write`,
              name: 'write_artifact',
              agent: role,
            })
            current.html = html
            current.checks = checks
            current.report = null
            current.review = null
            current.revision++
            await emit('tool_end', {
              id: `${stepName}:write`,
              name: 'write_artifact',
              agent: role,
              output: { revision: current.revision, bytes: html.length },
            })
            await emit('code_reset', { text: html })
            return {
              revision: current.revision,
              message: 'Candidate stored. Run validate_preview; it is not accepted yet.',
            }
          },
        })
        const validate = tool({
          name: 'validate_preview',
          description:
            'Execute real isolated browser actions and exact assertions against the current candidate. Returns genuine failures for repair.',
          parameters: z.object({}),
          execute: async () => {
            signal.throwIfAborted()
            await emit('tool_start', {
              id: `${stepName}:validate`,
              name: 'validate_preview',
              agent: role,
            })
            current.report = await validateArtifact(current.html, current.checks, signal)
            await emit('validation', { ...current.report })
            await emit('tool_end', {
              id: `${stepName}:validate`,
              name: 'validate_preview',
              agent: role,
              output: current.report,
            })
            return current.report
          },
        })
        const accept = tool({
          name: 'record_review',
          description:
            'Record independent review of user requirements and browser evidence. Accept only if tests cover the requested behavior and latest artifact passed.',
          parameters: z.object({ accepted: z.boolean(), findings: z.string() }),
          execute: async ({ accepted, findings }) => {
            if (
              accepted &&
              (!current.report?.valid ||
                current.report.artifactHash !== (await artifactHash(current.html)))
            )
              return { accepted: false, error: 'No passing report for the current artifact.' }
            current.review = { accepted, findings }
            return { accepted, findings }
          },
        })
        if (role === 'alex' && current.report && !current.report.valid)
          await emit('repair', { attempt: current.revision + 1, issues: current.report.issues })
        const instructions =
          role === 'emma'
            ? 'You are the product agent. Read workspace, define precise scope and at least two observable interaction acceptance criteria. Answer concisely in the user language.'
            : role === 'bob'
              ? 'You are the architect. Read workspace and product brief, choose a self-contained HTML/CSS/JS structure with in-memory state for an opaque iframe. No external network, storage, backend, CDN or secrets. Define testable semantic selectors. Answer concisely.'
              : role === 'alex'
                ? 'You are the implementation agent. Read workspace. Implement the requested self-contained app, or repair the exact reported defects preserving unrelated behavior. Use write_artifact for FULL HTML; no code fences as a substitute. Provide 2-6 meaningful browser checks. Each check has fresh page state, whitelisted click/fill/press/reload steps, then exact text/value/count assertion. click uses a selector and null value; fill uses a selector and string value; press uses a selector and one allowed key: Enter, Escape, Tab, Space, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown. reload uses selector body and null value to reload the same artifact inside its opaque iframe, resetting in-memory state. Include at least one real state-changing interaction. No external resources, fetch, browser storage, cookies or parent access. Fits sandbox allow-scripts allow-forms. After writing, call validate_preview and repair tool-reported failures before finishing. Do not claim success if checks fail. Prefer compact semantic markup and clear polished layout.'
                : 'You are an independent QA agent. Read workspace and user requirements. Call validate_preview to get actual browser evidence. Checks support click/fill/press/reload with exact text/value/count assertions; press supports Enter and other schema-enumerated keys, and reload reloads the same artifact inside its opaque iframe, resetting in-memory state. Assess whether the checks verify requested user behavior, not tautologies. Call record_review accepted true only if current checks pass and app meets brief. Otherwise give concrete repair instructions and record_review false. Never invent a passing report.'
        const specialist = new Agent({
          name: roles[role],
          model,
          instructions,
          tools:
            role === 'alex'
              ? [read, write, validate]
              : role === 'david'
                ? [read, validate, accept]
                : [read],
          modelSettings: { parallelToolCalls: false },
        })
        const stream = await runner.run(specialist, action.task, {
          maxTurns: role === 'alex' ? 10 : 6,
          signal,
          stream: true,
        })
        let pending = ''
        for await (const event of stream) {
          signal.throwIfAborted()
          if (event.type === 'raw_model_stream_event' && event.data.type === 'output_text_delta') {
            pending += event.data.delta
            if (pending.length >= 160) {
              await emit('token', { id: messageId, text: pending })
              pending = ''
            }
          }
        }
        await stream.completed
        if (pending) await emit('token', { id: messageId, text: pending })
        const output = stream.finalOutput ?? ''
        current.lastOutput = output
        if (role === 'emma') current.brief = output
        if (role === 'bob') current.architecture = output
        await emit('message_done', {
          id: messageId,
          role: 'agent',
          agent: role,
          content: output,
          createdAt: Date.now(),
        })
        await emit('agent_end', { id: role, name: roles[role] })
        await emit('tool_end', {
          id: stepName,
          name: `delegate_${role}`,
          agent: 'mike',
          childAgent: role,
          output: output.slice(0, 3000),
        })
        return current
      })
      history.push({
        role,
        task: action.task,
        result:
          role === 'emma'
            ? workspace.brief
            : role === 'bob'
              ? workspace.architecture
              : JSON.stringify({
                  revision: workspace.revision,
                  report: workspace.report,
                  review: workspace.review,
                  specialistOutput: workspace.lastOutput,
                }),
      })
    }
    throw Object.assign(new Error('Agent delegation limit reached without an accepted artifact.'), {
      code: 'validation',
    })
  } finally {
    await provider.close()
  }
}
