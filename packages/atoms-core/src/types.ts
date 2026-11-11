import type { ProjectSource } from './project'

export type AgentId = 'mike' | 'emma' | 'bob' | 'alex' | 'david'
export type ProjectStatus = 'idle' | 'generating' | 'error'

export interface Project {
  id: string
  title: string
  idea: string
  status: ProjectStatus
  error: string | null
  currentVersionId: string | null
  publishedSlug: string | null
  publishedVersionId: string | null
  createdAt: number
  updatedAt: number
  versionCount?: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'agent' | 'system'
  agent: AgentId | null
  content: string
  createdAt: number
}

export interface AppVersion {
  id: string
  number: number
  prompt: string
  createdAt: number
  html?: string
  source?: ProjectSource
}

export const AGENT_ORDER: AgentId[] = ['mike', 'emma', 'bob', 'alex', 'david']

export function isAgentId(value: string | null | undefined): value is AgentId {
  return (
    value === 'mike' || value === 'emma' || value === 'bob' || value === 'alex' || value === 'david'
  )
}
