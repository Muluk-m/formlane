import type { ProjectSource } from '@atoms-demo/core/project'

export interface HarnessContext {
  projectId: string
  runId: string
  idea: string
  request: string
  previousSource: ProjectSource | null
}

export interface HarnessResult {
  source: ProjectSource
  html: string
  summary: string
}

/** Callbacks return JSON-serializable values persisted by the restricted control plane. */
export interface DurableExecutor {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>
}

export type HarnessEmit = (type: string, data: Record<string, unknown>) => Promise<void>
