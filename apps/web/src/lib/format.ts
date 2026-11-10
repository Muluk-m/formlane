import { type Locale, localeTag, translate } from '@atoms-demo/i18n'

export function relativeTime(timestamp: number, locale: Locale): string {
  const minutes = Math.round((timestamp - Date.now()) / 60_000)
  if (Math.abs(minutes) < 1) return translate(locale, 'atoms.justNow')
  const formatter = new Intl.RelativeTimeFormat(localeTag[locale], { numeric: 'auto' })
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute')
  const hours = Math.round(minutes / 60)
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour')
  const days = Math.round(hours / 24)
  if (Math.abs(days) < 14) return formatter.format(days, 'day')
  return new Date(timestamp).toLocaleDateString(localeTag[locale])
}

export function formatBytes(bytes: number, locale: Locale): string {
  return bytes < 1024
    ? translate(locale, 'atoms.bytes', { count: bytes })
    : translate(locale, 'atoms.kilobytes', { count: (bytes / 1024).toFixed(1) })
}
