import { describe, expect, it } from 'vitest'
import { ReviewError, createReviewService } from '../src/modules/registration/review.service.js'

const admin = { id: '10000000-0000-4000-8000-000000000001', displayName: '审核员', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'admin' as const, disabledAt: null }

describe('application review state machine', () => {
  it.each([
    ['submitted', 'reviewing'], ['reviewing', 'needs_supplement'], ['reviewing', 'admitted'],
    ['reviewing', 'waitlisted'], ['reviewing', 'rejected'], ['needs_supplement', 'reviewing'],
  ] as const)('allows %s -> %s', async (from, to) => {
    const service = createReviewService({ transition: async (input) => ({ id: input.applicationId, revision: input.expectedRevision + 1, status: to }), list: async () => { throw new Error('unused') }, detail: async () => { throw new Error('unused') }, bulkTransition: async () => [], exportCsv: async () => { throw new Error('unused') } })
    await expect(service.transition(admin, '20000000-0000-4000-8000-000000000001', { expectedRevision: 1, targetStatus: to, publicMessage: to === 'needs_supplement' ? '请补充研究计划' : undefined, internalNote: '内部意见', editableFieldIds: to === 'needs_supplement' ? ['email'] : [], editableAttachmentIds: [] })).resolves.toMatchObject({ data: { status: to } })
  })

  it.each([['draft', 'admitted'], ['admitted', 'draft'], ['submitted', 'admitted'], ['reviewing', 'reviewing']] as const)('rejects %s -> %s', async (from, to) => {
    const service = createReviewService({ transition: async () => { throw new ReviewError(409, 'INVALID_STATUS_TRANSITION', `${from}->${to}`) }, list: async () => { throw new Error('unused') }, detail: async () => { throw new Error('unused') }, bulkTransition: async () => [], exportCsv: async () => { throw new Error('unused') } })
    await expect(service.transition(admin, '20000000-0000-4000-8000-000000000001', { expectedRevision: 1, targetStatus: to, editableFieldIds: [], editableAttachmentIds: [] })).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' })
  })

  it('requires a public message and at least one editable field or attachment for supplementation', async () => {
    const service = createReviewService({ transition: async () => { throw new Error('must not call repository') }, list: async () => { throw new Error('unused') }, detail: async () => { throw new Error('unused') }, bulkTransition: async () => [], exportCsv: async () => { throw new Error('unused') } })
    await expect(service.transition(admin, '20000000-0000-4000-8000-000000000001', { expectedRevision: 1, targetStatus: 'needs_supplement', publicMessage: '', editableFieldIds: [], editableAttachmentIds: [] })).rejects.toMatchObject({ status: 422 })
  })
})
