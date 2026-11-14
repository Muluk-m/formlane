import { type SelectionSubmission, selectionImageSchema } from '@atoms-demo/contracts'
import type {
  SelectionElementContext,
  SelectionEvidence,
  SelectionRect,
  SelectionSourceManifest,
} from '@atoms-demo/core/selection'

export type SelectionImage = NonNullable<SelectionSubmission['image']>

/** App-owned marker values are ordinary DOM attributes, never source authority. */
export function mappedEvidence(
  evidence: SelectionEvidence,
  manifest: SelectionSourceManifest,
): SelectionEvidence {
  const source = (id: string | null) => (id && Object.hasOwn(manifest.entries, id) ? id : null)
  const element = (value: SelectionElementContext): SelectionElementContext => ({
    ...value,
    sourceId: source(value.sourceId),
    ancestors: value.ancestors.map((ancestor) => ({
      ...ancestor,
      sourceId: source(ancestor.sourceId),
    })),
  })
  return evidence.kind === 'element'
    ? { kind: 'element', element: element(evidence.element) }
    : {
        ...evidence,
        elements: evidence.elements.map(element),
        focus: evidence.focus ? element(evidence.focus) : null,
      }
}

export function selectionRectangle(evidence: SelectionEvidence): SelectionRect | null {
  if (evidence.kind === 'region') return evidence.rectangle
  const rects = evidence.element.rects.filter((rect) => rect.width > 0 && rect.height > 0)
  if (!rects.length) return null
  const x = Math.min(...rects.map((rect) => rect.x))
  const y = Math.min(...rects.map((rect) => rect.y))
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  }
}

async function imageAttachment(blob: Blob, width: number, height: number): Promise<SelectionImage> {
  if (blob.size > 2_000_000 || width * height > 16_000_000 || width > 16384 || height > 16384)
    throw new Error('image-limit')
  const { promise, resolve, reject } = Promise.withResolvers<string>()
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('image-read'))
  reader.onload = () =>
    typeof reader.result === 'string'
      ? resolve(reader.result.split(',')[1] ?? '')
      : reject(new Error('image-read'))
  reader.readAsDataURL(blob)
  return selectionImageSchema.parse({
    provenance: 'client-captured',
    mimeType: blob.type,
    base64: await promise,
    width,
    height,
  })
}

export async function uploadedSelectionImage(file: File): Promise<SelectionImage> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 2_000_000)
    throw new Error('image-limit')
  const bitmap = await createImageBitmap(file)
  try {
    return await imageAttachment(file, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

/** CropTarget's successful restriction verifies the shared surface contains this exact
 * frame. Display labels, preferCurrentTab and aspect ratio alone cannot prove that.
 * Unsupported browsers refuse capture; no DOM rendering is substituted for pixels. */
export async function captureSelectionImage(
  frame: HTMLIFrameElement,
  prepare: () => Promise<SelectionEvidence>,
  signal: AbortSignal,
): Promise<SelectionImage> {
  const capabilities: object = globalThis
  if (!navigator.mediaDevices?.getDisplayMedia || !('CropTarget' in capabilities))
    throw new Error('capture-unsupported')
  const cropTarget = capabilities.CropTarget
  if (
    !cropTarget ||
    (typeof cropTarget !== 'object' && typeof cropTarget !== 'function') ||
    !('fromElement' in cropTarget) ||
    typeof cropTarget.fromElement !== 'function'
  )
    throw new Error('capture-unsupported')
  const displayOptions: DisplayMediaStreamOptions &
    Pick<MediaStreamConstraints, 'preferCurrentTab'> = {
    video: { displaySurface: 'browser' },
    audio: false,
    preferCurrentTab: true,
  }
  // Keep the native chooser call in the initiating user gesture.
  const stream = await navigator.mediaDevices.getDisplayMedia(displayOptions)
  const stop = () => {
    for (const track of stream.getTracks()) track.stop()
  }
  signal.addEventListener('abort', stop, { once: true })
  const video = document.createElement('video')
  try {
    if (signal.aborted) throw new Error('capture-cancelled')
    const track = stream.getVideoTracks()[0]
    if (
      track?.getSettings().displaySurface !== 'browser' ||
      !('cropTo' in track) ||
      typeof track.cropTo !== 'function'
    )
      throw new Error('capture-surface')
    const target: unknown = await cropTarget.fromElement(frame)
    await track.cropTo(target)
    const evidence = await prepare()
    const rectangle = selectionRectangle(evidence)
    const viewport = evidence.kind === 'element' ? evidence.element.viewport : evidence.viewport
    if (!rectangle) throw new Error('capture-outside')
    video.srcObject = stream
    video.muted = true
    const {
      promise: videoFrame,
      resolve: frameReady,
      reject: frameFailed,
    } = Promise.withResolvers<void>()
    const timer = window.setTimeout(() => {
      video.cancelVideoFrameCallback(callback)
      frameFailed(new Error('capture-frame'))
    }, 5000)
    const callback = video.requestVideoFrameCallback(() => {
      window.clearTimeout(timer)
      frameReady()
    })
    try {
      await Promise.all([video.play(), videoFrame])
    } finally {
      window.clearTimeout(timer)
      video.cancelVideoFrameCallback(callback)
    }
    if (signal.aborted || track.readyState !== 'live' || !frame.isConnected)
      throw new Error('capture-cancelled')
    const bounds = frame.getBoundingClientRect()
    if (
      Math.abs(bounds.width - viewport.width) > 1 ||
      Math.abs(bounds.height - viewport.height) > 1
    )
      throw new Error('capture-viewport')
    const scaleX = video.videoWidth / viewport.width
    const scaleY = video.videoHeight / viewport.height
    if (!Number.isFinite(scaleX) || scaleX <= 0 || Math.abs(scaleX - scaleY) > 0.02)
      throw new Error('capture-geometry')
    const left = Math.max(0, rectangle.x)
    const top = Math.max(0, rectangle.y)
    const right = Math.min(viewport.width, rectangle.x + rectangle.width)
    const bottom = Math.min(viewport.height, rectangle.y + rectangle.height)
    if (right <= left || bottom <= top) throw new Error('capture-outside')
    const width = Math.max(1, Math.round((right - left) * scaleX))
    const height = Math.max(1, Math.round((bottom - top) * scaleY))
    if (width * height > 16_000_000 || width > 16384 || height > 16384)
      throw new Error('image-limit')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('capture-canvas')
    context.drawImage(
      video,
      left * scaleX,
      top * scaleY,
      (right - left) * scaleX,
      (bottom - top) * scaleY,
      0,
      0,
      canvas.width,
      canvas.height,
    )
    const {
      promise: encoded,
      resolve: encodedImage,
      reject: encodeFailed,
    } = Promise.withResolvers<Blob>()
    canvas.toBlob(
      (value) => (value ? encodedImage(value) : encodeFailed(new Error('capture-encode'))),
      'image/png',
    )
    return await imageAttachment(await encoded, canvas.width, canvas.height)
  } finally {
    signal.removeEventListener('abort', stop)
    stop()
    video.pause()
    video.srcObject = null
  }
}
