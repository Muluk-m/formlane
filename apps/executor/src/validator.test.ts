import { describe, expect, it } from 'vitest'
import { artifactHash, browserCheckSchema, validateArtifact } from './validator'

describe('artifact acceptance boundaries', () => {
  it('rejects incomplete HTML before allocating a browser', async () => {
    const report = await validateArtifact(
      '<html><body>unfinished',
      [],
      new AbortController().signal,
    )
    expect(report.valid).toBe(false)
    expect(report.issues).toContain('Return a complete HTML document.')
  })
  it('binds validation evidence to the exact candidate', async () => {
    expect(await artifactHash('<button>Save</button>')).not.toBe(
      await artifactHash('<button>Delete</button>'),
    )
    expect(await artifactHash('<button>Save</button>')).toBe(
      await artifactHash('<button>Save</button>'),
    )
  })
  it('rejects arbitrary privileged evaluation instructions', () => {
    expect(
      browserCheckSchema.safeParse({
        name: 'exfiltrate',
        actions: [{ kind: 'evaluate', selector: 'body', value: 'fetch(secret)' }],
        assertion: { kind: 'text', selector: 'body', expected: 'ok' },
      }).success,
    ).toBe(false)
  })
  it.each([
    { kind: 'press', selector: '#task', value: 'Enter' },
    { kind: 'press', selector: '#task', value: 'Escape' },
    { kind: 'reload', selector: 'body', value: null },
  ])('accepts bounded keyboard and reload actions: $kind $value', (action) => {
    expect(
      browserCheckSchema.safeParse({
        name: 'interaction',
        actions: [action],
        assertion: { kind: 'count', selector: 'li', expected: '0' },
      }).success,
    ).toBe(true)
  })
  it.each([
    { kind: 'press', selector: '#task', value: 'Control+L' },
    { kind: 'press', selector: '#task', value: 'fetch(secret)' },
    { kind: 'press', selector: '#task', value: null },
    { kind: 'press', selector: '#task', value: '' },
    { kind: 'reload', selector: 'body', value: 'https://example.com' },
    { kind: 'reload', selector: '#task', value: null },
    { kind: 'fill', selector: '#task', value: null },
    { kind: 'click', selector: '#task', value: 'Enter' },
  ])('rejects invalid action keys and values: $kind $value', (action) => {
    expect(
      browserCheckSchema.safeParse({
        name: 'invalid action',
        actions: [action],
        assertion: { kind: 'count', selector: 'li', expected: '0' },
      }).success,
    ).toBe(false)
  })
})
