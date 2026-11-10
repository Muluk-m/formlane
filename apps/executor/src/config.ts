import { z } from 'zod'

const configurationSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  ENDPOINT: z.url(),
  MODEL: z.string().min(1),
  EXECUTOR_TOKEN: z.string().min(32),
  CONTROL_PLANE_URL: z.url().refine((value) => new URL(value).protocol === 'https:'),
})

export type ExecutorConfig = z.infer<typeof configurationSchema>

export function loadConfiguration(): ExecutorConfig {
  const result = configurationSchema.safeParse(process.env)
  if (!result.success) throw new Error('Required executor environment configuration is invalid.')
  return result.data
}
