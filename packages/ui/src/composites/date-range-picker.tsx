import { useI18n } from '@atoms-demo/i18n/react'
import { Calendar03Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { differenceInCalendarDays, format } from 'date-fns'
import { enUS, zhCN } from 'date-fns/locale'
import { useState } from 'react'
import type { DateRange } from 'react-day-picker'
import { Button } from '#components/button'
import { Calendar } from '#components/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '#components/popover'

export type IsoRange = { start: string; end: string }

const toIso = (d: Date) => format(d, 'yyyy-MM-dd')
const fromIso = (s: string) => new Date(`${s}T00:00:00`)

/**
 * Inclusive calendar-date range (YYYY-MM-DD), capped at `maxDays` (PRD: 31).
 * Dates are calendar days in the project's timezone; the server re-validates with dateRangeSchema.
 */
export function DateRangePicker({
  value,
  onChange,
  maxDays,
  minDate,
  maxDate,
  disabled,
}: {
  value: IsoRange | null
  onChange: (range: IsoRange) => void
  maxDays: number
  minDate?: string
  maxDate?: string
  disabled?: boolean
}) {
  const { locale, t } = useI18n()
  const dateLocale = locale === 'en' ? enUS : zhCN
  const [draft, setDraft] = useState<DateRange | undefined>(
    value ? { from: fromIso(value.start), to: fromIso(value.end) } : undefined,
  )
  const [open, setOpen] = useState(false)

  const tooLong =
    draft?.from && draft.to ? differenceInCalendarDays(draft.to, draft.from) + 1 > maxDays : false

  const label = value ? `${value.start} ~ ${value.end}` : t('ui.dateRange.placeholder')

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="outline" disabled={disabled} />}>
        <HugeiconsIcon icon={Calendar03Icon} strokeWidth={1.5} />
        <span className="num">{label}</span>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          locale={dateLocale}
          numberOfMonths={2}
          selected={draft}
          onSelect={setDraft}
          disabled={[
            ...(minDate ? [{ before: fromIso(minDate) }] : []),
            ...(maxDate ? [{ after: fromIso(maxDate) }] : []),
          ]}
        />
        <div className="flex items-center justify-between gap-3 border-t p-3 text-xs">
          <span className={tooLong ? 'text-destructive' : 'text-muted-foreground'}>
            {t('ui.dateRange.maxDays', { maxDays })}
          </span>
          <Button
            size="sm"
            disabled={!draft?.from || !draft.to || tooLong}
            onClick={() => {
              if (!draft?.from || !draft.to) return
              onChange({ start: toIso(draft.from), end: toIso(draft.to) })
              setOpen(false)
            }}
          >
            {t('ui.dateRange.confirm')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
