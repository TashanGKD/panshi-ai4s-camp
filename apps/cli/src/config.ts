import { lstat, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { resolveCliBaseUrl } from '@panshi/camp-client'
import { CliRuntimeError } from './errors.js'

export type CliProfile = { name: string, baseUrl: string, phoneHint?: string }
export type CliConfig = { profiles: Record<string, Omit<CliProfile, 'name'>> }

const secretKeys = new Set(['password', 'passwd', 'token', 'cookie', 'verificationcode', 'code', 'secret'])
const normalizedKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/gu, '')
const hasSecretKey = (value: unknown): boolean => {
  if (Array.isArray(value)) return value.some(hasSecretKey)
  if (!value || typeof value !== 'object') return false
  return Object.entries(value).some(([key, child]) => secretKeys.has(normalizedKey(key)) || hasSecretKey(child))
}

const parseConfig = (value: unknown): CliConfig => {
  if (hasSecretKey(value)) throw new CliRuntimeError('CONFIG_SECRET_FORBIDDEN')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new CliRuntimeError('CONFIG_INVALID')
  const profiles = (value as Record<string, unknown>).profiles
  if (!profiles || typeof profiles !== 'object' || Array.isArray(profiles)) throw new CliRuntimeError('CONFIG_INVALID')
  const normalized: CliConfig['profiles'] = {}
  for (const [name, raw] of Object.entries(profiles)) {
    if (!/^[a-z0-9][a-z0-9_-]{0,39}$/u.test(name) || !raw || typeof raw !== 'object' || Array.isArray(raw)) throw new CliRuntimeError('CONFIG_INVALID')
    const entry = raw as Record<string, unknown>
    if (typeof entry.baseUrl !== 'string' || Object.keys(entry).some((key) => !['baseUrl', 'phoneHint'].includes(key)) || (entry.phoneHint !== undefined && typeof entry.phoneHint !== 'string')) throw new CliRuntimeError('CONFIG_INVALID')
    normalized[name] = { baseUrl: resolveCliBaseUrl(entry.baseUrl), ...(entry.phoneHint ? { phoneHint: entry.phoneHint } : {}) }
  }
  return { profiles: normalized }
}

export const loadConfig = async (path: string): Promise<CliConfig> => {
  const directory = await lstat(dirname(path)).catch(() => { throw new CliRuntimeError('CONFIG_DIRECTORY_UNAVAILABLE') })
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new CliRuntimeError('CONFIG_DIRECTORY_UNSAFE')
  if (typeof process.getuid === 'function' && directory.uid !== process.getuid()) throw new CliRuntimeError('CONFIG_DIRECTORY_NOT_OWNED')
  const metadata = await lstat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw new CliRuntimeError('CONFIG_UNAVAILABLE')
  })
  if (metadata === null) return { profiles: {} }
  if (metadata.isSymbolicLink()) throw new CliRuntimeError('CONFIG_SYMLINK_FORBIDDEN')
  if (!metadata.isFile()) throw new CliRuntimeError('CONFIG_INVALID')
  if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) throw new CliRuntimeError('CONFIG_NOT_OWNED')
  if ((metadata.mode & 0o077) !== 0) throw new CliRuntimeError('CONFIG_PERMISSIONS_UNSAFE')
  try { return parseConfig(JSON.parse(await readFile(path, 'utf8'))) } catch (error) {
    if (error instanceof CliRuntimeError) throw error
    throw new CliRuntimeError('CONFIG_INVALID')
  }
}

export const resolveEndpoint = (input: {
  explicitBaseUrl?: string
  profile?: CliProfile
  environment?: 'local' | 'production'
  environmentBaseUrl?: string
}) => {
  const candidate = input.explicitBaseUrl ?? input.profile?.baseUrl ?? input.environmentBaseUrl ?? 'http://127.0.0.1:3001'
  const resolved = resolveCliBaseUrl(candidate)
  const production = resolved.startsWith('https://')
  if (production && (!input.profile || input.environment !== 'production')) throw new CliRuntimeError('PRODUCTION_PROFILE_REQUIRED')
  if (!production && input.environment === 'production') throw new CliRuntimeError('PRODUCTION_HTTPS_REQUIRED')
  return resolved
}
