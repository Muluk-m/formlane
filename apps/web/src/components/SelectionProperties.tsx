import { useI18n } from '@atoms-demo/i18n/react'
import { Button } from '@atoms-demo/ui/components/button'
import {
  Combobox,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@atoms-demo/ui/components/combobox'
import { Field, FieldDescription, FieldLabel, FieldSet } from '@atoms-demo/ui/components/field'
import { Input } from '@atoms-demo/ui/components/input'
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@atoms-demo/ui/components/popover'
import {
  PaintBucketIcon,
  SlidersHorizontalIcon,
  TextBoldIcon,
  TextColorIcon,
  TextItalicIcon,
  TextUnderlineIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useId } from 'react'
import {
  type SelectionStyleDraft,
  type SelectionStyleProperty,
  validateSelectionStyles,
} from '../features/projects/selection-styles'

export type SelectionPropertiesProps = {
  styles: Record<string, string>
  draft: SelectionStyleDraft
  onChange: (property: SelectionStyleProperty, value: string) => void
  disabled?: boolean
}

const propertyLabels = {
  'font-family': 'atoms.selection.editor.fontFamily',
  'font-size': 'atoms.selection.editor.fontSize',
  'font-weight': 'atoms.selection.editor.fontWeight',
  'font-style': 'atoms.selection.editor.fontStyle',
  'line-height': 'atoms.selection.editor.lineHeight',
  'letter-spacing': 'atoms.selection.editor.letterSpacing',
  'text-align': 'atoms.selection.editor.textAlign',
  'text-transform': 'atoms.selection.editor.textTransform',
  'text-decoration-line': 'atoms.selection.editor.textDecoration',
  color: 'atoms.selection.editor.color',
  'background-color': 'atoms.selection.editor.backgroundColor',
} as const

const choices = {
  'font-style': [
    ['normal', 'normal'],
    ['italic', 'italic'],
    ['oblique', 'oblique'],
  ],
  'text-align': [
    ['left', 'left'],
    ['center', 'center'],
    ['right', 'right'],
    ['justify', 'justify'],
    ['start', 'start'],
    ['end', 'end'],
  ],
  'text-transform': [
    ['none', 'none'],
    ['uppercase', 'uppercase'],
    ['lowercase', 'lowercase'],
    ['capitalize', 'capitalize'],
  ],
  'text-decoration-line': [
    ['none', 'none'],
    ['underline', 'underline'],
    ['line-through', 'lineThrough'],
    ['overline', 'overline'],
  ],
} as const

const suggestions = {
  'font-family': ['system-ui, sans-serif', 'Arial, sans-serif', 'Georgia, serif', 'monospace'],
  'font-size': ['12px', '14px', '16px', '20px', '24px', '32px', '48px'],
  'font-weight': ['100', '200', '300', '400', '500', '600', '700', '800', '900'],
  'line-height': ['normal', '1', '1.25', '1.5', '1.75', '2'],
  'letter-spacing': ['normal', '-0.02em', '0', '0.02em', '0.05em', '0.1em'],
} as const

const advancedProperties = [
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
] as const

function styleValue(props: SelectionPropertiesProps, property: SelectionStyleProperty): string {
  return props.draft[property] ?? props.styles[property] ?? ''
}

function StyleField({
  property,
  compact = false,
  ...props
}: SelectionPropertiesProps & { property: SelectionStyleProperty; compact?: boolean }) {
  const { t } = useI18n()
  const id = useId()
  const value = styleValue(props, property)
  const label = t(propertyLabels[property])
  const invalid =
    props.draft[property] !== undefined && !validateSelectionStyles({ [property]: value })
  const options = property in choices ? choices[property as keyof typeof choices] : undefined
  const presets =
    property in suggestions ? suggestions[property as keyof typeof suggestions] : undefined
  const color = property === 'color' || property === 'background-color'

  return (
    <Field className="min-w-0 gap-1.5" data-invalid={invalid || undefined}>
      <FieldLabel htmlFor={id} className={compact ? 'sr-only' : 'text-xs text-muted-foreground'}>
        {label}
      </FieldLabel>
      <div className="relative">
        {color && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-2 left-2 size-4 rounded-sm border border-foreground/15"
            style={{
              backgroundColor: validateSelectionStyles({ [property]: value }) ? value : undefined,
            }}
          />
        )}
        {presets || options ? (
          <Combobox
            items={presets ? [...presets] : options?.map(([option]) => option)}
            value={value}
            inputValue={value}
            onInputValueChange={(next) => props.onChange(property, next)}
            onValueChange={(next) => {
              if (next !== null) props.onChange(property, next)
            }}
            disabled={props.disabled}
          >
            <ComboboxInput
              id={id}
              title={label}
              aria-label={label}
              aria-invalid={invalid || undefined}
              aria-describedby={property === 'font-family' && !compact ? `${id}-hint` : undefined}
              autoComplete="off"
              spellCheck={false}
              className="text-xs"
            />
            <ComboboxContent>
              <ComboboxList>
                {(item: string) => {
                  const option = options?.find(([candidate]) => candidate === item)
                  return (
                    <ComboboxItem key={item} value={item}>
                      {option ? t(`atoms.selection.editor.${option[1]}`) : item}
                    </ComboboxItem>
                  )
                }}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        ) : (
          <Input
            id={id}
            value={value}
            title={label}
            aria-label={label}
            disabled={props.disabled}
            aria-invalid={invalid || undefined}
            autoComplete="off"
            spellCheck={false}
            className={color ? 'pl-8 text-xs md:text-xs' : 'text-xs md:text-xs'}
            onChange={(event) => props.onChange(property, event.target.value)}
          />
        )}
      </div>
      {property === 'font-family' && !compact && (
        <FieldDescription id={`${id}-hint`} className="text-[11px] leading-4">
          {t('atoms.selection.editor.fontFamilyHint')}
        </FieldDescription>
      )}
    </Field>
  )
}

export function SelectionProperties(props: SelectionPropertiesProps) {
  const { t } = useI18n()
  return (
    <FieldSet
      aria-label={t('atoms.selection.editor.properties')}
      className="flex w-full min-w-0 flex-col gap-4 bg-background text-foreground"
    >
      <h3 className="text-xs font-semibold">{t('atoms.selection.editor.typography')}</h3>
      <StyleField {...props} property="font-family" />
      <div className="grid grid-cols-2 gap-3">
        <StyleField {...props} property="font-size" />
        <StyleField {...props} property="font-weight" />
        <StyleField {...props} property="font-style" />
        <StyleField {...props} property="line-height" />
        <StyleField {...props} property="letter-spacing" />
        <StyleField {...props} property="text-align" />
        <StyleField {...props} property="text-transform" />
        <StyleField {...props} property="text-decoration-line" />
      </div>
      <h3 className="border-t border-border pt-4 text-xs font-semibold">
        {t('atoms.selection.editor.colors')}
      </h3>
      <StyleField {...props} property="color" />
      <StyleField {...props} property="background-color" />
    </FieldSet>
  )
}

function QuickColor({
  property,
  ...props
}: SelectionPropertiesProps & { property: 'color' | 'background-color' }) {
  const { t } = useI18n()
  const value = styleValue(props, property)
  const label = t(propertyLabels[property])
  return (
    <Popover>
      <PopoverTrigger
        render={<Button type="button" variant="ghost" size="icon" disabled={props.disabled} />}
        aria-label={label}
        title={label}
      >
        <span className="flex flex-col items-center gap-0.5">
          <HugeiconsIcon
            icon={property === 'color' ? TextColorIcon : PaintBucketIcon}
            strokeWidth={1.5}
            className="size-4"
          />
          <span
            aria-hidden="true"
            className="h-1 w-4 rounded-sm border border-foreground/15"
            style={{
              backgroundColor: validateSelectionStyles({ [property]: value }) ? value : undefined,
            }}
          />
        </span>
      </PopoverTrigger>
      <PopoverContent className="w-64" align="end">
        <PopoverTitle>{label}</PopoverTitle>
        <StyleField {...props} property={property} compact />
      </PopoverContent>
    </Popover>
  )
}

export function SelectionQuickStyles(props: SelectionPropertiesProps) {
  const { t } = useI18n()
  const weight = styleValue(props, 'font-weight')
  const bold = weight === 'bold' || weight === 'bolder' || Number(weight) >= 600
  const baselineWeight = props.styles['font-weight'] ?? '400'
  const baselineBold =
    baselineWeight === 'bold' || baselineWeight === 'bolder' || Number(baselineWeight) >= 600
  const italic = /^(italic|oblique)\b/.test(styleValue(props, 'font-style'))
  const baselineStyle = props.styles['font-style'] ?? 'normal'
  const baselineItalic = /^(italic|oblique)\b/.test(baselineStyle)
  const decorations = styleValue(props, 'text-decoration-line').split(/\s+/)
  const underline = decorations.includes('underline')
  const toggles = [
    {
      key: 'bold',
      icon: TextBoldIcon,
      pressed: bold,
      property: 'font-weight',
      next: bold ? (baselineBold ? '400' : baselineWeight) : baselineBold ? baselineWeight : '700',
    },
    {
      key: 'italic',
      icon: TextItalicIcon,
      pressed: italic,
      property: 'font-style',
      next: italic ? 'normal' : baselineItalic ? baselineStyle : 'italic',
    },
    {
      key: 'underline',
      icon: TextUnderlineIcon,
      pressed: underline,
      property: 'text-decoration-line',
      next: underline
        ? decorations.filter((value) => value !== 'underline').join(' ') || 'none'
        : [
            ...decorations.filter((value) => ['overline', 'line-through', 'blink'].includes(value)),
            'underline',
          ].join(' '),
    },
  ] as const

  return (
    <FieldSet
      aria-label={t('atoms.selection.editor.quickStyles')}
      className="flex min-w-0 flex-row flex-wrap items-center gap-1"
    >
      <div className="w-28 min-w-0">
        <StyleField {...props} property="font-family" compact />
      </div>
      <div className="w-20 min-w-0">
        <StyleField {...props} property="font-size" compact />
      </div>
      {toggles.map(({ key, icon, pressed, property, next }) => (
        <Button
          key={key}
          type="button"
          variant={pressed ? 'secondary' : 'ghost'}
          size="icon"
          aria-label={t(`atoms.selection.editor.${key}`)}
          title={t(`atoms.selection.editor.${key}`)}
          aria-pressed={pressed}
          disabled={props.disabled}
          onClick={() => props.onChange(property, next)}
        >
          <HugeiconsIcon icon={icon} strokeWidth={1.5} className="size-4" />
        </Button>
      ))}
      <QuickColor {...props} property="color" />
      <QuickColor {...props} property="background-color" />
      <Popover>
        <PopoverTrigger
          render={<Button type="button" variant="ghost" size="icon" disabled={props.disabled} />}
          aria-label={t('atoms.selection.editor.moreStyles')}
          title={t('atoms.selection.editor.moreStyles')}
        >
          <HugeiconsIcon icon={SlidersHorizontalIcon} strokeWidth={1.5} className="size-4" />
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="max-h-[min(28rem,70vh)] w-[280px] max-w-[calc(100vw-2rem)] overflow-y-auto"
        >
          <PopoverTitle>{t('atoms.selection.editor.typography')}</PopoverTitle>
          <div className="grid grid-cols-2 gap-3">
            {advancedProperties.map((property) => (
              <StyleField key={property} {...props} property={property} />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </FieldSet>
  )
}
