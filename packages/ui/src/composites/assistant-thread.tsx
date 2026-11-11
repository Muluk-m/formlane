import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  type TextMessagePartProps,
  ThreadPrimitive,
  useAuiState,
} from '@assistant-ui/react'
import { MarkdownTextPrimitive } from '@assistant-ui/react-markdown'
import { useI18n } from '@atoms-demo/i18n/react'
import {
  ArrowDown02Icon,
  ArrowUp02Icon,
  BubbleChatIcon,
  CheckmarkCircle02Icon,
  StopIcon,
  User02Icon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from 'cn'
import { type ReactNode, useId, useState } from 'react'
import { Button } from '#components/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '#components/collapsible'
import { ExternalLink } from '#components/link'
import { Spinner } from '#components/spinner'
import {
  AssistantActivity,
  AssistantActivityIcon,
  AssistantReasoning,
  AssistantStructuredOutput,
  AssistantToolCall,
} from '#composites/assistant-activity'

export type AssistantIdentity = { name: string; role?: string }
export type AssistantAgentResolver = (id: string | null) => AssistantIdentity

/** Message text is parsed by assistant-ui's streaming-aware Markdown renderer. */
export function MarkdownText() {
  return (
    <MarkdownTextPrimitive
      smooth={false}
      className="min-w-0 break-words text-sm leading-6 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 [&_p]:my-2 [&_h1]:my-3 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:my-3 [&_h2]:text-sm [&_h2]:font-semibold [&_h3]:my-2 [&_h3]:font-medium [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-input [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_pre]:my-3 [&_pre]:max-w-full [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-surface-sunken [&_pre]:p-3 [&_pre]:text-xs [&_code]:font-mono [&_code]:text-xs [&_strong]:font-semibold [&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-auto [&_th]:border [&_th]:border-border [&_th]:p-2 [&_td]:border [&_td]:border-border [&_td]:p-2"
      components={{
        a: ({ children, href }) => (
          <ExternalLink href={href} showIcon={false} className="inline text-link underline">
            {children}
          </ExternalLink>
        ),
      }}
    />
  )
}

function SystemText({ text }: TextMessagePartProps) {
  const { t } = useI18n()
  const version = text.match(/^Saved version (\d+)\./)
  return (
    <p className="flex items-center justify-center gap-2 whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">
      {version && (
        <HugeiconsIcon
          icon={CheckmarkCircle02Icon}
          strokeWidth={1.5}
          className="size-4 shrink-0 text-success"
          aria-hidden
        />
      )}
      <span className="min-w-0 [overflow-wrap:anywhere]">
        {version ? t('atoms.savedVersion', { number: version[1] ?? '' }) : text}
      </span>
    </p>
  )
}

const messageParts = {
  Text: MarkdownText,
  Reasoning: AssistantReasoning,
  tools: { Fallback: AssistantToolCall },
  data: {
    by_name: { activity: AssistantActivity, 'structured-output': AssistantStructuredOutput },
  },
}

function AssistantMessage({ resolveAgent }: { resolveAgent: AssistantAgentResolver }) {
  const { t } = useI18n()
  const role = useAuiState((s) => s.message.role)
  const custom = useAuiState((s) => s.message.metadata.custom)
  const status = useAuiState((s) => s.message.status)
  const hasText = useAuiState((s) =>
    s.message.content.some((part) => part.type === 'text' && part.text.length > 0),
  )
  const stepCount = useAuiState((s) => s.message.content.length)
  const identity = resolveAgent(typeof custom.agent === 'string' ? custom.agent : null)
  if (role === 'system' || custom.kind === 'system') {
    return (
      <MessagePrimitive.Root className="px-3 py-1" data-testid="system-message">
        <MessagePrimitive.Parts components={{ Text: SystemText }} />
      </MessagePrimitive.Root>
    )
  }
  if (role === 'user') {
    return (
      <MessagePrimitive.Root className="flex flex-col items-end gap-1.5" data-testid="user-message">
        <span className="text-xs font-medium text-muted-foreground">{t('ui.assistant.you')}</span>
        <div className="max-w-[92%] rounded-2xl rounded-tr-sm bg-secondary px-4 py-3 text-secondary-foreground">
          <MessagePrimitive.Parts components={messageParts} />
        </div>
      </MessagePrimitive.Root>
    )
  }
  if (custom.kind === 'execution') {
    return (
      <MessagePrimitive.Root className="min-w-0" data-testid="execution-message">
        <Collapsible defaultOpen className="min-w-0 rounded-xl border border-border bg-card">
          <CollapsibleTrigger className="group flex w-full items-center gap-2 rounded-xl px-3 py-3 text-left outline-none hover:bg-surface-sunken/60 focus-visible:ring-2 focus-visible:ring-ring">
            <AssistantActivityIcon tone={status?.type === 'running' ? 'running' : 'recorded'} />
            <span className="flex-1 text-xs font-medium">
              {t(status?.type === 'running' ? 'ui.assistant.executing' : 'ui.assistant.execution')}
            </span>
            <span className="text-xs tabular-nums text-muted-foreground">
              {t('ui.assistant.steps', { count: stepCount })}
            </span>
            <HugeiconsIcon
              icon={ArrowDown02Icon}
              strokeWidth={1.5}
              aria-hidden
              className="size-3.5 text-muted-foreground transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none"
            />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mx-3 mb-3 border-l border-border pl-2" data-testid="execution-steps">
              <MessagePrimitive.Parts components={messageParts} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      </MessagePrimitive.Root>
    )
  }
  return (
    <MessagePrimitive.Root className="min-w-0 space-y-3" data-testid="assistant-message">
      <div className="flex items-center gap-2">
        <span
          className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-surface-sunken text-foreground"
          aria-hidden
        >
          <HugeiconsIcon icon={User02Icon} strokeWidth={1.5} className="size-4" />
        </span>
        <span className="text-xs font-semibold text-foreground">{identity.name}</span>
        {identity.role && <span className="text-xs text-muted-foreground">{identity.role}</span>}
      </div>
      <div className="min-w-0 space-y-2">
        <MessagePrimitive.Parts components={messageParts} />
        {status?.type === 'running' && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
            data-testid="message-pending"
          >
            <Spinner className="size-3 motion-reduce:animate-none" />
            {!hasText && t('ui.assistant.writing')}
            {hasText && <span className="sr-only">{t('ui.assistant.writing')}</span>}
          </span>
        )}
        {status?.type === 'incomplete' && (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <AssistantActivityIcon tone="incomplete" />
            {t('ui.assistant.incomplete')}
          </p>
        )}
      </div>
    </MessagePrimitive.Root>
  )
}

export function AssistantRunStatus({
  label,
  state,
  agents,
  note,
}: {
  label: string
  state: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  agents: readonly (AssistantIdentity & { id: string })[]
  note?: string
}) {
  const tone = state === 'completed' ? 'complete' : state === 'queued' ? 'waiting' : state
  return (
    <div
      className="space-y-2 border-b border-border px-5 py-3"
      role="status"
      aria-live="polite"
      data-testid="run-status"
    >
      <div className="flex items-center gap-2 text-xs font-medium">
        <AssistantActivityIcon tone={tone} />
        <span>{label}</span>
      </div>
      {agents.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {agents.map((agent) => (
            <span
              key={agent.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-info-bg px-2 py-1 text-xs text-info"
              data-testid="agent-status"
            >
              <span className="size-1.5 rounded-full bg-current" aria-hidden />
              {agent.name}
              {agent.role && <span className="sr-only"> · {agent.role}</span>}
            </span>
          ))}
        </div>
      )}
      {note && <p className="text-xs leading-5 text-muted-foreground">{note}</p>}
    </div>
  )
}

/** The assistant runtime owns the draft; all submission paths share the same trimmed limit. */
export function AssistantComposer({
  disabled = false,
  stopping = false,
  mode = 'conversation',
}: {
  disabled?: boolean
  stopping?: boolean
  mode?: 'conversation' | 'idea'
}) {
  const { t } = useI18n()
  const text = useAuiState((s) => s.composer.text)
  const running = useAuiState((s) => s.thread.isRunning)
  const [attempted, setAttempted] = useState(false)
  const id = useId()
  const trimmed = text.trim()
  const invalid = trimmed.length > 4000 || (attempted && trimmed.length === 0)
  const blocked = disabled || running || stopping
  const error =
    trimmed.length > 4000
      ? t(mode === 'idea' ? 'atoms.ideaLength' : 'atoms.messageLength')
      : attempted && trimmed.length === 0
        ? t(mode === 'idea' ? 'atoms.ideaRequired' : 'atoms.messageRequired')
        : null
  return (
    <div
      className={cn('shrink-0 bg-card', mode === 'conversation' && 'border-t border-border p-3')}
    >
      <ComposerPrimitive.Root
        className={cn(
          'rounded-2xl border border-input bg-background shadow-card transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/10',
          mode === 'idea' ? 'p-4 sm:p-5' : 'p-3',
        )}
        data-testid={mode === 'idea' ? 'idea-composer' : 'chat-composer'}
        onSubmit={(event) => {
          if (blocked || !trimmed || trimmed.length > 4000) {
            event.preventDefault()
            setAttempted(true)
          } else {
            setAttempted(false)
          }
        }}
      >
        <ComposerPrimitive.Input
          id={`${id}-input`}
          data-testid={mode === 'idea' ? 'idea-input' : 'followup-input'}
          aria-label={t(mode === 'idea' ? 'atoms.placeholder' : 'atoms.followPlaceholder')}
          placeholder={t(mode === 'idea' ? 'atoms.placeholder' : 'atoms.followPlaceholder')}
          aria-invalid={invalid}
          aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}
          disabled={blocked}
          minRows={mode === 'idea' ? 3 : 2}
          maxRows={8}
          submitMode="enter"
          cancelOnEscape={false}
          addAttachmentOnPaste={false}
          className="block w-full resize-none bg-transparent px-1 py-1 text-sm leading-6 text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
          onChange={() => setAttempted(false)}
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="mt-1 px-1 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between gap-3">
          <p id={`${id}-hint`} className="px-1 text-xs leading-5 text-muted-foreground">
            {running
              ? t('ui.assistant.composerWorking')
              : disabled
                ? t('ui.assistant.composerUnavailable')
                : t(mode === 'idea' ? 'atoms.hint' : 'ui.assistant.composerHint')}
          </p>
          {running ? (
            <ComposerPrimitive.Cancel
              render={<Button variant="outline" />}
              disabled={stopping}
              data-testid="stop-button"
              aria-label={t(stopping ? 'atoms.stopping' : 'atoms.stop')}
            >
              {stopping ? (
                <Spinner className="motion-reduce:animate-none" />
              ) : (
                <HugeiconsIcon icon={StopIcon} strokeWidth={1.5} aria-hidden />
              )}
              {t(stopping ? 'atoms.stopping' : 'atoms.stop')}
            </ComposerPrimitive.Cancel>
          ) : (
            <ComposerPrimitive.Send
              render={<Button size={mode === 'idea' ? 'default' : 'icon'} />}
              disabled={disabled || stopping || !trimmed || trimmed.length > 4000}
              aria-label={t(mode === 'idea' ? 'atoms.build' : 'atoms.send')}
              data-testid={mode === 'idea' ? 'build-button' : 'send-button'}
              onClick={() => setAttempted(false)}
            >
              <HugeiconsIcon icon={ArrowUp02Icon} strokeWidth={1.5} aria-hidden />
              {mode === 'idea' && t('atoms.build')}
            </ComposerPrimitive.Send>
          )}
        </div>
        {trimmed.length > 3600 && (
          <p className="mt-2 px-1 text-xs tabular-nums text-muted-foreground">
            {t('ui.assistant.characters', { count: trimmed.length })}
          </p>
        )}
      </ComposerPrimitive.Root>
    </div>
  )
}

export function AssistantThread({
  resolveAgent,
  status,
  disabled,
  stopping,
}: {
  resolveAgent: AssistantAgentResolver
  status?: ReactNode
  disabled?: boolean
  stopping?: boolean
}) {
  const { t } = useI18n()
  return (
    <ThreadPrimitive.Root
      className="flex h-full min-h-0 flex-col bg-card"
      aria-label={t('atoms.chat')}
    >
      {status}
      <ThreadPrimitive.Viewport
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6"
        autoScroll
        data-testid="chat-log"
      >
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <div className="mx-auto flex max-w-sm flex-col items-center px-4 py-12 text-center">
            <span className="mb-4 flex size-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
              <HugeiconsIcon
                icon={BubbleChatIcon}
                strokeWidth={1.5}
                className="size-5"
                aria-hidden
              />
            </span>
            <h2 className="text-sm font-medium">{t('ui.assistant.emptyTitle')}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {t('ui.assistant.emptyDescription')}
            </p>
          </div>
        </AuiIf>
        <div className="flex min-w-0 flex-col gap-5" data-testid="run-activity">
          <ThreadPrimitive.Messages>
            {() => <AssistantMessage resolveAgent={resolveAgent} />}
          </ThreadPrimitive.Messages>
        </div>
        <div className="pointer-events-none sticky bottom-0 mt-4 flex justify-center">
          <ThreadPrimitive.ScrollToBottom
            render={<Button variant="outline" size="sm" />}
            className="pointer-events-auto shadow-card disabled:invisible"
            aria-label={t('ui.assistant.latest')}
            data-testid="scroll-to-latest"
          >
            <HugeiconsIcon icon={ArrowDown02Icon} strokeWidth={1.5} aria-hidden />
            {t('ui.assistant.latest')}
          </ThreadPrimitive.ScrollToBottom>
        </div>
      </ThreadPrimitive.Viewport>
      <AssistantComposer disabled={disabled} stopping={stopping} />
    </ThreadPrimitive.Root>
  )
}
