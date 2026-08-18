import { createHash, randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import { ConfirmationError, type ConfirmationService } from '../src/modules/confirmations/confirmation.service.js'

const origin = 'https://camp.example'
const token = 'd'.repeat(64)
const adminToken = 'a'.repeat(64)
const user = { id: '10000000-0000-4000-8000-000000000001', displayName: '学员', phoneNormalized: '+8613800138000', passwordHash: 'hash', role: 'user' as const, disabledAt: null, passwordResetRequiredAt: null }
const admin = { ...user, id: '10000000-0000-4000-8000-000000000002', displayName: '管理员', phoneNormalized: '+8613900139000', role: 'admin' as const }
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const identityRepository = {
  findUserByPhoneNormalized: async () => null,
  findSessionByTokenHash: async (tokenHash: string) => tokenHash === hash(token)
    ? { tokenHash, kind: 'web' as const, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user }
    : tokenHash === hash(adminToken)
      ? { tokenHash, kind: 'admin_web' as const, expiresAt: new Date(Date.now() + 60_000), revokedAt: null, user: admin }
      : null,
  revokeSessionByTokenHash: async () => undefined,
}
const authTransactions = { rotateSessionAndAudit: async () => undefined, revokeSessionAndAudit: async () => undefined }
const confirmationExecute = vi.fn(async (_actor, _id, _input, capabilityId: string) => {
  if (capabilityId === 'auth.login') return { apiVersion: 'v1', data: { token: 'e'.repeat(64), expiresAt: new Date(Date.now() + 60_000).toISOString(), user: { id: user.id, displayName: user.displayName, role: user.role } } }
  if (capabilityId === 'auth.register') return { apiVersion: 'v1', data: { user: { id: user.id, displayName: user.displayName, role: user.role } } }
  if (capabilityId === 'file.upload') return { apiVersion: 'v1', data: { file: { id: randomUUID(), originalName: 'resume.pdf', mimeType: 'application/pdf', sizeBytes: 8 } } }
  return { apiVersion: 'v1', data: { accepted: true } }
})
const confirmations = {
  prepare: vi.fn(async () => ({
    confirmationId: randomUUID(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(), preview: { action: '测试确认' }, payloadSha256: 'a'.repeat(64), confirmation: 'single' as const,
  })),
  execute: confirmationExecute,
} as unknown as ConfirmationService
const applicationService = { getMine: vi.fn(), saveDraft: vi.fn(), reopen: vi.fn(), submit: vi.fn() } as never
const fileUpload = vi.fn(async () => ({ id: randomUUID(), originalName: 'fixture.pdf', mimeType: 'application/pdf', sizeBytes: 8 }))
const fileService = { upload: fileUpload, openForDownload: vi.fn(), openPublishedResource: vi.fn(), hide: vi.fn(), remove: vi.fn() } as never
const accountService = { changeOwnPassword: vi.fn() } as never
let temporaryDirectory = ''

let temporaryRoot = ''
beforeAll(async () => { temporaryRoot = await mkdtemp(join(tmpdir(), 'panshi-confirmed-mutations-')); temporaryDirectory = join(temporaryRoot, 'incoming') })
afterAll(async () => { await rm(temporaryRoot, { recursive: true, force: true }) })

const app = () => createApp({
  checkDatabase: async () => undefined,
  identityRepository,
  authTransactionRepository: authTransactions,
  confirmationService: confirmations,
  applicationService,
  fileService,
  adminManagementService: accountService,
  config: { allowedOrigins: [origin], healthcheckTimeoutMs: 1_000, jsonLimitBytes: 1_000_000, fileUploadTempDirectory: temporaryDirectory },
})

const authenticated = (method: 'post' | 'put' | 'patch' | 'delete', path: string) => request(app())[method](path).set('Origin', origin).set('Cookie', `panshi_session=${token}`)
const binding = 'b'.repeat(64)
const confirmedHeaders = () => ({
  'X-Confirmation-Id': randomUUID(),
  'X-Confirmation-Binding': binding,
  'X-Idempotency-Key': randomUUID(),
})

const prepare = async (capabilityId: string, payload: Record<string, unknown>, authenticatedUser = false) => {
  const call = request(app()).post('/api/v1/confirmations/prepare').set('Origin', origin)
  if (authenticatedUser) call.set('Cookie', `panshi_session=${token}`)
  const response = await call.send({ capabilityId, payload, clientBinding: binding, idempotencyKey: randomUUID() })
  expect(response.status, JSON.stringify(response.body)).toBe(201)
  return response.body.data
}

describe('confirmed learner mutation boundary', () => {
  it('keeps administrator resource uploads on the authenticated admin path without learner confirmation headers', async () => {
    fileUpload.mockResolvedValueOnce({ id: randomUUID(), originalName: 'guide.pdf', mimeType: 'application/pdf', sizeBytes: 8 })
    const response = await request(app()).post('/api/v1/files').set('Origin', origin)
      .set('Cookie', `panshi_session=${adminToken}`).field('purpose', 'resource').field('visibility', 'admitted')
      .attach('file', Buffer.from('%PDF-1.4'), { filename: 'guide.pdf', contentType: 'application/pdf' })

    expect(response.status).toBe(201)
    expect(fileUpload).toHaveBeenCalledOnce()
  })

  it('maps confirmation contract failures to their public API code', async () => {
    confirmationExecute.mockRejectedValueOnce(new ConfirmationError('CONFIRMATION_MISMATCH', '确认内容与准备阶段不一致', 409))
    const response = await request(app()).post('/api/v1/auth/verification/send')
      .set('Origin', origin).set(confirmedHeaders()).send({ phone: '13800138000', purpose: 'register' })

    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CONFIRMATION_MISMATCH')
  })

  it.each([
    ['verification send', '/api/v1/auth/verification/send', { phone: '13800138000', purpose: 'register' }],
    ['registration', '/api/v1/auth/register', { phone: '13800138000', code: '123456', password: 'password-123' }],
    ['login', '/api/v1/auth/login', { phone: '13800138000', password: 'password-123' }],
    ['password reset', '/api/v1/auth/password/reset', { phone: '13800138000', code: '123456', newPassword: 'password-456' }],
  ])('rejects direct anonymous %s', async (_name, path, body) => {
    const response = await request(app()).post(path).set('Origin', origin).send(body)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CONFIRMATION_REQUIRED')
  })

  it.each([
    ['logout', 'post', '/api/v1/auth/logout', {}],
    ['password change', 'post', '/api/v1/me/account/password', { currentPassword: 'old-password', newPassword: 'new-password' }],
    ['draft save', 'put', '/api/v1/me/application/draft', {}],
    ['reopen', 'post', '/api/v1/me/application/reopen', { expectedRevision: 1 }],
    ['submit', 'post', '/api/v1/me/application/submit', { expectedRevision: 1 }],
    ['file hide', 'patch', '/api/v1/files/20000000-0000-4000-8000-000000000001/hide', {}],
    ['file delete', 'delete', '/api/v1/files/20000000-0000-4000-8000-000000000001', {}],
  ] as const)('rejects direct authenticated %s', async (_name, method, path, body) => {
    const response = await authenticated(method, path).send(body)
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CONFIRMATION_REQUIRED')
  })

  it('rejects upload before allocating a temporary file', async () => {
    const response = await authenticated('post', '/api/v1/files')
    expect(response.status).toBe(409)
    expect(response.body.error.code).toBe('CONFIRMATION_REQUIRED')
  })

  it.each([
    ['auth.verification.send', '/api/v1/auth/verification/send', { phone: '13800138000', purpose: 'register' }, { phoneMasked: '+8613******000', purpose: 'register' }, 200],
    ['auth.register', '/api/v1/auth/register', { phone: '13800138000', code: '123456', password: 'password-123' }, { phoneMasked: '+8613******000' }, 201],
    ['auth.login', '/api/v1/auth/login', { phone: '13800138000', password: 'password-123' }, { phoneMasked: '+8613******000', clientKind: 'web' }, 200],
    ['auth.password_reset', '/api/v1/auth/password/reset', { phone: '13800138000', code: '123456', newPassword: 'password-456' }, { phoneMasked: '+8613******000' }, 200],
  ] as const)('allows prepared anonymous %s execution', async (capabilityId, path, body, previewPayload, status) => {
    await prepare(capabilityId, previewPayload)
    const response = await request(app()).post(path).set('Origin', origin).set(confirmedHeaders()).send(body)
    expect(response.status).toBe(status)
  })

  it.each([
    ['auth.logout', 'post', '/api/v1/auth/logout', {}, { scope: 'current' }, 204],
    ['account.password_change', 'post', '/api/v1/me/account/password', { currentPassword: 'old-password', newPassword: 'new-password' }, { account: 'self' }, 200],
    ['application.draft.save', 'put', '/api/v1/me/application/draft', { expectedRevision: 1 }, { expectedRevision: 1, profileFields: [], answerIds: [], attachmentSlotIds: [] }, 200],
    ['application.reopen', 'post', '/api/v1/me/application/reopen', { expectedRevision: 1 }, { expectedRevision: 1 }, 200],
    ['application.submit', 'post', '/api/v1/me/application/submit', { expectedRevision: 1 }, { expectedRevision: 1 }, 201],
    ['file.hide', 'patch', '/api/v1/files/20000000-0000-4000-8000-000000000001/hide', {}, { fileId: '20000000-0000-4000-8000-000000000001' }, 204],
    ['file.delete', 'delete', '/api/v1/files/20000000-0000-4000-8000-000000000001', {}, { fileId: '20000000-0000-4000-8000-000000000001' }, 204],
  ] as const)('allows prepared authenticated %s execution', async (capabilityId, method, path, body, previewPayload, status) => {
    await prepare(capabilityId, previewPayload, true)
    const response = await authenticated(method, path).set(confirmedHeaders()).send(body)
    expect(response.status).toBe(status)
  })

  it('allows a prepared file upload execution', async () => {
    await prepare('file.upload', { sha256: 'a'.repeat(64), sizeBytes: 8, originalName: 'resume.pdf', mimeType: 'application/pdf', purpose: 'registration_attachment', attachmentSlot: 'resume' }, true)
    const response = await authenticated('post', '/api/v1/files').set(confirmedHeaders())
      .field('purpose', 'registration_attachment').field('attachmentSlot', 'resume')
      .attach('file', Buffer.from('%PDF-1.7'), { filename: 'resume.pdf', contentType: 'application/pdf' })
    expect(response.status).toBe(201)
  })
})
