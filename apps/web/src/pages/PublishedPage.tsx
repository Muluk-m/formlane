import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import { Spinner } from '@atoms-demo/ui/components/spinner'
import { useQuery } from '@tanstack/react-query'

type PublishedState =
  | { status: 'loading' | 'missing' | 'error' }
  | { status: 'ready'; html: string }

export function PublishedPage({ slug }: { slug: string }) {
  const { t } = useI18n()
  const query = useQuery({
    queryKey: ['published-app', slug],
    retry: false,
    gcTime: 0,
    queryFn: async ({ signal }): Promise<PublishedState> => {
      const response = await fetch(
        new URL(`/p/${encodeURIComponent(slug)}`, import.meta.env.VITE_API_ORIGIN),
        {
          credentials: 'omit',
          cache: 'no-store',
          referrerPolicy: 'no-referrer',
          signal,
          headers: { Accept: 'text/html' },
        },
      )
      if (response.status === 404 || response.status === 410) return { status: 'missing' }
      if (!response.ok) throw new Error('Published app request failed')
      return { status: 'ready', html: await response.text() }
    },
  })
  const state: PublishedState = query.isFetching
    ? { status: 'loading' }
    : query.isError
      ? { status: 'error' }
      : (query.data ?? { status: 'loading' })

  if (state.status === 'ready') {
    return (
      <main className="fixed inset-0 bg-background">
        <iframe
          title={t('atoms.publicViewer.title')}
          className="block h-full w-full border-0"
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
          srcDoc={state.html}
        />
      </main>
    )
  }

  return (
    <main className="grid min-h-dvh place-items-center bg-background p-6">
      {state.status === 'loading' ? (
        <div role="status" className="flex items-center gap-2 text-muted-foreground">
          <Spinner aria-hidden="true" />
          {t('atoms.publicViewer.loading')}
        </div>
      ) : (
        <div role="alert" className="max-w-md text-center">
          <h1 className="text-display">
            {t(
              state.status === 'missing'
                ? 'atoms.publicViewer.unavailable'
                : 'atoms.publicViewer.loadFailed',
            )}
          </h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {t(
              state.status === 'missing'
                ? 'atoms.publicViewer.unavailableDescription'
                : 'atoms.publicViewer.loadFailedDescription',
            )}
          </p>
          {state.status === 'error' && (
            <Button className="mt-4" onClick={() => void query.refetch()}>
              {t('atoms.publicViewer.retry')}
            </Button>
          )}
        </div>
      )}
    </main>
  )
}
