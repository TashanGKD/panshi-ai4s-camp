import { z } from 'zod'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { FILE_UPLOAD_HARD_MAX_BYTES } from '../modules/files/file-storage.js'

const projectRoot = fileURLToPath(new URL('../../../../', import.meta.url))
const defaultFileStorageRoot = resolve(projectRoot, 'var/uploads')
const defaultBackupRoot = resolve(projectRoot, 'var/backups')

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
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  RATE_LIMIT_STORE_MAX_BUCKETS: z.coerce.number().int().min(100).max(1_000_000).default(50_000),
  RATE_LIMIT_STORE_SWEEP_INTERVAL_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  RATE_LIMIT_LOGIN_FAILURE_MAX: z.coerce.number().int().min(1).max(100).default(5),
  RATE_LIMIT_LOGIN_FAILURE_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(900_000),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().min(1).max(10_000).default(20),
  RATE_LIMIT_AUTH_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(900_000),
  RATE_LIMIT_PUBLIC_MAX: z.coerce.number().int().min(1).max(10_000).default(120),
  RATE_LIMIT_PUBLIC_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
  RATE_LIMIT_AUTHENTICATED_MAX: z.coerce.number().int().min(1).max(10_000).default(300),
  RATE_LIMIT_AUTHENTICATED_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
  RATE_LIMIT_ADMIN_MAX: z.coerce.number().int().min(1).max(10_000).default(180),
  RATE_LIMIT_ADMIN_WINDOW_MS: z.coerce.number().int().min(1_000).max(86_400_000).default(60_000),
  VERIFICATION_PROVIDER: z.enum(['disabled', 'mock', 'aliyun']).default('disabled'),
  VERIFICATION_SECRET: z.string().regex(/^[a-f0-9]{64}$/iu).optional(),
  CHECK_IN_TOKEN_SECRET: z.string().regex(/^[a-f0-9]{64}$/iu).optional(),
  VERIFICATION_TTL_SECONDS: z.coerce.number().int().min(60).max(1_800).default(300),
  VERIFICATION_COOLDOWN_SECONDS: z.coerce.number().int().min(10).max(600).default(60),
  VERIFICATION_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
  VERIFICATION_MOCK_CODE: z.string().regex(/^\d{6}$/u).optional(),
  ALIBABA_CLOUD_ACCESS_KEY_ID: z.string().min(1).optional(),
  ALIBABA_CLOUD_ACCESS_KEY_SECRET: z.string().min(1).optional(),
  ALIYUN_SMS_SIGN_NAME: z.string().min(1).optional(),
  ALIYUN_SMS_TEMPLATE_CODE: z.string().min(1).optional(),
  ALIYUN_SMS_TEMPLATE_PARAM_KEY: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/u).default('code'),
  ALIYUN_SMS_ENDPOINT: z.string().min(1).default('dysmsapi.aliyuncs.com'),
  ALIYUN_SMS_REGION_ID: z.string().min(1).default('cn-hangzhou'),
  FILE_STORAGE_ROOT: z.string().min(1).default(defaultFileStorageRoot).transform((value) => resolve(projectRoot, value)),
  FILE_UPLOAD_TEMP_ROOT: z.string().min(1).optional().transform((value) => value ? resolve(projectRoot, value) : undefined),
  FILE_UPLOAD_MAX_BYTES: z.coerce.number().int().min(1_024).max(FILE_UPLOAD_HARD_MAX_BYTES).default(FILE_UPLOAD_HARD_MAX_BYTES),
  FILE_UPLOAD_GLOBAL_CONCURRENCY: z.coerce.number().int().min(1).max(16).default(4),
  FILE_UPLOAD_GLOBAL_WINDOW_MAX: z.coerce.number().int().min(1).max(100).default(20),
  FILE_UPLOAD_GLOBAL_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  FILE_UPLOAD_PER_USER_CONCURRENCY: z.coerce.number().int().min(1).max(2).default(1),
  FILE_UPLOAD_PER_USER_WINDOW_MAX: z.coerce.number().int().min(1).max(30).default(5),
  FILE_UPLOAD_PER_USER_WINDOW_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
  BACKUP_ROOT: z.string().min(1).default(defaultBackupRoot).transform((value) => resolve(projectRoot, value)),
  APP_VERSION: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u).default('development'),
}).superRefine((env, context) => {
  if (env.NODE_ENV === 'production' && env.VERIFICATION_PROVIDER === 'mock') {
    context.addIssue({ code: 'custom', path: ['VERIFICATION_PROVIDER'], message: 'mock provider is forbidden in production' })
  }
  if (env.VERIFICATION_PROVIDER !== 'disabled' && env.VERIFICATION_SECRET === undefined) {
    context.addIssue({ code: 'custom', path: ['VERIFICATION_SECRET'], message: 'verification secret must be 64 hexadecimal characters' })
  }
  if (env.VERIFICATION_PROVIDER === 'aliyun') {
    for (const key of ['ALIBABA_CLOUD_ACCESS_KEY_ID', 'ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'ALIYUN_SMS_SIGN_NAME', 'ALIYUN_SMS_TEMPLATE_CODE'] as const) {
      if (env[key] === undefined) {
        context.addIssue({ code: 'custom', path: [key], message: `${key} is required for the Aliyun verification provider` })
      }
    }
  }
  if (env.VERIFICATION_MOCK_CODE !== undefined && env.NODE_ENV !== 'test') {
    context.addIssue({ code: 'custom', path: ['VERIFICATION_MOCK_CODE'], message: 'fixed mock codes are test-only' })
  }
  if (env.NODE_ENV === 'production' && env.CHECK_IN_TOKEN_SECRET === undefined) {
    context.addIssue({ code: 'custom', path: ['CHECK_IN_TOKEN_SECRET'], message: 'check-in token secret must be 64 hexadecimal characters' })
  }
}).transform(({ JSON_BODY_LIMIT, ...env }) => ({
  ...env,
  CHECK_IN_TOKEN_SECRET: env.CHECK_IN_TOKEN_SECRET ?? env.VERIFICATION_SECRET ?? '00'.repeat(32),
  JSON_BODY_LIMIT_BYTES: JSON_BODY_LIMIT,
  FILE_UPLOAD_TEMP_ROOT: env.FILE_UPLOAD_TEMP_ROOT ?? resolve(env.FILE_STORAGE_ROOT, '.incoming'),
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
