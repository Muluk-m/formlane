export interface ProviderConfig {
  OPENAI_API_KEY?: string
  OPENAI_BASE_URL?: string
  OPENAI_MODEL?: string
  MOCK_LLM?: string
  MOCK_DELAY_MS?: string
  ENVIRONMENT?: string
}

export type Env = Omit<Cloudflare.Env, keyof ProviderConfig> & ProviderConfig

export function mockEnabled(env: ProviderConfig): boolean {
  const flag = (env.MOCK_LLM ?? '').trim().toLowerCase()
  return env.ENVIRONMENT === 'local' && ['1', 'true', 'yes', 'on'].includes(flag)
}
export function modelName(env: ProviderConfig): string {
  return env.OPENAI_MODEL?.trim() || 'gpt-4.1'
}
export function openAiBase(env: ProviderConfig): string {
  return (env.OPENAI_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/$/, '')
}
