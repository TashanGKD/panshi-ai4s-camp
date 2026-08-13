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

const corsOrigin = z.string().refine((value) => {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:')
      && url.origin === value
      && url.username === ''
      && url.password === ''
  } catch {
    return false
  }
}, 'must be an HTTP(S) origin without a path')

const ApiEnvSchema = DatabaseEnvSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65_535),
  CORS_ORIGINS: z.string().transform((value) => (
    value.split(',').map((origin) => origin.trim()).filter(Boolean)
  )).pipe(z.array(corsOrigin)),
  JSON_BODY_LIMIT: z.string().regex(/^\d+(?:b|kb|mb)$/iu).default('1mb'),
})

export type DatabaseEnv = z.infer<typeof DatabaseEnvSchema>
export type ApiEnv = z.infer<typeof ApiEnvSchema>

export const getDatabaseEnv = (source: NodeJS.ProcessEnv = process.env): DatabaseEnv => {
  const result = DatabaseEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error('Invalid database environment: DATABASE_URL is required and must be a PostgreSQL URL')
  }

  return result.data
}

export const getApiEnv = (source: NodeJS.ProcessEnv = process.env): ApiEnv => {
  const result = ApiEnvSchema.safeParse(source)

  if (!result.success) {
    throw new Error('Invalid API environment configuration')
  }

  return result.data
}
