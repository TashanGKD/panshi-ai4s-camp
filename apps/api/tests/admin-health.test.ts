import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { createAdminHealthFileChecks, createAdminHealthService } from '../src/modules/health/admin-health.routes.js'

const temporaryRoots: string[] = []
afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

const writeCompleteBackup = async (root: string, name: string, markerTime: Date) => {
  const directory = join(root, name)
  await mkdir(directory)
  const files = { 'database.dump': 'database', 'uploads.tar.gz': 'uploads', 'metadata.env': 'metadata' }
  for (const [filename, content] of Object.entries(files)) await writeFile(join(directory, filename), content)
  await writeFile(join(directory, 'SHA256SUMS'), Object.entries(files).map(([filename, content]) => `${sha256(content)}  ${filename}`).join('\n') + '\n')
  await writeFile(join(directory, 'COMPLETE'), 'complete\n')
  await utimes(join(directory, 'COMPLETE'), markerTime, markerTime)
  return directory
}

const adminToken = 'a'.repeat(64)
const studentToken = 'b'.repeat(64)
const adminHash = createHash('sha256').update(adminToken).digest('hex')
const studentHash = createHash('sha256').update(studentToken).digest('hex')

const identityRepository = {
  findUserByPhoneNormalized: async () => null,
  findSessionByTokenHash: async (candidate: string) => candidate === adminHash ? {
    tokenHash: adminHash, userId: 'admin-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, createdAt: new Date(),
    user: { id: 'admin-1', displayName: '管理员', phoneNormalized: '+8613800138000', passwordHash: 'unused', role: 'admin' as const, disabledAt: null },
  } : candidate === studentHash ? {
    tokenHash: studentHash, userId: 'student-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, createdAt: new Date(),
    user: { id: 'student-1', displayName: '学员', phoneNormalized: '+8613800138001', passwordHash: 'unused', role: 'user' as const, disabledAt: null },
  } : null,
  revokeSessionByTokenHash: async () => undefined,
}

const createService = (overrides: Partial<Parameters<typeof createAdminHealthService>[0]> = {}) => createAdminHealthService({
  checkDatabase: async () => undefined,
  checkUpload: async () => ({ freeBytes: 12_345_678 }),
  findLatestBackupAt: async () => new Date('2026-08-15T01:02:03.000Z'),
  timeoutMs: 50,
  appVersion: '6c444d0',
  now: () => new Date('2026-08-15T02:03:04.000Z'),
  ...overrides,
})

const createTestApp = (service = createService()) => createApp({
  checkDatabase: async () => undefined,
  adminHealthService: service,
  identityRepository,
  authTransactionRepository: { rotateSessionAndAudit: async () => undefined },
  config: { allowedOrigins: [], healthcheckTimeoutMs: 50, jsonLimitBytes: 1_048_576 },
})

describe('administrator system health API', () => {
  it('is admin-only, no-store, and returns only the sanitized health contract', async () => {
    expect((await request(createTestApp()).get('/api/v1/admin/system-health')).status).toBe(401)
    expect((await request(createTestApp()).get('/api/v1/admin/system-health').set('Cookie', `panshi_session=${studentToken}`)).status).toBe(403)

    const response = await request(createTestApp())
      .get('/api/v1/admin/system-health')
      .set('Cookie', `panshi_session=${adminToken}`)

    expect(response.status).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers.etag).toBeUndefined()
    expect(response.body).toEqual({
      apiVersion: 'v1',
      data: {
        status: 'healthy',
        checkedAt: '2026-08-15T02:03:04.000Z',
        version: '6c444d0',
        database: { connected: true },
        uploads: { writable: true, freeBytes: 11_534_336 },
        backup: { available: true, lastSuccessfulAt: '2026-08-15T01:02:03.000Z' },
      },
    })
    expect(JSON.stringify(response.body)).not.toMatch(
      /postgres|password|credential|hostname|database_url|\/secret|uploads\/|backups\//iu,
    )
  })

  it('degrades each failed probe without leaking exceptions or paths', async () => {
    const secret = 'postgresql://admin:password@db.internal/private /secret/uploads'
    const response = await request(createTestApp(createService({
      checkDatabase: async () => { throw new Error(secret) },
      checkUpload: async () => { throw new Error(secret) },
      findLatestBackupAt: async () => { throw new Error(secret) },
    }))).get('/api/v1/admin/system-health').set('Cookie', `panshi_session=${adminToken}`)

    expect(response.status).toBe(200)
    expect(response.body.data).toMatchObject({
      status: 'degraded',
      database: { connected: false },
      uploads: { writable: false, freeBytes: null },
      backup: { available: false, lastSuccessfulAt: null },
    })
    expect(JSON.stringify(response.body)).not.toMatch(/postgres|password|db\.internal|secret|private|stack/iu)
  })

  it('bounds hanging probes and returns a structured degraded response', async () => {
    vi.useFakeTimers()
    try {
      const result = createService({
        checkDatabase: () => new Promise<void>(() => undefined),
        checkUpload: () => new Promise(() => undefined),
        findLatestBackupAt: () => new Promise(() => undefined),
        timeoutMs: 25,
      }).getStatus()
      await vi.advanceTimersByTimeAsync(25)
      await expect(result).resolves.toMatchObject({
        data: {
          status: 'degraded',
          database: { connected: false },
          uploads: { writable: false, freeBytes: null },
          backup: { available: false, lastSuccessfulAt: null },
        },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('sanitizes invalid capacity, timestamp, and version values', async () => {
    const result = await createService({
      checkUpload: async () => ({ freeBytes: Number.POSITIVE_INFINITY }),
      findLatestBackupAt: async () => new Date('invalid'),
      appVersion: '/secret/path?token=password',
    }).getStatus()

    expect(result.data).toMatchObject({
      status: 'degraded', version: 'unknown',
      uploads: { writable: false, freeBytes: null },
      backup: { available: false, lastSuccessfulAt: null },
    })
    expect(JSON.stringify(result)).not.toMatch(/secret|path|token|password/iu)
  })
})

describe('successful backup discovery', () => {
  it('returns only the latest exact marker, regular files, manifest, and hash-valid backup', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-admin-health-'))
    temporaryRoots.push(root)
    const validTime = new Date('2026-08-15T01:02:03.000Z')
    await writeCompleteBackup(root, 'panshi-backup-20260815T010203Z-valid', validTime)

    const markerOnly = join(root, 'panshi-backup-20260815T020304Z-marker-only')
    await mkdir(markerOnly)
    await writeFile(join(markerOnly, 'COMPLETE'), 'complete\n')

    const corrupt = await writeCompleteBackup(root, 'panshi-backup-20260815T030405Z-corrupt', new Date('2026-08-15T03:04:05.000Z'))
    await writeFile(join(corrupt, 'database.dump'), 'tampered')

    const badMarker = await writeCompleteBackup(root, 'panshi-backup-20260815T040506Z-bad-marker', new Date('2026-08-15T04:05:06.000Z'))
    await writeFile(join(badMarker, 'COMPLETE'), 'complete but not exact\n')

    const symlinkFile = await writeCompleteBackup(root, 'panshi-backup-20260815T050607Z-symlink-file', new Date('2026-08-15T05:06:07.000Z'))
    await rm(join(symlinkFile, 'database.dump'))
    await symlink(join(root, 'outside.dump'), join(symlinkFile, 'database.dump'))
    await writeFile(join(root, 'outside.dump'), 'database')

    await symlink(join(root, 'panshi-backup-20260815T010203Z-valid'), join(root, 'panshi-backup-20260815T060708Z-symlink-dir'))

    const result = await createAdminHealthFileChecks(root, root).findLatestBackupAt()
    expect(result?.toISOString()).toBe(validTime.toISOString())
  })

  it('returns null when every backup is incomplete or corrupt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-admin-health-'))
    temporaryRoots.push(root)
    const corrupt = await writeCompleteBackup(root, 'panshi-backup-20260815T030405Z-corrupt', new Date())
    await writeFile(join(corrupt, 'SHA256SUMS'), `${'0'.repeat(64)}  database.dump\n`)
    await expect(createAdminHealthFileChecks(root, root).findLatestBackupAt()).resolves.toBeNull()
  })

  it('caches immutable verified candidates instead of hashing payloads on every refresh', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-admin-health-'))
    temporaryRoots.push(root)
    await writeCompleteBackup(root, 'panshi-backup-20260815T030405Z-valid', new Date('2026-08-15T03:04:05.000Z'))
    let payloadHashes = 0
    const checks = createAdminHealthFileChecks(root, root, {
      hashPayload: async (path) => {
        payloadHashes += 1
        return createHash('sha256').update(await readFile(path)).digest('hex')
      },
    })

    await expect(checks.findLatestBackupAt()).resolves.toEqual(new Date('2026-08-15T03:04:05.000Z'))
    await expect(checks.findLatestBackupAt()).resolves.toEqual(new Date('2026-08-15T03:04:05.000Z'))
    expect(payloadHashes).toBe(3)
  })

  it('checks newest candidates first and bounds corrupt fallback work', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-admin-health-'))
    temporaryRoots.push(root)
    await writeCompleteBackup(root, 'panshi-backup-20260815T010101Z-too-old', new Date('2026-08-15T01:01:01.000Z'))
    await writeCompleteBackup(root, 'panshi-backup-20260815T020202Z-valid', new Date('2026-08-15T02:02:02.000Z'))
    for (const [name, timestamp] of [
      ['panshi-backup-20260815T030303Z-corrupt', '2026-08-15T03:03:03.000Z'],
      ['panshi-backup-20260815T040404Z-corrupt', '2026-08-15T04:04:04.000Z'],
    ] as const) {
      const corrupt = await writeCompleteBackup(root, name, new Date(timestamp))
      await writeFile(join(corrupt, 'database.dump'), 'tampered')
    }
    let payloadHashes = 0
    const checks = createAdminHealthFileChecks(root, root, {
      maxBackupCandidates: 2,
      hashPayload: async (path) => {
        payloadHashes += 1
        return createHash('sha256').update(await readFile(path)).digest('hex')
      },
    })

    await expect(checks.findLatestBackupAt()).resolves.toBeNull()
    expect(payloadHashes).toBe(6)

    const fallbackChecks = createAdminHealthFileChecks(root, root, {
      maxBackupCandidates: 3,
      hashPayload: async (path) => createHash('sha256').update(await readFile(path)).digest('hex'),
    })
    await expect(fallbackChecks.findLatestBackupAt()).resolves.toEqual(new Date('2026-08-15T02:02:02.000Z'))
  })

  it('aborts active backup hashing when the health deadline expires', async () => {
    const root = await mkdtemp(join(tmpdir(), 'panshi-admin-health-'))
    temporaryRoots.push(root)
    await writeCompleteBackup(root, 'panshi-backup-20260815T030405Z-valid', new Date('2026-08-15T03:04:05.000Z'))
    let aborted = false
    let markStarted!: () => void
    const started = new Promise<void>((resolveStarted) => { markStarted = resolveStarted })
    const checks = createAdminHealthFileChecks(root, root, {
      hashPayload: (_path, signal) => new Promise<string>((_resolve, reject) => {
        markStarted()
        signal.addEventListener('abort', () => {
          aborted = true
          reject(new Error('/secret/path must not leak'))
        }, { once: true })
      }),
    })

    const result = createService({ findLatestBackupAt: checks.findLatestBackupAt, timeoutMs: 25 }).getStatus()
    await started
    await expect(result).resolves.toMatchObject({ data: { status: 'degraded', backup: { available: false } } })
    expect(aborted).toBe(true)
    expect(JSON.stringify(await result)).not.toMatch(/secret|path/iu)
  })
})
