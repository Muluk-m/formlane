import type { ReactNode } from 'react'
import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import type { MessageKey, MessageParams } from './index'
import { translate } from './index'
import type { Locale } from './locales'
import { defaultLocale, LOCALE_STORAGE_KEY, localeTag, readLocale } from './locales'

export type Translate = (key: MessageKey, params?: MessageParams) => string

type I18nValue = {
  locale: Locale
  setLocale: (locale: Locale) => void
  t: Translate
}

const I18nContext = createContext<I18nValue | null>(null)

function fallbackValue(): I18nValue {
  return {
    locale: defaultLocale,
    setLocale() {},
    t: (key, params) => translate(defaultLocale, key, params),
  }
}

/**
 * Reads `atoms-demo.locale` from localStorage. Outside a provider, `useI18n`
 * stays on the default locale so shared UI still renders Chinese.
 */
export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(() =>
    typeof window === 'undefined' ? defaultLocale : readLocale(window.localStorage),
  )

  useEffect(() => {
    document.documentElement.lang = localeTag[locale]
  }, [locale])

  const setLocale = useCallback((next: Locale) => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, next)
    setLocaleState(next)
  }, [])

  const t = useCallback<Translate>((key, params) => translate(locale, key, params), [locale])

  return <I18nContext.Provider value={{ locale, setLocale, t }}>{children}</I18nContext.Provider>
}

export function useI18n(): I18nValue {
  return useContext(I18nContext) ?? fallbackValue()
}
