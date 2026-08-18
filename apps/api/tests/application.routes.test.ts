import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { hashSessionToken } from '../src/modules/identity/session.service.js'
import { ApplicationError, type ApplicationService } from '../src/modules/registration/application.service.js'

const student = { id: '10000000-0000-4000-8000-000000000001', displayName: '张三', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const admin = { ...student, id: '10000000-0000-4000-8000-000000000002', role: 'admin' as const }
const disabled = { ...student, id: '10000000-0000-4000-8000-000000000003', disabledAt: new Date() }
const identityRepository = {
  findUserByPhoneNormalized: async () => null,
  findSessionByTokenHash: async (hash: string) => hash === hashSessionToken('student-token') ? { tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: student } : hash === hashSessionToken('admin-token') ? { tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: admin } : hash === hashSessionToken('disabled-token') ? { tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: disabled } : null,
  revokeSessionByTokenHash: async () => undefined,
}
const fakeService = (overrides: Partial<ApplicationService> = {}): ApplicationService => ({
  getMine: async () => { throw new Error('unused') }, reopen: async () => { throw new Error('unused') }, saveDraft: async () => { throw new Error('unused') }, submit: async () => { throw new Error('unused') }, ...overrides,
})
const app = (service: ApplicationService) => createApp({ checkDatabase: async () => undefined, identityRepository, authTransactionRepository: { rotateSessionAndAudit: async () => undefined }, applicationService: service, config: { allowedOrigins: ['https://camp.example'], healthcheckTimeoutMs: 1000, jsonLimitBytes: 1_000_000 } })

describe('my application routes', () => {
  it('requires a student session and never accepts a user id in the path', async () => {
    const unauthorized = await request(app(fakeService())).get('/api/v1/me/application')
    expect(unauthorized.status).toBe(401)
    expect(unauthorized.headers['cache-control']).toBe('private, no-store')
    expect(unauthorized.headers.etag).toBeUndefined()
    expect((await request(app(fakeService())).get('/api/v1/users/another/application').set('Cookie', 'panshi_session=student-token')).status).toBe(404)
    const administrator = await request(app(fakeService({ getMine: async () => ({ private: true }) as never }))).get('/api/v1/me/application').set('Cookie', 'panshi_session=admin-token')
    expect(administrator.status).toBe(403)
    expect(administrator.body.error.code).toBe('FORBIDDEN')
  })
  it('expires the browser cookie when a disabled session is rejected', async () => {
    const response = await request(app(fakeService())).get('/api/v1/me/application').set('Cookie', 'panshi_session=disabled-token')
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('ACCOUNT_DISABLED')
    expect(response.headers['set-cookie']?.[0]).toMatch(/^panshi_session=;.*Path=\/.*Expires=/u)
    expect(response.headers['cache-control']).toBe('private, no-store')
    expect(response.headers.etag).toBeUndefined()
  })
  it('marks account, application, forbidden, and missing me responses private without etags', async () => {
    const responses = await Promise.all([
      request(app(fakeService())).get('/api/v1/me/profile').set('Cookie', 'panshi_session=student-token'),
      request(app(fakeService({ getMine: async () => ({ private: true }) as never }))).get('/api/v1/me/application').set('Cookie', 'panshi_session=student-token'),
      request(app(fakeService({ getMine: async () => { throw new ApplicationError(403, 'ACCOUNT_DISABLED', '账号已停用') } }))).get('/api/v1/me/application').set('Cookie', 'panshi_session=student-token'),
      request(app(fakeService())).get('/api/v1/me/not-found').set('Cookie', 'panshi_session=student-token'),
      request(app(fakeService())).get('/api/v1/auth/not-found'),
      request(app(fakeService())).get('/api/v1/admin/not-found').set('Cookie', 'panshi_session=student-token'),
    ])
    expect(responses.map((response) => response.status)).toEqual([200, 200, 403, 404, 404, 404])
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('private, no-store')
      expect(response.headers.etag).toBeUndefined()
    }
  })
  it('returns field errors without echoing answers or phone numbers', async () => {
    const response = await request(app(fakeService({ saveDraft: async () => { throw new ApplicationError(422, 'APPLICATION_INCOMPLETE', '请完成必填项', [{ path: 'answers.q', message: '必填' }]) } })))
      .put('/api/v1/me/application/draft').set('Origin', 'https://camp.example').set('Cookie', 'panshi_session=student-token')
      .send({ phone: '+8613800138000', answers: { q: 'secret' } })
    expect(response.status).toBe(422); expect(response.body.error.details.fields).toEqual([{ path: 'answers.q', message: '必填' }])
    expect(JSON.stringify(response.body)).not.toContain('secret'); expect(JSON.stringify(response.body)).not.toContain('+8613800138000')
  })
  it('routes an authenticated learner reopen request without accepting another user id', async () => {
    const reopen = vi.fn(async () => ({ apiVersion: 'v1', data: { application: { status: 'draft' } } }) as never)
    const response = await request(app(fakeService({ reopen }))).post('/api/v1/me/application/reopen')
      .set('Origin', 'https://camp.example').set('Cookie', 'panshi_session=student-token').send({ expectedRevision: 2 })
    expect(response.status).toBe(200)
    expect(reopen).toHaveBeenCalledWith(student, { expectedRevision: 2 })
  })
})
