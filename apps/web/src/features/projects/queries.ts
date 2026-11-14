import { orpc } from '../../lib/api'

export const projectsQuery = orpc.projects.list.queryOptions({ input: {} })
export const projectQuery = (id: string) => orpc.projects.get.queryOptions({ input: { id } })
export const versionQuery = (id: string, versionId: string) =>
  orpc.projects.version.queryOptions({ input: { id, versionId } })
export const editorVersionQuery = (id: string, versionId: string) =>
  orpc.projects.editorVersion.queryOptions({ input: { id, versionId }, staleTime: Infinity, retry: false })
