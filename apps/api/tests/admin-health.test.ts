import { createHash } from 'node:crypto'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { createAdminHealthService } from '../src/modules/health/admin-health.routes.js'

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
