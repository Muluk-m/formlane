import { expect, it } from 'vitest'
import { applyArtifactEdits } from './agents'

const html =
  '<!doctype html><html><head><title>Market</title></head><body><script>const name = "old";</script><p>Keep me</p></body></html>'

it('applies unique literal repairs in order without expanding replacement tokens', () => {
  const updated = applyArtifactEdits(html, [
    { find: 'const name = "old";', replacement: 'const name = "$&";' },
    { find: 'const name = "$&";', replacement: 'const name = "$1";' },
  ])
  expect(updated).toBe(
    '<!doctype html><html><head><title>Market</title></head><body><script>const name = "$1";</script><p>Keep me</p></body></html>',
  )
})

it('rejects stale, ambiguous, unchanged and oversized repairs', () => {
  expect(() => applyArtifactEdits(html, [{ find: 'missing', replacement: 'x' }])).toThrow()
  expect(() => applyArtifactEdits(html, [{ find: 'html', replacement: 'main' }])).toThrow()
  expect(() => applyArtifactEdits(html, [{ find: 'Market', replacement: 'Market' }])).toThrow()
  expect(() =>
    applyArtifactEdits(html, [{ find: 'Market', replacement: 'x'.repeat(180000) }]),
  ).toThrow()
})
