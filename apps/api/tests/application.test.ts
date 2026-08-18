import { describe, expect, it } from 'vitest'
import { createApplicationService, ApplicationError, type ApplicationRepository } from '../src/modules/registration/application.service.js'
import { DEFAULT_REGISTRATION_FORM, type ApplicationCoreFields, type RegistrationForm } from '@panshi/contracts'
import { authoritativeRegistrationForm } from '../src/db/seeds/authoritative-registration-form.js'

const user = { id: '00000000-0000-4000-8000-000000000010', displayName: '张三', phoneNormalized: '+8613800138000', passwordHash: 'x', role: 'user' as const, disabledAt: null }
const form: RegistrationForm = {
  ...DEFAULT_REGISTRATION_FORM,
  questions: [{ id: '11111111-1111-4111-8111-111111111111', type: 'short_text', label: '研究问题', helpText: '', required: true, order: 0, active: true, validation: { minLength: 2, maxLength: 20 } }],
}
const profile: Omit<ApplicationCoreFields, 'phone'> = {
  name: '张三', email: 'a@example.com', organization: '物理所', department: '研究生部', identityType: '博士研究生',
  educationStage: '博士研究生', majorResearchDirection: '凝聚态物理', major: '物理学', researchDirection: '凝聚态物理',
  researchInterest: '', postdocStation: '', disciplineField: '', supervisor: '', jobPosition: '',
  professionalTitleLevel: '', specificTitle: '', identityDescription: '',
}

const memoryRepository = (options: { profile?: Omit<ApplicationCoreFields, 'phone'>, form?: RegistrationForm, answers?: Record<string, unknown> } = {}): ApplicationRepository => {
  let revision = 0
  let status: 'draft' | 'submitted' = 'draft'
  const currentProfile = options.profile ?? profile
  const record = () => ({ id: '20000000-0000-4000-8000-000000000001', revision, status, formVersionId: '30000000-0000-4000-8000-000000000001', formVersion: 1, form: options.form ?? form, profile: { ...currentProfile, phone: user.phoneNormalized }, answers: options.answers ?? {}, attachments: [], unlinkedAttachments: [], submittedAt: status === 'submitted' ? new Date() : null, updatedAt: new Date(), retiredAnswerIds: [] }) as unknown as ReturnType<ApplicationRepository['getOrCreateDraft']> extends Promise<infer T> ? T : never
  return {
    getOrCreateDraft: async () => record(),
    saveDraft: async (input) => input.expectedRevision === revision ? ({ ...record(), revision: ++revision, answers: input.answers, profile: { ...input.profile, phone: user.phoneNormalized } }) : null,
    reopen: async (input) => {
      if (input.expectedRevision !== revision || status !== 'submitted') return null
      status = 'draft'; revision += 1
      return record()
    },
    submit: async (input) => {
      if (input.expectedRevision !== revision || status !== 'draft') return null
      status = 'submitted'; revision += 1
      return { applicationId: '20000000-0000-4000-8000-000000000001', versionId: '40000000-0000-4000-8000-000000000001', submittedAt: new Date('2026-08-15T00:00:00Z') }
    },
    listTimeline: async () => [],
    registrationWindow: async () => ({ open: true }),
  }
}

describe('application service boundaries', () => {
  it('reopens a submitted application during registration without changing its saved content', async () => {
    const answers = { '11111111-1111-4111-8111-111111111111': '原答案' }
    const service = createApplicationService(memoryRepository({ answers }))
    await service.submit(user, { expectedRevision: 0 })
    await expect(service.reopen(user, { expectedRevision: 0 })).rejects.toMatchObject({ code: 'APPLICATION_REVISION_CONFLICT' })
    await expect(service.reopen(user, { expectedRevision: 1 })).resolves.toMatchObject({
      data: { application: { status: 'draft', revision: 2, answers } },
    })
  })

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

  it('requires an official training unit when the institution is 中国科学院大学', async () => {
    const ucasProfile = { ...profile, organization: '中国科学院大学', department: '不存在的培养单位' }
    const service = createApplicationService(memoryRepository({ profile: ucasProfile, form: DEFAULT_REGISTRATION_FORM }), {
      isUcasTrainingUnit: (name) => name === '中国科学院物理研究所',
    })

    await expect(service.submit(user, { expectedRevision: 0 })).rejects.toMatchObject({
      code: 'APPLICATION_VALIDATION_FAILED',
      fields: [{ path: 'profile.department', message: '请选择名录中的培养单位' }],
    })
  })

  it('accepts a complete graduate profile and one to three problem choices', async () => {
    const proficiency = authoritativeRegistrationForm.questions[0]
    const problem = authoritativeRegistrationForm.questions[5]
    if (proficiency?.type !== 'proficiency_matrix' || problem?.type !== 'multiple_choice') throw new Error('authoritative form shape changed')
    const answers = {
      [proficiency.id]: { ratings: Object.fromEntries(proficiency.items.map((item) => [item.value, 'basic'])), otherLabel: '', otherLevel: '' },
      [authoritativeRegistrationForm.questions[2]!.id]: ['research-agent'],
      [authoritativeRegistrationForm.questions[3]!.id]: 'yes',
      [authoritativeRegistrationForm.questions[4]!.id]: ['open-practice'],
      [problem.id]: problem.options.slice(0, 3).map(({ value }) => value),
    }
    const service = createApplicationService(memoryRepository({ profile: { ...profile, email: '' }, form: authoritativeRegistrationForm, answers }))
    await expect(service.submit(user, { expectedRevision: 0 })).resolves.toMatchObject({ data: { status: 'submitted' } })
  })

  it('rejects incomplete proficiency ratings and more than three problem choices', async () => {
    const proficiency = authoritativeRegistrationForm.questions[0]
    const problem = authoritativeRegistrationForm.questions[5]
    if (proficiency?.type !== 'proficiency_matrix' || problem?.type !== 'multiple_choice') throw new Error('authoritative form shape changed')
    const service = createApplicationService(memoryRepository({ form: authoritativeRegistrationForm }))
    await expect(service.saveDraft(user, {
      expectedRevision: 0, profile, attachments: [], answers: {
        [proficiency.id]: { ratings: { python: 'basic' }, otherLabel: '', otherLevel: '' },
        [authoritativeRegistrationForm.questions[4]!.id]: ['open-practice'],
        [problem.id]: problem.options.slice(0, 4).map(({ value }) => value),
      },
    })).rejects.toMatchObject({ code: 'APPLICATION_VALIDATION_FAILED' })
  })

  it('requires position for employed applicants but not student-only fields', async () => {
    const employed = {
      ...profile, identityType: '在职人员', educationStage: '已毕业／在职', organization: '测试科技有限公司',
      department: '', major: '', researchDirection: '', majorResearchDirection: '', jobPosition: '',
    }
    const service = createApplicationService(memoryRepository({ profile: employed, form: DEFAULT_REGISTRATION_FORM }))
    await expect(service.submit(user, { expectedRevision: 0 })).rejects.toMatchObject({
      code: 'APPLICATION_INCOMPLETE', fields: [{ path: 'profile.jobPosition', message: '此项为必填项' }],
    })
  })

  it('validates required dependent questions only when their visibility condition is met', async () => {
    const controllerId = '11111111-1111-4111-8111-111111111121'
    const dependentId = '11111111-1111-4111-8111-111111111122'
    const conditionalForm = {
      ...DEFAULT_REGISTRATION_FORM,
      questions: [
        {
          id: controllerId, type: 'multiple_choice', label: '参与意愿', helpText: '', required: true, order: 0, active: true,
          validation: {}, options: [
            { id: '22222222-2222-4222-8222-222222222221', value: 'open-practice', label: '开放实践' },
            { id: '22222222-2222-4222-8222-222222222222', value: 'not-yet', label: '暂不确定' },
          ],
        },
        {
          id: dependentId, type: 'long_text', label: '自定义问题', helpText: '', required: true, order: 1, active: true,
          validation: {}, visibleWhen: { questionId: controllerId, includes: 'open-practice' },
        },
      ],
    } as unknown as RegistrationForm

    await expect(createApplicationService(memoryRepository({ form: conditionalForm, answers: { [controllerId]: ['not-yet'] } })).submit(user, { expectedRevision: 0 })).resolves.toMatchObject({ data: { status: 'submitted' } })
    await expect(createApplicationService(memoryRepository({ form: conditionalForm, answers: { [controllerId]: ['open-practice'] } })).submit(user, { expectedRevision: 0 })).rejects.toMatchObject({
      code: 'APPLICATION_INCOMPLETE', fields: [{ path: `answers.${dependentId}`, message: '此项为必填项' }],
    })
  })
})
