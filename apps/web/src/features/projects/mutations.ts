import { orpc } from '../../lib/api'

export const createProjectMutation = orpc.projects.create.mutationOptions()
export const deleteProjectMutation = orpc.projects.delete.mutationOptions()
export const restoreVersionMutation = orpc.projects.restore.mutationOptions()
export const publishProjectMutation = orpc.projects.publish.mutationOptions()
export const unpublishProjectMutation = orpc.projects.unpublish.mutationOptions()
export const remixProjectMutation = orpc.projects.remix.mutationOptions()
