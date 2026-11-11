import { Agent, Runner, tool } from '@openai/agents-core'
import { OpenAIProvider } from '@openai/agents-openai'
import { z } from 'zod'

import type { ExecutorConfig } from './config'
import type { DurableExecutor, HarnessContext, HarnessResult } from './types'
import {
  artifactHash,
  type BrowserCheck,
  browserChecksSchema,
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
    for (let turn = 0; turn < 8; turn++) {
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
          instructions: `You manage a real application build. Choose ONE specialist tool per turn within eight delegations. Emma defines scope once, Bob designs architecture once, Alex implements and validates, and David independently reviews. Alex returns immediately after validation; failed reports are concrete evidence for a targeted repair delegation. Never repeat Emma or Bob. Delegate Alex at most twice in total. If the current artifact has a passing report, delegate David instead of rewriting HTML. Missing test coverage belongs to David. After a repair, David must review the repaired artifact again. Complete as soon as the current report passes and review accepts. Tools return durable dispatch receipts; use the next turn for the selected result.`,
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
          { maxTurns: 2, signal },
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
            checks: browserChecksSchema,
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
        const setChecks = tool({
          name: 'set_acceptance_checks',
          description:
            'Replace browser acceptance checks without modifying HTML or its hash. Clears prior validation and review; run validate_preview afterward.',
          parameters: z.object({ checks: browserChecksSchema }),
          execute: async ({ checks }) => {
            signal.throwIfAborted()
            await emit('tool_start', {
              id: `${stepName}:checks`,
              name: 'set_acceptance_checks',
              agent: role,
            })
            current.checks = checks
            current.report = null
            current.review = null
            const output = {
              revision: current.revision,
              checks: checks.length,
              message: 'Checks replaced; HTML unchanged. Run validate_preview before review.',
            }
            await emit('tool_end', {
              id: `${stepName}:checks`,
              name: 'set_acceptance_checks',
              agent: role,
              output,
            })
            return output
          },
        })
        const validate = tool({
          name: 'validate_preview',
          description:
            'Execute real isolated browser actions and assertions against the current candidate. Text assertions require containment; other assertions require exact equality. Returns genuine failures for repair.',
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
        const checkInstructions =
          'Use 2–8 checks, at most 12 actions and 8 total assertions per check. Every selector must be a complete valid CSS selector; quote attribute values with double quotes, e.g. input[data-favorites-only="true"], never leave an attribute selector open. Each check starts with fresh page state and an optional viewport (width 375–1440, height 640–1200; default 1280x720). Actions: click(selector, null), fill(selector, string), press(selector, schema-enumerated key), reload(body, null). Reload resets in-memory state inside the opaque iframe. Put exact assertions in assertions; legacy assertion remains supported and counts toward the same limit. Kinds: text (expected is contained in selected text), value, count, attribute (supply attribute name; missing attributes do not equal empty strings), no-horizontal-overflow (selector body, expected "true"; fixed document-width check). expected is always a string; attribute is null or omitted for other kinds. Keep independent QA coverage compact: combine related assertions in one check, then call validate_preview immediately. Do not replace checks repeatedly after a passing report.'
        if (role === 'alex' && current.report && !current.report.valid)
          await emit('repair', { attempt: current.revision + 1, issues: current.report.issues })
        const instructions =
          role === 'emma'
            ? 'You are the product agent. Read workspace. Define only the requested scope and 2–8 observable acceptance criteria, including requested interactions. Combine related outcomes; do not invent extra requirements, features, persistence, or visual constraints. Answer concisely in the user language.'
            : role === 'bob'
              ? 'You are the architect. Read workspace and product brief, choose a self-contained HTML/CSS/JS structure with in-memory state for an opaque iframe. No external network, storage, backend, CDN or secrets. Define testable semantic selectors. Stay under 250 words; no HTML, implementation, or test-code dumps.'
              : role === 'alex'
                ? `You are the implementation agent. Read workspace. Implement the requested self-contained app, or repair exact reported app defects preserving unrelated behavior. Use write_artifact for FULL HTML and checks; no code fences as a substitute. ${checkInstructions} Use set_acceptance_checks for malformed-check corrections without rewriting working HTML. Call validate_preview after writing or correcting checks. That tool ends this delegation and returns its evidence to the manager, who can request a targeted repair if needed. No external resources, fetch, browser storage, cookies or parent access. Fits sandbox allow-scripts allow-forms. Prefer compact semantic markup and clear polished layout.`
                : `You are an independent QA agent. Read workspace and user requirements. ${checkInstructions} Assess whether checks cover requested behavior, not tautologies. When coverage is insufficient, create your own complete check set with set_acceptance_checks, then run validate_preview yourself; do not ask Alex for fake code edits or HTML rewrites to add tests. Call validate_preview for actual browser evidence and record_review accepted true only if the current checks pass and the app meets the requested brief. Distinguish tool limitations or missing coverage from actual app defects. Request Alex repairs only for concrete app defects with evidence. Record_review false for unresolved defects or coverage gaps; never invent passing evidence or unrequested requirements.`
        const specialist = new Agent({
          name: roles[role],
          model,
          instructions,
          toolUseBehavior: {
            stopAtToolNames:
              role === 'alex' ? ['validate_preview'] : role === 'david' ? ['record_review'] : [],
          },
          tools:
            role === 'alex'
              ? [read, write, setChecks, validate]
              : role === 'david'
                ? [read, setChecks, validate, accept]
                : [read],
          modelSettings: {
            parallelToolCalls: false,
            ...(role === 'alex' || role === 'david' ? { toolChoice: 'required' as const } : {}),
          },
        })
        const stream = await runner.run(specialist, action.task, {
          maxTurns: 6,
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
