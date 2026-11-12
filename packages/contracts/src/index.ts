import { validateProjectSource } from '@atoms-demo/core/project'
import { oc } from '@orpc/contract'
import { z } from 'zod'

export const projectTemplateSchema = z.enum(['vanilla', 'react-ts'])
export const projectSourceSchema = z
  .object({ template: projectTemplateSchema, files: z.record(z.string(), z.string()) })
  .superRefine((source, context) => {
    try {
      validateProjectSource(source)
    } catch (error) {
      context.addIssue({
        code: 'custom',
        message: error instanceof Error ? error.message : 'Invalid project source.',
      })
    }
  })

export const projectStatusSchema = z.enum(['idle', 'generating', 'error'])
export const agentIdSchema = z.enum(['mike', 'emma', 'bob', 'alex', 'david'])
export const projectSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  idea: z.string(),
  status: projectStatusSchema,
  error: z.string().nullable(),
  currentVersionId: z.uuid().nullable(),
  publishedSlug: z.string().nullable(),
  publishedVersionId: z.uuid().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
  versionCount: z.number().int().nonnegative().optional(),
})
export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'agent', 'system']),
  agent: agentIdSchema.nullable(),
  content: z.string(),
  createdAt: z.number(),
})
export const versionSchema = z.object({
  id: z.uuid(),
  number: z.number().int().positive(),
  prompt: z.string(),
  createdAt: z.number(),
  html: z.string().optional(),
  source: projectSourceSchema.optional(),
})
export const ideaSchema = z.string().trim().min(1).max(4000)
export const createProjectSchema = z.object({ idea: ideaSchema })
export const followupSchema = z.object({ content: ideaSchema })
export const generateSchema = z.object({ content: ideaSchema.optional() })
export const runStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled'])
export const runErrorCodeSchema = z.enum([
  'timeout',
  'provider',
  'validation',
  'step_limit',
  'internal',
])
export const runSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  status: runStatusSchema,
  request: z.string(),
  createdAt: z.number(),
  startedAt: z.number().nullable(),
  finishedAt: z.number().nullable(),
  errorCode: runErrorCodeSchema.nullable(),
  error: z.string().nullable(),
  versionId: z.uuid().nullable(),
  cursor: z.number().int().nonnegative(),
})
export const runEventSchema = z.object({
  runId: z.uuid(),
  sequence: z.number().int().positive(),
  type: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.number(),
})
export const runReceiptSchema = z.object({ run: runSchema })
export type Run = z.infer<typeof runSchema>
export type RunEvent = z.infer<typeof runEventSchema>
export type RunErrorCode = z.infer<typeof runErrorCodeSchema>
export const apiErrors = {
  BAD_REQUEST: { status: 400, message: 'Invalid request.' },
  NOT_FOUND: { status: 404, message: 'Project or version not found.' },
  CONFLICT: { status: 409, message: 'The team is already working on this project.' },
  INTERNAL_SERVER_ERROR: { status: 500, message: 'Something went wrong.' },
} as const
const api = oc.errors(apiErrors)
const empty = z.object({})
const id = z.object({ id: z.uuid() })
const versionId = id.extend({ versionId: z.uuid() })
const ok = z.object({ ok: z.literal(true) })
const project = z.object({ project: projectSchema })

/** JSON project operations use oRPC; durable run receipts and replay use the HTTP transport. */
export const contract = {
  health: api
    .route({ method: 'GET', path: '/health' })
    .input(empty)
    .output(
      ok.extend({
        mock: z.boolean(),
        model: z.string(),
        hasKey: z.boolean(),
        executorConfigured: z.boolean(),
      }),
    ),
  me: api
    .route({ method: 'GET', path: '/me' })
    .input(empty)
    .output(z.object({ ownerId: z.uuid() })),
  projects: {
    list: api
      .route({ method: 'GET', path: '/projects' })
      .input(empty)
      .output(z.object({ projects: z.array(projectSchema) })),
    create: api
      .route({ method: 'POST', path: '/projects' })
      .input(createProjectSchema)
      .output(project),
    get: api
      .route({ method: 'GET', path: '/projects/{id}' })
      .input(id)
      .output(
        project.extend({
          messages: z.array(messageSchema),
          versions: z.array(versionSchema),
          html: z.string().nullable(),
          source: projectSourceSchema.nullable(),
        }),
      ),
    delete: api.route({ method: 'DELETE', path: '/projects/{id}' }).input(id).output(ok),
    version: api
      .route({ method: 'GET', path: '/projects/{id}/versions/{versionId}' })
      .input(versionId)
      .output(
        z.object({
          version: versionSchema.extend({ html: z.string(), source: projectSourceSchema }),
        }),
      ),
    publish: api
      .route({ method: 'POST', path: '/projects/{id}/publish' })
      .input(id)
      .output(z.object({ slug: z.string(), url: z.url(), versionId: z.uuid() })),
    unpublish: api.route({ method: 'POST', path: '/projects/{id}/unpublish' }).input(id).output(ok),
    remix: api
      .route({ method: 'POST', path: '/projects/{id}/remix' })
      .input(id.extend({ versionId: z.uuid().optional() }))
      .output(project),
    restore: api
      .route({ method: 'POST', path: '/projects/{id}/restore' })
      .input(versionId)
      .output(
        project.extend({
          html: z.string(),
          source: projectSourceSchema,
          number: z.number().int().positive(),
        }),
      ),
    cancel: api.route({ method: 'POST', path: '/projects/{id}/cancel' }).input(id).output(ok),
  },
}
