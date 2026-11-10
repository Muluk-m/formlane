import { LinkSquare02Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { cn } from 'cn'
import type * as React from 'react'

/** The only place an <a> is rendered for external URLs; in-app navigation uses the router's Link. */
function ExternalLink({
  className,
  children,
  showIcon = true,
  ...props
}: React.ComponentProps<'a'> & { showIcon?: boolean }) {
  return (
    <a
      data-slot="external-link"
      target="_blank"
      rel="noreferrer noopener"
      className={cn(
        'inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline',
        className,
      )}
      {...props}
    >
      {children}
      {showIcon ? (
        <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={1.5} className="size-3.5" aria-hidden />
      ) : null}
    </a>
  )
}

export { ExternalLink }
