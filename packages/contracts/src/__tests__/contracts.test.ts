import { describe, expect, it } from 'vitest'
import { createProjectSchema, followupSchema, projectSchema } from '../index'

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
