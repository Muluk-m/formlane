import {
  AssistantRuntimeProvider,
  MessageNotSentError,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import type { RunEvent as HarnessEvent, Run as HarnessRun } from '@atoms-demo/contracts'
import { AGENT_ORDER, type AgentId } from '@atoms-demo/core/types'
import { useI18n } from '@atoms-demo/i18n/react'
import {
  type AssistantIdentity,
  AssistantRunStatus,
  AssistantSavedVersion,
  AssistantThread,
} from '@atoms-demo/ui/composites/assistant-thread'
import { useMemo } from 'react'
import { z } from 'zod'
import {
  type ConversationMessage,
  groupExecutionMessages,
  toAssistantMessages,
} from '../features/assistant/messages'

const convertMessage = (message: ThreadMessageLike) => message

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
  savedVersion,
  onSend,
  onStop,
}: {
  messages: ConversationMessage[]
  running: boolean
  disabled: boolean
  stopping: boolean
  runStatus: HarnessRun['status'] | null
  activeAgents: Record<string, string>
  activity: HarnessEvent[]
  savedVersion?: { number: number; onPreview: () => void; onChanges: () => void }
  onSend: (text: string) => void
  onStop: () => void
}) {
  const { t } = useI18n()
  const converted = useMemo(
    () => groupExecutionMessages(toAssistantMessages(messages, activity, runStatus)),
    [messages, activity, runStatus],
  )
  const schema = z
    .string()
    .trim()
    .min(1, t('atoms.messageRequired'))
    .max(4000, t('atoms.messageLength'))
  const runtime = useExternalStoreRuntime({
    messages: converted,
    convertMessage,
    isRunning: running,
    isDisabled: disabled && !running,
    isSendDisabled: disabled || running || stopping,
    onNew: async (message) => {
      if (disabled || running || stopping) {
        throw new MessageNotSentError(t('ui.assistant.composerUnavailable'))
      }
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      const parsed = schema.safeParse(text)
      if (!parsed.success) {
        throw new MessageNotSentError(parsed.error.issues[0]?.message ?? t('atoms.messageRequired'))
      }
      onSend(parsed.data)
    },
    onCancel: async () => {
      if (running && !stopping) onStop()
    },
  })
  const resolveAgent = (id: string | null): AssistantIdentity => {
    if (id && isKnownAgent(id))
      return { name: t(`agents.${id}.name`), role: t(`agents.${id}.role`) }
    return { name: id ? (activeAgents[id] ?? id) : t('ui.assistant.name') }
  }
  const agents = running
    ? Object.entries(activeAgents).map(([id, name]) => ({
        id,
        ...resolveAgent(id),
        name: isKnownAgent(id) ? t(`agents.${id}.name`) : name,
      }))
    : []
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantThread
        resolveAgent={resolveAgent}
        disabled={disabled}
        stopping={stopping}
        artifact={savedVersion && <AssistantSavedVersion {...savedVersion} />}
        status={
          runStatus && (
            <AssistantRunStatus
              label={stopping ? t('atoms.stopping') : t(`atoms.runStatus.${runStatus}`)}
              state={runStatus}
              agents={agents}
              note={running ? t('atoms.durableRun') : undefined}
            />
          )
        }
      />
    </AssistantRuntimeProvider>
  )
}
