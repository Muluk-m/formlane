import { projectTemplateSchema } from '@atoms-demo/contracts'
import {
  createProjectSource,
  isProjectPath,
  type ProjectSource,
  projectSourceHash,
  validateProjectSource,
} from '@atoms-demo/core/project'
import { Agent, Runner, tool } from '@openai/agents-core'
import { OpenAIProvider } from '@openai/agents-openai'
import { z } from 'zod'

import type { ExecutorConfig } from './config'
import { observeModelStream } from './model-stream'
import { compileProject } from './project-build'
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
type Build = { sourceHash: string; artifactHash: string; revision: number }
type Workspace = {
  brief: string
  architecture: string
  source: ProjectSource | null
  html: string
  build: Build | null
  checks: BrowserCheck[]
  report: ValidationReport | null
  validatedBy: string | null
  implementationValidation: Build | null
  review: { accepted: boolean; findings: string; sourceHash: string; artifactHash: string } | null
  lastOutput: string
  revision: number
}
const roles = { emma: 'Emma', bob: 'Bob', alex: 'Alex', david: 'David' } as const
const filePathSchema = z.string().refine(isProjectPath, 'Use a safe relative project file path.')
const fileContentSchema = z.string().max(180000)
const fileEditsSchema = z
  .array(z.object({ find: z.string().min(1).max(180000), replacement: z.string().max(180000) }))
  .min(1)
  .max(8)

export function applyFileEdits(content: string, edits: z.infer<typeof fileEditsSchema>) {
  let candidate = content
  for (const { find, replacement } of fileEditsSchema.parse(edits)) {
    const index = candidate.indexOf(find)
    if (index < 0) throw new Error('Edit target was not found. Read the current file.')
    if (candidate.indexOf(find, index + 1) >= 0)
      throw new Error('Edit target is ambiguous. Include enough surrounding text to match once.')
    if (find === replacement) throw new Error('Edit replacement must change the file.')
    candidate = candidate.slice(0, index) + replacement + candidate.slice(index + find.length)
  }
  return fileContentSchema.parse(candidate)
}

async function currentBuild(workspace: Workspace): Promise<Build | null> {
  const { source, build, html, revision } = workspace
  if (!source || !build || build.revision !== revision || !html) return null
  if (build.sourceHash !== (await projectSourceHash(source))) return null
  if (build.artifactHash !== (await artifactHash(html))) return null
  return build
}

async function completionStatus(workspace: Workspace) {
  const build = await currentBuild(workspace)
  const missing: string[] = []
  if (!build) missing.push('current_build')
  if (
    !build ||
    workspace.implementationValidation?.sourceHash !== build.sourceHash ||
    workspace.implementationValidation.artifactHash !== build.artifactHash
  )
    missing.push('alex_validation')
  if (
    !build ||
    !workspace.report?.valid ||
    workspace.report.artifactHash !== build.artifactHash ||
    workspace.validatedBy !== 'david'
  )
    missing.push('david_validation')
  if (
    !build ||
    !workspace.review?.accepted ||
    workspace.review.sourceHash !== build.sourceHash ||
    workspace.review.artifactHash !== build.artifactHash
  )
    missing.push('david_acceptance')
  return {
    ready: missing.length === 0,
    missing,
    nextRole: !workspace.source
      ? 'bob'
      : missing.includes('alex_validation')
        ? 'alex'
        : missing.length
          ? 'david'
          : 'complete',
  }
}

function invalidateSource(workspace: Workspace, source: ProjectSource) {
  validateProjectSource(source)
  workspace.source = source
  workspace.revision++
  workspace.html = ''
  workspace.build = null
  workspace.report = null
  workspace.validatedBy = null
  workspace.implementationValidation = null
  workspace.review = null
}

export async function executeHarness(
  env: ExecutorConfig,
  context: HarnessContext,
  durable: DurableExecutor,
  emit: Emit,
  signal: AbortSignal,
): Promise<HarnessResult> {
  if (!env.OPENAI_API_KEY)
    throw Object.assign(new Error('Model credentials are missing.'), { code: 'provider' })
  signal.throwIfAborted()
  if (context.previousSource) validateProjectSource(context.previousSource)
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
    source: context.previousSource ? structuredClone(context.previousSource) : null,
    html: '',
    build: null,
    checks: [],
    report: null,
    validatedBy: null,
    implementationValidation: null,
    review: null,
    lastOutput: '',
    revision: 0,
  }
  const history: { role: string; task: string; result: string }[] = []
  try {
    for (let turn = 0; turn < 8; turn++) {
      signal.throwIfAborted()
      const action = await durable.run(`project-v1-manager-${turn}`, async () => {
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
          instructions: `You manage a real project build. Choose ONE specialist tool per turn within eight total manager turns, including completion. Read workspace.completion: it reports the exact missing evidence and next role. Emma defines scope once, Bob chooses and initializes a suitable template once (or preserves the existing project on follow-ups), Alex implements source files, builds and validates, and David independently runs browser validation and reviews. Alex returns immediately after validation. Never repeat Emma or Bob. Limit source implementation/repair to two Alex delegations; a validation-only Alex delegation on an unchanged build is allowed afterward within the remaining turns. Failed checks may have incorrect expectations: verify calculations and action effects before requesting source repairs. Missing coverage or incorrect checks belong to David. If David corrects checks and accepts but alex_validation is missing, delegate Alex to read workspace and run validate_preview on those corrected checks WITHOUT editing source, replacing checks or rebuilding. Then delegate David to validate and record review again, since Alex validation clears the prior review. If implementationValidation already matches the current build, delegate David instead of rewriting files. Every source repair requires fresh Alex validation followed by David validation and review. Reserve turns for this evidence sequence and completion. Complete only when workspace.completion.ready is true. Tools return durable dispatch receipts; use the next turn for the selected result.`,
          tools: [
            choose('emma', 'Delegate product requirements and acceptance criteria'),
            choose(
              'bob',
              'Delegate template selection, actual project initialization and architecture',
            ),
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
            hasPreviousApp: Boolean(context.previousSource),
            turnsRemaining: 8 - turn,
            history,
            workspace: {
              brief: workspace.brief,
              architecture: workspace.architecture,
              revision: workspace.revision,
              template: workspace.source?.template ?? null,
              files: Object.keys(workspace.source?.files ?? {}).sort(),
              build: workspace.build,
              checks: workspace.checks,
              report: workspace.report,
              validatedBy: workspace.validatedBy,
              implementationValidation: workspace.implementationValidation,
              review: workspace.review,
              completion: await completionStatus(workspace),
            },
          }),
          { maxTurns: 2, signal },
        )
        const decision = actionSchema.parse(JSON.parse(result.finalOutput ?? '{}'))
        await emit('agent_end', { id: 'mike', name: 'Mike' })
        return decision
      })
      if (action.role === 'complete') {
        const completion = await completionStatus(workspace)
        if (workspace.source && completion.ready) {
          signal.throwIfAborted()
          return { source: workspace.source, html: workspace.html, summary: action.task }
        }
        history.push({
          role: 'system',
          task: action.task,
          result: `Completion rejected: missing ${completion.missing.join(', ')}. Delegate ${completion.nextRole} for current-source evidence. If only Alex validation is missing after corrected David checks pass, validate the unchanged build with Alex, then rerun David validation and review.`,
        })
        continue
      }
      const role = action.role
      const stepName = `project-v1-delegate-${turn}-${role}`
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
        const observed = observeModelStream(model, emit, signal, role, messageId)
        // A retried delegation starts from its durable workspace, not an interrupted draft.
        await emit('project_reset', { source: current.source })
        await emit('tool_start', {
          id: stepName,
          name: `delegate_${role}`,
          agent: 'mike',
          childAgent: role,
          input: action.task,
        })
        await emit('agent_start', { id: role, name: roles[role], task: action.task })
        await emit('message_start', { id: messageId, role: 'agent', agent: role })
        let toolIndex = 0
        const withEvidence = async <T>(name: string, execute: () => Promise<T>): Promise<T> => {
          signal.throwIfAborted()
          const id = `${stepName}:${name}:${toolIndex++}`
          await emit('tool_start', { id, name, agent: role })
          const output = await execute()
          signal.throwIfAborted()
          await emit('tool_end', {
            id,
            name,
            agent: role,
            output: name === 'read_file' ? { revision: current.revision } : output,
          })
          return output
        }
        const toolError = (error: unknown) => ({
          error: error instanceof Error ? error.message : 'Project operation failed.',
        })
        const missingSource = { error: 'Initialize a project before working with files.' }
        const read = tool({
          name: 'read_workspace',
          description:
            'Read the brief, architecture, file listing, build and browser evidence. Use read_file for exact file content.',
          parameters: z.object({}),
          execute: async () =>
            withEvidence('read_workspace', async () => ({
              brief: current.brief,
              architecture: current.architecture,
              template: current.source?.template ?? null,
              files: Object.entries(current.source?.files ?? {})
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([path, content]) => ({ path, characters: content.length })),
              revision: current.revision,
              build: current.build,
              checks: current.checks,
              report: current.report,
              validatedBy: current.validatedBy,
              implementationValidation: current.implementationValidation,
              review: current.review,
              completion: await completionStatus(current),
              originalIdea: context.idea,
              userRequest: context.request,
            })),
        })
        const initialize = tool({
          name: 'initialize_project',
          description:
            'Choose vanilla for simple HTML/CSS/JS apps or react-ts for component-based interactive apps and create its runnable scaffold. Existing projects cannot be reset.',
          parameters: z.object({
            template: projectTemplateSchema,
            reason: z.string().min(1).max(2000),
          }),
          execute: async ({ template, reason }) =>
            withEvidence('initialize_project', async () => {
              if (current.source)
                return {
                  error: 'The project already exists. Preserve its template and edit its files.',
                }
              const source = createProjectSource(template)
              invalidateSource(current, source)
              await emit('project_initialized', { source, reason })
              return {
                template,
                files: Object.keys(source.files).sort(),
                revision: current.revision,
                reason,
              }
            }),
        })
        const readFile = tool({
          name: 'read_file',
          description: 'Read the exact current text of one project file before editing it.',
          parameters: z.object({ path: filePathSchema }),
          execute: async ({ path }) =>
            withEvidence('read_file', async () => {
              if (!current.source) return missingSource
              const content = current.source.files[path]
              return content === undefined
                ? { error: `File does not exist: ${path}` }
                : { path, content }
            }),
        })
        const write = tool({
          name: 'write_file',
          description:
            'Create or replace one source file. Supply path before content. The template package.json is protected. Invalidates build and browser review; run build_project afterward.',
          parameters: z.object({ path: filePathSchema, content: fileContentSchema }),
          execute: async ({ path, content }) =>
            withEvidence('write_file', async () => {
              if (!current.source) return missingSource
              try {
                invalidateSource(current, {
                  ...current.source,
                  files: { ...current.source.files, [path]: content },
                })
              } catch (error) {
                return toolError(error)
              }
              await observed.commit(path, content)
              return {
                path,
                revision: current.revision,
                message: 'File saved. Build and validate current source before acceptance.',
              }
            }),
        })
        const edit = tool({
          name: 'edit_file',
          description:
            'Apply ordered literal replacements to one existing file, each matching exactly once. All edits apply together or none do. Preserves checks, invalidates build and review.',
          parameters: z.object({ path: filePathSchema, edits: fileEditsSchema }),
          execute: async ({ path, edits }) =>
            withEvidence('edit_file', async () => {
              if (!current.source) return missingSource
              const previous = current.source.files[path]
              if (previous === undefined) return { error: `File does not exist: ${path}` }
              let content: string
              try {
                content = applyFileEdits(previous, edits)
                invalidateSource(current, {
                  ...current.source,
                  files: { ...current.source.files, [path]: content },
                })
              } catch (error) {
                return toolError(error)
              }
              await observed.commit(path, content)
              return {
                path,
                revision: current.revision,
                message: 'Edits applied; checks preserved. Build and validate again.',
              }
            }),
        })
        const deleteFile = tool({
          name: 'delete_file',
          description:
            'Delete an obsolete source file. Required index.html and protected package.json cannot be deleted. Invalidates build and review.',
          parameters: z.object({ path: filePathSchema }),
          execute: async ({ path }) =>
            withEvidence('delete_file', async () => {
              if (!current.source) return missingSource
              if (current.source.files[path] === undefined)
                return { error: `File does not exist: ${path}` }
              try {
                const files = { ...current.source.files }
                delete files[path]
                invalidateSource(current, { ...current.source, files })
              } catch (error) {
                return toolError(error)
              }
              await emit('file_deleted', { path })
              return { path, revision: current.revision }
            }),
        })
        const build = tool({
          name: 'build_project',
          description:
            'Compile current project files with the trusted compiler. Returns real build errors. Successful current-source build is required before browser validation; source/config scripts are never executed.',
          parameters: z.object({}),
          execute: async () =>
            withEvidence('build_project', async () => {
              current.build = null
              current.html = ''
              current.report = null
              current.validatedBy = null
              current.implementationValidation = null
              current.review = null
              let output: { ok: boolean; issues: string[]; sourceHash?: string }
              try {
                if (!current.source) throw new Error(missingSource.error)
                const result = await compileProject(current.source, signal)
                signal.throwIfAborted()
                const sourceHash = await projectSourceHash(current.source)
                if (result.sourceHash !== sourceHash)
                  throw new Error('Build did not match the current project source.')
                const htmlHash = await artifactHash(result.html)
                signal.throwIfAborted()
                current.html = result.html
                current.build = { sourceHash, artifactHash: htmlHash, revision: current.revision }
                output = { ok: true, issues: [], sourceHash }
              } catch (error) {
                signal.throwIfAborted()
                output = { ok: false, issues: [toolError(error).error] }
              }
              await emit('build_result', output)
              return output
            }),
        })
        const setChecks = tool({
          name: 'set_acceptance_checks',
          description:
            'Replace browser checks without modifying source or build. Clears prior validation and review; run validate_preview afterward.',
          parameters: z.object({ checks: browserChecksSchema }),
          execute: async ({ checks }) =>
            withEvidence('set_acceptance_checks', async () => {
              current.checks = checks
              current.report = null
              current.validatedBy = null
              current.review = null
              return {
                revision: current.revision,
                checks: checks.length,
                message: 'Checks replaced. Validate before review.',
              }
            }),
        })
        const validate = tool({
          name: 'validate_preview',
          description:
            'Execute isolated browser actions against the successful build of CURRENT source. Returns genuine failures for repair. Text assertions use containment; other assertions use exact equality.',
          parameters: z.object({}),
          execute: async () =>
            withEvidence('validate_preview', async () => {
              const built = await currentBuild(current)
              signal.throwIfAborted()
              if (!built)
                return {
                  error:
                    'Build current source successfully with build_project before browser validation.',
                }
              const report = await validateArtifact(current.html, current.checks, signal)
              signal.throwIfAborted()
              current.report = report
              current.validatedBy = role
              current.review = null
              if (role === 'alex')
                current.implementationValidation =
                  report.valid && report.artifactHash === built.artifactHash ? built : null
              await emit('validation', { ...report })
              return report
            }),
        })
        const accept = tool({
          name: 'record_review',
          description:
            'Record independent review. Accept only after your own browser validation passes for current build and checks cover requested behavior.',
          parameters: z.object({ accepted: z.boolean(), findings: z.string() }),
          execute: async ({ accepted, findings }) =>
            withEvidence('record_review', async () => {
              const built = await currentBuild(current)
              signal.throwIfAborted()
              if (
                accepted &&
                (!built ||
                  !current.report?.valid ||
                  current.report.artifactHash !== built.artifactHash ||
                  current.validatedBy !== 'david')
              )
                return {
                  accepted: false,
                  error: 'No passing independent browser report for the current source build.',
                }
              current.review = {
                accepted,
                findings,
                sourceHash: built?.sourceHash ?? '',
                artifactHash: built?.artifactHash ?? '',
              }
              return { ...current.review, completion: await completionStatus(current) }
            }),
        })
        const checkInstructions =
          'Use 2–8 checks, at most 12 actions and 8 total assertions per check. Every selector must be a complete valid CSS selector; quote attribute values with double quotes, e.g. input[data-favorites-only="true"], never leave an attribute selector open. Each check starts with fresh page state and an optional viewport (width 375–1440, height 640–1200; default 1280x720). Actions: click(selector, null), fill(selector, string), press(selector, schema-enumerated key), reload(body, null). After filling controls, commit their change by moving focus to an appropriate control before testing keyboard-driven state; a later blur can otherwise apply the input again. Reload resets in-memory state inside the opaque iframe. Put exact assertions in assertions; legacy assertion remains supported and counts toward the same limit. Kinds: text (expected is contained in selected text), value, count, attribute (literal getAttribute value; a missing attribute is null, never "false" or an empty string), no-horizontal-overflow (selector body, expected "true"; fixed document-width check). For boolean attributes use count assertions on :disabled/:enabled or [disabled]/:not([disabled]) selectors instead of expecting the string "false". expected is always a string; attribute is null or omitted for other kinds. Verify expected calculations and all action effects, including newly spawned state, before treating a failed check as an app defect. Correct mathematically wrong expectations without rewriting a valid app. Keep independent QA coverage compact: combine related assertions in one check, then call validate_preview immediately. Do not replace checks repeatedly after a passing report.'
        if (role === 'alex' && current.report && !current.report.valid)
          await emit('repair', { attempt: current.revision + 1, issues: current.report.issues })
        const instructions =
          role === 'emma'
            ? 'You are the product agent. Read workspace. Define only the requested scope and 2–8 observable acceptance criteria, including requested interactions. Combine related outcomes; do not invent extra requirements, features, persistence, or visual constraints. Answer concisely in the user language.'
            : role === 'bob'
              ? 'You are the architect. Read workspace and product brief. For a new project call initialize_project with vanilla (simple HTML/CSS/JS) or react-ts (component-based interactive UI), choosing from user requirements and explaining the choice. Do not merely describe initialization: create the scaffold with the tool. For follow-ups preserve the existing template and files; do not reinitialize. Plan real source modules, CSS and semantic selectors. The compiler supports local JS/TS/JSX/TSX/CSS imports and SVG assets; package.json dependencies and scripts are protected. Apps run in an opaque iframe: no external network, browser storage, backend, CDN or secrets. Keep architecture under 250 words; no source dumps.'
              : role === 'alex'
                ? `You are the implementation agent. Read workspace and relevant source files. Preserve the selected template and existing source on follow-ups. Only initialize_project if no project exists. Implement real source files with write_file (path before content), edit_file for unique targeted replacements, and delete_file for obsolete files. Keep the Vite index.html entry and canonical package.json; do not generate fake source from compiled HTML. Use local modules and concise CSS, with React/TypeScript components for react-ts. No arbitrary dependencies or config scripts: only template dependencies and the trusted compiler are supported. Preserve unrelated behavior and existing checks during repairs. ${checkInstructions} For new or changed source, set acceptance checks as needed and call build_project. Fix actual compiler errors and rebuild. For a validation-only delegation after David corrected checks, preserve those checks and the current source and build, then call validate_preview directly. Do not rebuild unchanged source: rebuilding clears existing evidence. Call validate_preview only after a successful build of current source; it ends this delegation and sends evidence to the manager. Every file change requires a fresh build and validation. No external resources, fetch, browser storage, cookies or parent access. Fits sandbox allow-scripts allow-forms. Prefer semantic markup, accessible controls and clear polished layout. No source dumps in ordinary chat.`
                : `You are an independent QA agent. Read workspace, relevant files and user requirements. ${checkInstructions} Assess whether checks cover requested behavior, not tautologies. When coverage is insufficient or expectations are incorrect, create your own corrected complete check set with set_acceptance_checks. Run validate_preview yourself on the current compiled build, then record_review accepted true only when checks pass and the app meets the brief. Your acceptance does not substitute for Alex validation: record_review returns completion status so the manager can obtain missing Alex evidence on your corrected checks. When returning after Alex validation on an unchanged build, preserve the checks, run validate_preview and record_review again. Do not ask Alex for source changes merely to add or correct tests. Distinguish missing coverage or tool limitations from concrete app defects. Request targeted repairs only for actual defects with evidence. Record_review false for unresolved defects, missing build or coverage gaps; never invent passing evidence or unrequested requirements.`
        const specialist = new Agent({
          name: roles[role],
          model: observed.model,
          instructions,
          toolUseBehavior: {
            stopAtToolNames:
              role === 'alex' ? ['validate_preview'] : role === 'david' ? ['record_review'] : [],
          },
          tools:
            role === 'alex'
              ? [read, initialize, readFile, write, edit, deleteFile, build, setChecks, validate]
              : role === 'david'
                ? [read, readFile, setChecks, validate, accept]
                : role === 'bob'
                  ? [read, readFile, initialize]
                  : [read],
          modelSettings: {
            parallelToolCalls: false,
            ...(role === 'alex' || role === 'david' ? { toolChoice: 'required' as const } : {}),
          },
        })
        const stream = await runner.run(specialist, action.task, {
          maxTurns: role === 'alex' ? 48 : role === 'david' ? 16 : 10,
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
        signal.throwIfAborted()
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
                  build: workspace.build,
                  report: workspace.report,
                  validatedBy: workspace.validatedBy,
                  implementationValidation: workspace.implementationValidation,
                  review: workspace.review,
                  completion: await completionStatus(workspace),
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
