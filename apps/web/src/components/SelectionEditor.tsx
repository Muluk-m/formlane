import type { SelectionElementContext, SelectionGeometry } from '@atoms-demo/core/selection'
import { useI18n } from '@atoms-demo/i18n/react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@atoms-demo/ui/components/alert-dialog'
import { Button } from '@atoms-demo/ui/components/button'
import { Textarea } from '@atoms-demo/ui/components/textarea'
import { Cancel01Icon, Delete02Icon, Settings01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  changedSelectionStyles,
  type SelectionStyleDraft,
  type SelectionStyleProperty,
  validateSelectionStyles,
} from '../features/projects/selection-styles'
import { SelectionProperties, SelectionQuickStyles } from './SelectionProperties'

export function SelectionEditor({
  element,
  geometry,
  canvas,
  editing,
  capturing,
  disabled,
  panelOpen,
  onPanelOpen,
  layers,
  onLayers,
  layerTree,
  tools,
  ancestors,
  comment,
  onComment,
  onClear,
  onSubmit,
}: {
  element: SelectionElementContext | null
  geometry: SelectionGeometry | null
  canvas: HTMLDivElement | null
  editing: boolean
  capturing: boolean
  disabled: boolean
  panelOpen: boolean
  onPanelOpen: (open: boolean) => void
  layers: boolean
  onLayers: (layers: boolean) => void
  layerTree: ReactNode
  tools: ReactNode
  ancestors: ReactNode
  comment: string
  onComment: (comment: string) => void
  onClear: () => void
  onSubmit: (content: string) => Promise<void>
}) {
  const { t } = useI18n()
  const nodeId = element?.nodeId ?? null
  const [draftState, setDraftState] = useState<{
    nodeId: string | null
    values: SelectionStyleDraft
  }>({ nodeId, values: {} })
  const draft = draftState.nodeId === nodeId ? draftState.values : {}
  useEffect(() => {
    setDraftState({ nodeId, values: {} })
  }, [nodeId])
  const resetDraft = () => setDraftState({ nodeId, values: {} })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [size, setSize] = useState({ width: 0, height: 0, editorHeight: 160 })
  const floating = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (!canvas) return
    const measure = () =>
      setSize({
        width: canvas.clientWidth,
        height: canvas.clientHeight,
        editorHeight: floating.current?.offsetHeight ?? 160,
      })
    const observer = new ResizeObserver(measure)
    observer.observe(canvas)
    if (floating.current) observer.observe(floating.current)
    measure()
    return () => observer.disconnect()
  }, [canvas])
  const styles = element?.styles ?? {}
  const changes = changedSelectionStyles(styles, draft)
  const hasChanges = Object.keys(changes).length > 0
  const valid = validateSelectionStyles(changes)
  const blocked = disabled || capturing || pending || !element
  const canSubmit = !blocked && valid && (hasChanges || Boolean(comment.trim()))
  const update = (property: SelectionStyleProperty, value: string) => {
    setDraftState((previous) => ({
      nodeId,
      values: { ...(previous.nodeId === nodeId ? previous.values : {}), [property]: value },
    }))
    setError(null)
  }
  async function submit(remove = false) {
    if (blocked || (!remove && !canSubmit)) return
    const content = remove
      ? t('atoms.selection.editor.deleteRequest')
      : [
          comment.trim(),
          hasChanges
            ? t('atoms.selection.editor.styleRequest', {
                changes: JSON.stringify(changes),
              })
            : '',
        ]
          .filter(Boolean)
          .join('\n\n')
    setPending(true)
    setError(null)
    try {
      await onSubmit(content)
      onComment('')
      resetDraft()
      setConfirmDelete(false)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t('atoms.requestError'))
    } finally {
      setPending(false)
    }
  }
  function submitForm(event: FormEvent) {
    event.preventDefault()
    void submit()
  }
  const currentGeometry = geometry?.nodeId === element?.nodeId ? geometry : null
  const box = currentGeometry?.rects.find(
    (rect) =>
      rect.x + rect.width > 0 &&
      rect.y + rect.height > 0 &&
      rect.x < currentGeometry.viewport.width &&
      rect.y < currentGeometry.viewport.height,
  )
  const width = Math.max(0, Math.min(480, size.width - 16))
  const scaleX = currentGeometry ? size.width / currentGeometry.viewport.width : 1
  const scaleY = currentGeometry ? size.height / currentGeometry.viewport.height : 1
  const left = box ? Math.max(8, Math.min(box.x * scaleX, size.width - width - 8)) : 8
  const below = box ? (box.y + box.height) * scaleY + 8 : 8
  const above = box ? box.y * scaleY - size.editorHeight - 8 : 8
  const top = Math.max(
    8,
    Math.min(
      below + size.editorHeight <= size.height - 8 ? below : Math.max(above, 8),
      size.height - size.editorHeight - 8,
    ),
  )
  const applyLabel = t(
    pending ? 'atoms.selection.editor.submitting' : 'atoms.selection.editor.apply',
  )
  return (
    <>
      {canvas &&
        createPortal(
          <form
            ref={floating}
            hidden={!editing || capturing || !element || !box || width === 0}
            onSubmit={submitForm}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.stopPropagation()
                onClear()
              }
            }}
            className="absolute z-20 overflow-auto rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg"
            style={{ left, top, width, maxHeight: Math.max(0, size.height - 16) }}
            data-testid="selection-floating-editor"
          >
            <div className="mb-2 flex items-center gap-2">
              <code className="min-w-0 flex-1 truncate text-xs">{element?.tagName}</code>
              <Button
                type="button"
                size="icon-sm"
                aria-label={t('atoms.selection.editor.properties')}
                title={t('atoms.selection.editor.properties')}
                variant="ghost"
                onClick={() => {
                  onLayers(false)
                  onPanelOpen(!panelOpen)
                }}
              >
                <HugeiconsIcon icon={Settings01Icon} size={18} strokeWidth={1.5} />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                aria-label={t('atoms.selection.editor.deleteElement')}
                title={t('atoms.selection.editor.deleteElement')}
                variant="ghost"
                disabled={blocked}
                onClick={() => setConfirmDelete(true)}
              >
                <HugeiconsIcon icon={Delete02Icon} size={18} strokeWidth={1.5} />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                onClick={onClear}
                aria-label={t('atoms.selection.editor.close')}
                title={t('atoms.selection.editor.close')}
              >
                <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.5} />
              </Button>
            </div>
            <SelectionQuickStyles
              styles={styles}
              draft={draft}
              onChange={update}
              disabled={blocked}
            />
            <Textarea
              className="mt-2 min-h-16 resize-none"
              value={comment}
              onChange={(event) => onComment(event.target.value)}
              placeholder={t('atoms.selection.editor.commentPlaceholder')}
              aria-label={t('atoms.selection.editor.commentPlaceholder')}
              disabled={pending}
              data-testid="selection-inline-comment"
            />
            {(!valid || error) && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {error ?? t('atoms.selection.editor.invalidStyles')}
              </p>
            )}
            <div className="mt-2 flex justify-end gap-2">
              {hasChanges && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={pending}
                  onClick={resetDraft}
                >
                  {t('atoms.selection.editor.clearStyles')}
                </Button>
              )}
              <Button type="submit" size="sm" disabled={!canSubmit} data-testid="selection-apply">
                {applyLabel}
              </Button>
            </div>
          </form>,
          canvas,
        )}
      {editing && panelOpen && (
        <aside
          className="absolute inset-y-0 right-0 z-30 flex w-72 max-w-full shrink-0 flex-col overflow-hidden rounded-lg border bg-background shadow-lg @min-[640px]:static @min-[640px]:z-auto @min-[640px]:shadow-none"
          aria-label={t('atoms.selection.editor.properties')}
          data-testid="selection-inspector"
          style={{ visibility: capturing ? 'hidden' : undefined }}
        >
          <div className="flex shrink-0 items-center gap-1 border-b p-2">
            <Button
              size="sm"
              variant={layers ? 'ghost' : 'secondary'}
              aria-pressed={!layers}
              onClick={() => onLayers(false)}
            >
              {t('atoms.selection.editor.properties')}
            </Button>
            <Button
              size="sm"
              variant={layers ? 'secondary' : 'ghost'}
              aria-pressed={layers}
              onClick={() => onLayers(true)}
            >
              {t('atoms.selection.layers')}
            </Button>
            <Button
              className="ml-auto"
              size="icon-sm"
              aria-label={t('atoms.selection.editor.close')}
              title={t('atoms.selection.editor.close')}
              variant="ghost"
              onClick={() => onPanelOpen(false)}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.5} />
            </Button>
          </div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
            {tools}
            {layers ? (
              layerTree
            ) : element ? (
              <>
                {ancestors}
                <SelectionProperties
                  styles={styles}
                  draft={draft}
                  onChange={update}
                  disabled={blocked}
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t('atoms.selection.editor.selectElement')}
              </p>
            )}
          </div>
          {element && (
            <div className="shrink-0 space-y-2 border-t p-3">
              {(!valid || error) && (
                <p role="alert" className="text-xs text-destructive">
                  {error ?? t('atoms.selection.editor.invalidStyles')}
                </p>
              )}
              <Button className="w-full" disabled={!canSubmit} onClick={() => void submit()}>
                {applyLabel}
              </Button>
            </div>
          )}
        </aside>
      )}
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('atoms.selection.editor.deleteElement')}</AlertDialogTitle>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>
              {t('atoms.selection.editor.close')}
            </AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={blocked}
              onClick={() => void submit(true)}
            >
              {applyLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
