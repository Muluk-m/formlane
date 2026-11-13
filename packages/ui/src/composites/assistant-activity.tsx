import {
  type DataMessagePartProps,
  type MessageStatus,
  type ReasoningMessagePartProps,
  type ToolCallMessagePartProps,
  useAuiState,
} from '@assistant-ui/react'
import { useI18n } from '@atoms-demo/i18n/react'
import {
  Alert02Icon,
  ArrowDown01Icon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  Loading03Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#components/collapsible'

type ActivityTone =
  | 'running'
  | 'complete'
  | 'failed'
  | 'cancelled'
  | 'incomplete'
  | 'waiting'
  | 'recorded'
type ExecutionState = { agent?: string | null; status?: MessageStatus }

const toolNames = {
  read_workspace: 'ui.assistant.tools.read_workspace',
  initialize_project: 'ui.assistant.tools.initialize_project',
  read_file: 'ui.assistant.tools.read_file',
  read_previous_file: 'ui.assistant.tools.read_previous_file',
  read_review_files: 'ui.assistant.tools.read_review_files',
  write_file: 'ui.assistant.tools.write_file',
  edit_file: 'ui.assistant.tools.edit_file',
  delete_file: 'ui.assistant.tools.delete_file',
  build_project: 'ui.assistant.tools.build_project',
  set_acceptance_checks: 'ui.assistant.tools.set_acceptance_checks',
  validate_preview: 'ui.assistant.tools.validate_preview',
  record_review: 'ui.assistant.tools.record_review',
  schedule_iteration: 'ui.assistant.tools.delegate_mike',
  delegate_mike: 'ui.assistant.tools.delegate_mike',
  delegate_emma: 'ui.assistant.tools.delegate_emma',
  delegate_bob: 'ui.assistant.tools.delegate_bob',
  delegate_alex: 'ui.assistant.tools.delegate_alex',
  delegate_david: 'ui.assistant.tools.delegate_david',
} as const

const fieldNames = {
  task: 'ui.assistant.fields.task',
  summary: 'ui.assistant.fields.summary',
  findings: 'ui.assistant.fields.findings',
  issues: 'ui.assistant.fields.issues',
  checks: 'ui.assistant.fields.checks',
  accepted: 'ui.assistant.fields.accepted',
  valid: 'ui.assistant.fields.valid',
  passed: 'ui.assistant.fields.passed',
  name: 'ui.assistant.fields.name',
  actual: 'ui.assistant.fields.actual',
  expected: 'ui.assistant.fields.expected',
  revision: 'ui.assistant.fields.revision',
  htmlLength: 'ui.assistant.fields.htmlLength',
  checkCount: 'ui.assistant.fields.checkCount',
  error: 'ui.assistant.fields.error',
  brief: 'ui.assistant.fields.brief',
  architecture: 'ui.assistant.fields.architecture',
  path: 'ui.assistant.fields.path',
  template: 'ui.assistant.fields.template',
  reason: 'ui.assistant.fields.reason',
  ok: 'ui.assistant.fields.ok',
  files: 'ui.assistant.fields.files',
} as const
const technicalFields: Record<string, true> = {
  id: true,
  runId: true,
  artifactHash: true,
  html: true,
  source: true,
  content: true,
  edits: true,
  sourceHash: true,
  createdAt: true,
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function useExecutionState(id?: string): ExecutionState {
  const custom = useAuiState((s) => s.message.metadata.custom)
  const status = useAuiState((s) => s.message.status)
  // This metadata is constructed by the conversation adapter, not the model.
  const states = custom.partStates as Record<string, ExecutionState> | undefined
  return (id ? states?.[id] : undefined) ?? { status }
}

function statusTone(status?: MessageStatus): ActivityTone {
  if (status?.type === 'running') return 'running'
  if (status?.type === 'complete') return 'complete'
  if (status?.reason === 'cancelled') return 'cancelled'
  if (status?.reason === 'error') return 'failed'
  return 'incomplete'
}

export function AssistantActivityIcon({ tone }: { tone: ActivityTone }) {
  const icon =
    tone === 'running'
      ? Loading03Icon
      : tone === 'complete'
        ? CheckmarkCircle02Icon
        : tone === 'failed' || tone === 'incomplete'
          ? Alert02Icon
          : Clock01Icon
  return (
    <HugeiconsIcon
      icon={icon}
      strokeWidth={1.5}
      aria-hidden
      className={cn(
        'size-4 shrink-0',
        tone === 'running' && 'motion-safe:animate-spin text-info',
        tone === 'complete' && 'text-success',
        tone === 'failed' && 'text-destructive',
        (tone === 'incomplete' || tone === 'cancelled') && 'text-warning',
      )}
    />
  )
}

/** A compact summary uses observed activity only; delegation prompts stay in details. */
export function AssistantExecutionSummary() {
  const { t } = useI18n()
  const status = useAuiState((s) => s.message.status)
  const focus = useAuiState((s) => s.message.metadata.custom.focus) as
    | { toolName?: string; agent?: string }
    | undefined
  const tone = statusTone(status)
  const tool = focus?.toolName ?? (focus?.agent ? `delegate_${focus.agent}` : undefined)
  const label =
    tone === 'running' && tool
      ? Object.hasOwn(toolNames, tool)
        ? t(toolNames[tool as keyof typeof toolNames])
        : tool.replace(/_/g, ' ')
      : t(
          `ui.assistant.executionStatus.${tone === 'waiting' || tone === 'recorded' ? 'incomplete' : tone}`,
        )
  return (
    <>
      <AssistantActivityIcon tone={tone} />
      <span className="flex min-w-0 flex-1 items-center gap-2 text-xs font-medium">
        <span className="truncate">{label}</span>
        {tone === 'running' && focus?.agent && (
          <span className="shrink-0 font-normal text-muted-foreground">
            {focus.agent.charAt(0).toUpperCase() + focus.agent.slice(1)}
          </span>
        )}
      </span>
    </>
  )
}

function ActivityRow({
  label,
  tone,
  children,
  testId,
  actor,
  summary,
}: {
  label: string
  tone: ActivityTone
  children?: ReactNode
  testId: string
  actor?: string | null
  summary?: string
}) {
  const { t } = useI18n()
  const heading = (
    <>
      <AssistantActivityIcon tone={tone} />
      <span className="min-w-0 flex-1 text-sm leading-5">
        {actor && (
          <span className="mr-2 text-xs text-muted-foreground">
            {actor.charAt(0).toUpperCase() + actor.slice(1)}
          </span>
        )}
        <span className="font-medium text-foreground">{label}</span>
      </span>
      <span
        className={cn(
          'shrink-0 text-xs',
          tone === 'failed' ? 'text-destructive' : 'text-muted-foreground',
        )}
      >
        {t(`ui.assistant.toolStatus.${tone}`)}
      </span>
    </>
  )
  if (!children)
    return (
      <div
        className="flex min-w-0 items-center gap-2 px-2 py-2"
        data-testid={testId}
        data-status={tone}
      >
        {heading}
      </div>
    )
  return (
    <Collapsible defaultOpen={false} className="min-w-0" data-testid={testId} data-status={tone}>
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring">
        {heading}
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={1.5}
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      {summary && (
        <p className="mb-2 ml-8 mr-3 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
          {summary}
        </p>
      )}
      <CollapsibleContent>
        <div className="mb-3 ml-4 space-y-3 border-l border-border py-1 pl-4 pr-2 text-xs leading-5">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function TechnicalDetails({ value }: { value: unknown }) {
  const { t } = useI18n()
  return (
    <Collapsible>
      <CollapsibleTrigger className="cursor-pointer rounded text-xs text-muted-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {t('ui.assistant.rawDetails')}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-surface-sunken p-3 font-mono text-xs">
          {JSON.stringify(value, null, 2)}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  )
}

function DetailValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const { t } = useI18n()
  if (value === null || value === undefined || value === '')
    return <span className="text-muted-foreground">{t('ui.assistant.emptyValue')}</span>
  if (typeof value === 'boolean')
    return <span>{t(value ? 'ui.assistant.true' : 'ui.assistant.false')}</span>
  if (typeof value === 'string' && depth < 2 && /^\s*[[{]/.test(value)) {
    try {
      const parsed: unknown = JSON.parse(value)
      if (isObject(parsed) || Array.isArray(parsed))
        return <DetailValue value={parsed} depth={depth + 1} />
    } catch {
      /* Ordinary text and incomplete JSON stay readable. */
    }
  }
  if (typeof value === 'string' || typeof value === 'number')
    return <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{String(value)}</p>
  if (depth > 2) return <TechnicalDetails value={value} />
  if (Array.isArray(value))
    return value.length ? (
      <ul className="space-y-2">
        {value.map((item, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: Immutable result entries have no identifiers.
          <li key={index} className="border-l-2 border-border pl-3">
            <DetailValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    ) : (
      <span className="text-muted-foreground">{t('ui.assistant.emptyValue')}</span>
    )
  const entries = Object.entries(isObject(value) ? value : {})
  const visible = entries.filter(([key]) => !Object.hasOwn(technicalFields, key))
  const technical = Object.fromEntries(
    entries.filter(([key]) => Object.hasOwn(technicalFields, key)),
  )
  return (
    <div className="space-y-3">
      <dl className="space-y-3">
        {visible.map(([key, item]) => (
          <div key={key} className="min-w-0">
            <dt className="mb-1 break-words text-xs font-medium text-muted-foreground">
              {Object.hasOwn(fieldNames, key)
                ? t(fieldNames[key as keyof typeof fieldNames])
                : key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}
            </dt>
            <dd className="min-w-0 text-foreground">
              <DetailValue value={item} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
      {Object.keys(technical).length > 0 && <TechnicalDetails value={technical} />}
    </div>
  )
}

export function AssistantStructuredOutput({ data }: DataMessagePartProps) {
  const { t } = useI18n()
  const failed = isObject(data) && (data.valid === false || data.accepted === false)
  const report = isObject(data) ? data : undefined
  const label =
    typeof report?.accepted === 'boolean'
      ? t(report.accepted ? 'ui.assistant.reviewPassed' : 'ui.assistant.reviewNeedsWork')
      : typeof report?.valid === 'boolean'
        ? t(report.valid ? 'atoms.validationPassed' : 'atoms.validationFailed')
        : t('ui.assistant.result')
  const checks = Array.isArray(report?.checks) ? report.checks : undefined
  const summary =
    typeof report?.findings === 'string'
      ? report.findings
      : typeof report?.summary === 'string'
        ? report.summary
        : checks?.length
          ? t('ui.assistant.checksPassed', {
              count: checks.filter((check) => isObject(check) && check.passed === true).length,
              total: checks.length,
            })
          : undefined
  return (
    <div
      className="rounded-xl border border-border bg-surface-sunken/30 p-2"
      data-testid="structured-output"
    >
      <ActivityRow
        label={label}
        summary={summary}
        tone={
          failed
            ? 'failed'
            : report?.valid === true || report?.accepted === true
              ? 'complete'
              : 'recorded'
        }
        testId="result-details"
      >
        <DetailValue value={data} />
      </ActivityRow>
    </div>
  )
}

export function AssistantToolCall({
  toolCallId,
  toolName,
  args,
  result,
  isError,
  isPreliminary,
  status,
}: ToolCallMessagePartProps<unknown>) {
  const { t } = useI18n()
  const state = useExecutionState(toolCallId)
  const hasResult = result !== undefined
  const tone: ActivityTone = isError
    ? 'failed'
    : hasResult && !isPreliminary
      ? 'complete'
      : state.status
        ? statusTone(state.status) === 'complete'
          ? 'incomplete'
          : statusTone(state.status)
        : status.type === 'requires-action'
          ? 'waiting'
          : 'incomplete'
  const label = Object.hasOwn(toolNames, toolName)
    ? t(toolNames[toolName as keyof typeof toolNames])
    : toolName.replace(/_/g, ' ')
  const path = isObject(args) && typeof args.path === 'string' ? args.path : undefined
  const error = isObject(result) && typeof result.error === 'string' ? result.error : undefined
  const hasArgs = args !== undefined && (!isObject(args) || Object.keys(args).length > 0)
  return (
    <ActivityRow
      label={label}
      actor={state.agent}
      tone={tone}
      summary={error ?? path}
      testId="tool-call"
    >
      {hasArgs && (
        <section aria-label={t('ui.assistant.input')}>
          <h3 className="mb-2 font-medium text-muted-foreground">{t('ui.assistant.input')}</h3>
          <DetailValue value={args} />
        </section>
      )}
      <section aria-label={t('ui.assistant.result')}>
        <h3 className="mb-2 font-medium text-muted-foreground">{t('ui.assistant.result')}</h3>
        {hasResult ? (
          <DetailValue value={result} />
        ) : (
          <p className="text-muted-foreground">
            {t(tone === 'running' ? 'ui.assistant.awaitingResult' : 'ui.assistant.noResult')}
          </p>
        )}
      </section>
      <TechnicalDetails
        value={{
          tool: toolName,
          ...(hasArgs ? { input: args } : {}),
          ...(hasResult ? { output: result } : {}),
        }}
      />
    </ActivityRow>
  )
}

type ActivityData = {
  type: 'agent_start' | 'agent_end' | 'validation' | 'repair' | 'build_result' | 'run_terminal'
  data: Record<string, unknown>
}

export function AssistantActivity({ id, data: event }: DataMessagePartProps<ActivityData>) {
  const { t } = useI18n()
  const { status } = useExecutionState(id)
  const detail = event.data
  const name = typeof detail.name === 'string' ? detail.name : t('ui.assistant.name')
  if (event.type === 'run_terminal') {
    const cancelled = detail.status === 'cancelled'
    return (
      <ActivityRow
        label={t(cancelled ? 'atoms.runStatus.cancelled' : 'atoms.runStatus.failed')}
        tone={cancelled ? 'cancelled' : 'failed'}
        testId="terminal-activity"
      >
        <TechnicalDetails value={detail} />
      </ActivityRow>
    )
  }
  if (event.type === 'agent_start' || event.type === 'agent_end') {
    const tone = statusTone(status)
    const label = t(
      tone === 'running'
        ? 'ui.assistant.agentWorking'
        : tone === 'complete'
          ? 'ui.assistant.agentDone'
          : 'ui.assistant.agentInterrupted',
      { name },
    )
    return (
      <ActivityRow label={label} tone={tone} testId="agent-activity">
        <DetailValue value={detail} />
      </ActivityRow>
    )
  }
  if (event.type === 'build_result') {
    return (
      <ActivityRow
        label={t(detail.ok === true ? 'atoms.files.buildPassed' : 'atoms.files.buildFailed')}
        tone={detail.ok === true ? 'complete' : 'failed'}
        testId="agent-activity"
      >
        <DetailValue value={detail} />
      </ActivityRow>
    )
  }
  const validation = event.type === 'validation'
  const label = validation
    ? t(
        detail.valid === true
          ? 'atoms.validationPassed'
          : detail.valid === false
            ? 'atoms.validationFailed'
            : 'ui.assistant.validation',
      )
    : typeof detail.attempt === 'number'
      ? t('atoms.repairAttempt', { attempt: detail.attempt })
      : t('ui.assistant.repair')
  const tone = validation
    ? detail.valid === true
      ? 'complete'
      : detail.valid === false
        ? 'failed'
        : 'incomplete'
    : 'recorded'
  return (
    <ActivityRow label={label} tone={tone} testId="agent-activity">
      <DetailValue value={detail} />
    </ActivityRow>
  )
}

export function AssistantReasoning({ text }: ReasoningMessagePartProps) {
  const { t } = useI18n()
  return (
    <section
      className="mx-2 my-3 border-l-2 border-info/30 pl-4"
      data-testid="reasoning-summary"
      aria-label={t('ui.assistant.reasoning')}
    >
      <h3 className="mb-2 text-xs font-medium text-info">{t('ui.assistant.reasoning')}</h3>
      <p className="whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
        {text}
      </p>
    </section>
  )
}
