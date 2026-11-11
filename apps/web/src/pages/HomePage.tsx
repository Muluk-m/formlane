import {
  AssistantRuntimeProvider,
  MessageNotSentError,
  type ThreadMessage,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react'
import type { Project } from '@atoms-demo/core/types'
import { useI18n } from '@atoms-demo/i18n/react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@atoms-demo/ui/components/alert-dialog'
import { Badge } from '@atoms-demo/ui/components/badge'
import { Button } from '@atoms-demo/ui/components/button'
import { Card, CardContent } from '@atoms-demo/ui/components/card'
import { Spinner } from '@atoms-demo/ui/components/spinner'
import { AssistantComposer } from '@atoms-demo/ui/composites/assistant-thread'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { z } from 'zod'
import { createProjectMutation, deleteProjectMutation } from '../features/projects/mutations'
import { projectsQuery } from '../features/projects/queries'
import { healthQuery } from '../features/session/queries'
import { relativeTime } from '../lib/format'

export function HomePage() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const client = useQueryClient()
  const [deleting, setDeleting] = useState<Project | null>(null)
  const projects = useQuery(projectsQuery)
  const health = useQuery(healthQuery)
  const create = useMutation({
    ...createProjectMutation,
    onSuccess: async ({ project }) => {
      await client.invalidateQueries({ queryKey: projectsQuery.queryKey })
      await navigate({
        to: '/project/$id',
        params: { id: project.id },
        search: { autostart: true },
      })
    },
  })
  const remove = useMutation({
    ...deleteProjectMutation,
    onSuccess: async () => {
      setDeleting(null)
      await client.invalidateQueries({ queryKey: projectsQuery.queryKey })
    },
  })
  const schema = z.string().trim().min(1, t('atoms.ideaRequired')).max(4000, t('atoms.ideaLength'))
  const runtime = useExternalStoreRuntime<ThreadMessage>({
    messages: [],
    isDisabled: create.isPending,
    onNew: async (message) => {
      const text = message.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n')
      const parsed = schema.safeParse(text)
      if (!parsed.success || create.isPending) {
        throw new MessageNotSentError(
          parsed.success
            ? t('atoms.building')
            : (parsed.error.issues[0]?.message ?? t('atoms.ideaRequired')),
        )
      }
      await create.mutateAsync({ idea: parsed.data })
    },
  })
  const error = create.error ?? projects.error ?? health.error
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-8 sm:py-16">
        <ThreadPrimitive.Root className="mx-auto max-w-3xl">
          <p className="text-xs font-medium tracking-widest text-link">{t('atoms.kicker')}</p>
          <h1 className="mt-3 max-w-3xl text-display">{t('atoms.hero')}</h1>
          <p className="mt-4 max-w-2xl text-base text-muted-foreground">{t('atoms.sub')}</p>
          {health.data && !health.data.mock && !health.data.hasKey && (
            <p role="status" className="mt-4 rounded-lg border bg-card p-3">
              {t('atoms.noKey')}
            </p>
          )}
          {health.data?.mock && (
            <Badge variant="secondary" className="mt-4">
              {t('atoms.mockPill')}
            </Badge>
          )}
          <div className="mt-8">
            <AssistantComposer mode="idea" disabled={create.isPending} />
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error.message || t('atoms.requestError')}
            </p>
          )}
          <section className="mt-5">
            <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('atoms.examples')}
            </h2>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(['one', 'two', 'three', 'four'] as const).map((key, index) => (
                <ThreadPrimitive.Suggestion
                  key={key}
                  prompt={t(`atoms.examplesList.${key}.prompt`)}
                  send={false}
                  disabled={create.isPending}
                  data-testid={`example-${index}`}
                  render={
                    <Button
                      variant="outline"
                      className="h-auto flex-col items-start whitespace-normal p-4 text-left"
                    />
                  }
                >
                  <span className="font-semibold">{t(`atoms.examplesList.${key}.title`)}</span>
                  <span className="text-sm font-normal text-muted-foreground">
                    {t(`atoms.examplesList.${key}.prompt`)}
                  </span>
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </section>
        </ThreadPrimitive.Root>
        <section id="projects" className="mt-10">
          <h2 className="text-xl font-semibold">{t('atoms.projects')}</h2>
          {projects.isPending && (
            <p role="status" className="mt-3 flex items-center gap-2 text-muted-foreground">
              <Spinner />
              {t('ui.spinner.loading')}
            </p>
          )}
          {projects.data?.projects.length === 0 && (
            <p className="mt-3 text-muted-foreground">{t('atoms.empty')}</p>
          )}
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {projects.data?.projects.map((project) => (
              <Card key={project.id}>
                <CardContent>
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <Button
                        variant="link"
                        nativeButton={false}
                        className="h-auto whitespace-normal p-0 text-left text-lg font-semibold"
                        render={
                          <Link
                            to="/project/$id"
                            params={{ id: project.id }}
                            data-testid="project-link"
                          />
                        }
                      >
                        {project.title}
                      </Button>
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {project.idea}
                      </p>
                    </div>
                    {project.publishedSlug && (
                      <Badge variant="secondary">{t('atoms.published')}</Badge>
                    )}
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {t('atoms.versionCount', { count: project.versionCount ?? 0 })} ·{' '}
                      {relativeTime(project.updatedAt, locale)}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => {
                        remove.reset()
                        setDeleting(project)
                      }}
                    >
                      {t('atoms.delete')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
        <p className="mt-10 text-sm text-muted-foreground">{t('atoms.noAccount')}</p>
        <AlertDialog
          open={Boolean(deleting)}
          onOpenChange={(open) => {
            if (!open && !remove.isPending) setDeleting(null)
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t('atoms.deleteTitle')}</AlertDialogTitle>
              <AlertDialogDescription>
                {t('atoms.deleteConfirm', { title: deleting?.title ?? '' })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {remove.error && (
              <p role="alert" className="text-sm text-destructive">
                {remove.error.message}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={remove.isPending}>
                {t('common.cancel')}
              </AlertDialogCancel>
              <AlertDialogAction
                variant="destructive"
                disabled={remove.isPending}
                onClick={() => deleting && remove.mutate({ id: deleting.id })}
              >
                {remove.isPending && <Spinner />}
                {t('atoms.delete')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </main>
    </AssistantRuntimeProvider>
  )
}
