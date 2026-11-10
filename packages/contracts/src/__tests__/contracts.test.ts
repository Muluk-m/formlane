import { describe, expect, it } from 'vitest'
import {
  createProjectSchema,
  followupSchema,
  generateSchema,
  projectSchema,
  runSchema,
} from '../index'

describe('Atoms DTO validation', () => {
  it('trims project ideas and rejects empty or overlong input', () => {
    expect(createProjectSchema.parse({ idea: '  Build a planner  ' })).toEqual({
      idea: 'Build a planner',
    })
    expect(createProjectSchema.safeParse({ idea: '  ' }).success).toBe(false)
    expect(createProjectSchema.safeParse({ idea: 'x'.repeat(4001) }).success).toBe(false)
  })
  it('uses the same limits for follow-up messages', () => {
    expect(followupSchema.parse({ content: '  Make it blue  ' }).content).toBe('Make it blue')
    expect(followupSchema.safeParse({ content: '' }).success).toBe(false)
  })
  it('allows an initial run to use the idea or a fresh retry instruction', () => {
    expect(generateSchema.parse({})).toEqual({})
    expect(generateSchema.parse({ content: '  Build a calendar instead  ' })).toEqual({
      content: 'Build a calendar instead',
    })
    expect(generateSchema.safeParse({ content: '' }).success).toBe(false)
  })
  it('keeps run failure categories distinct from project presentation status', () => {
    const run = {
      id: crypto.randomUUID(),
      projectId: crypto.randomUUID(),
      status: 'failed',
      request: 'Build',
      createdAt: 1,
      startedAt: 2,
      finishedAt: 3,
      errorCode: 'timeout',
      error: 'Budget exceeded.',
      versionId: null,
      cursor: 4,
    }
    expect(runSchema.parse(run).errorCode).toBe('timeout')
    expect(runSchema.safeParse({ ...run, status: 'idle' }).success).toBe(false)
    expect(runSchema.safeParse({ ...run, errorCode: 'stopped' }).success).toBe(false)
  })
  it('rejects foreign project status values', () => {
    expect(
      projectSchema.safeParse({
        id: crypto.randomUUID(),
        title: 'Planner',
        idea: 'Plan',
        status: 'published',
        error: null,
        currentVersionId: null,
        publishedSlug: null,
        publishedVersionId: null,
        createdAt: 1,
        updatedAt: 1,
      }).success,
    ).toBe(false)
  })
})
