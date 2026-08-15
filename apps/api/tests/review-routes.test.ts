import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { hashSessionToken } from '../src/modules/identity/session.service.js'
import type { ReviewService } from '../src/modules/registration/review.service.js'

const admin = { id: '10000000-0000-4000-8000-000000000001', displayName: '审核员', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'admin' as const, disabledAt: null }
const student = { ...admin, id: '10000000-0000-4000-8000-000000000002', role: 'user' as const }
const identityRepository = { findUserByPhoneNormalized: async () => null, findSessionByTokenHash: async (hash: string) => hash === hashSessionToken('admin-token') ? { tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: admin } : hash === hashSessionToken('student-token') ? { tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: student } : null, revokeSessionByTokenHash: async () => undefined }
const service: ReviewService = { list: async () => ({ apiVersion: 'v1', data: { items: [], total: 0, page: 1, pageSize: 20 } }), detail: async () => ({ apiVersion: 'v1', data: { private: true } }), transition: async () => ({ apiVersion: 'v1', data: { id: 'x', revision: 2, status: 'reviewing' } }), bulkTransition: async () => ({ apiVersion: 'v1', data: { results: [] } }), exportCsv: async () => ({ csv: '\uFEFFa\r\n', count: 0, columns: ['a'] }) }
const app = createApp({ checkDatabase: async () => undefined, identityRepository, authTransactionRepository: { rotateSessionAndAudit: async () => undefined }, reviewService: service, config: { allowedOrigins: ['https://camp.example'], healthcheckTimeoutMs: 1000, jsonLimitBytes: 1_000_000 } })

describe('admin application review routes', () => {
  it('rejects anonymous and student access and marks all responses private', async () => {
    for (const response of [await request(app).get('/api/v1/admin/applications'), await request(app).get('/api/v1/admin/applications').set('Cookie', 'panshi_session=student-token')]) { expect(response.status).toBe(403); expect(response.headers['cache-control']).toBe('private, no-store'); expect(response.headers.etag).toBeUndefined() }
  })
  it('serves list and bounded CSV only to an administrator', async () => {
    const list = await request(app).get('/api/v1/admin/applications').set('Cookie', 'panshi_session=admin-token'); expect(list.status).toBe(200)
    const csv = await request(app).get('/api/v1/admin/applications/export.csv').set('Cookie', 'panshi_session=admin-token'); expect(csv.status).toBe(200); expect(csv.headers['content-type']).toContain('text/csv'); expect(csv.headers['cache-control']).toBe('private, no-store')
  })
})
