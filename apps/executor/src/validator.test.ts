import { RunContext, tool } from '@openai/agents-core'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  artifactHash,
  browserCheckSchema,
  browserChecksSchema,
  validateArtifact,
} from './validator'

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
  it('normalizes old checkpoint checks without losing their assertion', () => {
    const assertion = { kind: 'text', selector: '#status', expected: 'Ready' }
    const check = browserCheckSchema.parse({ name: 'legacy', actions: [], assertion })
    expect(check.assertion).toEqual(assertion)
    expect(check.assertions).toEqual([])
    expect(check.viewport).toEqual({ width: 1280, height: 720 })
  })
  it.each([{ width: 375, height: 640 }, { width: 1440, height: 1200 }, null])(
    'accepts bounded or default viewports: %j',
    (viewport) => {
      expect(
        browserCheckSchema.safeParse({
          name: 'viewport',
          actions: [],
          viewport,
          assertions: [{ kind: 'no-horizontal-overflow', selector: 'body', expected: 'true' }],
        }).success,
      ).toBe(true)
    },
  )
  it.each([
    { width: 374, height: 640 },
    { width: 1441, height: 640 },
    { width: 375, height: 639 },
    { width: 375, height: 1201 },
    { width: 375.5, height: 640 },
    { width: 375, height: 640.5 },
    { width: 375 },
  ])('rejects invalid viewports: %j', (viewport) => {
    expect(
      browserCheckSchema.safeParse({
        name: 'viewport',
        actions: [],
        viewport,
        assertion: { kind: 'count', selector: 'body', expected: '1' },
      }).success,
    ).toBe(false)
  })
  it('accepts multiple exact assertions including attributes', () => {
    expect(
      browserCheckSchema.safeParse({
        name: 'selection',
        actions: [],
        assertion: null,
        assertions: [
          { kind: 'attribute', selector: '#choice', attribute: 'aria-pressed', expected: 'true' },
          { kind: 'text', selector: '#summary', attribute: null, expected: 'Selected' },
          { kind: 'count', selector: '.selected', expected: '1' },
        ],
      }).success,
    ).toBe(true)
  })
  it.each([undefined, null, '', 'a'.repeat(101)])(
    'requires a bounded attribute name: %s',
    (attribute) => {
      expect(
        browserCheckSchema.safeParse({
          name: 'attribute',
          actions: [],
          assertions: [{ kind: 'attribute', selector: '#choice', attribute, expected: 'true' }],
        }).success,
      ).toBe(false)
    },
  )
  it.each([
    { kind: 'evaluate', selector: 'body', expected: 'fetch(secret)' },
    { kind: 'no-horizontal-overflow', selector: 'body', expected: 'false' },
    { kind: 'attribute', selector: '#choice', attribute: 'aria-pressed', expected: true },
  ])('rejects unsupported assertions: $kind', (assertion) => {
    expect(browserCheckSchema.safeParse({ name: 'invalid', actions: [], assertion }).success).toBe(
      false,
    )
  })
  it('bounds total assertions across both old and new fields', () => {
    const assertion = { kind: 'count', selector: 'body', expected: '1' }
    const check = { name: 'bounded assertions', actions: [] }
    expect(browserCheckSchema.safeParse(check).success).toBe(false)
    expect(browserCheckSchema.safeParse({ ...check, assertions: [] }).success).toBe(false)
    expect(
      browserCheckSchema.safeParse({ ...check, assertions: Array(12).fill(assertion) }).success,
    ).toBe(true)
    expect(
      browserCheckSchema.safeParse({ ...check, assertion, assertions: Array(11).fill(assertion) })
        .success,
    ).toBe(true)
    expect(
      browserCheckSchema.safeParse({ ...check, assertions: Array(13).fill(assertion) }).success,
    ).toBe(false)
    expect(
      browserCheckSchema.safeParse({ ...check, assertion, assertions: Array(12).fill(assertion) })
        .success,
    ).toBe(false)
  })
  it('bounds actions and check collections at sixteen', () => {
    const action = { kind: 'click', selector: '#save', value: null }
    const check = {
      name: 'bounded actions',
      actions: Array(16).fill(action),
      assertion: { kind: 'count', selector: '#saved', expected: '1' },
    }
    expect(browserCheckSchema.safeParse(check).success).toBe(true)
    expect(
      browserCheckSchema.safeParse({ ...check, actions: Array(17).fill(action) }).success,
    ).toBe(false)
    expect(browserChecksSchema.safeParse(Array(2).fill(check)).success).toBe(true)
    expect(browserChecksSchema.safeParse(Array(16).fill(check)).success).toBe(true)
    expect(browserChecksSchema.safeParse([check]).success).toBe(false)
    expect(browserChecksSchema.safeParse(Array(17).fill(check)).success).toBe(false)
  })
  it('rejects out-of-bounds checkpoints before allocating a browser', async () => {
    const check = {
      name: 'invalid checkpoint',
      actions: [],
      assertion: { kind: 'count' as const, selector: 'body', expected: '1' },
      viewport: { width: 374, height: 640 },
    }
    const report = await validateArtifact(
      '<!doctype html><html><body>Candidate</body></html>',
      [check, check],
      new AbortController().signal,
    )
    expect(report.valid).toBe(false)
    expect(report.checks).toEqual([])
    expect(report.issues.some((issue) => issue.startsWith('Invalid acceptance checks:'))).toBe(true)
  })
  it('normalizes strict-tool nulls while retaining legacy checkpoint defaults', async () => {
    const acceptanceTool = tool({
      name: 'set_acceptance_checks',
      description: 'Store checks',
      parameters: z.object({ checks: browserChecksSchema }),
      execute: async ({ checks }) => checks,
    })
    const check = {
      name: 'strict optional fields',
      actions: [{ kind: 'click', selector: '#save', value: null }],
      viewport: null,
      assertion: { kind: 'text', selector: '#status', attribute: null, expected: 'Saved' },
      assertions: null,
    }
    const result = await acceptanceTool.invoke(
      new RunContext(),
      JSON.stringify({ checks: [check, check] }),
    )
    expect(result).toEqual([
      { ...check, assertions: [] },
      { ...check, assertions: [] },
    ])
  })
})
