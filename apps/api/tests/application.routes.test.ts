import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { hashSessionToken } from '../src/modules/identity/session.service.js'
import { ApplicationError, type ApplicationService } from '../src/modules/registration/application.service.js'

const student = { id: '10000000-0000-4000-8000-000000000001', displayName: '张三', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const identityRepository = {
  findUserByPhoneNormalized: async () => null,
  findSessionByTokenHash: async (hash: string) => hash === hashSessionToken('student-token') ? { tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: student } : null,
  revokeSessionByTokenHash: async () => undefined,
}
const fakeService = (overrides: Partial<ApplicationService> = {}): ApplicationService => ({
  getMine: async () => { throw new Error('unused') }, saveDraft: async () => { throw new Error('unused') }, submit: async () => { throw new Error('unused') }, ...overrides,
})
const app = (service: ApplicationService) => createApp({ checkDatabase: async () => undefined, identityRepository, authTransactionRepository: { rotateSessionAndAudit: async () => undefined }, applicationService: service, config: { allowedOrigins: ['https://camp.example'], healthcheckTimeoutMs: 1000, jsonLimitBytes: 1_000_000 } })

describe('my application routes', () => {
  it('requires a student session and never accepts a user id in the path', async () => {
    expect((await request(app(fakeService())).get('/api/v1/me/application')).status).toBe(401)
    expect((await request(app(fakeService())).get('/api/v1/users/another/application').set('Cookie', 'panshi_session=student-token')).status).toBe(404)
  })
  it('returns field errors without echoing answers or phone numbers', async () => {
    const response = await request(app(fakeService({ saveDraft: async () => { throw new ApplicationError(422, 'APPLICATION_INCOMPLETE', '请完成必填项', [{ path: 'answers.q', message: '必填' }]) } })))
      .put('/api/v1/me/application/draft').set('Origin', 'https://camp.example').set('Cookie', 'panshi_session=student-token')
      .send({ phone: '+8613800138000', answers: { q: 'secret' } })
    expect(response.status).toBe(422); expect(response.body.error.details.fields).toEqual([{ path: 'answers.q', message: '必填' }])
    expect(JSON.stringify(response.body)).not.toContain('secret'); expect(JSON.stringify(response.body)).not.toContain('+8613800138000')
  })
})
