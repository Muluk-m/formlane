import { useI18n } from '@atoms-demo/i18n/react'
import { FileCodeIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type ReactNode, useRef } from 'react'
import { Badge } from '#components/badge'
import { Button } from '#components/button'
import { Spinner } from '#components/spinner'

export function CodeSurface({
  hasCode,
  running,
  draft,
  phaseLabel,
  sizeLabel,
  children,
}: {
  hasCode: boolean
  running: boolean
  draft: boolean
  phaseLabel?: string
  sizeLabel: string
  children: ReactNode
}) {
  const { t } = useI18n()
  const source = useRef<HTMLElement>(null)
  const statusLabel = phaseLabel || t('atoms.files.generating')

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm"
      data-testid="code-view"
    >
      <div className="flex min-h-10 shrink-0 items-center justify-between gap-3 border-b px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">
          {t('atoms.files.navigation')}
        </span>
        {hasCode && (
          <span className="text-xs text-muted-foreground">{t('atoms.files.singleFile')}</span>
        )}
      </div>
      {hasCode ? (
        <>
          <nav
            aria-label={t('atoms.files.navigation')}
            className="flex shrink-0 items-center justify-between gap-2 border-b px-2 py-1.5"
          >
            <Button
              variant="secondary"
              size="sm"
              aria-pressed
              onClick={() => source.current?.focus()}
              data-testid="source-file"
            >
              <HugeiconsIcon icon={FileCodeIcon} strokeWidth={1.5} aria-hidden />
              <span className="font-mono text-xs">index.html</span>
            </Button>
            <span className="px-1 font-mono text-xs text-muted-foreground">HTML</span>
          </nav>
          <section
            ref={source}
            tabIndex={-1}
            aria-label={t('atoms.files.sourceLabel')}
            className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            {children}
          </section>
          <div className="shrink-0 space-y-2 border-t px-3 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge variant={draft ? 'secondary' : 'outline'}>
                {draft
                  ? t(running ? 'atoms.files.liveDraft' : 'atoms.files.unsavedDraft')
                  : t('atoms.files.savedVersion')}
              </Badge>
              <span className="font-mono text-xs text-muted-foreground">{sizeLabel}</span>
            </div>
            {draft && (
              <p className="text-xs leading-5 text-muted-foreground">
                {t('atoms.files.draftHint')}
              </p>
            )}
            {running && (
              <div role="status" className="flex items-start gap-2 text-xs text-muted-foreground">
                <Spinner aria-hidden className="mt-0.5 size-3 shrink-0" />
                <span className="min-w-0 break-words leading-4">{statusLabel}</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="grid min-h-0 flex-1 place-items-center overflow-auto px-5 py-8">
          <div className="w-full max-w-sm space-y-5 text-center" data-testid="code-empty">
            <div className="mx-auto grid size-14 place-items-center rounded-2xl border border-border bg-surface-sunken">
              <HugeiconsIcon
                icon={FileCodeIcon}
                strokeWidth={1.5}
                aria-hidden
                className="size-6 text-muted-foreground"
              />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">
                {t(running ? 'atoms.files.generatingTitle' : 'atoms.files.emptyTitle')}
              </h3>
              <p className="text-sm leading-6 text-muted-foreground">
                {t(running ? 'atoms.files.generatingDescription' : 'atoms.files.emptyDescription')}
              </p>
            </div>
            {running && (
              <div
                role="status"
                className="mx-auto flex w-fit max-w-full items-start gap-2 rounded-lg bg-sky-wash px-3 py-2 text-xs text-foreground"
              >
                <Spinner aria-hidden className="mt-0.5 size-3 shrink-0" />
                <span className="min-w-0 break-words text-left leading-4">{statusLabel}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
