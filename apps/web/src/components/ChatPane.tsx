import {
  AssistantRuntimeProvider,
  MessageNotSentError,
  type ThreadMessageLike,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import type { RunEvent as HarnessEvent, Run as HarnessRun } from '@atoms-demo/contracts'
import { AGENT_ORDER, type AgentId, type AppVersion } from '@atoms-demo/core/types'
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
  run,
  activeAgents,
  activity,
  versions,
  currentVersion,
  undoVersionId,
  undoDisabled,
  undoPending,
  undoneVersionIds,
  onUndoVersion,
  onOpenVersion,
  onSend,
  onStop,
}: {
  messages: ConversationMessage[]
  running: boolean
  disabled: boolean
  stopping: boolean
  run: Pick<HarnessRun, 'id' | 'status' | 'attempt'> | null
  activeAgents: Record<string, string>
  activity: HarnessEvent[]
  versions: AppVersion[]
  currentVersion: AppVersion | undefined
  undoVersionId: string | undefined
  undoDisabled: boolean
  undoPending: boolean
  undoneVersionIds: ReadonlySet<string>
  onUndoVersion: () => void
  onOpenVersion: (versionId: string, mode: 'preview' | 'changes') => void
  onSend: (text: string) => void
  onStop: () => void
}) {
  const { t } = useI18n()
  const converted = useMemo(
    () => groupExecutionMessages(toAssistantMessages(messages, activity, run, versions)),
    [messages, activity, run, versions],
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
        renderSavedVersion={(versionId) => {
          const version = versions.find((item) => item.id === versionId)
          return version ? (
            <AssistantSavedVersion
              number={version.number}
              undoneCurrentVersionNumber={
                undoneVersionIds.has(versionId) && versionId !== currentVersion?.id
                  ? currentVersion?.number
                  : undefined
              }
              onUndo={versionId === undoVersionId ? onUndoVersion : undefined}
              undoDisabled={undoDisabled}
              undoPending={undoPending && versionId === undoVersionId}
              onPreview={() => onOpenVersion(versionId, 'preview')}
              onChanges={() => onOpenVersion(versionId, 'changes')}
            />
          ) : null
        }}
        status={
          run ? (
            <AssistantRunStatus
              label={stopping ? t('atoms.stopping') : t(`atoms.runStatus.${run.status}`)}
              state={run.status}
              agents={agents}
            />
          ) : (
            <h2 className="flex min-h-12 shrink-0 items-center px-6 text-xs font-medium">
              {t('atoms.chat')}
            </h2>
          )
        }
      />
    </AssistantRuntimeProvider>
  )
}
