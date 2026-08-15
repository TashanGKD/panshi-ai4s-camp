import { constants } from 'node:fs'
import { access, lstat, readdir, statfs } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Router } from 'express'
import { requireAdmin } from '../../middleware/require-admin.js'
import { createRequireUser } from '../../middleware/require-user.js'
import type { SessionService } from '../identity/session.service.js'
import type { DatabaseHealthCheck } from './health.routes.js'

const mebibyte = 1_048_576
const safeVersion = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u
const backupDirectoryName = /^panshi-backup-[0-9]{8}T[0-9]{6}Z-[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u

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
    const entries = await readdir(backupRoot, { withFileTypes: true })
    let latest: Date | null = null
    for (const entry of entries) {
      if (!entry.isDirectory() || !backupDirectoryName.test(entry.name)) continue
      const marker = await lstat(resolve(backupRoot, entry.name, 'COMPLETE')).catch(() => null)
      if (!marker?.isFile() || marker.isSymbolicLink()) continue
      if (latest === null || marker.mtime.getTime() > latest.getTime()) latest = marker.mtime
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
