import { createProjectSource } from '@atoms-demo/core/project'
import { describe, expect, it } from 'vitest'
import {
  createProjectSchema,
  followupSchema,
  generateSchema,
  projectCandidateSchema,
  projectSchema,
  runEventSchema,
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
  it('allows an initial run to use the idea or an explicit new instruction', () => {
    expect(generateSchema.parse({})).toEqual({})
    expect(generateSchema.parse({ content: '  Build a calendar instead  ' })).toEqual({
      content: 'Build a calendar instead',
    })
    expect(generateSchema.safeParse({ content: '' }).success).toBe(false)
  })
  it('retains candidate source with an optional compiled artifact independently of versions', () => {
    const candidate = {
      runId: crypto.randomUUID(),
      source: createProjectSource('react-ts'),
      sourceHash: 'candidate-source',
      html: null,
      artifactHash: null,
      createdAt: 10,
    }
    expect(projectCandidateSchema.parse(candidate)).toEqual(candidate)
    const compiled = {
      ...candidate,
      html: '<!doctype html><html><body>Draft</body></html>',
      artifactHash: 'candidate-artifact',
    }
    expect(projectCandidateSchema.parse(compiled)).toEqual(compiled)
    expect(projectCandidateSchema.nullable().parse(null)).toBeNull()
    expect(projectCandidateSchema.safeParse({ ...candidate, runId: 'invalid' }).success).toBe(false)
    expect(
      projectCandidateSchema.safeParse({
        ...candidate,
        source: { template: 'react-ts', files: {} },
      }).success,
    ).toBe(false)
    expect(projectCandidateSchema.safeParse({ ...candidate, html: undefined }).success).toBe(false)
    expect(
      projectCandidateSchema.safeParse({ ...candidate, artifactHash: undefined }).success,
    ).toBe(false)
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
    expect(runSchema.parse(run)).toMatchObject({ attempt: 1, resumable: false })
    expect(runSchema.parse({ ...run, attempt: 2, resumable: true })).toMatchObject({
      attempt: 2,
      resumable: true,
    })
    for (const attempt of [0, -1, 1.5])
      expect(runSchema.safeParse({ ...run, attempt }).success).toBe(false)
    expect(runSchema.safeParse({ ...run, resumable: 'true' }).success).toBe(false)
    expect(runSchema.parse({ ...run, errorCode: 'step_limit' }).errorCode).toBe('step_limit')
    expect(runSchema.safeParse({ ...run, status: 'idle' }).success).toBe(false)
    expect(runSchema.safeParse({ ...run, errorCode: 'stopped' }).success).toBe(false)
  })
  it('defaults historical event attempts and preserves resumed event identity', () => {
    const event = {
      runId: crypto.randomUUID(),
      sequence: 3,
      type: 'run_state',
      data: { status: 'failed' },
      createdAt: 1,
    }
    expect(runEventSchema.parse(event).attempt).toBe(1)
    expect(runEventSchema.parse({ ...event, attempt: 2 }).attempt).toBe(2)
    for (const attempt of [0, -1, 1.5])
      expect(runEventSchema.safeParse({ ...event, attempt }).success).toBe(false)
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
