import { describe, expect, it, vi } from 'vitest'
import { CheckInError, createCheckInService, type CheckInRepository } from '../src/modules/check-in/check-in.service.js'

const student = { id: '10000000-0000-4000-8000-000000000001', displayName: '郑博元', phoneNormalized: '+8618811132625', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const admin = { id: '10000000-0000-4000-8000-000000000002', displayName: '会务组01', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'admin' as const, disabledAt: null }
const publicId = '20000000-0000-4000-8000-000000000001'
const credentialId = '30000000-0000-4000-8000-000000000001'
const applicationId = '40000000-0000-4000-8000-000000000001'
const profile = {
  name: '郑博元', phone: student.phoneNormalized, organization: '中国科学院大学', department: '中国科学院物理研究所', identityType: '博士研究生',
}

const context = (status: 'admitted' | 'reviewing' = 'admitted') => ({
  applicationId,
  credential: { id: credentialId, applicationId, publicId, revision: 0, revokedAt: null },
  applicationStatus: status,
  profile,
  checkIn: null,
})

const repository = (overrides: Partial<CheckInRepository> = {}): CheckInRepository => ({
  findStudentContext: async () => context(),
  ensureCredential: async () => context().credential,
  findByPublicId: async () => context(),
  recordRepeatedLookup: async () => undefined,
  confirm: async () => ({ ...context(), checkIn: { id: '50000000-0000-4000-8000-000000000001', active: true, confirmedAt: new Date('2026-09-04T01:00:00.000Z'), confirmedByName: admin.displayName, revokedAt: null, revokeReason: null, revision: 0 }, duplicate: false }),
  revoke: async () => ({ ...context(), checkIn: { id: '50000000-0000-4000-8000-000000000001', active: false, confirmedAt: new Date('2026-09-04T01:00:00.000Z'), confirmedByName: admin.displayName, revokedAt: new Date('2026-09-04T02:00:00.000Z'), revokeReason: '现场误操作', revision: 1 }, duplicate: false }),
  ...overrides,
})

describe('check-in service', () => {
  it('issues an opaque signed credential only for admitted students', async () => {
    const service = createCheckInService(repository(), { tokenSecret: '11'.repeat(32) })
    const available = await service.getStudentCredential(student)
    expect(available.data).toMatchObject({ availability: 'available', displayCode: '20000000', checkedInAt: null })
    expect(available.data).toHaveProperty('qrPayload')
    expect(JSON.stringify(available)).not.toContain(student.phoneNormalized)

    const unavailable = createCheckInService(repository({ findStudentContext: async () => context('reviewing') }), { tokenSecret: '11'.repeat(32) })
    await expect(unavailable.getStudentCredential(student)).resolves.toEqual({ apiVersion: 'v1', data: { availability: 'unavailable', reason: '录取后开放报到二维码' } })
  })

  it('verifies the signature and never queries invalid public credentials', async () => {
    const findByPublicId = vi.fn(async () => context())
    const service = createCheckInService(repository({ findByPublicId }), { tokenSecret: '22'.repeat(32) })
    const issued = await service.getStudentCredential(student)
    if (issued.data.availability === 'unavailable') throw new Error('expected credential')
    await expect(service.lookup(admin, { code: issued.data.qrPayload })).resolves.toMatchObject({ data: { applicationStatus: 'admitted', checkInState: 'not_checked_in' } })
    expect(findByPublicId).toHaveBeenCalledWith(publicId)

    await expect(service.lookup(admin, { code: `${publicId}.invalid` })).rejects.toMatchObject({ code: 'CHECK_IN_CODE_INVALID' })
    expect(findByPublicId).toHaveBeenCalledTimes(1)
  })

  it('confirms explicitly and preserves idempotent duplicate results', async () => {
    const confirm = vi.fn(async () => ({ ...context(), checkIn: { id: '50000000-0000-4000-8000-000000000001', active: true, confirmedAt: new Date('2026-09-04T01:00:00.000Z'), confirmedByName: admin.displayName, revokedAt: null, revokeReason: null, revision: 0 }, duplicate: true }))
    const service = createCheckInService(repository({ confirm }), { tokenSecret: '33'.repeat(32) })
    await expect(service.confirm(admin, credentialId, { expectedRevision: 0 })).resolves.toMatchObject({ data: { checkInState: 'checked_in', duplicate: true, firstCheckedInAt: '2026-09-04T01:00:00.000Z' } })
    expect(confirm).toHaveBeenCalledWith({ credentialId, adminId: admin.id, expectedRevision: 0 })
  })

  it('requires an enabled administrator and a reasoned revocation', async () => {
    const service = createCheckInService(repository(), { tokenSecret: '44'.repeat(32) })
    await expect(service.revoke({ ...admin, disabledAt: new Date() }, credentialId, { expectedRevision: 0, reason: '现场误操作' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(service.revoke(admin, credentialId, { expectedRevision: 0, reason: ' ' })).rejects.toBeInstanceOf(CheckInError)
    await expect(service.revoke(admin, credentialId, { expectedRevision: 0, reason: '现场误操作' })).resolves.toMatchObject({ data: { checkInState: 'revoked', revokeReason: '现场误操作' } })
  })
})
