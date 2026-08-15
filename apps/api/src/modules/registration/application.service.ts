import {
  ApplicationDraftSaveRequestSchema,
  ApplicationSubmitRequestSchema,
  MyApplicationResponseSchema,
  RegistrationFormSchema,
  type ApplicationCoreFields,
  type ApplicationDraftSaveRequest,
  type ApplicationStatus,
  type MyApplicationResponse,
  type RegistrationForm,
} from '@panshi/contracts'
import type { AuthenticatedSessionUser } from '../identity/session.service.js'

export type ApplicationFile = {
  id: string; slotId: string; originalName: string; mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; sizeBytes: number
}
export type ApplicationRecord = {
  id: string; revision: number; status: ApplicationStatus; formVersionId: string; formVersion: number; form: RegistrationForm
  profile: ApplicationCoreFields; answers: Record<string, string | string[]>; attachments: ApplicationFile[]
  unlinkedAttachments: Array<Omit<ApplicationFile, 'slotId'>>
  submittedAt: Date | null; updatedAt: Date; retiredAnswerIds: string[]
}
export type ApplicationRepository = {
  getOrCreateDraft: (user: AuthenticatedSessionUser) => Promise<ApplicationRecord>
  saveDraft: (input: ApplicationDraftSaveRequest & { user: AuthenticatedSessionUser }) => Promise<ApplicationRecord | null>
  submit: (input: { user: AuthenticatedSessionUser, expectedRevision: number }) => Promise<{ applicationId: string, versionId: string, submittedAt: Date } | null>
  listTimeline: (applicationId: string) => Promise<Array<{ status: ApplicationStatus, createdAt: Date, publicReason: string | null }>>
  registrationWindow: () => Promise<{ open: boolean, reason?: 'REGISTRATION_NOT_OPEN' | 'REGISTRATION_CLOSED' }>
}

export class ApplicationSubmissionError extends Error {
  constructor(readonly reason: 'form_version_changed' | 'attachment_invalid', readonly fields: Array<{ path: string, message: string }> = []) {
    super(reason); this.name = 'ApplicationSubmissionError'
  }
}

export class ApplicationError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly fields?: Array<{ path: string, message: string }>) {
    super(message); this.name = 'ApplicationError'
  }
}

const validationError = (path: string, message: string) => new ApplicationError(422, 'APPLICATION_VALIDATION_FAILED', '报名内容校验失败', [{ path, message }])

const validateAnswers = (form: RegistrationForm, answers: Record<string, string | string[]>, complete: boolean, allowedRetired = new Set<string>()) => {
  const active = new Map(form.questions.filter((question) => question.active).map((question) => [question.id, question]))
  for (const [id, value] of Object.entries(answers)) {
    const question = active.get(id)
    if (!question) {
      if (allowedRetired.has(id)) continue // Retain only answers that already existed before migration.
      throw validationError(`answers.${id}`, '问题标识不属于当前报名表')
    }
    if (question.type === 'short_text' || question.type === 'long_text') {
      if (typeof value !== 'string') throw validationError(`answers.${id}`, '答案类型不正确')
      if (question.validation.maxLength !== undefined && value.length > question.validation.maxLength) throw validationError(`answers.${id}`, '答案超过字数限制')
      if (value !== '' && question.validation.minLength !== undefined && value.length < question.validation.minLength) throw validationError(`answers.${id}`, '答案少于最小字数')
    } else {
      const selected = typeof value === 'string' ? [value] : value
      if (question.type === 'single_choice' && (typeof value !== 'string' || selected.length !== 1)) throw validationError(`answers.${id}`, '单选答案类型不正确')
      if (question.type === 'multiple_choice' && !Array.isArray(value)) throw validationError(`answers.${id}`, '多选答案类型不正确')
      const allowed = new Set((question.options ?? []).map((option) => option.value))
      if (new Set(selected).size !== selected.length || selected.some((item) => !allowed.has(item))) throw validationError(`answers.${id}`, '答案包含无效选项')
    }
  }
  if (complete) for (const question of active.values()) {
    const value = answers[question.id]
    if (question.required && (value === undefined || value === '' || (Array.isArray(value) && value.length === 0))) {
      throw new ApplicationError(422, 'APPLICATION_INCOMPLETE', '请完成所有必填项', [{ path: `answers.${question.id}`, message: '此项为必填项' }])
    }
  }
}

const validateProfile = (profile: Omit<ApplicationCoreFields, 'phone'>, complete: boolean) => {
  for (const [key, value] of Object.entries(profile)) {
    if (complete && value.trim() === '') throw new ApplicationError(422, 'APPLICATION_INCOMPLETE', '请完成所有必填项', [{ path: `profile.${key}`, message: '此项为必填项' }])
  }
}

const response = async (repository: ApplicationRepository, application: ApplicationRecord): Promise<MyApplicationResponse> => MyApplicationResponseSchema.parse({
  apiVersion: 'v1', data: {
    application: {
      ...application, locked: application.status !== 'draft', submittedAt: application.submittedAt?.toISOString() ?? null, updatedAt: application.updatedAt.toISOString(),
      attachments: application.attachments.map((file) => ({ ...file, downloadUrl: `/api/v1/files/${file.id}/download` })),
      unlinkedAttachments: application.unlinkedAttachments.map((file) => ({ ...file, downloadUrl: `/api/v1/files/${file.id}/download` })),
    },
    timeline: (await repository.listTimeline(application.id)).map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    supplementRequest: null,
    accessibleResources: [],
  },
})

export type ApplicationService = ReturnType<typeof createApplicationService>
export const createApplicationService = (repository: ApplicationRepository) => ({
  getMine: async (user: AuthenticatedSessionUser) => {
    if (user.disabledAt !== null) throw new ApplicationError(403, 'ACCOUNT_DISABLED', '账号已停用')
    return response(repository, await repository.getOrCreateDraft(user))
  },
  saveDraft: async (user: AuthenticatedSessionUser, input: unknown) => {
    if (user.disabledAt !== null) throw new ApplicationError(403, 'ACCOUNT_DISABLED', '账号已停用')
    const parsed = ApplicationDraftSaveRequestSchema.safeParse(input)
    if (!parsed.success) throw new ApplicationError(422, 'APPLICATION_VALIDATION_FAILED', '报名内容校验失败', parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })))
    const current = await repository.getOrCreateDraft(user)
    if (current.status !== 'draft') throw new ApplicationError(409, 'APPLICATION_LOCKED', '报名已提交，不能修改')
    validateProfile(parsed.data.profile, false)
    const currentQuestionIds = new Set(current.form.questions.map((question) => question.id))
    const retired = new Set(Object.keys(current.answers).filter((id) => !currentQuestionIds.has(id)))
    validateAnswers(RegistrationFormSchema.parse(current.form), parsed.data.answers, false, retired)
    const saved = await repository.saveDraft({ ...parsed.data, user })
    if (!saved) throw new ApplicationError(409, 'APPLICATION_REVISION_CONFLICT', '草稿已在其他页面更新，请刷新后重试')
    return response(repository, saved)
  },
  submit: async (user: AuthenticatedSessionUser, input: unknown) => {
    if (user.disabledAt !== null) throw new ApplicationError(403, 'ACCOUNT_DISABLED', '账号已停用')
    const parsed = ApplicationSubmitRequestSchema.safeParse(input)
    if (!parsed.success) throw new ApplicationError(400, 'INVALID_REQUEST', '提交请求格式错误')
    const window = await repository.registrationWindow()
    if (!window.open) throw new ApplicationError(409, window.reason ?? 'REGISTRATION_CLOSED', '当前不在报名时间内')
    const current = await repository.getOrCreateDraft(user)
    if (current.status !== 'draft') throw new ApplicationError(409, 'APPLICATION_ALREADY_SUBMITTED', '报名已提交')
    const currentProfile = {
      name: current.profile.name, email: current.profile.email, organization: current.profile.organization,
      department: current.profile.department, identityType: current.profile.identityType,
      educationStage: current.profile.educationStage, majorResearchDirection: current.profile.majorResearchDirection,
    }
    validateProfile(currentProfile, true)
    validateAnswers(current.form, current.answers, true, new Set(Object.keys(current.answers)))
    const activeSlots = new Map(current.form.attachments.filter((item) => item.active).map((item) => [item.id, item]))
    const attached = new Map(current.attachments.map((file) => [file.slotId, file]))
    for (const slot of activeSlots.values()) if (slot.required && !attached.has(slot.id)) {
      throw new ApplicationError(422, 'APPLICATION_INCOMPLETE', '请上传所有必填附件', [{ path: `attachments.${slot.id}`, message: '此附件为必填项' }])
    }
    let result
    try {
      result = await repository.submit({ user, expectedRevision: parsed.data.expectedRevision })
    } catch (error) {
      if (!(error instanceof ApplicationSubmissionError)) throw error
      if (error.reason === 'form_version_changed') {
        await repository.getOrCreateDraft(user)
        throw new ApplicationError(409, 'APPLICATION_FORM_VERSION_CHANGED', '报名表已更新，请核对后重新提交')
      }
      throw new ApplicationError(422, 'APPLICATION_ATTACHMENT_INVALID', '附件不符合当前报名表要求', error.fields)
    }
    if (!result) throw new ApplicationError(409, 'APPLICATION_REVISION_CONFLICT', '草稿已变化或报名已提交，请刷新后重试')
    return { apiVersion: 'v1' as const, data: { applicationId: result.applicationId, versionId: result.versionId, status: 'submitted' as const, submittedAt: result.submittedAt.toISOString() } }
  },
})
