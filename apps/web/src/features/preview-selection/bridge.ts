import {
  SELECTION_LIMITS,
  SELECTION_PROTOCOL,
  SELECTION_PROTOCOL_VERSION,
} from '@atoms-demo/core/selection'
import type {
  SelectionCommandPayloads,
  SelectionCommandResults,
  SelectionEvent,
  SelectionRect,
} from '@atoms-demo/core/selection'
import { z } from 'zod'
import type { PreviewSelectionConfig } from './runtime'

const shortString = z.string().max(SELECTION_LIMITS.attributeCharacters)
const nodeId = z.string().min(1).max(200)
const rectangle = z.strictObject({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() })
const viewport = z.strictObject({ width: z.number().nonnegative(), height: z.number().nonnegative() })
const scroll = z.strictObject({ x: z.number(), y: z.number() })
const attributes = z.enum(['id', 'class', 'role', 'aria-label', 'aria-labelledby', 'aria-describedby',
  'aria-expanded', 'aria-selected', 'aria-checked', 'aria-disabled', 'alt', 'title', 'type', 'placeholder'])
const styles = z.enum(['display', 'visibility', 'position', 'color', 'background-color', 'font-family',
  'font-size', 'font-weight', 'line-height', 'text-align', 'border-radius', 'padding', 'gap', 'opacity'])
const element = z.strictObject({
  nodeId,
  sourceId: shortString.nullable(),
  tagName: shortString,
  role: shortString.nullable(),
  text: z.string().max(SELECTION_LIMITS.textCharacters),
  attributes: z.partialRecord(attributes, shortString),
  styles: z.partialRecord(styles, shortString),
  selector: z.string().max(SELECTION_LIMITS.selectorCharacters),
  ancestors: z.array(z.strictObject({ nodeId, sourceId: shortString.nullable(), tagName: shortString,
    label: shortString })).max(SELECTION_LIMITS.ancestors),
  rects: z.array(rectangle).max(SELECTION_LIMITS.rects),
  viewport,
  scroll,
  instance: z.strictObject({ label: z.string().max(SELECTION_LIMITS.instanceCharacters),
    context: z.string().max(SELECTION_LIMITS.instanceCharacters) }),
})
const selected = z.strictObject({ kind: z.literal('element'), element })
const evidence = z.discriminatedUnion('kind', [selected, z.strictObject({
  kind: z.literal('region'), rectangle, elements: z.array(element).max(SELECTION_LIMITS.regionMembers),
  focus: element.nullable(), viewport, scroll, truncated: z.boolean(),
})])
const resultSchemas = {
  enable: z.strictObject({ enabled: z.boolean() }),
  children: z.strictObject({ parentNodeId: nodeId.nullable(), children: z.array(z.strictObject({
    nodeId, tagName: shortString, label: shortString, sourceId: shortString.nullable(),
    hasChildren: z.boolean(), hidden: z.boolean(),
  })).max(SELECTION_LIMITS.children), nextCursor: z.string().max(1000).nullable() }),
  select: selected,
  hover: z.null(),
  parent: selected.nullable(),
  capture: evidence.nullable(),
  clear: z.null(),
  dispose: z.null(),
} satisfies { [Command in keyof SelectionCommandResults]: z.ZodType<SelectionCommandResults[Command]> }
const eventSchemas = {
  ready: z.strictObject({ enabled: z.boolean() }),
  selected,
  cleared: z.null(),
  invalidated: z.strictObject({ nodeId }),
  error: z.strictObject({ code: z.string().max(200), message: z.string().max(1000) }),
}
const envelope = z.strictObject({
  protocol: z.literal(SELECTION_PROTOCOL), protocolVersion: z.literal(SELECTION_PROTOCOL_VERSION),
  sessionId: z.string().min(1).max(200), requestId: z.string().min(1).max(200).nullable(),
  type: z.enum(['ready', 'result', 'selected', 'cleared', 'invalidated', 'error']), payload: z.unknown(),
})
const resultPayload = z.strictObject({ command: z.enum(['enable', 'children', 'select', 'hover',
  'parent', 'capture', 'clear', 'dispose']), value: z.unknown() })

export interface PreviewSelectionBridgeOptions extends PreviewSelectionConfig {
  onEvent?: (event: SelectionEvent) => void
  requestTimeoutMs?: number
}

export interface PreviewSelectionBridge {
  readonly sessionId: string
  /** Mode messages preserve the live document. Disabling also hides capture outlines. */
  enable(enabled: boolean): Promise<SelectionCommandResults['enable']>
  /** Null lists body children. Offscreen rows remain; hidden rows require includeHidden.
   * Continue with nextCursor and identical options; a DOM mutation can reject cursor-stale. */
  children(parentNodeId: string | null, options?: { cursor?: string | null; includeHidden?: boolean }): Promise<SelectionCommandResults['children']>
  select(nodeId: string): Promise<SelectionCommandResults['select']>
  hover(nodeId: string | null): Promise<null>
  parent(): Promise<SelectionCommandResults['parent']>
  /** CSS viewport coordinates, positive-area intersection, deepest descendants first.
   * Overlapping siblings remain distinct; truncated reports node/byte/work limits.
   * This captures DOM context only, never screenshot pixels or application state. */
  capture(options?: { region?: SelectionRect; focusNodeId?: string | null }): Promise<SelectionCommandResults['capture']>
  clear(): Promise<null>
  dispose(): void
}

/** One bridge per document/session, attached to an opaque sandbox frame.
 * Create before setting srcDoc (late attachment also works); dispose before replacing it.
 * Use a fresh sessionId with the injected script. No capability/credential belongs in config.
 * Frame pointer selection uses Alt-click for overlapping targets, ArrowUp for parents,
 * Enter/Space for the focused target, Escape to clear. Failures expose internal error codes.
 */
export function createPreviewSelectionBridge(
  frame: HTMLIFrameElement,
  options: PreviewSelectionBridgeOptions,
): PreviewSelectionBridge {
  if (!frame.contentWindow || !options.sessionId || options.sessionId.length > 200 ||
    options.editorOrigin !== window.location.origin) throw new Error('invalid-selection-config')
  const child = frame.contentWindow
  const host = frame.ownerDocument.defaultView
  if (!host) throw new Error('preview-host-missing')
  let disposed = false
  let ready = false
  let desiredEnabled = false
  let sequence = 0
  let loaded = false
  const pending = new Map<string, {
    command: keyof SelectionCommandPayloads
    payload: SelectionCommandPayloads[keyof SelectionCommandPayloads]
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: number
    sent: boolean
  }>()
  const timeout = options.requestTimeoutMs ?? 10000
  function post(type: keyof SelectionCommandPayloads, payload: SelectionCommandPayloads[keyof SelectionCommandPayloads], requestId: string) {
    child.postMessage({ protocol: SELECTION_PROTOCOL, protocolVersion: SELECTION_PROTOCOL_VERSION,
      sessionId: options.sessionId, requestId, type, payload }, '*')
  }
  function flush() {
    for (const [requestId, request] of pending) {
      if (!request.sent) {
        request.sent = true
        post(request.command, request.payload, requestId)
      }
    }
  }
  function request<Command extends keyof SelectionCommandPayloads>(
    command: Command,
    payload: SelectionCommandPayloads[Command],
  ): Promise<SelectionCommandResults[Command]> {
    if (disposed) return Promise.reject(new Error('bridge-disposed'))
    const requestId = `r${++sequence}`
    const { promise, resolve, reject } = Promise.withResolvers<SelectionCommandResults[Command]>()
    const timer = window.setTimeout(() => {
      pending.delete(requestId)
      reject(new Error('selection-timeout'))
    }, timeout)
    pending.set(requestId, { command, payload, timer, sent: false, reject, resolve(value) {
      // The command-indexed schema checks this before settling the matching request.
      resolve(value as SelectionCommandResults[Command])
    } })
    if (ready) flush()
    return promise
  }
  function dispose(reason = 'bridge-disposed') {
    if (disposed) return
    post('dispose', {}, `r${++sequence}`)
    disposed = true
    host?.removeEventListener('message', receive)
    frame.removeEventListener('load', loadedFrame)
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(new Error(reason))
    }
    pending.clear()
  }
  function receive(event: MessageEvent) {
    if (disposed || event.source !== child || event.origin !== 'null') return
    let size: number
    try { size = new TextEncoder().encode(JSON.stringify(event.data)).byteLength } catch { return }
    if (size > SELECTION_LIMITS.metadataBytes) return
    const parsed = envelope.safeParse(event.data)
    if (!parsed.success || parsed.data.sessionId !== options.sessionId) return
    const message = parsed.data
    if (message.type === 'result') {
      const result = resultPayload.safeParse(message.payload)
      const waiting = message.requestId ? pending.get(message.requestId) : undefined
      if (!result.success || !waiting || result.data.command !== waiting.command) return
      const value = resultSchemas[waiting.command].safeParse(result.data.value)
      if (!value.success) return
      clearTimeout(waiting.timer)
      if (message.requestId) pending.delete(message.requestId)
      waiting.resolve(value.data)
      return
    }
    const payload = eventSchemas[message.type].safeParse(message.payload)
    if (!payload.success) return
    if (message.type === 'error' && message.requestId) {
      const waiting = pending.get(message.requestId)
      const error = eventSchemas.error.safeParse(payload.data)
      if (!waiting || !error.success) return
      clearTimeout(waiting.timer)
      pending.delete(message.requestId)
      waiting.reject(new Error(error.data.code))
    } else if (message.requestId !== null) return
    if (message.type === 'ready') {
      ready = true
      flush()
    }
    if (message.type === 'error' && message.requestId === null) {
      const error = eventSchemas.error.safeParse(payload.data)
      if (error.success && error.data.code === 'document-replaced') dispose('document-replaced')
    }
    // Envelope and the corresponding discriminated event payload were both validated.
    options.onEvent?.({ ...message, payload: payload.data } as SelectionEvent)
  }
  function probe() {
    post('enable', { enabled: desiredEnabled }, `probe${++sequence}`)
  }
  function loadedFrame() {
    if (loaded && ready) {
      dispose('document-replaced')
      options.onEvent?.({ protocol: SELECTION_PROTOCOL, protocolVersion: SELECTION_PROTOCOL_VERSION,
        sessionId: options.sessionId, requestId: null, type: 'error',
        payload: { code: 'document-replaced', message: 'Preview document replaced' } })
      return
    }
    loaded = true
    probe()
  }
  host.addEventListener('message', receive)
  frame.addEventListener('load', loadedFrame)
  // Probe immediately as well as on load: callers may attach after the frame's ready event.
  probe()
  return {
    sessionId: options.sessionId,
    enable(enabled) { desiredEnabled = enabled; return request('enable', { enabled }) },
    children(parentNodeId, childOptions = {}) { return request('children', { parentNodeId, ...childOptions }) },
    select(nodeId) { return request('select', { nodeId }) },
    hover(nodeId) { return request('hover', { nodeId }) },
    parent() { return request('parent', {}) },
    capture(captureOptions = {}) { return request('capture', captureOptions) },
    clear() { return request('clear', {}) },
    dispose() { dispose() },
  }
}
