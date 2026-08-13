import { z } from 'zod'

const postgresUrl = z.string().min(1).refine((value) => {
  try {
    const url = new URL(value)
    return url.protocol === 'postgres:' || url.protocol === 'postgresql:'
  } catch {
    return false
  }
}, 'must be a valid PostgreSQL connection URL')

const DatabaseEnvSchema = z.object({
  DATABASE_URL: postgresUrl,
})

export type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>

export const getDatabaseEnv = (source: NodeJS.ProcessEnv = process.env): DatabaseEnv => {
  const result = DatabaseEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error('Invalid database environment: DATABASE_URL is required and must be a PostgreSQL URL')
  }

  return result.data
}
