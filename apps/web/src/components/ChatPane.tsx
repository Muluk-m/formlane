import type { RunEvent as HarnessEvent, Run as HarnessRun } from '@atoms-demo/contracts'
import { AGENT_ORDER, type AgentId } from '@atoms-demo/core/types'
import { useI18n } from '@atoms-demo/i18n/react'
import { Badge } from '@atoms-demo/ui/components/badge'
import { Button } from '@atoms-demo/ui/components/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@atoms-demo/ui/components/collapsible'
import { Field, FieldError, FieldLabel } from '@atoms-demo/ui/components/field'
import { Spinner } from '@atoms-demo/ui/components/spinner'
import { Textarea } from '@atoms-demo/ui/components/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import type { UiMessage } from '../pages/ProjectPage'
import { AgentAvatar } from './AgentAvatar'
import { RichText } from './RichText'

function isKnownAgent(id: string): id is AgentId {
  return AGENT_ORDER.some((agent) => agent === id)
}

export function ChatPane({
  messages,
  running,
  disabled,
  stopping,
  runStatus,
  activeAgents,
  activity,
  onSend,
  onStop,
}: {
  messages: UiMessage[]
  running: boolean
  disabled: boolean
  stopping: boolean
  runStatus: HarnessRun['status'] | null
  activeAgents: Record<string, string>
  activity: HarnessEvent[]
  onSend: (text: string) => void
  onStop: () => void
}) {
  const { t } = useI18n()
  const endRef = useRef<HTMLDivElement>(null)
  const schema = z.object({
    content: z
      .string()
      .trim()
      .min(1, t('atoms.messageRequired'))
      .max(4000, t('atoms.messageLength')),
  })
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { content: '' },
  })
  const submit = form.handleSubmit(({ content }) => {
    if (running || disabled) return
    onSend(content)
    form.reset()
  })
  useEffect(() => {
    if (messages.length > 0 || activity.length > 0) endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages, activity])
  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label={t('atoms.chat')}>
      {runStatus && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2 text-xs" role="status">
          {running && <Spinner />}
          <span>{t(`atoms.runStatus.${runStatus}`)}</span>
          {Object.entries(activeAgents).map(([id, name]) => (
            <Badge key={id} variant="secondary" data-testid="agent-status">
              {isKnownAgent(id) ? t(`agents.${id}.name`) : name}
            </Badge>
          ))}
          {running && <span className="w-full text-muted-foreground">{t('atoms.durableRun')}</span>}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="chat-log">
        <div className="flex flex-col gap-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          {activity.length > 0 && (
            <section className="min-w-0 rounded-lg border p-3" aria-label={t('atoms.runActivity')}>
              <h2 className="mb-2 text-xs font-semibold">{t('atoms.runActivity')}</h2>
              <ol className="space-y-2 text-xs" data-testid="run-activity">
                {activity.map((event) => (
                  <Activity key={`${event.runId}:${event.sequence}`} event={event} />
                ))}
              </ol>
            </section>
          )}
          <div ref={endRef} />
        </div>
      </div>
      <form className="border-t p-3" onSubmit={submit}>
        <Field>
          <FieldLabel htmlFor="followup" className="sr-only">
            {t('atoms.followPlaceholder')}
          </FieldLabel>
          <Textarea
            id="followup"
            data-testid="followup-input"
            rows={2}
            maxLength={4000}
            disabled={running || disabled}
            placeholder={t('atoms.followPlaceholder')}
            aria-invalid={Boolean(form.formState.errors.content)}
            {...form.register('content')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          <FieldError errors={[form.formState.errors.content]} />
        </Field>
        <div className="mt-2 flex justify-end">
          {running ? (
            <Button
              variant="outline"
              type="button"
              data-testid="stop-button"
              disabled={stopping}
              onClick={onStop}
            >
              {stopping && <Spinner />}
              {stopping ? t('atoms.stopping') : t('atoms.stop')}
            </Button>
          ) : (
            <Button
              type="submit"
              data-testid="send-button"
              disabled={disabled || !form.watch('content').trim()}
            >
              {t('atoms.send')}
            </Button>
          )}
        </div>
      </form>
    </section>
  )
}

function Activity({ event }: { event: HarnessEvent }) {
  const { t } = useI18n()
  const data = event.data
  const name = typeof data.name === 'string' ? data.name : ''
  const label =
    event.type === 'tool_start'
      ? t('atoms.toolStarted', { name })
      : event.type === 'tool_end'
        ? t(data.error ? 'atoms.toolFailed' : 'atoms.toolFinished', { name })
        : event.type === 'agent_start'
          ? t('atoms.agentStarted', { name })
          : event.type === 'agent_end'
            ? t('atoms.agentFinished', { name })
            : event.type === 'repair'
              ? t('atoms.repairAttempt', { attempt: Number(data.attempt) })
              : t(data.valid ? 'atoms.validationPassed' : 'atoms.validationFailed')
  const details =
    event.type === 'tool_start'
      ? data.input
      : event.type === 'tool_end'
        ? (data.error ?? data.output)
        : event.type === 'validation'
          ? { issues: data.issues, checks: data.checks, artifactHash: data.artifactHash }
          : data.issues
  const text =
    details === undefined
      ? ''
      : typeof details === 'string'
        ? details
        : JSON.stringify(details, null, 2)
  return (
    <li className="min-w-0" data-event-type={event.type}>
      {text ? (
        <Collapsible>
          <CollapsibleTrigger className="cursor-pointer break-words text-left">
            {label}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded bg-muted p-2">
              {text}
            </pre>
          </CollapsibleContent>
        </Collapsible>
      ) : (
        <p className="break-words">{label}</p>
      )}
    </li>
  )
}

function MessageBubble({ message }: { message: UiMessage }) {
  const { t } = useI18n()
  if (message.role === 'system') {
    const version = message.content.match(/^Saved version (\d+)\./)
    return (
      <div className="flex justify-center">
        <p className="rounded-lg bg-muted px-3 py-1 text-xs text-muted-foreground">
          {version ? t('atoms.savedVersion', { number: version[1] ?? '' }) : message.content}
        </p>
      </div>
    )
  }
  if (message.role === 'user')
    return (
      <div className="flex justify-end">
        <div className="max-w-[90%] rounded-xl bg-primary px-3 py-2 text-sm text-primary-foreground">
          <RichText text={message.content} />
        </div>
      </div>
    )
  const agent = message.agent
  return (
    <article className="flex gap-3">
      {agent && isKnownAgent(agent) && <AgentAvatar id={agent} />}
      <div className="min-w-0">
        {agent && (
          <p className="text-sm font-semibold">
            {isKnownAgent(agent) ? t(`agents.${agent}.name`) : agent}
          </p>
        )}
        <div className="mt-1 text-sm leading-6">
          <RichText text={message.content} />
          {message.pending && <span className="caret" />}
        </div>
      </div>
    </article>
  )
}
