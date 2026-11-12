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
import { Spinner } from '@atoms-demo/ui/components/spinner'
import {
  AssistantHomeBrowserNote,
  AssistantHomeIntro,
  AssistantHomeProjectCard,
  AssistantHomeProjectsHeading,
  AssistantHomeProjectsState,
  AssistantHomeSuggestions,
} from '@atoms-demo/ui/composites/assistant-home'
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
      try {
        await create.mutateAsync({ idea: parsed.data })
      } catch (error) {
        throw new MessageNotSentError(
          error instanceof Error ? error.message : t('atoms.requestError'),
        )
      }
    },
  })
  const error = create.error ?? projects.error ?? health.error
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <main className="mx-auto max-w-6xl px-4 pt-8 pb-8 sm:px-8 sm:pt-12 sm:pb-12">
        <ThreadPrimitive.Root className="mx-auto max-w-3xl">
          <AssistantHomeIntro />
          {health.data && !health.data.mock && !health.data.hasKey && (
            <p role="status" className="mt-6 rounded-lg border bg-card p-3">
              {t('atoms.noKey')}
            </p>
          )}
          {health.data?.mock && (
            <Badge variant="secondary" className="mt-6">
              {t('atoms.mockPill')}
            </Badge>
          )}
          <div className="mt-7 sm:mt-8">
            <AssistantComposer mode="idea" disabled={create.isPending} />
          </div>
          {error && (
            <p role="alert" className="mt-3 text-sm text-destructive">
              {error.message || t('atoms.requestError')}
            </p>
          )}
          <div className="mt-5">
            <AssistantHomeSuggestions disabled={create.isPending} />
          </div>
        </ThreadPrimitive.Root>
        <section id="projects" className="mx-auto mt-12 max-w-5xl sm:mt-16">
          <AssistantHomeProjectsHeading />
          {projects.isPending && (
            <div className="mt-5">
              <AssistantHomeProjectsState loading />
            </div>
          )}
          {projects.data?.projects.length === 0 && (
            <div className="mt-5">
              <AssistantHomeProjectsState />
            </div>
          )}
          <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {projects.data?.projects.map((project) => (
              <AssistantHomeProjectCard
                key={project.id}
                title={project.title}
                idea={project.idea}
                status={project.status}
                hasSavedVersion={Boolean(project.currentVersionId)}
                published={Boolean(project.publishedSlug)}
                versionLabel={
                  project.versionCount === undefined
                    ? undefined
                    : t('atoms.versionCount', { count: project.versionCount })
                }
                updatedAt={project.updatedAt}
                updatedLabel={relativeTime(project.updatedAt, locale)}
                link={
                  <Link to="/project/$id" params={{ id: project.id }} data-testid="project-link" />
                }
                onDelete={() => {
                  remove.reset()
                  setDeleting(project)
                }}
              />
            ))}
          </div>
        </section>
        <div className="mx-auto mt-8 max-w-2xl sm:mt-10">
          <AssistantHomeBrowserNote />
        </div>
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
