import { projectSourceSchema, type RunEvent } from '@atoms-demo/contracts'
import { isProjectPath, type ProjectSource } from '@atoms-demo/core/project'

export type ProjectBuild = { ok: boolean; issues: string[]; sourceHash?: string }
export type ProjectWorkspace = {
  source: ProjectSource | null
  drafts: Record<string, string>
  activePath: string | null
  dirty: boolean
  build: ProjectBuild | null
}

export function projectWorkspace(source: ProjectSource | null): ProjectWorkspace {
  return { source, drafts: {}, activePath: null, dirty: false, build: null }
}

/** Streamed replacements are visible drafts; only file_saved changes working source. */
export function reduceProjectEvent(state: ProjectWorkspace, event: RunEvent): ProjectWorkspace {
  const { type, data } = event
  if (type === 'project_reset' || type === 'project_initialized') {
    if (type === 'project_reset' && data.source === null) return projectWorkspace(null)
    const parsed = projectSourceSchema.safeParse(data.source)
    if (!parsed.success) return state
    return { ...projectWorkspace(parsed.data), dirty: true }
  }
  if (type === 'build_result') {
    if (typeof data.ok !== 'boolean' || !Array.isArray(data.issues)) return state
    return {
      ...state,
      build: {
        ok: data.ok,
        issues: data.issues.filter((issue): issue is string => typeof issue === 'string'),
        ...(typeof data.sourceHash === 'string' ? { sourceHash: data.sourceHash } : {}),
      },
    }
  }
  const path = data.path
  if (typeof path !== 'string' || !isProjectPath(path) || !state.source) return state
  if (type === 'file_start') {
    return {
      ...state,
      drafts: { ...state.drafts, [path]: '' },
      activePath: path,
      dirty: true,
      build: null,
    }
  }
  if (type === 'file_delta' && typeof data.text === 'string' && Object.hasOwn(state.drafts, path)) {
    return { ...state, drafts: { ...state.drafts, [path]: state.drafts[path] + data.text } }
  }
  if (type === 'file_saved' && typeof data.content === 'string') {
    const drafts = { ...state.drafts }
    delete drafts[path]
    return {
      ...state,
      source: { ...state.source, files: { ...state.source.files, [path]: data.content } },
      drafts,
      activePath: state.activePath === path ? null : state.activePath,
      dirty: true,
      build: null,
    }
  }
  if (type === 'file_deleted') {
    const files = { ...state.source.files }
    const drafts = { ...state.drafts }
    delete files[path]
    delete drafts[path]
    return {
      ...state,
      source: { ...state.source, files },
      drafts,
      activePath: state.activePath === path ? null : state.activePath,
      dirty: true,
      build: null,
    }
  }
  return state
}
