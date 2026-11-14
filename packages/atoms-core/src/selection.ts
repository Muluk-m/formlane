export const SELECTION_PROTOCOL = 'formlane-selection' as const
export const SELECTION_PROTOCOL_VERSION = 1 as const
export const SELECTION_SOURCE_ATTRIBUTE = 'data-formlane-source' as const
export const SELECTION_LIMITS = {
  metadataBytes: 64 * 1024,
  textCharacters: 2000,
  ancestors: 12,
  regionMembers: 32,
  children: 200,
  imageBytes: 2_000_000,
  selectorCharacters: 1000,
  attributeCharacters: 500,
  instanceCharacters: 500,
  rects: 32,
} as const

/** Positions are one-based UTF-16 columns; the end is exclusive in the immutable source. */
export interface SelectionSourceLocation {
  path: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
  tagName: string
}

/** Private compiler output. Browser source IDs are hints, never source authority. */
export interface SelectionSourceManifest {
  instrumentationVersion: string
  sourceHash: string
  canonicalArtifactHash: string
  editorArtifactHash: string
  entries: Record<string, SelectionSourceLocation>
}

export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SelectionViewport {
  width: number
  height: number
}

export interface SelectionScroll {
  x: number
  y: number
}

export interface SelectionAncestor {
  nodeId: string
  sourceId: string | null
  tagName: string
  label: string
}

/** One live instance; multiple instances may share the same compiler sourceId. */
export interface SelectionElementContext {
  nodeId: string
  sourceId: string | null
  tagName: string
  role: string | null
  text: string
  attributes: Record<string, string>
  styles: Record<string, string>
  selector: string
  ancestors: SelectionAncestor[]
  rects: SelectionRect[]
  viewport: SelectionViewport
  scroll: SelectionScroll
  instance: { label: string; context: string }
}

export interface SelectionElementEvidence {
  kind: 'element'
  element: SelectionElementContext
}

export interface SelectionRegionEvidence {
  kind: 'region'
  rectangle: SelectionRect
  elements: SelectionElementContext[]
  focus: SelectionElementContext | null
  viewport: SelectionViewport
  scroll: SelectionScroll
  /** True when the deterministic member limit excluded intersecting nodes. */
  truncated: boolean
}

export type SelectionEvidence = SelectionElementEvidence | SelectionRegionEvidence

export interface SelectionLayerRow {
  nodeId: string
  tagName: string
  label: string
  sourceId: string | null
  hasChildren: boolean
  hidden: boolean
}

export interface SelectionChildrenPage {
  parentNodeId: string | null
  children: SelectionLayerRow[]
  /** Opaque document-local continuation, null when the list is complete. */
  nextCursor: string | null
}

export interface SelectionCommandPayloads {
  enable: { enabled: boolean }
  children: { parentNodeId: string | null; cursor?: string | null; includeHidden?: boolean }
  select: { nodeId: string }
  hover: { nodeId: string | null }
  parent: Record<string, never>
  capture: { region?: SelectionRect; focusNodeId?: string | null }
  clear: Record<string, never>
  dispose: Record<string, never>
}

export interface SelectionCommandResults {
  enable: { enabled: boolean }
  children: SelectionChildrenPage
  select: SelectionElementEvidence
  hover: null
  parent: SelectionElementEvidence | null
  capture: SelectionEvidence | null
  clear: null
  dispose: null
}

export interface SelectionEnvelope<Type extends string, Payload> {
  protocol: typeof SELECTION_PROTOCOL
  protocolVersion: typeof SELECTION_PROTOCOL_VERSION
  sessionId: string
  requestId: string | null
  type: Type
  payload: Payload
}

export type SelectionCommand = {
  [Command in keyof SelectionCommandPayloads]: SelectionEnvelope<
    Command,
    SelectionCommandPayloads[Command]
  > & { requestId: string }
}[keyof SelectionCommandPayloads]

export type SelectionResult = {
  [Command in keyof SelectionCommandResults]: SelectionEnvelope<
    'result',
    { command: Command; value: SelectionCommandResults[Command] }
  > & { requestId: string }
}[keyof SelectionCommandResults]

export type SelectionEvent =
  | SelectionEnvelope<'ready', { enabled: boolean }>
  | SelectionEnvelope<'selected', SelectionElementEvidence>
  | SelectionEnvelope<'cleared', null>
  | SelectionEnvelope<'invalidated', { nodeId: string }>
  | SelectionEnvelope<'error', { code: string; message: string }>

/** A resolver must report uncertainty; DOM metadata never authorizes source access. */
export type SelectionSourceResolution =
  | { status: 'mapped'; sourceId: string; location: SelectionSourceLocation }
  | { status: 'unmapped'; reason: string }
  | { status: 'ambiguous'; candidates: SelectionSourceLocation[] }
  | { status: 'stale'; reason: string }

export type SelectionImageProvenance =
  | 'client-captured'
  | 'server-reconstructed'
  | 'dom-approximation'
