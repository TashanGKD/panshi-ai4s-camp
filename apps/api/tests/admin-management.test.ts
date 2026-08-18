import { createHash } from 'node:crypto'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { createAuditService } from '../src/modules/audit/audit.service.js'
import { AdminManagementError } from '../src/modules/identity/admin-management.service.js'

const token = 'admin-token'
const tokenHash = createHash('sha256').update(token).digest('hex')
const admin = { id: '10000000-0000-4000-8000-000000000001', displayName: '主管理员', phoneNormalized: '+8613800138000', passwordHash: 'secret-hash', role: 'admin' as const, disabledAt: null }
const identityRepository = {
  findUserByPhoneNormalized: async () => null,
  findSessionByTokenHash: async (candidate: string) => candidate === tokenHash
    ? { tokenHash, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: admin }
    : null,
  revokeSessionByTokenHash: async () => undefined,
}

const administrators = [{ id: admin.id, displayName: admin.displayName, phone: admin.phoneNormalized, disabledAt: null, createdAt: '2026-08-15T00:00:00.000Z' }]
const adminManagementService = {
  list: vi.fn(async () => ({ apiVersion: 'v1', data: { administrators } })),
  create: vi.fn(async (_actor: typeof admin, input: unknown) => ({ apiVersion: 'v1', data: { administrator: administrators[0], input } })),
  disable: vi.fn(async () => ({ apiVersion: 'v1', data: { administrator: { ...administrators[0], disabledAt: '2026-08-15T01:00:00.000Z' } } })),
  resetPassword: vi.fn(async () => ({ apiVersion: 'v1', data: { administrator: administrators[0] } })),
  listStudents: vi.fn(async () => ({ apiVersion: 'v1', data: { students: [] } })),
  updateSelf: vi.fn(async () => ({ apiVersion: 'v1', data: { administrator: { ...administrators[0], isCurrent: true } } })),
  changeOwnPassword: vi.fn(async () => ({ apiVersion: 'v1', data: { sessionsRevoked: true } })),
  setStudentStatus: vi.fn(async () => ({ apiVersion: 'v1', data: { student: administrators[0] } })),
  forceStudentPasswordReset: vi.fn(async () => ({ apiVersion: 'v1', data: { student: administrators[0], resetMethod: 'verification_code' } })),
}
const auditQueryService = {
  auditLogs: vi.fn(async () => ({ apiVersion: 'v1', data: { items: [{ id: '20000000-0000-4000-8000-000000000001', actor: { id: admin.id, displayName: admin.displayName }, action: 'admin.created', entityType: 'user', entityId: admin.id, metadata: { result: 'success' }, createdAt: '2026-08-15T00:00:00.000Z' }], total: 1, page: 1, pageSize: 20 } })),
  auditLog: vi.fn(async () => ({ apiVersion: 'v1', data: { item: { id: '20000000-0000-4000-8000-000000000001', actor: { id: admin.id, displayName: admin.displayName }, action: 'admin.created', entityType: 'user', entityId: admin.id, metadata: { result: 'success' }, createdAt: '2026-08-15T00:00:00.000Z' } } })),
}

const makeApp = () => createApp({
  checkDatabase: async () => undefined,
  identityRepository,
  authTransactionRepository: { rotateSessionAndAudit: async () => undefined, revokeSessionAndAudit: async () => undefined },
  adminManagementService,
  auditQueryService,
  config: { allowedOrigins: ['https://admin.example'], healthcheckTimeoutMs: 1_000, jsonLimitBytes: 100_000 },
} as never)

describe('administrator management and audit routes', () => {
  it('rejects arbitrary metadata before the audit repository write', async () => {
    const append = vi.fn(async () => undefined)
    await expect(createAuditService({ append }).record({ actorUserId: admin.id, action: 'application.status_changed', entityType: 'application', entityId: admin.id, metadata: { fromStatus: 'submitted', toStatus: 'reviewing', revision: 1, editableFieldCount: 0, editableAttachmentCount: 0, summary: '内部意见' } as never })).rejects.toMatchObject({ name: 'AuditPolicyError' })
    expect(append).not.toHaveBeenCalled()
  })
  it('requires an administrator and never exposes password hashes', async () => {
    await request(makeApp()).get('/api/v1/admin/users').expect(403)
    const response = await request(makeApp()).get('/api/v1/admin/users').set('Cookie', `panshi_session=${token}`).expect(200)
    expect(response.body.data.administrators).toEqual(administrators)
    expect(JSON.stringify(response.body)).not.toContain('passwordHash')
    expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('requires the current password payload for creation and disabling', async () => {
    const app = makeApp()
    await request(app).post('/api/v1/admin/users').set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example')
      .send({ displayName: '新管理员', phone: '13900139000', password: 'NewAdmin!2026' }).expect(422)
    await request(app).post(`/api/v1/admin/users/${admin.id}/disable`).set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example')
      .send({}).expect(422)
    await request(app).post(`/api/v1/admin/users/${admin.id}/reset-password`).set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example')
      .send({ newPassword: 'Replacement!2026' }).expect(422)
  })

  it('provides no-store student management and self-service routes with reauthentication inputs', async () => {
    const app = makeApp()
    const list = await request(app).get('/api/v1/admin/users/students?search=test').set('Cookie', `panshi_session=${token}`).expect(200)
    expect(list.headers['cache-control']).toBe('private, no-store')
    await request(app).patch('/api/v1/admin/users/me').set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example').send({ displayName: '新名称' }).expect(422)
    await request(app).post('/api/v1/admin/users/students/not-a-uuid/status').set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example').send({ currentPassword: 'Current!2026', disabled: true }).expect(422)
    await request(app).post('/api/v1/me/account/password').set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example').send({ currentPassword: 'Current!2026', newPassword: 'Replacement!2026' }).expect(200)
    expect(adminManagementService.changeOwnPassword).toHaveBeenCalled()
  })

  it('returns the stable conflict contract for a duplicate self rename', async () => {
    adminManagementService.updateSelf.mockRejectedValueOnce(new AdminManagementError(409, 'ADMIN_NAME_CONFLICT', '管理员名称已存在'))
    const response = await request(makeApp()).patch('/api/v1/admin/users/me').set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example')
      .send({ displayName: 'duplicate admin', currentPassword: 'Current!2026' }).expect(409)
    expect(response.body.error.code).toBe('ADMIN_NAME_CONFLICT')
    expect(response.headers['cache-control']).toBe('private, no-store')
  })

  it('provides filtered read-only audit access without mutation routes', async () => {
    const app = makeApp()
    const response = await request(app).get('/api/v1/admin/audit-logs?action=admin.created&actorId=10000000-0000-4000-8000-000000000001&entityId=10000000-0000-4000-8000-000000000001&from=2026-08-01&to=2026-08-31')
      .set('Cookie', `panshi_session=${token}`).expect(200)
    expect(response.body.data.total).toBe(1)
    expect(auditQueryService.auditLogs).toHaveBeenLastCalledWith(expect.objectContaining({
      from: new Date('2026-07-31T16:00:00.000Z'),
      toExclusive: new Date('2026-08-31T16:00:00.000Z'),
    }))
    const lastAuditQuery = auditQueryService.auditLogs.mock.calls.at(-1) as unknown as [Record<string, unknown>] | undefined
    expect(lastAuditQuery?.[0]).not.toHaveProperty('to')
    expect(JSON.stringify(response.body)).not.toMatch(/password|verification|attachmentContent|secret/iu)
    const detail = await request(app).get('/api/v1/admin/audit-logs/20000000-0000-4000-8000-000000000001').set('Cookie', `panshi_session=${token}`).expect(200)
    expect(detail.body.data.item.action).toBe('admin.created')
    expect(detail.headers['cache-control']).toBe('private, no-store')
    expect(detail.headers.etag).toBeUndefined()
    await request(app).put('/api/v1/admin/audit-logs/20000000-0000-4000-8000-000000000001').set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example').send({}).expect(404)
    await request(app).delete('/api/v1/admin/audit-logs/20000000-0000-4000-8000-000000000001').set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example').expect(404)
    await request(app).post('/api/v1/admin/audit-logs').set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example').send({}).expect(404)
  })

  it('rejects invalid identifiers before accessing services', async () => {
    const app = makeApp()
    await request(app).post('/api/v1/admin/users/not-a-uuid/disable').set('Cookie', `panshi_session=${token}`).set('Origin', 'https://admin.example').send({ currentPassword: 'Current!2026' }).expect(422)
    await request(app).get('/api/v1/admin/audit-logs/not-a-uuid').set('Cookie', `panshi_session=${token}`).expect(422)
    expect(adminManagementService.disable).not.toHaveBeenCalledWith(expect.anything(), 'not-a-uuid', expect.anything())
  })
})
