import { ThreadPrimitive } from '@assistant-ui/react'
import { useI18n } from '@atoms-demo/i18n/react'
import {
  ArrowUpRight01Icon,
  BrowserIcon,
  Calendar03Icon,
  Clock01Icon,
  Coffee01Icon,
  Delete02Icon,
  Folder01Icon,
  Globe02Icon,
  Layers01Icon,
  MapsLocation01Icon,
  ToolsIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import type { ComponentProps } from 'react'
import { Badge } from '#components/badge'
import { Button } from '#components/button'
import { Card, CardContent, CardFooter } from '#components/card'
import { Spinner } from '#components/spinner'
import { StatusBadge } from '#composites/status-badge'

const suggestions = [
  { key: 'one', icon: MapsLocation01Icon },
  { key: 'two', icon: Calendar03Icon },
  { key: 'three', icon: ToolsIcon },
  { key: 'four', icon: Coffee01Icon },
] as const

export function AssistantHomeIntro() {
  const { t } = useI18n()
  return (
    <header className="text-center">
      <svg
        aria-hidden="true"
        viewBox="0 0 320 144"
        fill="none"
        className="mx-auto mb-6 h-28 w-64 sm:h-36 sm:w-80"
      >
        <ellipse cx="160" cy="124" rx="104" ry="8" fill="var(--muted)" opacity="0.6" />
        <g transform="rotate(-12 76 80)" stroke="var(--input)">
          <rect x="26" y="38" width="100" height="82" rx="10" fill="var(--card)" />
          <path d="M26 60h100" />
          <path d="M42 49h20" stroke="var(--muted-foreground)" strokeLinecap="round" />
          <rect x="42" y="73" width="15" height="13" rx="3" fill="var(--sky-wash)" stroke="none" />
          <rect x="65" y="73" width="15" height="13" rx="3" />
          <rect x="88" y="73" width="15" height="13" rx="3" />
          <path d="M42 99h15m8 0h15m8 0h15" strokeLinecap="round" />
        </g>
        <g transform="rotate(12 244 80)" stroke="var(--input)">
          <rect x="194" y="38" width="100" height="82" rx="10" fill="var(--card)" />
          <path d="M194 60h100" />
          <path d="M210 49h20" stroke="var(--muted-foreground)" strokeLinecap="round" />
          <path
            d="M210 103l18-16 15 8 28-22"
            stroke="var(--chart-2)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="271" cy="73" r="3" fill="var(--chart-2)" stroke="none" />
        </g>
        <rect
          x="97"
          y="17"
          width="126"
          height="106"
          rx="12"
          fill="var(--card)"
          stroke="var(--input)"
        />
        <path d="M97 40h126" stroke="var(--input)" />
        <circle cx="109" cy="29" r="2" fill="var(--muted-foreground)" opacity="0.45" />
        <circle cx="117" cy="29" r="2" fill="var(--muted-foreground)" opacity="0.25" />
        <circle cx="125" cy="29" r="2" fill="var(--muted-foreground)" opacity="0.15" />
        <rect x="109" y="52" width="42" height="58" rx="5" fill="var(--sky-wash)" />
        <path
          d="M117 94l9-16 8 7 9-19"
          stroke="var(--link)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M163 57h34m-34 9h22"
          stroke="var(--muted-foreground)"
          strokeWidth="3"
          strokeLinecap="round"
          opacity="0.35"
        />
        <rect x="161" y="79" width="49" height="31" rx="5" fill="var(--muted)" />
        <path
          d="M176 94h19m-9-9v19"
          stroke="var(--muted-foreground)"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M250 15v10m-5-5h10M63 19v6m-3-3h6"
          stroke="var(--link)"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.5"
        />
        <circle cx="284" cy="119" r="2" fill="var(--chart-2)" opacity="0.5" />
      </svg>
      <h1 className="text-balance text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">
        {t('atoms.landing.headline')}
      </h1>
    </header>
  )
}

export function AssistantHomeSuggestions({ disabled }: { disabled: boolean }) {
  const { t } = useI18n()
  return (
    <section aria-label={t('atoms.examples')} className="text-center">
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-center">
        {suggestions.map(({ key, icon }, index) => (
          <ThreadPrimitive.Suggestion
            key={key}
            prompt={t(`atoms.examplesList.${key}.prompt`)}
            send={false}
            disabled={disabled}
            data-testid={`example-${index}`}
            render={
              <Button
                variant="outline"
                className="h-auto min-h-11 justify-start gap-2 rounded-full px-4 py-2 text-left text-xs whitespace-normal sm:justify-center"
              />
            }
          >
            <HugeiconsIcon
              icon={icon}
              strokeWidth={1.5}
              aria-hidden
              className="size-4 text-muted-foreground"
            />
            <span>{t(`atoms.examplesList.${key}.title`)}</span>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </section>
  )
}

export function AssistantHomeProjectsHeading() {
  const { t } = useI18n()
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b pb-4">
      <h2 className="text-lg font-semibold">{t('atoms.projects')}</h2>
      <p className="text-xs text-muted-foreground">{t('atoms.landing.projectsNote')}</p>
    </div>
  )
}

export function AssistantHomeProjectsState({ loading = false }: { loading?: boolean }) {
  const { t } = useI18n()
  return (
    <div
      role={loading ? 'status' : undefined}
      className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center"
    >
      <span className="flex size-11 items-center justify-center rounded-xl bg-surface-sunken text-muted-foreground">
        {loading ? (
          <Spinner className="size-5" />
        ) : (
          <HugeiconsIcon icon={Folder01Icon} strokeWidth={1.5} aria-hidden className="size-5" />
        )}
      </span>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
        {t(loading ? 'ui.spinner.loading' : 'atoms.empty')}
      </p>
    </div>
  )
}

export function AssistantHomeProjectCard({
  title,
  idea,
  status,
  hasSavedVersion,
  published,
  versionLabel,
  updatedAt,
  updatedLabel,
  link,
  onDelete,
}: {
  title: string
  idea: string
  status: 'idle' | 'generating' | 'error'
  hasSavedVersion: boolean
  published: boolean
  versionLabel?: string
  updatedAt: number
  updatedLabel: string
  link: ComponentProps<typeof Button>['render']
  onDelete: () => void
}) {
  const { t, locale } = useI18n()
  return (
    <Card className="h-full gap-5 transition-shadow duration-150 hover:ring-input motion-reduce:transition-none">
      <CardContent className="flex flex-1 flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="flex size-10 items-center justify-center rounded-lg border bg-surface-sunken text-muted-foreground">
            <HugeiconsIcon icon={BrowserIcon} strokeWidth={1.5} aria-hidden className="size-5" />
          </span>
          <div className="flex flex-wrap items-center gap-2">
            {status === 'generating' ? (
              <StatusBadge status="running" />
            ) : status === 'error' ? (
              <StatusBadge status={hasSavedVersion ? 'failedKeepOld' : 'failed'} />
            ) : hasSavedVersion ? (
              <StatusBadge status="updated" label={t('atoms.landing.saved')} />
            ) : (
              <Badge variant="secondary">{t('atoms.landing.notBuilt')}</Badge>
            )}
            {published && (
              <Badge variant="outline" className="gap-1.5">
                <HugeiconsIcon
                  icon={Globe02Icon}
                  strokeWidth={1.5}
                  aria-hidden
                  className="size-3"
                />
                {t('atoms.published')}
              </Badge>
            )}
          </div>
        </div>
        <div className="min-w-0">
          <h3>
            <Button
              variant="link"
              nativeButton={false}
              className="h-auto w-full items-start justify-between gap-4 p-0 text-left text-base leading-snug font-semibold whitespace-normal hover:no-underline hover:text-link"
              render={link}
            >
              <span className="min-w-0 wrap-anywhere">{title}</span>
              <HugeiconsIcon
                icon={ArrowUpRight01Icon}
                strokeWidth={1.5}
                aria-hidden
                className="mt-0.5 size-4 text-muted-foreground"
              />
            </Button>
          </h3>
          <p className="mt-2 line-clamp-2 min-h-10 text-sm leading-5 wrap-anywhere text-muted-foreground">
            {idea}
          </p>
        </div>
      </CardContent>
      <CardFooter className="flex-wrap justify-between gap-x-3 gap-y-1 bg-surface-sunken/50 py-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {versionLabel && (
            <span className="inline-flex items-center gap-1.5">
              <HugeiconsIcon
                icon={Layers01Icon}
                strokeWidth={1.5}
                aria-hidden
                className="size-3.5"
              />
              {versionLabel}
            </span>
          )}
          <time
            dateTime={new Date(updatedAt).toISOString()}
            title={new Date(updatedAt).toLocaleString(locale)}
            className="inline-flex items-center gap-1.5"
          >
            <HugeiconsIcon icon={Clock01Icon} strokeWidth={1.5} aria-hidden className="size-3.5" />
            {updatedLabel}
          </time>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="min-h-10 text-muted-foreground hover:bg-danger-bg hover:text-destructive"
          onClick={onDelete}
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={1.5} aria-hidden />
          {t('atoms.delete')}
        </Button>
      </CardFooter>
    </Card>
  )
}

export function AssistantHomeBrowserNote() {
  const { t } = useI18n()
  return (
    <p className="flex items-start justify-center gap-2 text-center text-xs leading-relaxed text-muted-foreground">
      <HugeiconsIcon
        icon={BrowserIcon}
        strokeWidth={1.5}
        aria-hidden
        className="mt-0.5 size-4 shrink-0"
      />
      <span>{t('atoms.noAccount')}</span>
    </p>
  )
}
