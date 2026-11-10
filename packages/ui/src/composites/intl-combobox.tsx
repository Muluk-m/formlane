import { useI18n } from '@atoms-demo/i18n/react'
import { useMemo } from 'react'
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '#components/combobox'

/** Full ISO 4217 and IANA catalogs from the runtime (PRD 7.4); never a hand-kept list. */
export const supportedCurrencies = (): string[] => Intl.supportedValuesOf('currency')
export const supportedTimeZones = (): string[] => Intl.supportedValuesOf('timeZone')

function SearchableSelect({
  items,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  items: string[]
  value: string | null
  onChange: (value: string) => void
  placeholder: string
  disabled?: boolean
}) {
  const { t } = useI18n()
  return (
    <Combobox
      items={items}
      value={value}
      onValueChange={(next) => {
        if (typeof next === 'string') onChange(next)
      }}
      disabled={disabled}
    >
      <ComboboxInput placeholder={placeholder} />
      <ComboboxContent>
        <ComboboxEmpty>{t('ui.combobox.empty')}</ComboboxEmpty>
        <ComboboxList>
          {(item: string) => (
            <ComboboxItem key={item} value={item}>
              {item}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}

export function CurrencyCombobox(props: {
  value: string | null
  onChange: (code: string) => void
  disabled?: boolean
}) {
  const items = useMemo(supportedCurrencies, [])
  const { t } = useI18n()
  return <SearchableSelect {...props} items={items} placeholder={t('ui.currency.placeholder')} />
}

export function TimeZoneCombobox(props: {
  value: string | null
  onChange: (zone: string) => void
  disabled?: boolean
}) {
  const items = useMemo(supportedTimeZones, [])
  const { t } = useI18n()
  return <SearchableSelect {...props} items={items} placeholder={t('ui.timeZone.placeholder')} />
}
