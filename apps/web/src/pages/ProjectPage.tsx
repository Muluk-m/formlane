import { slugify } from '@atoms-demo/core/html'
import type { AgentId, AppVersion, ChatMessage, Project } from '@atoms-demo/core/types'
import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atoms-demo/ui/components/dialog'
import { Input } from '@atoms-demo/ui/components/input'
import { ExternalLink } from '@atoms-demo/ui/components/link'
import { Spinner } from '@atoms-demo/ui/components/spinner'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'
import { ChatPane } from '../components/ChatPane'
import { Stage } from '../components/Stage'
import {
  cancelProjectMutation,
  publishProjectMutation,
  remixProjectMutation,
  restoreVersionMutation,
  unpublishProjectMutation,
} from '../features/projects/mutations'
import { projectQuery, projectsQuery, versionQuery } from '../features/projects/queries'
import { healthQuery as healthQueryOptions } from '../features/session/queries'
import { downloadProject, streamEvents } from '../lib/api'
import { relativeTime } from '../lib/format'

type UiMessage = ChatMessage & { pending?: boolean }

export function ProjectPage() {
  const { id } = useParams({ from: '/project/$id' })
  const { autostart } = useSearch({ from: '/project/$id' })
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const detailQuery = useQuery(projectQuery(id))
  const healthQuery = useQuery(healthQueryOptions)
  const cancelMutation = useMutation(cancelProjectMutation)
  const restoreMutation = useMutation(restoreVersionMutation)
  const publishMutation = useMutation(publishProjectMutation)
  const unpublishMutation = useMutation(unpublishProjectMutation)
  const remixMutation = useMutation(remixProjectMutation)
  const [project, setProject] = useState<Project | null>(null)
  const [messages, setMessages] = useState<UiMessage[]>([])
  const [versions, setVersions] = useState<AppVersion[]>([])
  const [html, setHtml] = useState('')
  const [code, setCode] = useState('')
  const [banner, setBanner] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState<AgentId | null>(null)
  const [pipeline, setPipeline] = useState<AgentId[]>([])
  const [done, setDone] = useState<AgentId[]>([])
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewing, setViewing] = useState<(AppVersion & { html: string }) | null>(null)
  const [share, setShare] = useState<{ slug: string; url: string; versionId: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const health = healthQuery.data
  const [split, setSplit] = useState(() => Number(localStorage.getItem('atoms-split')) || 420)
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 860px)').matches)
  const abortRef = useRef<AbortController | null>(null)
  const startedRef = useRef(false)

  async function refresh() {
    const detail = await client.fetchQuery({ ...projectQuery(id), staleTime: 0 })
    setProject(detail.project)
    setMessages(detail.messages)
    setVersions(detail.versions)
    setHtml(detail.html ?? '')
    setCode(detail.html ?? '')
    await client.invalidateQueries({ queryKey: projectsQuery.queryKey })
    return detail
  }

  useEffect(() => {
    const detail = detailQuery.data
    if (!detail || running) return
    setProject(detail.project)
    setMessages(detail.messages)
    setVersions(detail.versions)
    setHtml(detail.html ?? '')
    setCode(detail.html ?? '')
  }, [detailQuery.data, running])

  useEffect(() => {
    const media = window.matchMedia('(min-width: 860px)')
    const apply = () => setWide(media.matches)
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  async function run(path: string, body?: unknown) {
    const controller = new AbortController()
    abortRef.current = controller
    setRunning(true)
    setBanner(null)
    setActive(null)
    setDone([])
    setViewing(null)
    const agentsByMessage = new Map<string, AgentId | null>()
    try {
      await streamEvents(path, body ?? {}, controller.signal, (event, data) => {
        if (event === 'pipeline') {
          setPipeline((data.agents as AgentId[]) ?? [])
          setDone([])
        } else if (event === 'status' && typeof data.agent === 'string') {
          setActive(data.agent as AgentId)
        } else if (event === 'message_start') {
          const messageId = String(data.id)
          const agent = (data.agent as AgentId | null) ?? null
          agentsByMessage.set(messageId, agent)
          setMessages((current) => [
            ...current,
            {
              id: messageId,
              role: data.role === 'system' ? 'system' : 'agent',
              agent,
              content: '',
              createdAt: Date.now(),
              pending: true,
            },
          ])
        } else if (event === 'token') {
          const messageId = String(data.id)
          const text = String(data.text ?? '')
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId ? { ...message, content: message.content + text } : message,
            ),
          )
        } else if (event === 'message_replace' || event === 'message_done') {
          const messageId = String(data.id)
          const content = String(data.content ?? '')
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId
                ? {
                    ...message,
                    content,
                    pending: event === 'message_done' ? false : message.pending,
                  }
                : message,
            ),
          )
          if (event === 'message_done') {
            const agent = agentsByMessage.get(messageId)
            if (agent) setDone((agents) => (agents.includes(agent) ? agents : [...agents, agent]))
          }
        } else if (event === 'code_start') {
          setCode('')
        } else if (event === 'code_reset') {
          setCode(String(data.text ?? ''))
        } else if (event === 'code') {
          setCode((current) => current + String(data.text ?? ''))
        } else if (event === 'preview' && typeof data.html === 'string') {
          setViewing(null)
          setHtml(data.html)
        } else if (event === 'version') {
          const version: AppVersion & { html?: string } = {
            id: String(data.id),
            number: Number(data.number),
            prompt: String(data.prompt ?? ''),
            createdAt: Number(data.createdAt),
            html: typeof data.html === 'string' ? data.html : undefined,
          }
          if (version.html) {
            setHtml(version.html)
            setCode(version.html)
          }
          setVersions((current) =>
            current.some((item) => item.id === version.id) ? current : [...current, version],
          )
          setProject((current) =>
            current
              ? { ...current, currentVersionId: version.id, status: 'idle', error: null }
              : current,
          )
          setViewing(null)
        } else if (event === 'title' && typeof data.title === 'string') {
          setProject((current) => (current ? { ...current, title: data.title as string } : current))
          document.title = `${data.title} · ${t('brand.name')}`
        } else if (event === 'error') {
          setBanner(String(data.message ?? t('atoms.streamError')))
        }
      })
      await refresh()
    } catch (reason) {
      const aborted = reason instanceof DOMException && reason.name === 'AbortError'
      if (aborted) {
        await cancelMutation.mutateAsync({ id }).catch(() => undefined)
        await refresh().catch(() => undefined)
      } else {
        setBanner(reason instanceof Error ? reason.message : t('atoms.streamError'))
        await refresh().catch(() => undefined)
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null
      setRunning(false)
      setActive(null)
    }
  }

  function runGenerate() {
    return run(`/api/projects/${id}/generate`)
  }

  const startAutomatically = useEffectEvent(() => {
    void navigate({ to: '/project/$id', params: { id }, search: {}, replace: true })
    void runGenerate()
  })

  useEffect(() => {
    if (!project || startedRef.current) return
    if (!autostart) return
    const key = `atoms-autostart-${id}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    startedRef.current = true
    startAutomatically()
  }, [project, id, autostart])

  function onDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!wide) return
    event.preventDefault()
    const startX = event.clientX
    const startW = split
    const previous = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const move = (ev: PointerEvent) => {
      const next = Math.min(680, Math.max(320, startW + ev.clientX - startX))
      setSplit(next)
      localStorage.setItem('atoms-split', String(next))
    }
    const up = () => {
      document.body.style.userSelect = previous
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  async function send(text: string) {
    const optimistic: UiMessage = {
      id: `tmp-${crypto.randomUUID()}`,
      role: 'user',
      agent: null,
      content: text,
      createdAt: Date.now(),
    }
    setMessages((current) => [...current, optimistic])
    await run(`/api/projects/${id}/chat`, { content: text })
  }

  async function openVersion(versionId: string) {
    const { version } = await client.fetchQuery(versionQuery(id, versionId))
    setViewing(version)
    setTab('preview')
  }

  async function restore(versionId: string) {
    const result = await restoreMutation.mutateAsync({ id, versionId })
    setHtml(result.html)
    setCode(result.html)
    setViewing(null)
    await refresh()
  }

  async function publish() {
    const result = await publishMutation.mutateAsync({ id })
    setShare(result)
    setProject((current) =>
      current
        ? { ...current, publishedSlug: result.slug, publishedVersionId: result.versionId }
        : current,
    )
    setCopied(false)
    await client.invalidateQueries({ queryKey: projectsQuery.queryKey })
  }

  async function unpublish() {
    await unpublishMutation.mutateAsync({ id })
    setProject((current) =>
      current ? { ...current, publishedSlug: null, publishedVersionId: null } : current,
    )
    setShare(null)
    await client.invalidateQueries({ queryKey: projectsQuery.queryKey })
  }

  async function remix() {
    const { project: copy } = await remixMutation.mutateAsync({ id })
    await client.invalidateQueries({ queryKey: projectsQuery.queryKey })
    await navigate({ to: '/project/$id', params: { id: copy.id } })
  }

  async function act(action: () => Promise<unknown>) {
    setBanner(null)
    try {
      await action()
    } catch (error) {
      setBanner(error instanceof Error ? error.message : t('atoms.requestError'))
    }
  }

  if (detailQuery.isPending)
    return (
      <div
        role="status"
        className="flex min-h-[60vh] items-center justify-center gap-2 text-muted-foreground"
      >
        <Spinner />
        {t('atoms.loading')}
      </div>
    )
  if (detailQuery.error || !project)
    return (
      <main className="grid min-h-[60vh] place-items-center p-6">
        <div>
          <h1 className="text-display">{detailQuery.error?.message ?? t('atoms.notFound')}</h1>
          <Button nativeButton={false} className="mt-4" render={<Link to="/" />}>
            {t('atoms.home')}
          </Button>
        </div>
      </main>
    )

  const displayHtml = viewing?.html ?? html
  const displayCode = viewing?.html ?? code
  const publishedCurrent = Boolean(
    project.publishedSlug && project.publishedVersionId === project.currentVersionId,
  )
  const publishLabel = !project.publishedSlug
    ? t('atoms.publish')
    : publishedCurrent
      ? t('atoms.published')
      : t('atoms.updateLive')
  const interrupted = project.status === 'generating' && !running
  const busy =
    restoreMutation.isPending ||
    publishMutation.isPending ||
    unpublishMutation.isPending ||
    remixMutation.isPending
  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-[36rem] flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b p-3">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold">{project.title}</h1>
          <p className="truncate text-xs text-muted-foreground">
            {t('atoms.versionCount', { count: versions.length })}
            {health?.mock
              ? ` · ${t('atoms.mockPill')}`
              : health
                ? ` · ${t('atoms.livePill')} ${health.model}`
                : ''}
          </p>
        </div>
        {(busy || cancelMutation.isPending) && <Spinner />}
        <div className="flex flex-wrap gap-1.5">
          <Button
            variant="outline"
            data-testid="history-button"
            onClick={() => setHistoryOpen(true)}
          >
            {t('atoms.history')}
          </Button>
          <Button
            variant="outline"
            data-testid="remix-button"
            disabled={busy || running}
            onClick={() => void act(remix)}
          >
            {t('atoms.remix')}
          </Button>
          <Button
            variant="outline"
            data-testid="download-button"
            disabled={!project.currentVersionId}
            onClick={() =>
              void act(() =>
                downloadProject(
                  id,
                  `${slugify(project.title)}-v${viewing?.number ?? versions.find((version) => version.id === project.currentVersionId)?.number ?? 1}.html`,
                  viewing?.id,
                ),
              )
            }
          >
            {t('atoms.download')}
          </Button>
          <Button
            data-testid="publish-button"
            disabled={!project.currentVersionId || running || busy}
            onClick={() => void act(publish)}
          >
            {publishLabel}
          </Button>
        </div>
      </header>
      {(banner || project.error || interrupted) && !running && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 border-b bg-danger-bg px-4 py-2 text-sm"
        >
          <p>{banner || project.error || t('atoms.interrupted')}</p>
          {!html && (
            <Button variant="outline" onClick={() => void runGenerate()} data-testid="retry-button">
              {interrupted ? t('atoms.takeOver') : t('atoms.retry')}
            </Button>
          )}
          {interrupted && html && (
            <Button
              variant="outline"
              onClick={() =>
                void act(async () => {
                  await cancelMutation.mutateAsync({ id })
                  await refresh()
                })
              }
            >
              {t('atoms.takeOver')}
            </Button>
          )}
        </div>
      )}
      <div className="flex min-h-0 flex-1" style={{ flexDirection: wide ? 'row' : 'column' }}>
        <div
          className="min-h-0 shrink-0"
          style={wide ? { width: split, maxWidth: '60%' } : { height: '48%' }}
        >
          <ChatPane
            messages={messages}
            running={running}
            active={active}
            pipeline={pipeline}
            done={done}
            onSend={(text) => void send(text)}
            onStop={() => abortRef.current?.abort()}
          />
        </div>
        {wide && (
          <Button
            variant="ghost"
            className="splitter h-auto rounded-none p-0"
            role="separator"
            aria-label={t('atoms.resize')}
            aria-orientation="vertical"
            aria-valuemin={320}
            aria-valuemax={680}
            aria-valuenow={split}
            onPointerDown={onDrag}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
              event.preventDefault()
              const next = Math.min(
                680,
                Math.max(320, split + (event.key === 'ArrowRight' ? 20 : -20)),
              )
              setSplit(next)
              localStorage.setItem('atoms-split', String(next))
            }}
          />
        )}
        <Stage
          html={displayHtml}
          code={displayCode}
          tab={tab}
          device={device}
          running={running}
          staleLabel={
            viewing
              ? `${t('atoms.viewing')} · ${t('atoms.versionLabel', { number: viewing.number })}`
              : null
          }
          onTab={setTab}
          onDevice={setDevice}
          onBack={() => setViewing(null)}
        />
      </div>
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent
          showCloseButton={false}
          className="max-h-[85dvh] overflow-y-auto"
          data-testid="version-drawer"
        >
          <DialogHeader>
            <DialogTitle>{t('atoms.history')}</DialogTitle>
            <DialogDescription>{t('atoms.historyNote')}</DialogDescription>
          </DialogHeader>
          <ul className="flex flex-col gap-2">
            {versions.length === 0 && (
              <li className="text-sm text-muted-foreground">{t('atoms.emptyCode')}</li>
            )}
            {[...versions].reverse().map((version) => (
              <li key={version.id} className="rounded-lg border p-3">
                <Button
                  variant="ghost"
                  className="h-auto w-full flex-col items-start whitespace-normal text-left"
                  onClick={() =>
                    void act(async () => {
                      await openVersion(version.id)
                      setHistoryOpen(false)
                    })
                  }
                >
                  <span className="font-semibold">
                    {t('atoms.versionLabel', { number: version.number })}
                    {version.id === project.currentVersionId && (
                      <span className="ml-2 text-xs text-link">{t('atoms.current')}</span>
                    )}
                  </span>
                  <span className="text-sm text-muted-foreground">{version.prompt}</span>
                  <span className="text-xs text-muted-foreground">
                    {relativeTime(version.createdAt, locale)}
                  </span>
                </Button>
                {version.id !== project.currentVersionId && (
                  <Button
                    variant="outline"
                    className="mt-2"
                    disabled={running || busy}
                    data-testid={`restore-${version.number}`}
                    onClick={() =>
                      void act(async () => {
                        await restore(version.id)
                        setHistoryOpen(false)
                      })
                    }
                  >
                    {t('atoms.restore')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setHistoryOpen(false)}>
              {t('atoms.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={Boolean(share)}
        onOpenChange={(open) => {
          if (!open) setShare(null)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('atoms.published')}</DialogTitle>
            <DialogDescription>{t('atoms.liveNote')}</DialogDescription>
          </DialogHeader>
          <Input
            readOnly
            aria-label={t('atoms.copyLink')}
            data-testid="share-url"
            value={share?.url ?? ''}
            onFocus={(event) => event.currentTarget.select()}
          />
          <DialogFooter className="flex-wrap">
            <Button
              onClick={() =>
                void act(async () => {
                  if (share) {
                    await navigator.clipboard.writeText(share.url)
                    setCopied(true)
                  }
                })
              }
            >
              {copied ? t('atoms.copied') : t('atoms.copyLink')}
            </Button>
            {share && (
              <Button
                variant="outline"
                nativeButton={false}
                render={<ExternalLink href={share.url} showIcon={false} />}
              >
                {t('atoms.preview')}
              </Button>
            )}
            <Button variant="outline" disabled={busy} onClick={() => void act(unpublish)}>
              {t('atoms.unpublish')}
            </Button>
            <Button variant="ghost" onClick={() => setShare(null)}>
              {t('atoms.close')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
