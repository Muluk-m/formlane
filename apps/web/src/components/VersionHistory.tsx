import type { AppVersion } from '@atoms-demo/core/types'
import { useI18n } from '@atoms-demo/i18n/react'
import { Badge } from '@atoms-demo/ui/components/badge'
import { Button } from '@atoms-demo/ui/components/button'
import { Spinner } from '@atoms-demo/ui/components/spinner'
import { ArrowLeft01Icon, Clock01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { relativeTime } from '../lib/format'

export function VersionHistory({
  versions,
  currentId,
  selectedId,
  publishedId,
  loadingId,
  error,
  onSelect,
  onClose,
}: {
  versions: AppVersion[]
  currentId: string | null
  selectedId: string | null
  publishedId: string | null
  loadingId: string | null
  error: string | null
  onSelect: (id: string) => void
  onClose: () => void
}) {
  const { t, locale } = useI18n()
  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background"
      data-testid="version-drawer"
      aria-label={t('atoms.historyTitle')}
    >
      <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          aria-label={t('atoms.versionReview.backToChat')}
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.5} />
        </Button>
        <h2 className="flex-1 text-sm font-medium">{t('atoms.historyTitle')}</h2>
        <Badge variant="secondary">{versions.length}</Badge>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {versions.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-4 py-12 text-center text-sm text-muted-foreground">
            <HugeiconsIcon icon={Clock01Icon} size={24} strokeWidth={1.5} />
            <p>{t('atoms.historyEmpty')}</p>
          </div>
        ) : (
          <ol className="space-y-2">
            {[...versions]
              .sort((a, b) => b.number - a.number)
              .map((version) => (
                <li key={version.id}>
                  <Button
                    variant={selectedId === version.id ? 'secondary' : 'ghost'}
                    className="h-auto w-full flex-col items-stretch gap-3 px-4 py-4 text-left whitespace-normal"
                    aria-pressed={selectedId === version.id}
                    disabled={Boolean(loadingId)}
                    data-testid={`preview-${version.number}`}
                    onClick={() => onSelect(version.id)}
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">
                        {t('atoms.versionReview.shortVersion', { number: version.number })}
                      </span>
                      {currentId === version.id && (
                        <Badge variant="outline">{t('atoms.current')}</Badge>
                      )}
                      {publishedId === version.id && (
                        <Badge variant="outline">{t('atoms.published')}</Badge>
                      )}
                      {loadingId === version.id && <Spinner className="ml-auto" />}
                    </span>
                    <span
                      className={`text-sm leading-relaxed ${selectedId === version.id ? 'break-words' : 'line-clamp-3'}`}
                    >
                      {version.prompt || t('atoms.files.savedVersion')}
                    </span>
                    <time
                      className="text-xs font-normal text-muted-foreground"
                      dateTime={new Date(version.createdAt).toISOString()}
                      title={new Date(version.createdAt).toLocaleString(locale)}
                    >
                      {relativeTime(version.createdAt, locale)}
                    </time>
                  </Button>
                </li>
              ))}
          </ol>
        )}
      </div>
      {error && (
        <p role="alert" className="border-t px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      <footer className="shrink-0 border-t px-5 py-4 text-xs leading-relaxed text-muted-foreground">
        {t('atoms.versionReview.historyHint')}
      </footer>
    </section>
  )
}
