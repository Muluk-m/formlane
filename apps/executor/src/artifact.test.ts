import { expect, it } from 'vitest'
import { applyFileEdits } from './agents'

const html =
  '<!doctype html><html><head><title>Market</title></head><body><script>const name = "old";</script><p>Keep me</p></body></html>'

it('applies unique literal repairs in order without expanding replacement tokens', () => {
  const updated = applyFileEdits(html, [
    { find: 'const name = "old";', replacement: 'const name = "$&";' },
    { find: 'const name = "$&";', replacement: 'const name = "$1";' },
  ])
  expect(updated).toBe(
    '<!doctype html><html><head><title>Market</title></head><body><script>const name = "$1";</script><p>Keep me</p></body></html>',
  )
})

it('rejects stale, ambiguous, unchanged and oversized repairs', () => {
  expect(() => applyFileEdits(html, [{ find: 'missing', replacement: 'x' }])).toThrow()
  expect(() => applyFileEdits(html, [{ find: 'html', replacement: 'main' }])).toThrow()
  expect(() => applyFileEdits(html, [{ find: 'Market', replacement: 'Market' }])).toThrow()
  expect(() =>
    applyFileEdits(html, [{ find: 'Market', replacement: 'x'.repeat(180000) }]),
  ).toThrow()
})

it('supports short source modules and empty files after a deletion edit', () => {
  expect(applyFileEdits('export const n = 1', [{ find: '1', replacement: '2' }])).toBe(
    'export const n = 2',
  )
  expect(applyFileEdits('remove me', [{ find: 'remove me', replacement: '' }])).toBe('')
})
