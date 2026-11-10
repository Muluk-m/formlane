import { contract } from '@atoms-demo/contracts'
import { OpenAPIHandler } from '@orpc/openapi/fetch'
import { implement } from '@orpc/server'
import { type Env, mockEnabled, modelName } from '../env'
import { type ProjectContext, projectsService } from '../modules/projects/projects.service'

export type RpcContext = ProjectContext & { env: Env }
const os = implement(contract).$context<RpcContext>()
const router = os.router({
  health: os.health.handler(({ context }) => ({
    ok: true,
    mock: mockEnabled(context.env),
    model: modelName(context.env),
    hasKey: Boolean(context.env.OPENAI_API_KEY?.trim()),
  })),
  me: os.me.handler(({ context }) => ({ ownerId: context.ownerId })),
  projects: {
    list: os.projects.list.handler(({ context }) => projectsService.list(context)),
    create: os.projects.create.handler(({ input, context }) =>
      projectsService.create(context, input.idea),
    ),
    get: os.projects.get.handler(({ input, context }) => projectsService.get(context, input.id)),
    delete: os.projects.delete.handler(({ input, context }) =>
      projectsService.delete(context, input.id),
    ),
    version: os.projects.version.handler(({ input, context }) =>
      projectsService.version(context, input.id, input.versionId),
    ),
    publish: os.projects.publish.handler(({ input, context }) =>
      projectsService.publish(context, input.id),
    ),
    unpublish: os.projects.unpublish.handler(({ input, context }) =>
      projectsService.unpublish(context, input.id),
    ),
    remix: os.projects.remix.handler(({ input, context }) =>
      projectsService.remix(context, input.id),
    ),
    restore: os.projects.restore.handler(({ input, context }) =>
      projectsService.restore(context, input.id, input.versionId),
    ),
    cancel: os.projects.cancel.handler(({ input, context }) =>
      projectsService.cancel(context, input.id),
    ),
  },
})
export const rpcHandler = new OpenAPIHandler(router)
