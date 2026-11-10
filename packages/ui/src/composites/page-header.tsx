import type * as React from 'react'

/** Every screen opens with this: title left, primary actions right, optional one-line meta below. */
export function PageHeader({
  title,
  meta,
  actions,
}: {
  title: string
  meta?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 pb-4">
      <div className="min-w-0">
        <h1 className="truncate text-display">{title}</h1>
        {meta ? <div className="mt-2 text-body-sm text-muted-foreground">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
