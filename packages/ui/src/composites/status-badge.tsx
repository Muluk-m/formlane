import { useI18n } from '@atoms-demo/i18n/react'
import {
  Alert02Icon,
  AlertCircleIcon,
  CancelCircleIcon,
  CheckmarkCircle02Icon,
  Clock01Icon,
  MinusSignCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react'
import { cn } from 'cn'
import { Badge } from '#components/badge'
import { Spinner } from '#components/spinner'

/**
 * One status vocabulary for the whole product (DESIGN.md, Status language).
 * Status is always icon + text, never color alone; a running state always spins.
 */
export const statusTones = {
  success: 'bg-success-bg text-success',
  warning: 'bg-warning-bg text-warning',
  danger: 'bg-danger-bg text-destructive',
  info: 'bg-info-bg text-info',
  neutral: 'bg-muted text-muted-foreground',
} as const
export type StatusTone = keyof typeof statusTones

export const statusPresets = {
  // Reusable generation and connectivity states. Labels live in the shared catalog.
  updated: { tone: 'success' },
  running: { tone: 'info', spinning: true },
  failedKeepOld: { tone: 'warning' },
  failed: { tone: 'danger' },
  noData: { tone: 'neutral', icon: AlertCircleIcon },
  offline: { tone: 'warning' },
  ready: { tone: 'success' },
  pending: { tone: 'info' },
} as const satisfies Record<string, { tone: StatusTone; spinning?: boolean; icon?: IconSvgElement }>
export type StatusPreset = keyof typeof statusPresets

const toneIcon: Record<StatusTone, IconSvgElement> = {
  success: CheckmarkCircle02Icon,
  warning: Alert02Icon,
  danger: CancelCircleIcon,
  info: Clock01Icon,
  neutral: MinusSignCircleIcon,
}

export function StatusBadge({
  status,
  label,
  className,
}: {
  status: StatusPreset
  /** Override the preset label, e.g. with a count; the tone stays the preset's. */
  label?: string
  className?: string
}) {
  const { t } = useI18n()
  const preset = statusPresets[status]
  const spinning = 'spinning' in preset && preset.spinning
  const icon = 'icon' in preset ? preset.icon : toneIcon[preset.tone]
  return (
    <Badge className={cn('h-6 gap-1.5 px-2', statusTones[preset.tone], className)}>
      {spinning ? (
        <Spinner className="size-3" />
      ) : (
        <HugeiconsIcon icon={icon} strokeWidth={1.5} aria-hidden className="size-3" />
      )}
      {label ?? t(`status.${status}`)}
    </Badge>
  )
}
