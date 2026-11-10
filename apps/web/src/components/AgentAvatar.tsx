import type { AgentId } from '@atoms-demo/core/types'
import { useI18n } from '@atoms-demo/i18n/react'
import { Avatar, AvatarFallback } from '@atoms-demo/ui/components/avatar'
import { User02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'

export function AgentAvatar({ id }: { id: AgentId }) {
  const { t } = useI18n()
  return (
    <Avatar aria-label={t(`agents.${id}.name`)}>
      <AvatarFallback className="bg-primary text-primary-foreground">
        <HugeiconsIcon icon={User02Icon} strokeWidth={1.5} className="size-4" aria-hidden />
      </AvatarFallback>
    </Avatar>
  )
}
