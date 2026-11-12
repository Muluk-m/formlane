import type { AppVersion } from '@atoms-demo/core/types'
import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@atoms-demo/ui/components/dropdown-menu'
import { Spinner } from '@atoms-demo/ui/components/spinner'
import { ArrowDown01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { versionQuery } from '../features/projects/queries'
import { VersionDiff } from './VersionDiff'

export function VersionChanges({
  projectId,
  version,
  versions,
  active,
}: {
  projectId: string
  version: AppVersion
  versions: AppVersion[]
  active: boolean
}) {
  const { t } = useI18n()
  const candidates = versions
    .filter((item) => item.id !== version.id)
    .sort((a, b) => b.number - a.number)
  const [baselineId, setBaselineId] = useState<string | null>(
    () => candidates.find((item) => item.number < version.number)?.id ?? null,
  )
  const selected = useQuery({
    ...versionQuery(projectId, version.id),
    enabled: active,
    staleTime: Infinity,
  })
  const baseline = useQuery({
    ...versionQuery(projectId, baselineId ?? ''),
    enabled: active && Boolean(baselineId),
    staleTime: Infinity,
  })
  const beforeVersion = candidates.find((item) => item.id === baselineId)
  const label = (number: number) => t('atoms.versionReview.shortVersion', { number })
  const beforeLabel = beforeVersion
    ? label(beforeVersion.number)
    : t('atoms.versionReview.emptyBaseline')
  const failed = selected.isError || (baselineId && baseline.isError)
  const loading = !selected.data || (baselineId && !baseline.data)
  return (
    <section className="flex h-full min-h-0 flex-col" aria-label={t('atoms.versionReview.changes')}>
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2 text-xs">
        <span className="text-muted-foreground">{t('atoms.versionReview.compareWith')}</span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="outline" size="sm" data-testid="diff-baseline" />}
          >
            <span className="font-mono">{beforeLabel}</span>
            <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.5} />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuRadioGroup
              value={baselineId ?? ''}
              onValueChange={(value) => setBaselineId(value || null)}
            >
              <DropdownMenuRadioItem value="" closeOnClick>
                {t('atoms.versionReview.emptyBaseline')}
              </DropdownMenuRadioItem>
              {candidates.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id} closeOnClick>
                  {label(item.number)}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="ml-auto text-muted-foreground">{t('atoms.versionReview.savedOnly')}</span>
      </div>
      {failed ? (
        <div
          role="alert"
          className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm"
        >
          <p>{t('atoms.versionReview.loadFailed')}</p>
          <Button
            variant="outline"
            onClick={() => {
              void selected.refetch()
              if (baselineId) void baseline.refetch()
            }}
          >
            {t('atoms.versionReview.retryLoad')}
          </Button>
        </div>
      ) : loading ? (
        <div
          role="status"
          className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
        >
          <Spinner />
          {t('atoms.loading')}
        </div>
      ) : selected.data ? (
        <VersionDiff
          before={baselineId ? (baseline.data?.version.source ?? null) : null}
          after={selected.data.version.source}
          beforeLabel={beforeLabel}
          afterLabel={label(version.number)}
        />
      ) : null}
    </section>
  )
}
