import { SELECTION_LIMITS } from '@atoms-demo/core/selection'
import { z } from 'zod'

const boundedText = (max: number) => z.string().max(max).refine(value => !value.includes('\0'), 'NUL is not supported')
const identifier = boundedText(128).min(1)
const hash = z.string().regex(/^[0-9a-f]{64}$/)
const tag = z.string().regex(/^[a-zA-Z][a-zA-Z0-9:_-]{0,63}$/)
const coordinate = z.number().min(-10_000_000).max(10_000_000)
const dimension = z.number().min(0).max(1_000_000)
const attributes: Record<string, true> = {
  id: true, class: true, role: true, 'aria-label': true, 'aria-labelledby': true,
  'aria-describedby': true, 'aria-expanded': true, 'aria-pressed': true,
  'aria-selected': true, 'aria-checked': true, 'aria-disabled': true,
  title: true, alt: true, type: true, name: true, placeholder: true,
  disabled: true, checked: true, tabindex: true,
}
const styles: Record<string, true> = {
  display: true, visibility: true, position: true, color: true, 'background-color': true,
  'font-family': true, 'font-size': true, 'font-weight': true, 'line-height': true,
  'text-align': true, 'text-decoration': true, width: true, height: true, margin: true,
  padding: true, border: true, 'border-radius': true, opacity: true, overflow: true,
  'overflow-x': true, 'overflow-y': true, 'z-index': true, transform: true,
  'flex-direction': true, 'align-items': true, 'justify-content': true, gap: true,
  'grid-template-columns': true,
}

export const selectionSourceLocationSchema = z.strictObject({
  path: boundedText(240).min(1), startLine: z.number().int().positive(), startColumn: z.number().int().positive(),
  endLine: z.number().int().positive(), endColumn: z.number().int().positive(), tagName: tag,
})
export const selectionSourceManifestSchema = z.strictObject({
  instrumentationVersion: identifier, sourceHash: hash, canonicalArtifactHash: hash, editorArtifactHash: hash,
  entries: z.record(identifier, selectionSourceLocationSchema).refine(entries => Object.keys(entries).length <= 4096),
})
export const selectionRectSchema = z.strictObject({ x: coordinate, y: coordinate, width: dimension, height: dimension })
const viewport = z.strictObject({ width: z.number().positive().max(16384), height: z.number().positive().max(16384) })
const scroll = z.strictObject({ x: coordinate, y: coordinate })
const ancestor = z.strictObject({ nodeId: identifier, sourceId: identifier.nullable(), tagName: tag, label: boundedText(500) })
export const selectionElementContextSchema = z.strictObject({
  nodeId: identifier, sourceId: identifier.nullable(), tagName: tag, role: boundedText(100).nullable(),
  text: boundedText(SELECTION_LIMITS.textCharacters),
  attributes: z.record(z.string().refine(key => Object.hasOwn(attributes, key)), boundedText(SELECTION_LIMITS.attributeCharacters)),
  styles: z.record(z.string().refine(key => Object.hasOwn(styles, key)), boundedText(SELECTION_LIMITS.attributeCharacters)),
  selector: boundedText(SELECTION_LIMITS.selectorCharacters), ancestors: z.array(ancestor).max(SELECTION_LIMITS.ancestors),
  rects: z.array(selectionRectSchema).max(SELECTION_LIMITS.rects), viewport, scroll,
  instance: z.strictObject({ label: boundedText(500), context: boundedText(500) }),
}).superRefine((value, context) => {
  if (['script', 'style', 'meta', 'link', 'head', 'title', 'noscript', 'template'].includes(value.tagName.toLowerCase()) ||
      (value.attributes.type?.toLowerCase() === 'password' && value.text)) {
    context.addIssue({ code: 'custom', message: 'Selection must exclude technical nodes and password content' })
  }
})
export const selectionEvidenceSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('element'), element: selectionElementContextSchema }),
  z.strictObject({
    kind: z.literal('region'), rectangle: selectionRectSchema,
    elements: z.array(selectionElementContextSchema).max(SELECTION_LIMITS.regionMembers),
    focus: selectionElementContextSchema.nullable(), viewport, scroll, truncated: z.boolean(),
  }).superRefine((value, context) => {
    const members = new Map(value.elements.map(element => [element.nodeId, element]))
    const focus = value.focus
    const focusedMember = focus ? members.get(focus.nodeId) : undefined
    const area = value.rectangle
    const focusMatches = !focus || (
      focus.viewport.width === value.viewport.width && focus.viewport.height === value.viewport.height &&
      focus.scroll.x === value.scroll.x && focus.scroll.y === value.scroll.y &&
      focus.rects.some(rect => rect.width > 0 && rect.height > 0 &&
        rect.x < area.x + area.width && rect.x + rect.width > area.x &&
        rect.y < area.y + area.height && rect.y + rect.height > area.y)
    )
    if (members.size !== value.elements.length || area.width <= 0 || area.height <= 0 || !focusMatches ||
        (focusedMember && focus && (focusedMember.sourceId !== focus.sourceId || focusedMember.tagName !== focus.tagName))) {
      context.addIssue({ code: 'custom', message: 'Region requires distinct members, positive area and consistent intersecting focus' })
    }
  }),
])
export const selectionImageSchema = z.strictObject({
  provenance: z.enum(['client-captured', 'dom-approximation']),
  mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
  base64: z.string().min(4).max(2_666_668).regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  width: z.number().int().min(1).max(16384), height: z.number().int().min(1).max(16384),
}).superRefine((image, context) => {
  const padding = image.base64.endsWith('==') ? 2 : image.base64.endsWith('=') ? 1 : 0
  if (image.width * image.height > 16_000_000 || image.base64.length / 4 * 3 - padding > SELECTION_LIMITS.imageBytes) {
    context.addIssue({ code: 'custom', message: 'Selection image exceeds its byte or pixel limit' })
  }
})
const reproduction = z.strictObject({
  steps: z.array(boundedText(500)).max(20), clock: z.iso.datetime({ offset: true }).max(40).nullable().optional(),
  seed: z.number().int().min(0).max(4_294_967_295).nullable().optional(),
})
const submission = z.strictObject({
  versionId: z.uuid(), sourceHash: hash, canonicalArtifactHash: hash, editorArtifactHash: hash,
  instrumentationVersion: identifier, sessionId: identifier, documentId: identifier,
  evidence: selectionEvidenceSchema, image: selectionImageSchema.nullable().optional(), reproduction: reproduction.nullable().optional(),
})
export const selectionSubmissionSchema = submission.superRefine((value, context) => {
  const { image, ...metadata } = value
  const metadataImage = image ? { provenance: image.provenance, mimeType: image.mimeType, width: image.width, height: image.height } : image
  if (new TextEncoder().encode(JSON.stringify({ ...metadata, ...(image !== undefined ? { image: metadataImage } : {}) })).length > SELECTION_LIMITS.metadataBytes) {
    context.addIssue({ code: 'custom', message: 'Selection metadata exceeds 64 KiB' })
  }
})
export const selectionSourceResolutionSchema = z.discriminatedUnion('status', [
  z.strictObject({ nodeId: identifier, status: z.literal('mapped'), sourceId: identifier, location: selectionSourceLocationSchema }),
  z.strictObject({ nodeId: identifier, status: z.literal('unmapped'), reason: boundedText(500) }),
])
export const selectionAttachmentSchema = submission.extend({
  selectionId: z.uuid(), projectId: z.uuid(), createdAt: z.number().int().nonnegative(),
  sourceResolutions: z.array(selectionSourceResolutionSchema).max(SELECTION_LIMITS.regionMembers + 1),
})
export const selectionSummarySchema = z.strictObject({
  selectionId: z.uuid(), kind: z.enum(['element', 'region']), tagName: tag.nullable(),
  memberCount: z.number().int().min(0).max(SELECTION_LIMITS.regionMembers), hasImage: z.boolean(),
})
export const editorArtifactSchema = z.strictObject({
  projectId: z.uuid(), versionId: z.uuid(), html: z.string(), editorHtml: z.string(),
  manifest: selectionSourceManifestSchema,
  diagnostics: z.array(z.strictObject({
    code: z.enum(['reserved-marker', 'jsx-spread', 'instrumentation-limit']), path: boundedText(240).optional(),
    startLine: z.number().int().positive().optional(), startColumn: z.number().int().positive().optional(),
  })).max(200),
})

export type SelectionSubmission = z.infer<typeof selectionSubmissionSchema>
export type SelectionAttachment = z.infer<typeof selectionAttachmentSchema>
export type SelectionSummary = z.infer<typeof selectionSummarySchema>
export type EditorArtifact = z.infer<typeof editorArtifactSchema>
