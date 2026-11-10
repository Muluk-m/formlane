import { cn } from 'cn'
import type * as React from 'react'
import { Spinner } from '#components/spinner'

/** Facts about one entity in small panels (extension popup, detail cards). Loading shows a spinner, never "—". */
export function KeyValueRow({
  label,
  children,
  loading = false,
  mono = false,
}: {
  label: string
  children?: React.ReactNode
  loading?: boolean
  mono?: boolean
}) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-4 border-b border-dashed py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={cn('text-right text-sm', mono && 'num')}>
        {loading ? <Spinner className="size-3.5" /> : children}
      </span>
    </div>
  )
}
