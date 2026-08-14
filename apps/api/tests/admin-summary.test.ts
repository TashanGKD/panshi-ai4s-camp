import { createHash } from 'node:crypto'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createAdminSummaryService, type AdminSummaryRepository } from '../src/modules/admin-summary/admin-summary.service.js'
import { shanghaiBusinessDate } from '../src/modules/admin-summary/admin-summary.repository.js'

const emptyRepository: AdminSummaryRepository = {
  countApplicationsByStatus: async () => [],
  listUpcomingDates: async () => [],
  listUnpublishedDrafts: async () => [],
  listRecentOperations: async () => [],
}

describe('administrator summary service', () => {
  it.each([
    ['2026-08-13T15:59:59.999Z', '2026-08-13'],
    ['2026-08-13T16:00:00.000Z', '2026-08-14'],
    ['2026-08-14T15:59:59.999Z', '2026-08-14'],
    ['2026-08-14T16:00:00.000Z', '2026-08-15'],
  ])('uses the Asia/Shanghai business date at UTC boundary %s', (instant, expected) => {
    expect(shanghaiBusinessDate(new Date(instant))).toBe(expected)
  })
  it('returns complete truthful zero values for an empty database', async () => {
    await expect(createAdminSummaryService(emptyRepository).getSummary()).resolves.toEqual({
      apiVersion: 'v1',
      data: {
        applications: {
          total: 0, pendingReview: 0,
          byStatus: { draft: 0, submitted: 0, reviewing: 0, needs_supplement: 0, admitted: 0, waitlisted: 0, rejected: 0 },
        },
        upcomingDates: [], unpublishedDrafts: [], recentOperations: [],
      },
    })
  })

  it('aggregates status counts and does not expose audit metadata', async () => {
    const service = createAdminSummaryService({
      ...emptyRepository,
      countApplicationsByStatus: async () => [{ status: 'submitted', count: 2 }, { status: 'reviewing', count: 1 }, { status: 'admitted', count: 3 }],
      listRecentOperations: async () => [{ id: 'log-1', action: 'content.published', actorDisplayName: '管理员', createdAt: new Date('2026-08-14T00:00:00Z') }],
    })
    const result = await service.getSummary()
    expect(result.data.applications).toMatchObject({ total: 6, pendingReview: 3, byStatus: { submitted: 2, reviewing: 1, admitted: 3 } })
    expect(JSON.stringify(result)).not.toContain('metadata')
  })
})

describe('administrator summary route', () => {
  const token = 'a'.repeat(64)
  const studentToken = 'b'.repeat(64)
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const studentTokenHash = createHash('sha256').update(studentToken).digest('hex')
  const app = createApp({
    checkDatabase: async () => undefined,
    adminSummaryService: createAdminSummaryService(emptyRepository),
    identityRepository: {
      findUserByPhoneNormalized: async () => null,
      findSessionByTokenHash: async (candidate) => candidate === tokenHash ? {
        tokenHash, userId: 'admin-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, createdAt: new Date(),
        user: { id: 'admin-1', displayName: '管理员', phoneNormalized: '+8613800138000', passwordHash: 'unused', role: 'admin', disabledAt: null },
      } : candidate === studentTokenHash ? {
        tokenHash: studentTokenHash, userId: 'student-1', expiresAt: new Date(Date.now() + 60_000), revokedAt: null, createdAt: new Date(),
        user: { id: 'student-1', displayName: '学员', phoneNormalized: '+8613800138001', passwordHash: 'unused', role: 'user', disabledAt: null },
      } : null,
      revokeSessionByTokenHash: async () => undefined,
    },
    authTransactionRepository: { rotateSessionAndAudit: async () => undefined },
    config: { allowedOrigins: ['https://admin.example'], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576 },
  })

  it('requires administrator authentication and returns the summary contract', async () => {
    expect((await request(app).get('/api/v1/admin/summary')).status).toBe(401)
    expect((await request(app).get('/api/v1/admin/summary').set('Cookie', `panshi_session=${studentToken}`)).status).toBe(403)
    const response = await request(app).get('/api/v1/admin/summary').set('Cookie', `panshi_session=${token}`)
    expect(response.status).toBe(200)
    expect(response.body.data.applications.total).toBe(0)
  })
})
