import { createHash } from 'node:crypto'
import { constants, createReadStream } from 'node:fs'
import { access, lstat, readFile, readdir, realpath, statfs } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Router } from 'express'
import { requireAdmin } from '../../middleware/require-admin.js'
import { createRequireUser } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import type { DatabaseHealthCheck } from './health.routes.js'

const mebibyte = 1_048_576
const safeVersion = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u
const backupDirectoryName = /^panshi-backup-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u
const backupPayloadNames = ['database.dump', 'uploads.tar.gz', 'metadata.env'] as const
const manifestLine = /^([a-f0-9]{64}) [ *](database\.dump|uploads\.tar\.gz|metadata\.env)$/u

export type UploadHealthCheck = () => Promise<{ freeBytes: number }>
export type LatestBackupCheck = (signal?: AbortSignal) => Promise<Date | null>

export type AdminHealthService = ReturnType<typeof createAdminHealthService>

type AdminHealthOptions = {
  checkDatabase: DatabaseHealthCheck
  checkUpload: UploadHealthCheck
  findLatestBackupAt: LatestBackupCheck
  timeoutMs: number
  appVersion: string
  now?: () => Date
}

const withTimeout = async <T>(operation: (signal: AbortSignal) => Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const controller = new AbortController()
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new Error('Timed out'))
    }, timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

type PayloadHasher = (path: string, signal: AbortSignal) => Promise<string>

const hashFile: PayloadHasher = (path, signal) => new Promise<string>((resolveHash, rejectHash) => {
  const hash = createHash('sha256')
  const stream = createReadStream(path, { signal })
  stream.on('error', rejectHash)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('end', () => resolveHash(hash.digest('hex')))
})

type BackupCacheEntry = { key: string; successfulAt: Date | null }

const validatedBackupTime = async (
  root: string,
  name: string,
  signal: AbortSignal,
  hashPayload: PayloadHasher,
  cache: Map<string, BackupCacheEntry>,
): Promise<Date | null> => {
  signal.throwIfAborted()
  const candidate = resolve(root, name)
  const candidateInfo = await lstat(candidate)
  if (!candidateInfo.isDirectory() || candidateInfo.isSymbolicLink()) return null
  const resolvedCandidate = await realpath(candidate)
  if (dirname(resolvedCandidate) !== root || resolvedCandidate !== candidate) return null

  const requiredNames = ['COMPLETE', 'SHA256SUMS', ...backupPayloadNames]
  const requiredStats = await Promise.all(requiredNames.map((filename) => lstat(resolve(candidate, filename))))
  if (requiredStats.some((info) => !info.isFile() || info.isSymbolicLink())) return null
  if (await readFile(resolve(candidate, 'COMPLETE'), { encoding: 'utf8', signal }) !== 'complete\n') return null

  const manifest = await readFile(resolve(candidate, 'SHA256SUMS'), { encoding: 'utf8', signal })
  if (!manifest.endsWith('\n')) return null
  const lines = manifest.slice(0, -1).split('\n')
  if (lines.length !== backupPayloadNames.length) return null
  const expected = new Map<string, string>()
  for (const line of lines) {
    const match = manifestLine.exec(line)
    if (!match || expected.has(match[2]!)) return null
    expected.set(match[2]!, match[1]!)
  }
  if (backupPayloadNames.some((filename) => !expected.has(filename))) return null
  const manifestDigest = createHash('sha256').update(manifest).digest('hex')
  const cacheKey = [manifestDigest, ...requiredStats.map((info) => [info.dev, info.ino, info.mode, info.size, info.mtimeMs, info.ctimeMs].join(':'))].join('|')
  const cached = cache.get(name)
  if (cached?.key === cacheKey) return cached.successfulAt

  const hashes = await Promise.all(backupPayloadNames.map((filename) => hashPayload(resolve(candidate, filename), signal)))
  const successfulAt = hashes.some((hash, index) => hash !== expected.get(backupPayloadNames[index]!))
    ? null
    : requiredStats[0]!.mtime
  cache.set(name, { key: cacheKey, successfulAt })
  return successfulAt
}

export const createAdminHealthService = ({
  checkDatabase,
  checkUpload,
  findLatestBackupAt,
  timeoutMs,
  appVersion,
  now = () => new Date(),
}: AdminHealthOptions) => ({
  getStatus: async () => {
    const [databaseResult, uploadResult, backupResult] = await Promise.allSettled([
      withTimeout(() => checkDatabase(), timeoutMs),
      withTimeout(() => checkUpload(), timeoutMs),
      withTimeout((signal) => findLatestBackupAt(signal), timeoutMs),
    ])

    const rawFreeBytes = uploadResult.status === 'fulfilled' ? uploadResult.value.freeBytes : Number.NaN
    const validFreeBytes = Number.isSafeInteger(rawFreeBytes) && rawFreeBytes >= 0
    const freeBytes = validFreeBytes ? Math.floor(rawFreeBytes / mebibyte) * mebibyte : null
    const latestBackup = backupResult.status === 'fulfilled' ? backupResult.value : null
    const validBackup = latestBackup instanceof Date && Number.isFinite(latestBackup.getTime())
    const checkedAt = now()
    const checkedAtIso = Number.isFinite(checkedAt.getTime()) ? checkedAt.toISOString() : new Date(0).toISOString()
    const healthy = databaseResult.status === 'fulfilled' && validFreeBytes && validBackup

    return {
      apiVersion: 'v1' as const,
      data: {
        status: healthy ? 'healthy' as const : 'degraded' as const,
        checkedAt: checkedAtIso,
        version: safeVersion.test(appVersion) ? appVersion : 'unknown',
        database: { connected: databaseResult.status === 'fulfilled' },
        uploads: { writable: validFreeBytes, freeBytes },
        backup: {
          available: validBackup,
          lastSuccessfulAt: validBackup ? latestBackup.toISOString() : null,
        },
      },
    }
  },
})

type AdminHealthFileCheckOptions = {
  maxBackupCandidates?: number
  hashPayload?: PayloadHasher
}

export const createAdminHealthFileChecks = (
  uploadDirectory: string,
  backupRoot: string,
  options: AdminHealthFileCheckOptions = {},
) => {
  const maxBackupCandidates = Number.isSafeInteger(options.maxBackupCandidates) && options.maxBackupCandidates! > 0
    ? Math.min(options.maxBackupCandidates!, 100)
    : 10
  const hashPayload = options.hashPayload ?? hashFile
  const cache = new Map<string, BackupCacheEntry>()
  return {
    checkUpload: async () => {
      await access(uploadDirectory, constants.W_OK)
      const capacity = await statfs(uploadDirectory)
      return { freeBytes: Number(capacity.bavail) * Number(capacity.bsize) }
    },
    findLatestBackupAt: async (providedSignal?: AbortSignal) => {
      const signal = providedSignal ?? new AbortController().signal
      signal.throwIfAborted()
      const resolvedRoot = await realpath(backupRoot)
      const entries = await readdir(resolvedRoot, { withFileTypes: true })
      const candidates = entries
        .filter((entry) => entry.isDirectory() && backupDirectoryName.test(entry.name))
        .map((entry) => entry.name)
        .sort((left, right) => right.localeCompare(left))
        .slice(0, maxBackupCandidates)
      const candidateSet = new Set(candidates)
      for (const cachedName of cache.keys()) if (!candidateSet.has(cachedName)) cache.delete(cachedName)
      for (const name of candidates) {
        signal.throwIfAborted()
        const successfulAt = await validatedBackupTime(resolvedRoot, name, signal, hashPayload, cache).catch((error: unknown) => {
          if (signal.aborted) throw error
          return null
        })
        if (successfulAt !== null) return successfulAt
      }
      return null
    },
  }
}

export const createAdminHealthRouter = (sessions: SessionService, service: AdminHealthService) => {
  const router = Router()
  router.use(createRequireUser(sessions), requireAdmin)
  router.get('/', async (_request, response) => {
    response.setHeader('Cache-Control', 'private, no-store')
    response.removeHeader('ETag')
    response.json(await service.getStatus())
  })
  return router
}
