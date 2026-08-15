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
export type LatestBackupCheck = () => Promise<Date | null>

export type AdminHealthService = ReturnType<typeof createAdminHealthService>

type AdminHealthOptions = {
  checkDatabase: DatabaseHealthCheck
  checkUpload: UploadHealthCheck
  findLatestBackupAt: LatestBackupCheck
  timeoutMs: number
  appVersion: string
  now?: () => Date
}

const withTimeout = async <T>(operation: () => Promise<T>, timeoutMs: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('Timed out')), timeoutMs)
  })
  try {
    return await Promise.race([Promise.resolve().then(operation), deadline])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

const hashFile = (path: string) => new Promise<string>((resolveHash, rejectHash) => {
  const hash = createHash('sha256')
  const stream = createReadStream(path)
  stream.on('error', rejectHash)
  stream.on('data', (chunk) => hash.update(chunk))
  stream.on('end', () => resolveHash(hash.digest('hex')))
})

const validatedBackupTime = async (root: string, name: string): Promise<Date | null> => {
  const candidate = resolve(root, name)
  const candidateInfo = await lstat(candidate)
  if (!candidateInfo.isDirectory() || candidateInfo.isSymbolicLink()) return null
  const resolvedCandidate = await realpath(candidate)
  if (dirname(resolvedCandidate) !== root || resolvedCandidate !== candidate) return null

  const requiredNames = ['COMPLETE', 'SHA256SUMS', ...backupPayloadNames]
  const requiredStats = await Promise.all(requiredNames.map((filename) => lstat(resolve(candidate, filename))))
  if (requiredStats.some((info) => !info.isFile() || info.isSymbolicLink())) return null
  if (await readFile(resolve(candidate, 'COMPLETE'), 'utf8') !== 'complete\n') return null

  const manifest = await readFile(resolve(candidate, 'SHA256SUMS'), 'utf8')
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
  const hashes = await Promise.all(backupPayloadNames.map((filename) => hashFile(resolve(candidate, filename))))
  if (hashes.some((hash, index) => hash !== expected.get(backupPayloadNames[index]!))) return null
  return requiredStats[0]!.mtime
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
      withTimeout(checkDatabase, timeoutMs),
      withTimeout(checkUpload, timeoutMs),
      withTimeout(findLatestBackupAt, timeoutMs),
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

export const createAdminHealthFileChecks = (uploadDirectory: string, backupRoot: string) => ({
  checkUpload: async () => {
    await access(uploadDirectory, constants.W_OK)
    const capacity = await statfs(uploadDirectory)
    return { freeBytes: Number(capacity.bavail) * Number(capacity.bsize) }
  },
  findLatestBackupAt: async () => {
    const resolvedRoot = await realpath(backupRoot)
    const entries = await readdir(resolvedRoot, { withFileTypes: true })
    let latest: Date | null = null
    for (const entry of entries) {
      if (!entry.isDirectory() || !backupDirectoryName.test(entry.name)) continue
      const successfulAt = await validatedBackupTime(resolvedRoot, entry.name).catch(() => null)
      if (successfulAt !== null && (latest === null || successfulAt.getTime() > latest.getTime())) latest = successfulAt
    }
    return latest
  },
})

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
