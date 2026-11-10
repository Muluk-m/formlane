import { useI18n } from '@atoms-demo/i18n/react'
import { Loading03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from 'cn'

function Spinner({ className, ...props }: Omit<React.ComponentProps<'svg'>, 'strokeWidth'>) {
  const { t } = useI18n()
  return (
    <HugeiconsIcon
      icon={Loading03Icon}
      strokeWidth={1.5}
      data-slot="spinner"
      role="status"
      aria-label={t('ui.spinner.loading')}
      className={cn('size-4 animate-spin', className)}
      {...props}
    />
  )
}

export { Spinner }
