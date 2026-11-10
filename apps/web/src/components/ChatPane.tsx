import type { AgentId, ChatMessage } from '@atoms-demo/core/types'
import { useI18n } from '@atoms-demo/i18n/react'
import { Badge } from '@atoms-demo/ui/components/badge'
import { Button } from '@atoms-demo/ui/components/button'
import { Field, FieldError, FieldLabel } from '@atoms-demo/ui/components/field'
import { Spinner } from '@atoms-demo/ui/components/spinner'
import { Textarea } from '@atoms-demo/ui/components/textarea'
import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { AgentAvatar } from './AgentAvatar'
import { RichText } from './RichText'

type UiMessage = ChatMessage & { pending?: boolean }
export function ChatPane({
  messages,
  running,
  active,
  pipeline,
  done,
  onSend,
  onStop,
}: {
  messages: UiMessage[]
  running: boolean
  active: AgentId | null
  pipeline: AgentId[]
  done: AgentId[]
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
    if (running) return
    onSend(content)
    form.reset()
  })
  useEffect(() => {
    const end = endRef.current
    const content = end?.parentElement
    if (!end || !content) return
    const observer = new ResizeObserver(() => end.scrollIntoView({ block: 'end' }))
    observer.observe(content)
    if (content.parentElement) observer.observe(content.parentElement)
    return () => observer.disconnect()
  }, [])
  return (
    <section className="flex h-full min-h-0 flex-col bg-card" aria-label={t('atoms.chat')}>
      {pipeline.length > 0 && running && (
        <ol className="flex gap-1.5 overflow-x-auto border-b px-4 py-3">
          {pipeline.map((id) => (
            <li key={id}>
              <Badge
                variant={active === id ? 'default' : 'secondary'}
                className={done.includes(id) ? 'bg-sky-wash text-link' : ''}
              >
                {t(`agents.${id}.name`)}
              </Badge>
            </li>
          ))}
        </ol>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto p-4" data-testid="chat-log">
        <div className="flex flex-col gap-4">
          {messages.map((message) => (
            <MessageBubble key={message.id} message={message} />
          ))}
          <div ref={endRef} />
        </div>
      </div>
      <form className="border-t p-3" onSubmit={submit}>
        {active && (
          <p
            role="status"
            className="mb-2 flex items-center gap-2 text-sm text-muted-foreground"
            data-testid="agent-status"
          >
            <Spinner />
            {t(`agents.${active}.status`)}
          </p>
        )}
        <Field>
          <FieldLabel htmlFor="followup" className="sr-only">
            {t('atoms.followPlaceholder')}
          </FieldLabel>
          <Textarea
            id="followup"
            data-testid="followup-input"
            rows={2}
            maxLength={4000}
            disabled={running}
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
            <Button variant="outline" type="button" data-testid="stop-button" onClick={onStop}>
              <Spinner />
              {t('atoms.stop')}
            </Button>
          ) : (
            <Button
              type="submit"
              data-testid="send-button"
              disabled={!form.watch('content').trim()}
            >
              {t('atoms.send')}
            </Button>
          )}
        </div>
      </form>
    </section>
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
  return (
    <article className="flex gap-3">
      {message.agent && <AgentAvatar id={message.agent} />}
      <div className="min-w-0">
        {message.agent && (
          <p className="text-sm">
            <span className="font-semibold">{t(`agents.${message.agent}.name`)}</span>{' '}
            <span className="text-muted-foreground">{t(`agents.${message.agent}.role`)}</span>
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
