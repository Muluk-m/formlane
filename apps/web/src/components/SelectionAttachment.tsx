import type { SelectionSubmission, SelectionSummary } from '@atoms-demo/contracts'
import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import { Input } from '@atoms-demo/ui/components/input'
import { Label } from '@atoms-demo/ui/components/label'
import { useId, useRef, useState } from 'react'
import { uploadedSelectionImage } from '../features/projects/selection'

export function SelectionMessageSummary({ summary }: { summary: SelectionSummary }) {
  const { t } = useI18n()
  return (
    <p className="mt-2 text-xs text-muted-foreground" data-testid="message-selection-summary">
      {summary.kind === 'region'
        ? t('atoms.selection.regionCount', { count: summary.memberCount })
        : t('atoms.selection.element', { tag: summary.tagName ?? '' })}
      {summary.hasImage && ` · ${t('atoms.selection.imageLabel')}`}
    </p>
  )
}

export function SelectionAttachment({
  selection,
  stale,
  disabled,
  onChange,
}: {
  selection: SelectionSubmission
  stale: boolean
  disabled: boolean
  onChange: (selection: SelectionSubmission | null) => void
}) {
  const { t } = useI18n()
  const inputId = useId()
  const latest = useRef(selection)
  latest.current = selection
  const [error, setError] = useState(false)
  const [uploading, setUploading] = useState(false)
  const evidence = selection.evidence
  const element = evidence.kind === 'element' ? evidence.element : evidence.focus
  const unmapped =
    evidence.kind === 'element'
      ? !evidence.element.sourceId
      : evidence.elements.some((member) => !member.sourceId)
  return (
    <section
      aria-label={t('atoms.selection.attachment')}
      data-testid="selection-attachment"
      className="mx-6 max-h-64 shrink-0 overflow-auto rounded-lg border bg-card p-3 text-xs"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <p className="font-medium">
            {evidence.kind === 'element'
              ? t('atoms.selection.element', { tag: evidence.element.tagName })
              : t('atoms.selection.regionCount', { count: evidence.elements.length })}
          </p>
          {element && (
            <p className="line-clamp-2 break-words">{element.instance.label || element.text}</p>
          )}
          <p className="text-muted-foreground">{t('atoms.selection.replace')}</p>
        </div>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          data-testid="selection-remove"
          onClick={() => onChange(null)}
        >
          {t('atoms.selection.remove')}
        </Button>
      </div>
      {stale && (
        <p role="alert" className="mt-2 text-destructive">
          {t('atoms.selection.stale')}
        </p>
      )}
      {unmapped && <p className="mt-2 text-muted-foreground">{t('atoms.selection.unmapped')}</p>}
      {selection.image && (
        <figure className="mt-2 space-y-1">
          <img
            src={`data:${selection.image.mimeType};base64,${selection.image.base64}`}
            alt={t('atoms.selection.image')}
            className="max-h-28 max-w-full rounded-md object-contain"
          />
          <figcaption className="text-muted-foreground">
            {t('atoms.selection.imageLabel')}
          </figcaption>
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled}
            onClick={() => onChange({ ...selection, image: null })}
          >
            {t('atoms.selection.removeImage')}
          </Button>
        </figure>
      )}
      <Label htmlFor={inputId} className="mt-2 block font-medium">
        {t('atoms.selection.upload')}
      </Label>
      <Input
        id={inputId}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={disabled || uploading}
        data-testid="selection-upload"
        onChange={async (event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (!file) return
          setUploading(true)
          setError(false)
          try {
            const image = await uploadedSelectionImage(file)
            if (latest.current === selection) onChange({ ...selection, image })
          } catch {
            setError(true)
          } finally {
            setUploading(false)
          }
        }}
      />
      {error && (
        <p role="alert" className="mt-2 text-destructive">
          {t('atoms.selection.imageError')}
        </p>
      )}
    </section>
  )
}
