import { describe, expect, it } from 'vitest'
import { createApplicationService, ApplicationError, type ApplicationRepository } from '../src/modules/registration/application.service.js'
import { DEFAULT_REGISTRATION_FORM, type RegistrationForm } from '@panshi/contracts'

const user = { id: '00000000-0000-4000-8000-000000000010', displayName: '张三', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const form: RegistrationForm = {
  ...DEFAULT_REGISTRATION_FORM,
  questions: [{ id: '11111111-1111-4111-8111-111111111111', type: 'short_text', label: '研究问题', helpText: '', required: true, order: 0, active: true, validation: { minLength: 2, maxLength: 20 } }],
}
const profile = { name: '张三', email: 'a@example.com', organization: '物理所', department: '研究生部', identityType: '研究生', educationStage: '博士', majorResearchDirection: '凝聚态物理' }

const memoryRepository = (): ApplicationRepository => {
  let revision = 0
  let status: 'draft' | 'submitted' = 'draft'
  const record = () => ({ id: '20000000-0000-4000-8000-000000000001', revision, status, formVersionId: '30000000-0000-4000-8000-000000000001', formVersion: 1, form, profile: { ...profile, phone: user.phoneNormalized }, answers: {}, attachments: [], submittedAt: status === 'submitted' ? new Date() : null, updatedAt: new Date(), retiredAnswerIds: [] })
  return {
    getOrCreateDraft: async () => record(),
    saveDraft: async (input) => input.expectedRevision === revision ? ({ ...record(), revision: ++revision, answers: input.answers, profile: { ...input.profile, phone: user.phoneNormalized } }) : null,
    submit: async (input) => {
      if (input.expectedRevision !== revision || status !== 'draft') return null
      status = 'submitted'
      return { applicationId: '20000000-0000-4000-8000-000000000001', versionId: '40000000-0000-4000-8000-000000000001', submittedAt: new Date('2026-08-15T00:00:00Z') }
    },
    listTimeline: async () => [],
    registrationWindow: async () => ({ open: true }),
  }
}

describe('application service boundaries', () => {
  it('allows incomplete drafts but rejects wrong answer types and stale revisions', async () => {
    const service = createApplicationService(memoryRepository())
    await expect(service.saveDraft(user, { expectedRevision: 0, profile, answers: {}, attachments: [] })).resolves.toMatchObject({ data: { application: { revision: 1 } } })
    await expect(service.saveDraft(user, { expectedRevision: 0, profile, answers: {}, attachments: [] })).rejects.toMatchObject({ code: 'APPLICATION_REVISION_CONFLICT' })
    await expect(service.saveDraft(user, { expectedRevision: 1, profile, answers: { '11111111-1111-4111-8111-111111111111': ['bad'] }, attachments: [] })).rejects.toBeInstanceOf(ApplicationError)
    await expect(service.saveDraft(user, { expectedRevision: 1, profile, answers: { '99999999-9999-4999-8999-999999999999': 'injected' }, attachments: [] })).rejects.toMatchObject({ code: 'APPLICATION_VALIDATION_FAILED' })
  })

  it('rejects submission with missing required answers and closed windows', async () => {
    const repository = memoryRepository()
    const service = createApplicationService(repository)
    await expect(service.submit(user, { expectedRevision: 0 })).rejects.toMatchObject({ code: 'APPLICATION_INCOMPLETE' })
    repository.registrationWindow = async () => ({ open: false, reason: 'REGISTRATION_CLOSED' })
    await expect(service.submit(user, { expectedRevision: 0 })).rejects.toMatchObject({ code: 'REGISTRATION_CLOSED' })
  })
})
