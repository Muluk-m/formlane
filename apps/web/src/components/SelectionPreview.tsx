import type { EditorArtifact, SelectionSubmission } from '@atoms-demo/contracts'
import type {
  SelectionChildrenPage,
  SelectionEvidence,
  SelectionRect,
} from '@atoms-demo/core/selection'
import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import { FieldSet } from '@atoms-demo/ui/components/field'
import { ArrowDown01Icon, CursorRectangleSelection01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useCallback, useEffect, useEffectEvent, useRef, useState } from 'react'
import {
  createPreviewSelectionBridge,
  injectPreviewSelectionRuntime,
  type PreviewSelectionBridge,
} from '../features/preview-selection'
import { captureSelectionImage, mappedEvidence } from '../features/projects/selection'

export type SelectionPreviewProps = {
  artifact: EditorArtifact
  device: 'desktop' | 'mobile'
  selection: SelectionSubmission | null
  onSelection: (selection: SelectionSubmission | null) => void
  onInvalidated: () => void
  onPrepare: (prepare: (() => Promise<SelectionSubmission>) | null) => void
}

export function SelectionPreview({
  artifact,
  device,
  selection,
  onSelection,
  onInvalidated,
  onPrepare,
}: SelectionPreviewProps) {
  const { t } = useI18n()
  const frame = useRef<HTMLIFrameElement>(null)
  const bridge = useRef<PreviewSelectionBridge | null>(null)
  const documentId = useRef<string | null>(null)
  const captureAbort = useRef<AbortController | null>(null)
  const latestSelection = useRef(selection)
  latestSelection.current = selection
  const [ready, setReady] = useState(false)
  const [previewFailed, setPreviewFailed] = useState(false)
  const [editing, setEditing] = useState(false)
  const [layers, setLayers] = useState(false)
  const [includeHidden, setIncludeHidden] = useState(false)
  const [layersRevision, setLayersRevision] = useState(0)
  const [regionMode, setRegionMode] = useState(false)
  const [rectangle, setRectangle] = useState<SelectionRect | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [error, setError] = useState<'error' | 'invalidated' | 'captureUnavailable' | null>(null)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const evidence =
    selection && selection.sessionId === bridge.current?.sessionId ? selection.evidence : null
  const selected = evidence?.kind === 'element' ? evidence.element : evidence?.focus
  const emit = useCallback(
    (value: SelectionEvidence) => {
      if (!documentId.current || !bridge.current) return
      setError(null)
      const manifest = artifact.manifest
      onSelection({
        versionId: artifact.versionId,
        sourceHash: manifest.sourceHash,
        canonicalArtifactHash: manifest.canonicalArtifactHash,
        editorArtifactHash: manifest.editorArtifactHash,
        instrumentationVersion: manifest.instrumentationVersion,
        sessionId: bridge.current.sessionId,
        documentId: documentId.current,
        evidence: mappedEvidence(value, manifest),
      })
    },
    [artifact, onSelection],
  )
  const invalidate = useCallback(() => {
    onInvalidated()
    setError('invalidated')
  }, [onInvalidated])
  const clear = useCallback(() => {
    onSelection(null)
    setRectangle(null)
  }, [onSelection])
  useEffect(() => {
    const iframe = frame.current
    if (!iframe) return
    // Each installed document needs a fresh session, including StrictMode effect replay.
    const config = { sessionId: crypto.randomUUID(), editorOrigin: location.origin }
    documentId.current = null
    const previewError = (event: MessageEvent<unknown>) => {
      if (
        event.source === iframe.contentWindow &&
        typeof event.data === 'object' &&
        event.data !== null &&
        'type' in event.data &&
        event.data.type === 'atoms-preview-error'
      )
        setPreviewFailed(true)
    }
    window.addEventListener('message', previewError)
    const connection = createPreviewSelectionBridge(iframe, {
      ...config,
      onEvent: (event) => {
        if (event.type === 'ready') {
          if (documentId.current && documentId.current !== event.payload.documentId) invalidate()
          // Runtime interception can pause for capture without leaving the host's Edit layout.
          documentId.current = event.payload.documentId
          setReady(true)
        } else if (event.type === 'selected') {
          setRectangle(null)
          emit(event.payload)
        } else if (event.type === 'cleared') clear()
        else if (event.type === 'invalidated') {
          const current = latestSelection.current?.evidence
          const nodes =
            current?.kind === 'element'
              ? [current.element]
              : current
                ? [...current.elements, ...(current.focus ? [current.focus] : [])]
                : []
          if (nodes.some((node) => node.nodeId === event.payload.nodeId)) invalidate()
          setLayersRevision((value) => value + 1)
        } else if (event.type === 'error') {
          if (event.requestId === null) {
            documentId.current = null
            setReady(false)
            setEditing(false)
            captureAbort.current?.abort()
            invalidate()
          } else setError('error')
        }
      },
    })
    bridge.current = connection
    const errorScript = `<script>addEventListener('error',()=>parent.postMessage({type:'atoms-preview-error'},${JSON.stringify(config.editorOrigin)}));addEventListener('unhandledrejection',()=>parent.postMessage({type:'atoms-preview-error'},${JSON.stringify(config.editorOrigin)}));</script>`
    const monitored = /<head(?:\s[^>]*)?>/i.test(artifact.editorHtml)
      ? artifact.editorHtml.replace(/<head(?:\s[^>]*)?>/i, (head) => head + errorScript)
      : errorScript + artifact.editorHtml
    // StrictMode can retire this connection before its initial document is installed.
    queueMicrotask(() => {
      if (bridge.current === connection)
        iframe.srcdoc = injectPreviewSelectionRuntime(monitored, config)
    })
    void connection
      .enable(false)
      .then((value) => {
        if (bridge.current !== connection) return
        documentId.current = value.documentId
        setReady(true)
      })
      .catch(() => {
        if (bridge.current === connection) setError('error')
      })
    return () => {
      captureAbort.current?.abort()
      window.removeEventListener('message', previewError)
      bridge.current = null
      connection.dispose()
      onPrepare(null)
      onInvalidated()
    }
  }, [artifact.editorHtml, onInvalidated, onPrepare, emit, invalidate, clear])

  const snapshot = useCallback(async (): Promise<SelectionSubmission> => {
    if (
      !selection ||
      selection.sessionId !== bridge.current?.sessionId ||
      selection.documentId !== documentId.current ||
      !bridge.current
    )
      throw new Error('selection-stale')
    const previous = selection.evidence
    const value = await bridge.current.capture(
      previous.kind === 'region'
        ? { region: rectangle ?? previous.rectangle, focusNodeId: previous.focus?.nodeId }
        : undefined,
    )
    if (!value || selection.documentId !== documentId.current) throw new Error('selection-stale')
    if (
      previous.kind === 'element' &&
      (value.kind !== 'element' || value.element.nodeId !== previous.element.nodeId)
    )
      throw new Error('selection-stale')
    if (
      previous.kind === 'region' &&
      (value.kind !== 'region' ||
        previous.elements.length !== value.elements.length ||
        previous.elements.some(
          (element) => !value.elements.some((member) => member.nodeId === element.nodeId),
        ))
    )
      throw new Error('selection-stale')
    return { ...selection, evidence: mappedEvidence(value, artifact.manifest) }
  }, [selection, rectangle, artifact.manifest])
  useEffect(() => {
    onPrepare(snapshot)
  }, [onPrepare, snapshot])

  useEffect(() => {
    if (!selection && bridge.current) void bridge.current.clear().catch(() => {})
  }, [selection])

  const refreshRegion = useEffectEvent(async () => {
    if (evidence?.kind !== 'region' || !bridge.current || regionMode || capturing) return
    const current = await bridge.current.capture({ region: evidence.rectangle, focusNodeId: null })
    if (current?.kind !== 'region') return
    if (
      current.viewport.width !== evidence.viewport.width ||
      current.viewport.height !== evidence.viewport.height
    ) {
      setRectangle(null)
      invalidate()
      return
    }
    const adjusted = {
      ...evidence.rectangle,
      x: evidence.rectangle.x + evidence.scroll.x - current.scroll.x,
      y: evidence.rectangle.y + evidence.scroll.y - current.scroll.y,
    }
    const refreshed =
      adjusted.x === evidence.rectangle.x && adjusted.y === evidence.rectangle.y
        ? current
        : await bridge.current.capture({ region: adjusted, focusNodeId: null })
    if (
      refreshed?.kind !== 'region' ||
      evidence.elements.length !== refreshed.elements.length ||
      evidence.elements.some(
        (element) => !refreshed.elements.some((member) => member.nodeId === element.nodeId),
      )
    ) {
      setRectangle(null)
      invalidate()
      return
    }
    setRectangle((previous) =>
      previous &&
      previous.x === adjusted.x &&
      previous.y === adjusted.y &&
      previous.width === adjusted.width &&
      previous.height === adjusted.height
        ? previous
        : adjusted,
    )
  })
  useEffect(() => {
    if (evidence?.kind !== 'region' || !editing) return
    let pending = false
    const timer = window.setInterval(() => {
      if (pending) return
      pending = true
      void refreshRegion()
        .catch(() => invalidate())
        .finally(() => {
          pending = false
        })
    }, 500)
    return () => window.clearInterval(timer)
  }, [evidence?.kind, editing, invalidate])

  const rectangleBeforeDrawing = useRef<SelectionRect | null>(null)
  function cancelRegion() {
    drag.current = null
    setRegionMode(false)
    setRectangle(rectangleBeforeDrawing.current)
  }
  async function toggleEdit() {
    try {
      const enabled = !editing
      await bridge.current?.enable(enabled)
      setEditing(enabled)
      if (regionMode) cancelRegion()
    } catch {
      setError('error')
    }
  }
  async function chooseRegion(value: SelectionRect) {
    if (!bridge.current || value.width < 1 || value.height < 1) return
    try {
      const context = await bridge.current.capture({ region: value, focusNodeId: null })
      if (context) {
        emit(context)
        setRectangle(value)
        setRegionMode(false)
      }
    } catch {
      cancelRegion()
      setError('error')
    }
  }
  async function chooseFocus(nodeId: string | null) {
    if (evidence?.kind !== 'region' || !bridge.current) return
    try {
      const context = await bridge.current.capture({
        region: rectangle ?? evidence.rectangle,
        focusNodeId: nodeId,
      })
      if (context) emit(context)
    } catch {
      setError('error')
    }
  }
  async function capture() {
    if (!selection || !frame.current || !bridge.current || capturing) return
    const original = selection
    const controller = new AbortController()
    captureAbort.current = controller
    setCapturing(true)
    setError(null)
    try {
      let captured = original
      const image = await captureSelectionImage(
        frame.current,
        async () => {
          if (latestSelection.current !== original) throw new Error('selection-stale')
          await bridge.current?.enable(false)
          const { promise, resolve } = Promise.withResolvers<void>()
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
          await promise
          captured = await snapshot()
          return captured.evidence
        },
        controller.signal,
      )
      if (
        !controller.signal.aborted &&
        documentId.current === original.documentId &&
        latestSelection.current === original
      )
        onSelection({ ...captured, image })
    } catch {
      if (!controller.signal.aborted) setError('captureUnavailable')
    } finally {
      if (!controller.signal.aborted) {
        try {
          await bridge.current?.enable(editing)
        } catch {
          setReady(false)
          setEditing(false)
          invalidate()
        }
      }
      setCapturing(false)
      captureAbort.current = null
    }
  }
  function selectNode(nodeId: string) {
    void bridge.current?.select(nodeId).catch(() => setError('error'))
  }
  return (
    <div className="flex h-full min-h-0 w-full flex-col gap-2">
      {/* Selection details must not resize the viewport that defines region coordinates. */}
      <div className="h-28 shrink-0 space-y-2 overflow-y-auto">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="icon-sm"
            variant={editing ? 'default' : 'outline'}
            disabled={!ready || capturing}
            aria-pressed={editing}
            aria-label={t(editing ? 'atoms.selection.done' : 'atoms.selection.edit')}
            title={t(editing ? 'atoms.selection.done' : 'atoms.selection.edit')}
            onClick={() => void toggleEdit()}
            data-testid="selection-edit"
          >
            <HugeiconsIcon icon={CursorRectangleSelection01Icon} size={18} strokeWidth={1.5} />
          </Button>
          {editing && (
            <>
              <Button
                size="sm"
                variant="outline"
                aria-pressed={layers}
                onClick={() => setLayers(!layers)}
              >
                {t('atoms.selection.layers')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                aria-pressed={regionMode}
                disabled={capturing}
                onClick={() => {
                  if (regionMode) cancelRegion()
                  else {
                    rectangleBeforeDrawing.current = rectangle
                    setRegionMode(true)
                    setRectangle({ x: 20, y: 20, width: 160, height: 100 })
                  }
                }}
                data-testid="selection-region"
              >
                {t('atoms.selection.region')}
              </Button>
              <span className="text-xs text-muted-foreground">{t('atoms.selection.hint')}</span>
            </>
          )}
          {evidence && (
            <Button
              size="sm"
              variant="outline"
              disabled={capturing}
              onClick={() => void capture()}
              data-testid="selection-capture"
              title={t('atoms.selection.captureHint')}
            >
              {t(capturing ? 'atoms.selection.capturing' : 'atoms.selection.capture')}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {t(`atoms.selection.${error}`)}
          </p>
        )}
        {editing && selected && (
          <nav
            aria-label={t('atoms.selection.breadcrumbs')}
            className="flex flex-wrap items-center gap-1"
          >
            {selected.ancestors.map((ancestor) => (
              <Button
                key={ancestor.nodeId}
                variant="ghost"
                size="sm"
                onClick={() => selectNode(ancestor.nodeId)}
              >
                {ancestor.label || ancestor.tagName}
              </Button>
            ))}
            <Button
              size="sm"
              variant="outline"
              data-testid="selection-parent"
              onClick={() => void bridge.current?.parent().catch(() => setError('error'))}
            >
              {t('atoms.selection.parent')}
            </Button>
          </nav>
        )}
        {previewFailed && (
          <p role="alert" className="text-xs text-destructive">
            {t('atoms.previewError')}
          </p>
        )}
        {evidence?.kind === 'region' && (
          <FieldSet className="flex-row flex-wrap gap-1" aria-label={t('atoms.selection.region')}>
            <Button
              size="sm"
              variant={!evidence.focus ? 'secondary' : 'ghost'}
              onClick={() => void chooseFocus(null)}
            >
              {t('atoms.selection.noFocus')}
            </Button>
            {evidence.elements.map((element) => (
              <Button
                key={element.nodeId}
                size="sm"
                variant={element.nodeId === evidence.focus?.nodeId ? 'secondary' : 'ghost'}
                onClick={() => void chooseFocus(element.nodeId)}
              >
                {t('atoms.selection.focus', { label: element.instance.label || element.tagName })}
              </Button>
            ))}
            {evidence.truncated && (
              <p className="text-xs text-muted-foreground">{t('atoms.selection.truncated')}</p>
            )}
          </FieldSet>
        )}
        {regionMode && (
          <p className="text-xs text-muted-foreground">{t('atoms.selection.regionHint')}</p>
        )}
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 md:flex-row">
        {editing && layers && bridge.current && (
          <aside className="max-h-48 w-full shrink-0 overflow-auto rounded-lg border bg-background p-2 md:max-h-none md:w-52">
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={includeHidden}
              onClick={() => setIncludeHidden(!includeHidden)}
            >
              {t('atoms.selection.hidden')}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setLayersRevision((value) => value + 1)}
            >
              {t('atoms.selection.refresh')}
            </Button>
            <div
              role="tree"
              aria-label={t('atoms.selection.layers')}
              onKeyDown={(event) => {
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
                const rows = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>('[data-layer-node]'),
                ]
                const active = document.activeElement
                const index = active instanceof HTMLButtonElement ? rows.indexOf(active) : -1
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? rows.length - 1
                      : Math.max(
                          0,
                          Math.min(rows.length - 1, index + (event.key === 'ArrowDown' ? 1 : -1)),
                        )
                event.preventDefault()
                rows[next]?.focus()
              }}
            >
              <LayerBranch
                key={`${layersRevision}:${includeHidden}`}
                connection={bridge.current}
                parent={null}
                includeHidden={includeHidden}
                selectedId={selected?.nodeId ?? null}
                onSelect={selectNode}
                onError={() => setError('error')}
              />
            </div>
          </aside>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 justify-center overflow-hidden">
          <div className={`device ${device} relative`} data-testid="preview-frame">
            <iframe
              ref={frame}
              title={t('atoms.previewTitle')}
              sandbox="allow-scripts allow-forms allow-popups"
            />
            {editing && !capturing && rectangle && (
              <div
                data-testid="selection-rectangle"
                className="pointer-events-none absolute border-2 border-ring bg-info/10"
                style={{
                  left: rectangle.x,
                  top: rectangle.y,
                  width: rectangle.width,
                  height: rectangle.height,
                }}
              />
            )}
            {regionMode && !capturing && (
              <Button
                variant="ghost"
                aria-label={t('atoms.selection.region')}
                data-testid="selection-region-surface"
                className="absolute inset-0 h-full w-full cursor-crosshair rounded-none border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus-visible:ring-2 focus-visible:ring-ring"
                ref={(node) => node?.focus()}
                onPointerDown={(event) => {
                  if (event.button !== 0 || !event.isPrimary) return
                  event.preventDefault()
                  const bounds = event.currentTarget.getBoundingClientRect()
                  drag.current = { x: event.clientX - bounds.left, y: event.clientY - bounds.top }
                  event.currentTarget.setPointerCapture(event.pointerId)
                  setRectangle({ ...drag.current, width: 0, height: 0 })
                }}
                onPointerMove={(event) => {
                  if (!drag.current) return
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const x = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left))
                  const y = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top))
                  setRectangle({
                    x: Math.min(x, drag.current.x),
                    y: Math.min(y, drag.current.y),
                    width: Math.abs(x - drag.current.x),
                    height: Math.abs(y - drag.current.y),
                  })
                }}
                onPointerUp={() => {
                  if (!drag.current) return
                  drag.current = null
                  if (rectangle) void chooseRegion(rectangle)
                }}
                onPointerCancel={cancelRegion}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    cancelRegion()
                    return
                  }
                  if (['Enter', ' '].includes(event.key) && rectangle) {
                    event.preventDefault()
                    void chooseRegion(rectangle)
                    return
                  }
                  if (
                    !rectangle ||
                    !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)
                  )
                    return
                  event.preventDefault()
                  const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight'
                  const change = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -10 : 10
                  const field = event.shiftKey
                    ? horizontal
                      ? 'width'
                      : 'height'
                    : horizontal
                      ? 'x'
                      : 'y'
                  const bounds = event.currentTarget.getBoundingClientRect()
                  const maximum =
                    field === 'x'
                      ? bounds.width - rectangle.width
                      : field === 'y'
                        ? bounds.height - rectangle.height
                        : field === 'width'
                          ? bounds.width - rectangle.x
                          : bounds.height - rectangle.y
                  setRectangle({
                    ...rectangle,
                    [field]: Math.max(
                      event.shiftKey ? 1 : 0,
                      Math.min(maximum, rectangle[field] + change),
                    ),
                  })
                }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function LayerBranch({
  connection,
  parent,
  includeHidden,
  selectedId,
  onSelect,
  onError,
}: {
  connection: PreviewSelectionBridge
  parent: string | null
  includeHidden: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  onError: () => void
}) {
  const { t } = useI18n()
  const [page, setPage] = useState<SelectionChildrenPage | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const reportError = useEffectEvent(onError)
  useEffect(() => {
    let active = true
    void connection
      .children(parent, { includeHidden })
      .then((value) => {
        if (active) setPage(value)
      })
      .catch(() => {
        if (active) reportError()
      })
    return () => {
      active = false
    }
  }, [connection, parent, includeHidden])
  function toggle(id: string, value: boolean) {
    setExpanded((current) => {
      const next = new Set(current)
      if (value) next.add(id)
      else next.delete(id)
      return next
    })
  }
  return (
    <div role={parent ? 'group' : undefined} className={parent ? 'ml-3 border-l pl-2' : undefined}>
      {page?.children.map((row) => (
        <div key={row.nodeId}>
          <div className="flex items-center gap-1">
            {row.hasChildren && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t(
                  expanded.has(row.nodeId) ? 'atoms.selection.collapse' : 'atoms.selection.expand',
                  { label: row.label },
                )}
                aria-expanded={expanded.has(row.nodeId)}
                onClick={() => toggle(row.nodeId, !expanded.has(row.nodeId))}
              >
                <HugeiconsIcon
                  icon={ArrowDown01Icon}
                  size={14}
                  strokeWidth={1.5}
                  className={expanded.has(row.nodeId) ? undefined : '-rotate-90'}
                />
              </Button>
            )}
            <Button
              role="treeitem"
              data-layer-node={row.nodeId}
              aria-selected={selectedId === row.nodeId}
              aria-expanded={row.hasChildren ? expanded.has(row.nodeId) : undefined}
              variant={selectedId === row.nodeId ? 'secondary' : 'ghost'}
              size="sm"
              className="min-w-0 flex-1 justify-start truncate"
              onClick={() => onSelect(row.nodeId)}
              onMouseEnter={() => void connection.hover(row.nodeId).catch(() => {})}
              onMouseLeave={() => void connection.hover(null).catch(() => {})}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight' && row.hasChildren) {
                  event.preventDefault()
                  if (!expanded.has(row.nodeId)) toggle(row.nodeId, true)
                  else
                    event.currentTarget.parentElement?.nextElementSibling
                      ?.querySelector<HTMLButtonElement>('[data-layer-node]')
                      ?.focus()
                }
                if (event.key === 'ArrowLeft') {
                  event.preventDefault()
                  if (expanded.has(row.nodeId)) toggle(row.nodeId, false)
                  else
                    event.currentTarget
                      .closest('[role="group"]')
                      ?.previousElementSibling?.querySelector<HTMLButtonElement>(
                        '[data-layer-node]',
                      )
                      ?.focus()
                }
                if (event.key === 'Escape') {
                  event.preventDefault()
                  void connection.clear().catch(onError)
                }
              }}
            >
              {row.label || row.tagName}
              {row.hidden && <span className="sr-only">{t('atoms.selection.hidden')}</span>}
            </Button>
          </div>
          {expanded.has(row.nodeId) && (
            <LayerBranch
              connection={connection}
              parent={row.nodeId}
              includeHidden={includeHidden}
              selectedId={selectedId}
              onSelect={onSelect}
              onError={onError}
            />
          )}
        </div>
      ))}
      {page?.nextCursor && (
        <Button
          variant="ghost"
          size="sm"
          disabled={loading}
          onClick={() => {
            setLoading(true)
            void connection
              .children(parent, { includeHidden, cursor: page.nextCursor })
              .then((next) => setPage({ ...next, children: [...page.children, ...next.children] }))
              .catch(onError)
              .finally(() => setLoading(false))
          }}
        >
          {t('atoms.selection.more')}
        </Button>
      )}
    </div>
  )
}
