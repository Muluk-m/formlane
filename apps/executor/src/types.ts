export interface HarnessContext {
  projectId: string
  runId: string
  idea: string
  request: string
  previousHtml: string | null
}

export interface HarnessResult {
  html: string
  summary: string
}

/** Callbacks return JSON-serializable values persisted by the restricted control plane. */
export interface DurableExecutor {
  run<T>(name: string, fn: () => Promise<T>): Promise<T>
}

export type HarnessEmit = (type: string, data: Record<string, unknown>) => Promise<void>
