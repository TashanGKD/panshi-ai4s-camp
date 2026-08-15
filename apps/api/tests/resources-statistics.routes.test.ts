import { Readable } from 'node:stream'
import request from 'supertest'
import { describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { hashSessionToken } from '../src/modules/identity/session.service.js'
import { ResourceAccessError, type ResourceService } from '../src/modules/resources/resource.service.js'

const user = { id: '10000000-0000-4000-8000-000000000001', displayName: '学员', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const admitted = { ...user, id: '10000000-0000-4000-8000-000000000002', phoneNormalized: '+8613900139000' }
const identityRepository = {
  findUserByPhoneNormalized: async () => null,
  findSessionByTokenHash: async (hash: string) => {
    const actor = hash === hashSessionToken('user-token') ? user : hash === hashSessionToken('admitted-token') ? admitted : null
    return actor ? { tokenHash: hash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: actor } : null
  },
  revokeSessionByTokenHash: async () => undefined,
}
const publicItem = { id: '20000000-0000-4000-8000-000000000001', key: 'public', title: '公开资料', description: null, accessScope: 'public' as const, sortOrder: 0, downloadUrl: '/api/v1/resources/20000000-0000-4000-8000-000000000001/download' }
const protectedItem = { ...publicItem, id: '20000000-0000-4000-8000-000000000002', key: 'admitted', title: '录取资料', accessScope: 'admitted' as const, downloadUrl: '/api/v1/resources/20000000-0000-4000-8000-000000000002/download' }
const service = {
  list: async (actor: typeof user | null) => actor?.id === admitted.id ? [publicItem, protectedItem] : [publicItem],
  open: async (id: string, actor: typeof user | null) => {
    if (id === protectedItem.id && actor?.id !== admitted.id) throw new ResourceAccessError(404, 'RESOURCE_NOT_AVAILABLE')
    return { record: { mimeType: 'application/pdf', sizeBytes: 3, originalName: 'guide.pdf', visibility: id === publicItem.id ? 'public' : 'admitted' }, stream: Readable.from(Buffer.from('pdf')) }
  },
  listAdmin: async () => [], createDraft: async () => { throw new Error('unused') }, updateDraft: async () => { throw new Error('unused') }, setPublished: async () => { throw new Error('unused') },
} as unknown as ResourceService
const makeApp = (visible = true) => createApp({
  checkDatabase: async () => undefined, identityRepository, authTransactionRepository: { rotateSessionAndAudit: async () => undefined }, resourceService: service,
  statisticsService: { readPublic: async () => visible ? { visible: true, submittedCount: 7, updatedAt: '2026-08-15T12:00:00.000Z' } : { visible: false } },
  config: { allowedOrigins: ['https://camp.example'], healthcheckTimeoutMs: 1000, jsonLimitBytes: 100_000 },
})

describe('resource and statistics routes', () => {
  it('never mixes protected metadata into anonymous cacheable lists', async () => {
    const anonymous = await request(makeApp()).get('/api/v1/resources').expect(200)
    expect(anonymous.body.data.resources).toEqual([publicItem]); expect(anonymous.headers['cache-control']).toContain('public')
    const loggedIn = await request(makeApp()).get('/api/v1/resources').set('Cookie', 'panshi_session=admitted-token').expect(200)
    expect(loggedIn.body.data.resources).toHaveLength(2); expect(loggedIn.headers['cache-control']).toBe('private, no-store'); expect(loggedIn.headers.etag).toBeUndefined()
  })

  it('uses indistinguishable 404 for restricted downloads and private no-store errors', async () => {
    const response = await request(makeApp()).get(`/api/v1/resources/${protectedItem.id}/download`).expect(404)
    expect(response.body.error.code).toBe('RESOURCE_NOT_AVAILABLE'); expect(response.headers['cache-control']).toBe('private, no-store'); expect(response.headers.etag).toBeUndefined()
  })

  it('exposes the safe download filename to the decoupled web origin', async () => {
    const response = await request(makeApp()).get(`/api/v1/resources/${publicItem.id}/download`).set('Origin', 'https://camp.example').expect(200)
    expect(response.headers['access-control-expose-headers']).toBe('Content-Disposition')
    expect(response.headers['content-disposition']).toContain("filename*=UTF-8''guide.pdf")
    expect(response.headers['cache-control']).toBe('public, max-age=0, must-revalidate')
  })

  it('omits count and timestamp when the published switch is off', async () => {
    const response = await request(makeApp(false)).get('/api/v1/public/statistics/applications').expect(200)
    expect(response.body).toEqual({ apiVersion: 'v1', data: { visible: false } }); expect(response.text).not.toContain('count'); expect(response.text).not.toContain('updatedAt')
  })
})
