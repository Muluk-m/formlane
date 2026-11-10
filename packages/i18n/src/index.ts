import en from './en.json'
import type { Locale, LocaleStorage } from './locales'
import {
  consumeLocaleSearch,
  defaultLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  locales,
  localeTag,
  parseLocale,
  readLocale,
} from './locales'
import zh from './zh.json'

export type { Locale, LocaleStorage }
export {
  consumeLocaleSearch,
  defaultLocale,
  isLocale,
  LOCALE_STORAGE_KEY,
  locales,
  localeTag,
  parseLocale,
  readLocale,
}

const catalogs = { zh, en } satisfies Record<Locale, typeof zh>

type Join<A extends string, B extends string> = A extends '' ? B : `${A}.${B}`
type Leaves<T, P extends string = ''> = T extends string
  ? P
  : T extends Record<string, unknown>
    ? { [K in keyof T & string]: Leaves<T[K], Join<P, K>> }[keyof T & string]
    : never

/** Dot path of every string in zh.json. en.json must carry the same keys. */
export type MessageKey = Leaves<typeof zh>
export type MessageParams = Record<string, string | number>

function dig(catalog: unknown, key: string): string {
  let node: unknown = catalog
  for (const part of key.split('.')) {
    if (
      typeof node !== 'object' ||
      node === null ||
      Array.isArray(node) ||
      !Object.hasOwn(node, part)
    ) {
      throw new Error(`Missing message ${key}`)
    }
    node = (node as Record<string, unknown>)[part]
  }
  if (typeof node !== 'string' || node.length === 0)
    throw new Error(`Message ${key} is not a string`)
  return node
}

/** The raw catalog string. Placeholders such as `{name}` are left untouched. */
export function message(locale: Locale, key: MessageKey): string {
  return dig(catalogs[locale], key)
}

const placeholder = /\{([A-Za-z][A-Za-z0-9]*)\}/g

export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  return message(locale, key).replace(placeholder, (_token, name: string) => {
    const value = params?.[name]
    if (value === undefined) throw new Error(`Missing param ${name} for ${key}`)
    return String(value)
  })
}

/** Split a raw message around a single `{slot}` that is not a translate parameter. */
export function splitSlot(template: string, slot: string): [string, string] {
  const token = `{${slot}}`
  const index = template.indexOf(token)
  if (index < 0) throw new Error(`Missing slot ${token}`)
  return [template.slice(0, index), template.slice(index + token.length)]
}
