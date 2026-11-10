import { parseAlexOutput } from './alex-stream'

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function extractHtml(raw: string): string | null {
  const parsed = parseAlexOutput(raw)
  const source = parsed.code.trim() ? parsed.code : raw
  const doctype = source.search(/<!doctype html/i)
  const start = doctype === -1 ? source.search(/<html[\s>]/i) : doctype
  if (start === -1) return null
  const slice = source.slice(start)
  const end = slice.search(/<\/html>/i)
  if (end === -1) return null
  const html = slice.slice(0, end + '</html>'.length).trim()
  if (html.length < 40 || !/<body[\s>]/i.test(html)) return null
  return html
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string | null | undefined): value is string {
  return !!value && UUID_RE.test(value)
}

export function slugify(value: string): string {
  const cleaned = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
  return cleaned || 'app'
}

export function makeSlug(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(10)
  crypto.getRandomValues(bytes)
  let out = ''
  for (const byte of bytes) out += alphabet[byte % alphabet.length]
  return out
}
