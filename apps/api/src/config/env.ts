import { z } from 'zod'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const defaultFileStorageRoot = resolve(projectRoot, 'var/uploads')

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

const bodyLimitMultipliers = {
  b: 1,
  kb: 1_024,
  mb: 1_048_576,
} as const

const jsonBodyLimit = z.string().regex(/^\d+(?:b|kb|mb)$/iu).transform((value) => {
  const match = /^(\d+)(b|kb|mb)$/iu.exec(value)
  if (!match) {
    return 0
  }
  const amount = Number(match[1])
  const unit = match[2]?.toLowerCase() as keyof typeof bodyLimitMultipliers
  return amount * bodyLimitMultipliers[unit]
}).pipe(z.number().int().min(1_024).max(10_485_760))

const ApiEnvSchema = DatabaseEnvSchema.extend({
  API_PORT: z.coerce.number().int().min(1).max(65_535),
  CORS_ORIGINS: z.string().transform((value) => (
    value.split(',').map((origin) => origin.trim()).filter(Boolean)
  )).pipe(z.array(corsOrigin)).transform((origins) => [...new Set(origins)]),
  HEALTHCHECK_TIMEOUT_MS: z.coerce.number().int().min(100).max(10_000).default(2_000),
  JSON_BODY_LIMIT: jsonBodyLimit.default(1_048_576),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SESSION_TTL_SECONDS: z.coerce.number().int().min(300).max(604_800).default(28_800),
  VERIFICATION_PROVIDER: z.enum(['disabled', 'mock']).default('disabled'),
  VERIFICATION_SECRET: z.string().regex(/^[a-f0-9]{64}$/iu).optional(),
  VERIFICATION_TTL_SECONDS: z.coerce.number().int().min(60).max(1_800).default(300),
  VERIFICATION_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  VERIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  VERIFICATION_MOCK_CODE: z.string().regex(/^\d{6}$/u).optional(),
  FILE_STORAGE_ROOT: z.string().min(1).default(defaultFileStorageRoot).transform((value) => resolve(projectRoot, value)),
  FILE_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1_024).max(26_214_400).default(10_485_760),
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && env.VERIFICATION_PROVIDER === 'mock') {
    context.addIssue({ code: 'custom', path: ['VERIFICATION_PROVIDER'], message: 'mock provider is forbidden in production' })
  }
  if (env.VERIFICATION_PROVIDER === 'mock' && env.VERIFICATION_SECRET === undefined) {
    context.addIssue({ code: 'custom', path: ['VERIFICATION_SECRET'], message: 'verification secret must be 64 hexadecimal characters' })
  }
  if (env.VERIFICATION_MOCK_CODE !== undefined && env.NODE_ENV !== 'test') {
    context.addIssue({ code: 'custom', path: ['VERIFICATION_MOCK_CODE'], message: 'fixed mock codes are test-only' })
  }
}).transform(({ JSON_BODY_LIMIT, ...env }) => ({
  ...env,
  JSON_BODY_LIMIT_BYTES: JSON_BODY_LIMIT,
  SECURE_COOKIES: env.NODE_ENV === 'production',
}))

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
