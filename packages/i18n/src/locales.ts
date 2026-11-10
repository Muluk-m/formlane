export const locales = ['zh', 'en'] as const
export type Locale = (typeof locales)[number]
export const defaultLocale: Locale = 'zh'

/** BCP 47 tags written to `<html lang>` and mail. */
export const localeTag: Record<Locale, string> = {
  zh: 'zh-CN',
  en: 'en',
}

export const LOCALE_STORAGE_KEY = 'atoms-demo.locale'

export type LocaleStorage = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'en'
}

export function parseLocale(value: unknown): Locale | null {
  return isLocale(value) ? value : null
}

export function readLocale(localeStore: LocaleStorage | null | undefined): Locale {
  return parseLocale(localeStore?.getItem(LOCALE_STORAGE_KEY)) ?? defaultLocale
}

/**
 * The marketing site links into the app with `?lang=`. Persist a valid value and
 * drop the parameter so a refresh does not override a later in-app switch.
 * An unrecognized value is removed and does not change the stored locale.
 */
export function consumeLocaleSearch(href: string, localeStore: LocaleStorage): string {
  const url = new URL(href)
  if (!url.searchParams.has('lang')) return href
  const locale = parseLocale(url.searchParams.get('lang'))
  if (locale) localeStore.setItem(LOCALE_STORAGE_KEY, locale)
  url.searchParams.delete('lang')
  return url.toString()
}
