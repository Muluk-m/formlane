import {
  type DataMessagePartProps,
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

const toolNames = {
  read_workspace: 'ui.assistant.tools.read_workspace',
  write_artifact: 'ui.assistant.tools.write_artifact',
  edit_artifact: 'ui.assistant.tools.edit_artifact',
  set_acceptance_checks: 'ui.assistant.tools.set_acceptance_checks',
  validate_preview: 'ui.assistant.tools.validate_preview',
  record_review: 'ui.assistant.tools.record_review',
  delegate_mike: 'ui.assistant.tools.delegate_mike',
  delegate_emma: 'ui.assistant.tools.delegate_emma',
  delegate_bob: 'ui.assistant.tools.delegate_bob',
  delegate_alex: 'ui.assistant.tools.delegate_alex',
  delegate_david: 'ui.assistant.tools.delegate_david',
} as const

function knownTool(name: string): name is keyof typeof toolNames {
  return Object.hasOwn(toolNames, name)
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
        tone === 'running' && 'motion-safe:animate-spin',
        tone === 'complete' && 'text-success',
        tone === 'failed' && 'text-destructive',
        (tone === 'incomplete' || tone === 'cancelled') && 'text-warning',
      )}
    />
  )
}

function ActivityRow({
  label,
  tone,
  children,
  testId,
}: {
  label: string
  tone: ActivityTone
  children: ReactNode
  testId: string
}) {
  const { t } = useI18n()
  return (
    <Collapsible
      className="min-w-0 rounded-lg border border-border bg-surface-sunken/60"
      data-testid={testId}
      data-status={tone}
    >
      <CollapsibleTrigger className="group flex w-full cursor-pointer items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-muted-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <AssistantActivityIcon tone={tone} />
        <span className="min-w-0 flex-1 break-words font-medium text-foreground">{label}</span>
        <span className="shrink-0 text-xs">{t(`ui.assistant.toolStatus.${tone}`)}</span>
        <HugeiconsIcon
          icon={ArrowDown01Icon}
          strokeWidth={1.5}
          aria-hidden
          className="size-3.5 shrink-0 transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none"
        />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 border-t border-border px-3 py-3 text-xs leading-5">
          {children}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Structured values stay readable; exact nested payloads remain available on demand. */
function DetailValue({ value, depth = 0 }: { value: unknown; depth?: number }) {
  const { t } = useI18n()
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted-foreground">{t('ui.assistant.emptyValue')}</span>
  }
  if (typeof value === 'boolean') {
    return <span>{t(value ? 'ui.assistant.true' : 'ui.assistant.false')}</span>
  }
  if (typeof value === 'string' || typeof value === 'number') {
    return <p className="max-h-64 overflow-auto whitespace-pre-wrap break-words">{String(value)}</p>
  }
  if (depth > 1) {
    return (
      <Collapsible>
        <CollapsibleTrigger className="cursor-pointer rounded text-muted-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t('ui.assistant.rawDetails')}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs">
            {JSON.stringify(value, null, 2)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    )
  }
  if (Array.isArray(value)) {
    if (!value.length)
      return <span className="text-muted-foreground">{t('ui.assistant.emptyValue')}</span>
    return (
      <ul className="list-disc space-y-1 pl-4">
        {value.map((item, index) => (
          // Tool payload arrays are immutable snapshots and have no stable item identifiers.
          // biome-ignore lint/suspicious/noArrayIndexKey: Preserve the tool's recorded array order.
          <li key={index}>
            <DetailValue value={item} depth={depth + 1} />
          </li>
        ))}
      </ul>
    )
  }
  const entries = Object.entries(typeof value === 'object' ? value : {})
  if (!entries.length)
    return <span className="text-muted-foreground">{t('ui.assistant.emptyValue')}</span>
  return (
    <dl className="space-y-2">
      {entries.map(([key, item]) => (
        <div key={key} className="min-w-0">
          <dt className="mb-0.5 break-words font-medium text-muted-foreground">
            {key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2')}
          </dt>
          <dd className="min-w-0">
            <DetailValue value={item} depth={depth + 1} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function AssistantStructuredOutput({ data }: DataMessagePartProps) {
  const { t } = useI18n()
  const failed =
    data !== null &&
    typeof data === 'object' &&
    (('valid' in data && data.valid === false) || ('accepted' in data && data.accepted === false))
  return (
    <ActivityRow
      label={t('ui.assistant.result')}
      tone={failed ? 'failed' : 'recorded'}
      testId="structured-output"
    >
      <DetailValue value={data} />
    </ActivityRow>
  )
}

export function AssistantToolCall({
  toolName,
  args,
  result,
  isError,
  isPreliminary,
  status,
}: ToolCallMessagePartProps<unknown>) {
  const { t } = useI18n()
  const messageStatus = useAuiState((s) => s.message.status)
  // A completed message alone is not evidence that a server-side tool returned.
  const hasResult = result !== undefined
  const tone: ActivityTone = isError
    ? 'failed'
    : hasResult && !isPreliminary
      ? 'complete'
      : messageStatus?.type === 'running'
        ? 'running'
        : messageStatus?.type === 'incomplete'
          ? messageStatus.reason === 'cancelled'
            ? 'cancelled'
            : 'incomplete'
          : status.type === 'requires-action'
            ? 'waiting'
            : 'incomplete'
  const label = knownTool(toolName) ? t(toolNames[toolName]) : toolName.replace(/_/g, ' ')
  return (
    <ActivityRow label={label} tone={tone} testId="tool-call">
      <p className="break-all font-mono text-muted-foreground">{toolName}</p>
      {args !== undefined && (
        <section aria-label={t('ui.assistant.input')}>
          <h3 className="mb-1 font-medium">{t('ui.assistant.input')}</h3>
          <DetailValue value={args} />
        </section>
      )}
      <section aria-label={t('ui.assistant.result')}>
        <h3 className="mb-1 font-medium">{t('ui.assistant.result')}</h3>
        {hasResult ? (
          <DetailValue value={result} />
        ) : (
          <p className="text-muted-foreground">{t('ui.assistant.noResult')}</p>
        )}
      </section>
    </ActivityRow>
  )
}

type ActivityData = {
  type: 'agent_start' | 'agent_end' | 'validation' | 'repair'
  data: Record<string, unknown>
}

export function AssistantActivity({ data: event }: DataMessagePartProps<ActivityData>) {
  const { t } = useI18n()
  const status = useAuiState((s) => s.message.status)
  const detail = event.data
  const name = typeof detail.name === 'string' ? detail.name : t('ui.assistant.name')
  const interrupted = status?.type === 'incomplete'
  let label: string
  let tone: ActivityTone
  switch (event.type) {
    case 'agent_start':
      label = t(
        interrupted || status?.type !== 'running'
          ? 'ui.assistant.agentInterrupted'
          : 'ui.assistant.agentWorking',
        { name },
      )
      tone =
        status?.type === 'running'
          ? 'running'
          : status?.reason === 'cancelled'
            ? 'cancelled'
            : 'incomplete'
      break
    case 'agent_end':
      label = t(interrupted ? 'ui.assistant.agentInterrupted' : 'ui.assistant.agentDone', { name })
      tone = interrupted ? 'failed' : 'complete'
      break
    case 'validation':
      label = t(
        detail.valid === true
          ? 'atoms.validationPassed'
          : detail.valid === false
            ? 'atoms.validationFailed'
            : 'ui.assistant.validation',
      )
      tone = detail.valid === true ? 'complete' : detail.valid === false ? 'failed' : 'incomplete'
      break
    case 'repair':
      label =
        typeof detail.attempt === 'number'
          ? t('atoms.repairAttempt', { attempt: detail.attempt })
          : t('ui.assistant.repair')
      tone = interrupted ? 'incomplete' : 'recorded'
      break
    default:
      return null
  }
  return (
    <ActivityRow label={label} tone={tone} testId="agent-activity">
      <DetailValue value={detail} />
    </ActivityRow>
  )
}
