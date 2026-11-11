import {
  type RunEvent as HarnessEvent,
  type Run as HarnessRun,
  runSchema,
} from '@atoms-demo/contracts'
import { slugify } from '@atoms-demo/core/html'
import type { ProjectSource } from '@atoms-demo/core/project'
import type { AppVersion, Project } from '@atoms-demo/core/types'
import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import { ButtonGroup } from '@atoms-demo/ui/components/button-group'
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
  useMemo,
  useRef,
  useState,
} from 'react'
import { ChatPane } from '../components/ChatPane'
import { Stage } from '../components/Stage'
import type { ConversationMessage } from '../features/assistant/messages'
import {
  publishProjectMutation,
  remixProjectMutation,
  restoreVersionMutation,
  unpublishProjectMutation,
} from '../features/projects/mutations'
import { projectQuery, projectsQuery, versionQuery } from '../features/projects/queries'
import { projectWorkspace, reduceProjectEvent } from '../features/projects/workspace'
import { healthQuery as healthQueryOptions } from '../features/session/queries'
import {
  cancelRun,
  downloadProject,
  latestRun,
  RunConnectionError,
  startRun,
  streamRunEvents,
} from '../lib/api'
import { relativeTime } from '../lib/format'

function isActiveRun(run: HarnessRun | null) {
  return run?.status === 'queued' || run?.status === 'running'
}

export function ProjectPage() {
  const { id } = useParams({ from: '/project/$id' })
  const { autostart } = useSearch({ from: '/project/$id' })
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const client = useQueryClient()
  const detailQuery = useQuery(projectQuery(id))
  const healthQuery = useQuery(healthQueryOptions)
  const restoreMutation = useMutation(restoreVersionMutation)
  const publishMutation = useMutation(publishProjectMutation)
  const unpublishMutation = useMutation(unpublishProjectMutation)
  const remixMutation = useMutation(remixProjectMutation)
  const [project, setProject] = useState<Project | null>(null)
  const [messages, setMessages] = useState<ConversationMessage[]>([])
  const [versions, setVersions] = useState<AppVersion[]>([])
  const [html, setHtml] = useState('')
  const [source, setSource] = useState<ProjectSource | null>(null)
  const [workspace, setWorkspace] = useState(() => projectWorkspace(null))
  const [banner, setBanner] = useState<string | null>(null)
  const [run, setRun] = useState<HarnessRun | null>(null)
  const [starting, setStarting] = useState(false)
  const [loadingRun, setLoadingRun] = useState(true)
  const [stopping, setStopping] = useState(false)
  const [reconciling, setReconciling] = useState(false)
  const [connection, setConnection] = useState<'connected' | 'reconnecting' | 'error'>('connected')
  const [reconnect, setReconnect] = useState(0)
  const [activity, setActivity] = useState<HarnessEvent[]>([])
  const [activeAgents, setActiveAgents] = useState<Record<string, string>>({})
  const running = isActiveRun(run)
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'preview'>('chat')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [viewing, setViewing] = useState<
    (AppVersion & { html: string; source: ProjectSource }) | null
  >(null)
  const [share, setShare] = useState<{ slug: string; url: string; versionId: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const health = healthQuery.data
  const [split, setSplit] = useState(() => Number(localStorage.getItem('atoms-split')) || 420)
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 860px)').matches)
  const startPending = useRef(false)
  const cursorRef = useRef({ runId: '', sequence: 0 })
  const mounted = useRef(true)
  const retryRequest = useRef<string | undefined>(undefined)
  const reconciliationPending = useRef(false)
  const subscription = useRef<AbortController | null>(null)

  async function refresh(fence?: { runId: string; signal: AbortSignal }, resetWorkspace = true) {
    const detail = await client.fetchQuery({ ...projectQuery(id), staleTime: 0 })
    if (
      !mounted.current ||
      (fence &&
        (fence.signal.aborted ||
          subscription.current?.signal !== fence.signal ||
          cursorRef.current.runId !== fence.runId))
    )
      return false
    setProject(detail.project)
    setMessages(detail.messages)
    setVersions(detail.versions)
    setHtml(detail.html ?? '')
    setSource(detail.source)
    if (resetWorkspace)
      setWorkspace((current) => ({ ...projectWorkspace(detail.source), build: current.build }))
    await client.invalidateQueries({ queryKey: projectsQuery.queryKey })
    return true
  }

  useEffect(() => {
    const detail = detailQuery.data
    if (!detail || running || starting || reconciling || reconciliationPending.current) return
    setProject(detail.project)
    setMessages(detail.messages)
    setVersions(detail.versions)
    setHtml(detail.html ?? '')
    setSource(detail.source)
    if (!run) setWorkspace(projectWorkspace(detail.source))
  }, [detailQuery.data, running, starting, reconciling, run])

  useEffect(() => {
    const media = window.matchMedia('(min-width: 860px)')
    const apply = () => setWide(media.matches)
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  async function begin(content?: string) {
    if (startPending.current || running || reconciliationPending.current) return
    startPending.current = true
    retryRequest.current = content
    setStarting(true)
    setBanner(null)
    setViewing(null)
    try {
      const receipt = await startRun(id, !project?.currentVersionId, content)
      if (!mounted.current) return
      setActivity([])
      setActiveAgents({})
      setWorkspace(projectWorkspace(source))
      setRun(receipt)
      if (content)
        setMessages((current) => [
          ...current,
          {
            id: `request-${receipt.id}`,
            role: 'user',
            agent: null,
            content,
            createdAt: receipt.createdAt,
          },
        ])
      setConnection('connected')
    } catch (error) {
      if (!mounted.current) return
      setBanner(error instanceof Error ? error.message : t('atoms.requestError'))
      // A lost start receipt must attach to the accepted run, not submit it again.
      try {
        const accepted = await latestRun(id)
        if (mounted.current && accepted && (isActiveRun(accepted) || accepted.id !== run?.id))
          setRun(accepted)
      } catch {
        /* Keep the actionable request error. */
      }
    } finally {
      startPending.current = false
      if (mounted.current) setStarting(false)
    }
  }

  const initialize = useEffectEvent(async (signal: AbortSignal) => {
    try {
      const existing = await latestRun(id, signal)
      if (signal.aborted) return
      setRun(existing)
      setLoadingRun(false)
      if (autostart) {
        void navigate({ to: '/project/$id', params: { id }, search: {}, replace: true })
        if (!existing && !detailQuery.data?.project.currentVersionId) await begin()
      }
    } catch (error) {
      if (signal.aborted) return
      setLoadingRun(false)
      setConnection('error')
      setBanner(error instanceof Error ? error.message : t('atoms.requestError'))
    }
  })

  const detailReady = Boolean(detailQuery.data)
  useEffect(() => {
    if (!detailReady) return
    const controller = new AbortController()
    void initialize(controller.signal)
    return () => controller.abort()
  }, [detailReady])

  const receive = useEffectEvent((event: HarnessEvent, signal: AbortSignal) => {
    const data = event.data
    if (event.type === 'run_state') {
      const state = runSchema.parse(data)
      setRun((current) =>
        current?.id === state.id && !isActiveRun(current) && isActiveRun(state) ? current : state,
      )
      if (!isActiveRun(state)) {
        reconciliationPending.current = true
        setReconciling(true)
        setActiveAgents({})
        setStopping(false)
        setWorkspace((current) => ({ ...current, activePath: null }))
        void refresh({ runId: state.id, signal }, state.status === 'completed')
          .then((applied) => {
            if (!applied || signal.aborted || subscription.current?.signal !== signal) return
            reconciliationPending.current = false
            setReconciling(false)
          })
          .catch((error: unknown) => {
            if (!mounted.current || signal.aborted || subscription.current?.signal !== signal)
              return
            setConnection('error')
            setBanner(error instanceof Error ? error.message : t('atoms.loadError'))
          })
      }
    } else if (event.type === 'agent_start') {
      setActiveAgents((current) => ({ ...current, [String(data.id)]: String(data.name) }))
    } else if (event.type === 'agent_end') {
      setActiveAgents((current) => {
        const next = { ...current }
        delete next[String(data.id)]
        return next
      })
    } else if (event.type === 'message_start') {
      const message: ConversationMessage = {
        id: String(data.id),
        role: data.role === 'system' ? 'system' : data.role === 'user' ? 'user' : 'agent',
        agent: typeof data.agent === 'string' ? data.agent : null,
        content: typeof data.content === 'string' ? data.content : '',
        createdAt: event.createdAt,
        pending: true,
      }
      setMessages((current) => [...current.filter((item) => item.id !== message.id), message])
    } else if (event.type === 'token') {
      setMessages((current) =>
        current.map((message) =>
          message.id === data.id
            ? { ...message, content: message.content + String(data.text ?? '') }
            : message,
        ),
      )
    } else if (event.type === 'message_replace' || event.type === 'message_done') {
      setMessages((current) =>
        current.map((message) =>
          message.id === data.id
            ? {
                ...message,
                content: String(data.content ?? ''),
                pending: event.type !== 'message_done',
              }
            : message,
        ),
      )
    } else if (
      [
        'project_reset',
        'project_initialized',
        'file_start',
        'file_delta',
        'file_saved',
        'file_deleted',
        'build_result',
      ].includes(event.type)
    ) {
      setWorkspace((current) => reduceProjectEvent(current, event))
    } else if (event.type === 'version') {
      const version: AppVersion = {
        id: String(data.id),
        number: Number(data.number),
        prompt: String(data.prompt ?? ''),
        createdAt: Number(data.createdAt),
      }
      setVersions((current) =>
        current.some((item) => item.id === version.id) ? current : [...current, version],
      )
      setViewing(null)
    } else if (event.type === 'title' && typeof data.title === 'string') {
      const title = data.title
      setProject((current) => (current ? { ...current, title } : current))
      document.title = `${title} · ${t('brand.name')}`
    } else if (event.type === 'error') {
      setBanner(String(data.message ?? t('atoms.streamError')))
    }
    if (
      [
        'tool_start',
        'tool_end',
        'validation',
        'build_result',
        'repair',
        'agent_start',
        'agent_end',
        'reasoning_summary',
      ].includes(event.type)
    ) {
      setActivity((current) => [...current, event])
    }
  })

  const observation = useMemo(() => ({ runId: run?.id, reconnect }), [run?.id, reconnect])
  const hasReplayedTerminal = useEffectEvent(
    () => !isActiveRun(run) && cursorRef.current.sequence >= (run?.cursor ?? 0),
  )

  useEffect(() => {
    const { runId } = observation
    if (!runId) return
    const controller = new AbortController()
    subscription.current = controller
    if (cursorRef.current.runId !== runId) cursorRef.current = { runId, sequence: 0 }
    let terminal = hasReplayedTerminal()
    let delay = 500
    const observe = async () => {
      while (!controller.signal.aborted && !terminal) {
        try {
          await streamRunEvents(
            id,
            runId,
            cursorRef.current.sequence,
            controller.signal,
            (event) => {
              if (
                controller.signal.aborted ||
                subscription.current !== controller ||
                event.runId !== runId ||
                event.sequence <= cursorRef.current.sequence
              )
                return
              setConnection('connected')
              receive(event, controller.signal)
              cursorRef.current.sequence = event.sequence
              if (event.type === 'run_state') terminal = !isActiveRun(runSchema.parse(event.data))
              delay = 500
            },
          )
        } catch (error) {
          if (controller.signal.aborted) return
          if (error instanceof RunConnectionError && [401, 403, 404].includes(error.status)) {
            setConnection('error')
            setBanner(error.message)
            return
          }
        }
        if (terminal || controller.signal.aborted) return
        setConnection('reconnecting')
        const { promise, resolve } = Promise.withResolvers<void>()
        const finish = () => {
          window.clearTimeout(timer)
          controller.signal.removeEventListener('abort', finish)
          resolve()
        }
        const timer = window.setTimeout(finish, delay)
        controller.signal.addEventListener('abort', finish, { once: true })
        await promise
        delay = Math.min(delay * 2, 10_000)
      }
    }
    void observe()
    // Disconnect only the observer; durable execution belongs to the server.
    return () => controller.abort()
  }, [id, observation])

  async function stop() {
    if (!run || stopping) return
    setStopping(true)
    try {
      await cancelRun(id, run.id)
    } catch (error) {
      setBanner(error instanceof Error ? error.message : t('atoms.requestError'))
      setStopping(false)
    }
  }

  async function reconnectRun() {
    setBanner(null)
    subscription.current?.abort()
    reconciliationPending.current = true
    setReconciling(true)
    try {
      const current = await latestRun(id)
      if (!mounted.current) return
      await refresh(undefined, !current || current.status === 'completed')
      if (!mounted.current) return
      setRun(current)
      reconciliationPending.current = false
      setReconciling(false)
      setConnection('connected')
      setReconnect((value) => value + 1)
    } catch (error) {
      setBanner(error instanceof Error ? error.message : t('atoms.requestError'))
    }
  }

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

  async function openVersion(versionId: string) {
    const { version } = await client.fetchQuery(versionQuery(id, versionId))
    setViewing(version)
    setTab('preview')
  }

  async function restore(versionId: string) {
    const result = await restoreMutation.mutateAsync({ id, versionId })
    setHtml(result.html)
    setSource(result.source)
    setWorkspace(projectWorkspace(result.source))
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
    const { project: copy } = await remixMutation.mutateAsync({ id, versionId: viewing?.id })
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
  const displaySource = viewing?.source ?? workspace.source
  const projectError = run ? null : project.error
  const publishedCurrent = Boolean(
    project.publishedSlug && project.publishedVersionId === project.currentVersionId,
  )
  const publishLabel = !project.publishedSlug
    ? t('atoms.publish')
    : publishedCurrent
      ? t('atoms.published')
      : t('atoms.updateLive')
  const busy =
    starting ||
    loadingRun ||
    reconciling ||
    restoreMutation.isPending ||
    publishMutation.isPending ||
    unpublishMutation.isPending ||
    remixMutation.isPending
  return (
    <div className="flex h-[calc(100dvh-3rem)] min-h-[36rem] flex-col bg-background">
      <header className="flex flex-wrap items-center gap-3 border-b p-3">
        <div className="min-w-0 flex-1 basis-full sm:basis-auto">
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
        {(busy || starting || stopping) && <Spinner />}
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
                  `${slugify(project.title)}-v${viewing?.number ?? versions.find((version) => version.id === project.currentVersionId)?.number ?? 1}.zip`,
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
      {(banner ||
        projectError ||
        run?.status === 'failed' ||
        run?.status === 'cancelled' ||
        connection !== 'connected') && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 border-b bg-danger-bg px-4 py-2 text-sm"
        >
          <div>
            <p>
              {connection === 'reconnecting'
                ? t('atoms.reconnecting')
                : run?.status === 'failed'
                  ? t(`atoms.runError.${run.errorCode ?? 'internal'}`)
                  : run?.status === 'cancelled'
                    ? t('atoms.runCancelled')
                    : banner || projectError}
            </p>
            {run?.status === 'failed' && (run.error || banner) && (
              <p className="break-words text-xs">{run.error || banner}</p>
            )}
            {!running && html && run?.status === 'failed' && (
              <p className="text-xs">{t('atoms.previousVersionKept')}</p>
            )}
          </div>
          {connection === 'error' ? (
            <Button variant="outline" onClick={() => void reconnectRun()}>
              {t('atoms.reconnect')}
            </Button>
          ) : (
            !running &&
            !loadingRun && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void begin(retryRequest.current ?? run?.request)}
                data-testid="retry-button"
              >
                {t('atoms.retry')}
              </Button>
            )
          )}
        </div>
      )}
      {!wide && (
        <ButtonGroup className="m-3" aria-label={t('atoms.chat')}>
          <Button
            className="flex-1"
            variant={mobilePanel === 'chat' ? 'default' : 'outline'}
            aria-pressed={mobilePanel === 'chat'}
            data-testid="workspace-chat"
            onClick={() => setMobilePanel('chat')}
          >
            {t('atoms.chat')}
          </Button>
          <Button
            className="flex-1"
            variant={mobilePanel === 'preview' ? 'default' : 'outline'}
            aria-pressed={mobilePanel === 'preview'}
            data-testid="workspace-preview"
            onClick={() => setMobilePanel('preview')}
          >
            {t('atoms.preview')}
          </Button>
        </ButtonGroup>
      )}
      <div className="flex min-h-0 flex-1" style={{ flexDirection: wide ? 'row' : 'column' }}>
        <div
          className="min-h-0 min-w-0 shrink-0"
          style={wide ? { width: split, maxWidth: '60%' } : { flex: 1 }}
          hidden={!wide && mobilePanel !== 'chat'}
        >
          <ChatPane
            messages={messages}
            running={running}
            disabled={busy || connection === 'error'}
            stopping={stopping}
            runStatus={run?.status ?? null}
            activeAgents={activeAgents}
            activity={activity}
            onSend={(text) => void begin(text)}
            onStop={() => void stop()}
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
        <div className="min-h-0 min-w-0 flex-1" hidden={!wide && mobilePanel !== 'preview'}>
          <Stage
            html={displayHtml}
            source={displaySource}
            drafts={viewing ? {} : workspace.drafts}
            activePath={viewing ? null : workspace.activePath}
            draft={!viewing && workspace.dirty}
            build={viewing ? null : workspace.build}
            tab={tab}
            device={device}
            running={running}
            phaseLabel={
              running
                ? Object.values(activeAgents)
                    .map((name) => t('ui.assistant.agentWorking', { name }))
                    .join(' · ') || t(`atoms.runStatus.${run?.status ?? 'queued'}`)
                : undefined
            }
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
