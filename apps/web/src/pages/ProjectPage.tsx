import {
  type RunEvent as HarnessEvent,
  type Run as HarnessRun,
  runSchema,
} from '@atoms-demo/contracts'
import { slugify } from '@atoms-demo/core/html'
import type { ProjectSource } from '@atoms-demo/core/project'
import type { AppVersion, Project } from '@atoms-demo/core/types'
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
import { ButtonGroup } from '@atoms-demo/ui/components/button-group'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@atoms-demo/ui/components/collapsible'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@atoms-demo/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@atoms-demo/ui/components/dropdown-menu'
import { Input } from '@atoms-demo/ui/components/input'
import { ExternalLink } from '@atoms-demo/ui/components/link'
import { SidebarTrigger } from '@atoms-demo/ui/components/sidebar'
import { Spinner } from '@atoms-demo/ui/components/spinner'
import {
  Alert02Icon,
  ArrowDown01Icon,
  Clock01Icon,
  MoreHorizontalIcon,
  SidebarLeftIcon,
  UndoIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
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
import { VersionChanges } from '../components/VersionChanges'
import { VersionHistory } from '../components/VersionHistory'
import type { ConversationMessage } from '../features/assistant/messages'
import {
  publishProjectMutation,
  remixProjectMutation,
  restoreVersionMutation,
  unpublishProjectMutation,
} from '../features/projects/mutations'
import { projectQuery, projectsQuery, versionQuery } from '../features/projects/queries'
import { projectWorkspace, reduceProjectEvent } from '../features/projects/workspace'
import {
  cancelRun,
  downloadProject,
  latestRun,
  publishedUrl,
  RunConnectionError,
  startRun,
  streamRunEvents,
} from '../lib/api'

function isActiveRun(run: HarnessRun | null) {
  return run?.status === 'queued' || run?.status === 'running'
}

export function ProjectPage() {
  const { id } = useParams({ from: '/project/$id' })
  const { autostart } = useSearch({ from: '/project/$id' })
  const navigate = useNavigate()
  const { t } = useI18n()
  const client = useQueryClient()
  const detailQuery = useQuery(projectQuery(id))
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
  const [failedAction, setFailedAction] = useState<{
    action: () => Promise<unknown>
    label: string
  } | null>(null)
  const [actionPending, setActionPending] = useState(false)
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
  const [tab, setTab] = useState<'preview' | 'code' | 'changes'>('preview')
  const [mobilePanel, setMobilePanel] = useState<'chat' | 'preview'>('chat')
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [chatHidden, setChatHidden] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<AppVersion | null>(null)
  const [historyAction, setHistoryAction] = useState<{
    id: string
    kind: 'preview' | 'restore' | 'undo'
  } | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [viewing, setViewing] = useState<
    (AppVersion & { html: string; source: ProjectSource }) | null
  >(null)
  const [share, setShare] = useState<{ slug: string; url: string; versionId: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [split, setSplit] = useState(
    () =>
      Number(localStorage.getItem('atoms-split')) ||
      Math.min(440, Math.max(320, Math.round(window.innerWidth * 0.29))),
  )
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 860px)').matches)
  const startPending = useRef(false)
  const undoPending = useRef(false)
  const cursorRef = useRef({ runId: '', sequence: 0 })
  const mounted = useRef(true)
  const retryRequest = useRef<string | undefined>(undefined)
  const reconciliationPending = useRef(false)
  const subscription = useRef<AbortController | null>(null)
  const historySelection = useRef(0)
  const historyButton = useRef<HTMLButtonElement>(null)

  function selectCurrentVersion() {
    historySelection.current++
    setViewing(null)
  }

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
    if (startPending.current || undoPending.current || running || reconciliationPending.current)
      return
    startPending.current = true
    retryRequest.current = content
    setStarting(true)
    setBanner(null)
    setFailedAction(null)
    selectCurrentVersion()
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
        runId: event.runId,
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
        parentVersionId: typeof data.parentVersionId === 'string' ? data.parentVersionId : null,
        number: Number(data.number),
        prompt: String(data.prompt ?? ''),
        createdAt: Number(data.createdAt),
      }
      setVersions((current) =>
        current.some((item) => item.id === version.id) ? current : [...current, version],
      )
      selectCurrentVersion()
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

  async function openVersion(versionId: string, selection: number, mode: 'preview' | 'changes') {
    if (versionId === project?.currentVersionId) setViewing(null)
    else {
      const { version } = await client.fetchQuery(versionQuery(id, versionId))
      if (!mounted.current || selection !== historySelection.current) return
      setViewing(version)
    }
    setTab(mode)
    setMobilePanel('preview')
  }

  async function restore(versionId: string) {
    setBanner(null)
    setFailedAction(null)
    historySelection.current++
    const result = await restoreMutation.mutateAsync({ id, versionId })
    setProject(result.project)
    setHtml(result.html)
    setSource(result.source)
    setWorkspace(projectWorkspace(result.source))
    selectCurrentVersion()
    await refresh()
  }

  async function selectHistoryVersion(
    versionId: string,
    kind: 'preview' | 'restore',
    mode: 'preview' | 'changes' = tab === 'changes' ? 'changes' : 'preview',
  ) {
    if (historyAction || undoPending.current) return
    const selection = ++historySelection.current
    setHistoryAction({ id: versionId, kind })
    setHistoryError(null)
    try {
      if (kind === 'restore') await restore(versionId)
      else await openVersion(versionId, selection, mode)
      if (kind === 'restore') setRestoreTarget(null)
    } catch (error) {
      if (!mounted.current || (kind === 'preview' && selection !== historySelection.current)) return
      setHistoryError(error instanceof Error ? error.message : t('atoms.requestError'))
      if (kind === 'preview') {
        setHistoryOpen(true)
        setMobilePanel('chat')
      }
    } finally {
      setHistoryAction(null)
    }
  }

  async function undoVersionChange() {
    if (
      undoPending.current ||
      busy ||
      running ||
      stopping ||
      project?.status === 'generating' ||
      historyAction ||
      !undoVersion
    )
      return
    undoPending.current = true
    setHistoryAction({ id: undoVersion.id, kind: 'undo' })
    setHistoryError(null)
    try {
      await restore(undoVersion.id)
    } finally {
      undoPending.current = false
      if (mounted.current) setHistoryAction(null)
    }
  }

  async function publish() {
    const result = await publishMutation.mutateAsync({ id })
    setShare({ ...result, url: publishedUrl(result.slug) })
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

  async function act(action: () => Promise<unknown>, label: string) {
    setBanner(null)
    setFailedAction(null)
    setActionPending(true)
    try {
      await action()
    } catch (error) {
      setFailedAction({ action, label })
      setBanner(error instanceof Error ? error.message : t('atoms.requestError'))
    } finally {
      setActionPending(false)
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
    actionPending ||
    historyAction?.kind === 'undo' ||
    restoreMutation.isPending ||
    publishMutation.isPending ||
    unpublishMutation.isPending ||
    remixMutation.isPending
  const selectedVersion =
    viewing ?? versions.find((version) => version.id === project.currentVersionId)
  const currentVersion = versions.find((version) => version.id === project.currentVersionId)
  const undoVersion = versions.find((version) => version.id === currentVersion?.parentVersionId)
  return (
    <div className="flex h-dvh min-h-0 flex-col bg-background">
      <header className="flex min-h-16 shrink-0 items-center gap-2 px-3 py-3 sm:gap-3 sm:px-5">
        <SidebarTrigger />
        <span className="hidden text-sm font-semibold lg:inline">{t('brand.name')}</span>
        <span className="hidden h-4 border-l lg:block" aria-hidden />
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold" title={project.title}>
            {project.title}
          </h1>
          <p className="hidden truncate text-xs text-muted-foreground sm:block">
            {t('atoms.versionCount', { count: versions.length })}
            {project.publishedVersionId &&
              ` · ${t('atoms.versionReview.publishedVersion', { number: versions.find((version) => version.id === project.publishedVersionId)?.number ?? '—' })}`}
          </p>
        </div>
        {(busy || starting || stopping) && <Spinner />}
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            variant="ghost"
            size="icon-sm"
            data-testid="undo-version"
            aria-label={t('atoms.versionReview.undo')}
            disabled={
              !undoVersion ||
              busy ||
              running ||
              stopping ||
              project.status === 'generating' ||
              Boolean(historyAction)
            }
            title={
              undoVersion
                ? t('atoms.versionReview.undoToVersion', { number: undoVersion.number })
                : t('atoms.versionReview.nothingToUndo')
            }
            onClick={() => void act(undoVersionChange, t('atoms.versionReview.undo'))}
          >
            {historyAction?.kind === 'undo' ? (
              <Spinner />
            ) : (
              <HugeiconsIcon icon={UndoIcon} size={16} strokeWidth={1.5} />
            )}
            <span className="sr-only">{t('atoms.versionReview.undo')}</span>
          </Button>
          <Button
            ref={historyButton}
            variant={historyOpen ? 'secondary' : 'ghost'}
            data-testid="history-button"
            size="icon-sm"
            aria-label={t('atoms.history')}
            title={t('atoms.history')}
            aria-pressed={historyOpen}
            onClick={() => {
              setHistoryOpen(!historyOpen)
              setChatHidden(false)
              setMobilePanel('chat')
            }}
          >
            <HugeiconsIcon icon={Clock01Icon} size={16} strokeWidth={1.5} />
            <span className="sr-only">{t('atoms.history')}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('atoms.versionReview.projectActions')}
                  data-testid="project-actions"
                />
              }
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} size={18} strokeWidth={1.5} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                data-testid="remix-button"
                disabled={busy || running}
                onClick={() => void act(remix, t('atoms.remix'))}
              >
                {t('atoms.remix')}
              </DropdownMenuItem>
              <DropdownMenuItem
                data-testid="download-button"
                disabled={!project.currentVersionId}
                onClick={() =>
                  void act(
                    () =>
                      downloadProject(
                        id,
                        `${slugify(project.title)}-v${viewing?.number ?? versions.find((version) => version.id === project.currentVersionId)?.number ?? 1}.zip`,
                        viewing?.id,
                      ),
                    t('atoms.download'),
                  )
                }
              >
                {t('atoms.download')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="sm"
            data-testid="publish-button"
            disabled={!project.currentVersionId || running || busy}
            onClick={() => void act(publish, publishLabel)}
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
          className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b bg-warning-bg px-4 py-3 text-sm"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2">
            <HugeiconsIcon
              icon={Alert02Icon}
              size={18}
              strokeWidth={1.5}
              className="mt-0.5 shrink-0 text-warning"
            />
            <div className="min-w-0 space-y-1">
              <p>
                {failedAction
                  ? banner
                  : connection === 'reconnecting'
                    ? t('atoms.reconnecting')
                    : run?.status === 'failed'
                      ? t(`atoms.runError.${run.errorCode ?? 'internal'}`)
                      : run?.status === 'cancelled'
                        ? t('atoms.runCancelled')
                        : banner || projectError}
              </p>
              {!failedAction && run?.status === 'failed' && (run.error || banner) && (
                <Collapsible className="text-xs text-muted-foreground">
                  <CollapsibleTrigger
                    render={
                      <Button variant="link" size="sm" className="h-auto px-0 py-1 text-xs" />
                    }
                  >
                    {t('ui.assistant.rawDetails')}
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <p className="mt-2 break-words">{run.error || banner}</p>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </div>
          </div>
          {connection === 'error' ? (
            <Button variant="outline" onClick={() => void reconnectRun()}>
              {t('atoms.reconnect')}
            </Button>
          ) : failedAction ? (
            <Button
              variant="outline"
              disabled={busy || running}
              onClick={() => void act(failedAction.action, failedAction.label)}
              data-testid="retry-action-button"
            >
              {failedAction.label}
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
        <ButtonGroup className="mx-3 my-2 shrink-0" aria-label={t('atoms.chat')}>
          <Button
            className="flex-1"
            variant={mobilePanel === 'chat' ? 'default' : 'outline'}
            aria-pressed={mobilePanel === 'chat'}
            data-testid="workspace-chat"
            onClick={() => setMobilePanel('chat')}
          >
            {historyOpen ? t('atoms.history') : t('atoms.chat')}
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
      <div
        className="flex min-h-0 flex-1 px-2 pb-3 sm:pr-4 sm:pb-4"
        style={{ flexDirection: wide ? 'row' : 'column' }}
      >
        <div
          id="project-conversation"
          className="min-h-0 min-w-0 shrink-0"
          style={wide ? { width: split, maxWidth: '60%' } : { flex: 1 }}
          hidden={wide ? chatHidden : mobilePanel !== 'chat'}
        >
          <div className="h-full" hidden={!historyOpen}>
            <VersionHistory
              versions={versions}
              currentId={project.currentVersionId}
              selectedId={viewing?.id ?? project.currentVersionId}
              publishedId={project.publishedVersionId}
              loadingId={historyAction?.id ?? null}
              error={historyError}
              onSelect={(versionId) => void selectHistoryVersion(versionId, 'preview')}
              onClose={() => {
                setHistoryOpen(false)
                historyButton.current?.focus()
              }}
            />
          </div>
          <div className="h-full" hidden={historyOpen}>
            <ChatPane
              messages={messages}
              running={running}
              disabled={busy || connection === 'error'}
              stopping={stopping}
              run={run}
              activeAgents={activeAgents}
              activity={activity}
              onSend={(text) => void begin(text)}
              onStop={() => void stop()}
              versions={versions}
              onOpenVersion={(versionId, mode) =>
                void selectHistoryVersion(versionId, 'preview', mode)
              }
            />
          </div>
        </div>
        {wide && !chatHidden && (
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
            toolbarAction={
              wide ? (
                <Button
                  variant={chatHidden ? 'secondary' : 'ghost'}
                  size="icon-sm"
                  data-testid="toggle-chat"
                  aria-label={t(chatHidden ? 'atoms.showChat' : 'atoms.hideChat')}
                  title={t(chatHidden ? 'atoms.showChat' : 'atoms.hideChat')}
                  aria-expanded={!chatHidden}
                  aria-controls="project-conversation"
                  onClick={() => setChatHidden((hidden) => !hidden)}
                >
                  <HugeiconsIcon icon={SidebarLeftIcon} size={16} strokeWidth={1.5} />
                </Button>
              ) : undefined
            }
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
            onBack={selectCurrentVersion}
            onRestore={
              viewing
                ? () => {
                    setHistoryError(null)
                    setRestoreTarget(viewing)
                  }
                : undefined
            }
            restoreDisabled={busy || running || Boolean(historyAction)}
            versionControl={
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="sm"
                      variant="ghost"
                      data-testid="version-picker"
                      disabled={!versions.length || Boolean(historyAction)}
                    />
                  }
                >
                  {historyAction ? (
                    <Spinner />
                  ) : (
                    <span className="font-mono text-xs">
                      {t('atoms.versionReview.shortVersion', {
                        number:
                          viewing?.number ??
                          versions.find((version) => version.id === project.currentVersionId)
                            ?.number ??
                          '—',
                      })}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {t(viewing ? 'atoms.versionReview.historical' : 'atoms.current')}
                  </span>
                  <HugeiconsIcon icon={ArrowDown01Icon} size={14} strokeWidth={1.5} />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {[...versions]
                    .sort((a, b) => b.number - a.number)
                    .map((version) => (
                      <DropdownMenuItem
                        key={version.id}
                        onClick={() => void selectHistoryVersion(version.id, 'preview')}
                      >
                        {t('atoms.versionLabel', { number: version.number })}
                        {version.id === project.currentVersionId && (
                          <Badge variant="secondary">{t('atoms.current')}</Badge>
                        )}
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() => {
                      setHistoryOpen(true)
                      setChatHidden(false)
                      setMobilePanel('chat')
                    }}
                  >
                    {t('atoms.historyTitle')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
            changes={
              selectedVersion ? (
                <VersionChanges
                  key={viewing?.id ?? project.currentVersionId}
                  projectId={id}
                  version={selectedVersion}
                  versions={versions}
                  active={tab === 'changes'}
                />
              ) : (
                <div className="grid h-full place-items-center p-6 text-sm text-muted-foreground">
                  {t('atoms.historyEmpty')}
                </div>
              )
            }
          />
        </div>
      </div>
      <AlertDialog
        open={Boolean(restoreTarget)}
        onOpenChange={(open) => {
          if (!open && !historyAction) setRestoreTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('atoms.versionReview.restoreTitle', { number: restoreTarget?.number ?? '' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('atoms.versionReview.restoreDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {historyError && (
            <p role="alert" className="text-sm text-destructive">
              {historyError}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(historyAction)}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={running || busy || Boolean(historyAction)}
              data-testid="confirm-restore"
              onClick={() => {
                if (restoreTarget) void selectHistoryVersion(restoreTarget.id, 'restore')
              }}
            >
              {historyAction && <Spinner />}
              {t('atoms.restore')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
                }, t('atoms.copyLink'))
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
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void act(unpublish, t('atoms.unpublish'))}
            >
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
