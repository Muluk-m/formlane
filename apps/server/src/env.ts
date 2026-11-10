export interface ProviderConfig {
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
}

export type Env = Omit<Cloudflare.Env, keyof ProviderConfig> &
  ProviderConfig & {
    EXECUTOR_TOKEN?: string
  }

export function modelName(env: ProviderConfig): string {
  return env.OPENAI_MODEL?.trim() || 'gpt-4.1'
}
