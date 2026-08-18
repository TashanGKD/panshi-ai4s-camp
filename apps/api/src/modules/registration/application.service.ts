import {
  ApplicationCoreFieldsSchema,
  ApplicationDraftSaveRequestSchema,
  ApplicationReopenRequestSchema,
  ProficiencyMatrixAnswerSchema,
  REGISTRATION_IDENTITY_OPTIONS,
  ApplicationSubmitRequestSchema,
  MyApplicationResponseSchema,
  RegistrationFormSchema,
  type ApplicationCoreFields,
  type ApplicationAnswers,
  type ApplicationDraftSaveRequest,
  type ApplicationStatus,
  type MyApplicationResponse,
  type RegistrationForm,
  isRegistrationQuestionVisible,
} from '@panshi/contracts'
import type { AuthenticatedSessionUser } from '../identity/session.service.js'

export type ApplicationFile = {
  id: string; slotId: string; originalName: string; mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; sizeBytes: number
}
export type ApplicationRecord = {
  id: string; revision: number; status: ApplicationStatus; formVersionId: string; formVersion: number; form: RegistrationForm
  profile: ApplicationCoreFields; answers: ApplicationAnswers; attachments: ApplicationFile[]
  unlinkedAttachments: Array<Omit<ApplicationFile, 'slotId'>>
  submittedAt: Date | null; updatedAt: Date; retiredAnswerIds: string[]
  supplement?: { message: string, deadline: Date | null, editableFieldIds: string[], editableAttachmentIds: string[] } | null
}
export type ApplicationRepository = {
  getOrCreateDraft: (user: AuthenticatedSessionUser) => Promise<ApplicationRecord>
  reopen: (input: { user: AuthenticatedSessionUser, expectedRevision: number }) => Promise<ApplicationRecord | null>
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

const validateAnswers = (form: RegistrationForm, answers: ApplicationAnswers, complete: boolean, allowedRetired = new Set<string>()) => {
  const active = new Map(form.questions.filter((question) => question.active).map((question) => [question.id, question]))
  for (const [id, value] of Object.entries(answers)) {
    const question = active.get(id)
    if (!question) {
      if (allowedRetired.has(id)) continue // Retain only answers that already existed before migration.
      throw validationError(`answers.${id}`, '问题标识不属于当前报名表')
    }
    if (!isRegistrationQuestionVisible(question, answers)) continue
    if (question.type === 'short_text' || question.type === 'long_text') {
      if (typeof value !== 'string') throw validationError(`answers.${id}`, '答案类型不正确')
      if (question.validation.maxLength !== undefined && value.length > question.validation.maxLength) throw validationError(`answers.${id}`, '答案超过字数限制')
      if (value !== '' && question.validation.minLength !== undefined && value.length < question.validation.minLength) throw validationError(`answers.${id}`, '答案少于最小字数')
    } else if (question.type === 'proficiency_matrix') {
      const parsed = ProficiencyMatrixAnswerSchema.safeParse(value)
      if (!parsed.success) throw validationError(`answers.${id}`, '能力评价答案类型不正确')
      const allowedItems = new Set(question.items.map((item) => item.value))
      const allowedLevels = new Set(question.levels.map((level) => level.value))
      if (Object.entries(parsed.data.ratings).some(([item, level]) => !allowedItems.has(item) || !allowedLevels.has(level))) {
        throw validationError(`answers.${id}`, '能力评价包含无效项目或等级')
      }
      if (parsed.data.otherLabel === '' && parsed.data.otherLevel !== '') throw validationError(`answers.${id}`, '请先填写其他能力名称')
      if (parsed.data.otherLevel !== '' && !allowedLevels.has(parsed.data.otherLevel)) {
        throw validationError(`answers.${id}`, '其他能力等级无效')
      }
      if (complete && question.required && question.items.some((item) => parsed.data.ratings[item.value] === undefined)) {
        throw new ApplicationError(422, 'APPLICATION_INCOMPLETE', '请完成所有必填项', [{ path: `answers.${id}`, message: '请评价所有列出的能力项目' }])
      }
    } else {
      if (typeof value !== 'string' && !Array.isArray(value)) throw validationError(`answers.${id}`, '选择答案类型不正确')
      const selected = typeof value === 'string' ? [value] : value
      if (question.type === 'single_choice' && (typeof value !== 'string' || selected.length !== 1)) throw validationError(`answers.${id}`, '单选答案类型不正确')
      if (question.type === 'multiple_choice' && !Array.isArray(value)) throw validationError(`answers.${id}`, '多选答案类型不正确')
      const allowed = new Set((question.options ?? []).map((option) => option.value))
      if (new Set(selected).size !== selected.length || selected.some((item) => !allowed.has(item))) throw validationError(`answers.${id}`, '答案包含无效选项')
      if (question.type === 'multiple_choice' && question.validation.maxSelections !== undefined && selected.length > question.validation.maxSelections) {
        throw validationError(`answers.${id}`, `最多选择 ${question.validation.maxSelections} 项`)
      }
      if (complete && question.type === 'multiple_choice' && question.validation.minSelections !== undefined && selected.length < question.validation.minSelections) {
        throw new ApplicationError(422, 'APPLICATION_INCOMPLETE', '请完成所有必填项', [{ path: `answers.${id}`, message: `至少选择 ${question.validation.minSelections} 项` }])
      }
    }
  }
  if (complete) for (const question of active.values()) {
    if (!isRegistrationQuestionVisible(question, answers)) continue
    const value = answers[question.id]
    if (question.required && (value === undefined || value === '' || (Array.isArray(value) && value.length === 0))) {
      throw new ApplicationError(422, 'APPLICATION_INCOMPLETE', '请完成所有必填项', [{ path: `answers.${question.id}`, message: '此项为必填项' }])
    }
  }
}

const validateProfile = (
  profile: Omit<ApplicationCoreFields, 'phone'>,
  complete: boolean,
  options: { isUcasTrainingUnit?: (name: string) => boolean } = {},
) => {
  if (profile.identityType !== '' && !REGISTRATION_IDENTITY_OPTIONS.includes(profile.identityType as typeof REGISTRATION_IDENTITY_OPTIONS[number])) {
    throw validationError('profile.identityType', '请选择有效的当前身份')
  }
  if (profile.professionalTitleLevel !== '' && !['无', '初级', '中级', '副高级', '正高级', '其他'].includes(profile.professionalTitleLevel)) {
    throw validationError('profile.professionalTitleLevel', '请选择有效的专业技术职称等级')
  }
  if (!complete) return
  const requireField = (key: keyof typeof profile) => {
    if (profile[key].trim() === '') throw new ApplicationError(422, 'APPLICATION_INCOMPLETE', '请完成所有必填项', [{ path: `profile.${key}`, message: '此项为必填项' }])
  }
  requireField('name'); requireField('identityType')
  if (['本科生', '硕士研究生', '博士研究生'].includes(profile.identityType)) {
    requireField('organization'); requireField('department'); requireField('major')
    if (profile.identityType !== '本科生') requireField('researchDirection')
  } else if (profile.identityType === '在站博士后') {
    requireField('organization'); requireField('postdocStation'); requireField('disciplineField'); requireField('researchDirection')
  } else if (profile.identityType === '在职人员') {
    requireField('organization'); requireField('jobPosition')
  } else if (profile.identityType === '其他') {
    requireField('identityDescription')
  }
  if (['本科生', '硕士研究生', '博士研究生'].includes(profile.identityType) && profile.organization.trim() === '中国科学院大学' && !options.isUcasTrainingUnit?.(profile.department)) {
    throw validationError('profile.department', '请选择名录中的培养单位')
  }
}

const normalizeProfile = (profile: Omit<ApplicationCoreFields, 'phone'>): Omit<ApplicationCoreFields, 'phone'> => ({
  ...profile,
  educationStage: ({
    本科生: '本科生', 硕士研究生: '硕士研究生', 博士研究生: '博士研究生', 在站博士后: '博士后', 在职人员: '已毕业／在职', 其他: '其他',
  } as Record<string, string>)[profile.identityType] ?? '',
  majorResearchDirection: [profile.major, profile.researchInterest, profile.researchDirection, profile.disciplineField].filter(Boolean).join('；'),
})

const response = async (repository: ApplicationRepository, application: ApplicationRecord): Promise<MyApplicationResponse> => {
  const { supplement, ...publicApplication } = application
  return MyApplicationResponseSchema.parse({
  apiVersion: 'v1', data: {
    application: {
      ...publicApplication, locked: !['draft', 'needs_supplement'].includes(application.status), submittedAt: application.submittedAt?.toISOString() ?? null, updatedAt: application.updatedAt.toISOString(),
      attachments: application.attachments.map((file) => ({ ...file, downloadUrl: `/api/v1/files/${file.id}/download` })),
      unlinkedAttachments: application.unlinkedAttachments.map((file) => ({ ...file, downloadUrl: `/api/v1/files/${file.id}/download` })),
    },
    timeline: (await repository.listTimeline(application.id)).map((entry) => ({ ...entry, createdAt: entry.createdAt.toISOString() })),
    supplementRequest: supplement ? { ...supplement, deadline: supplement.deadline?.toISOString() ?? null } : null,
    accessibleResources: [],
  },
}) }

export type ApplicationService = ReturnType<typeof createApplicationService>
export const createApplicationService = (
  repository: ApplicationRepository,
  options: { isUcasTrainingUnit?: (name: string) => boolean } = {},
) => ({
  getMine: async (user: AuthenticatedSessionUser) => {
    if (user.disabledAt !== null) throw new ApplicationError(403, 'ACCOUNT_DISABLED', '账号已停用')
    return response(repository, await repository.getOrCreateDraft(user))
  },
  reopen: async (user: AuthenticatedSessionUser, input: unknown) => {
    if (user.disabledAt !== null) throw new ApplicationError(403, 'ACCOUNT_DISABLED', '账号已停用')
    const parsed = ApplicationReopenRequestSchema.safeParse(input)
    if (!parsed.success) throw new ApplicationError(400, 'INVALID_REQUEST', '重新填写请求格式错误')
    const current = await repository.getOrCreateDraft(user)
    if (current.status !== 'submitted') throw new ApplicationError(409, 'APPLICATION_NOT_REOPENABLE', '当前报名状态不能重新填写')
    const window = await repository.registrationWindow()
    if (!window.open) throw new ApplicationError(409, window.reason ?? 'REGISTRATION_CLOSED', '当前不在报名时间内')
    const reopened = await repository.reopen({ user, expectedRevision: parsed.data.expectedRevision })
    if (!reopened) throw new ApplicationError(409, 'APPLICATION_REVISION_CONFLICT', '报名状态已发生变化，请刷新后重试')
    return response(repository, reopened)
  },
  saveDraft: async (user: AuthenticatedSessionUser, input: unknown) => {
    if (user.disabledAt !== null) throw new ApplicationError(403, 'ACCOUNT_DISABLED', '账号已停用')
    const parsed = ApplicationDraftSaveRequestSchema.safeParse(input)
    if (!parsed.success) throw new ApplicationError(422, 'APPLICATION_VALIDATION_FAILED', '报名内容校验失败', parsed.error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message })))
    const current = await repository.getOrCreateDraft(user)
    if (!['draft', 'needs_supplement'].includes(current.status)) throw new ApplicationError(409, 'APPLICATION_LOCKED', '报名当前不能修改')
    if (current.status === 'needs_supplement') {
      const supplement = current.supplement!
      if (supplement.deadline && supplement.deadline.getTime() < Date.now()) throw new ApplicationError(409, 'SUPPLEMENT_DEADLINE_PASSED', '补充材料提交时间已截止')
      const editable = new Set(supplement.editableFieldIds)
      const profileKeys = ['name', 'email', 'organization', 'department', 'identityType', 'educationStage', 'majorResearchDirection', 'major', 'researchInterest', 'researchDirection', 'postdocStation', 'disciplineField', 'supervisor', 'jobPosition', 'professionalTitleLevel', 'specificTitle', 'identityDescription'] as const
      for (const key of profileKeys) if (!editable.has(key) && parsed.data.profile[key] !== current.profile[key]) throw validationError(`profile.${key}`, '该字段未开放修改')
      for (const [id, value] of Object.entries(parsed.data.answers)) if (!editable.has(id) && JSON.stringify(value) !== JSON.stringify(current.answers[id])) throw validationError(`answers.${id}`, '该问题未开放修改')
      const editableSlots = new Set(supplement.editableAttachmentIds)
      const before = new Map(current.attachments.map((item) => [item.slotId, item.id])); const after = new Map(parsed.data.attachments.map((item) => [item.slotId, item.fileId]))
      for (const slot of new Set([...before.keys(), ...after.keys()])) if (!editableSlots.has(slot) && before.get(slot) !== after.get(slot)) throw validationError(`attachments.${slot}`, '该附件未开放修改')
    }
    const profile = normalizeProfile(parsed.data.profile)
    validateProfile(profile, false)
    const retired = new Set(current.retiredAnswerIds)
    const answers = current.status === 'needs_supplement' ? { ...current.answers, ...parsed.data.answers } : { ...parsed.data.answers }
    for (const id of retired) if (current.answers[id] !== undefined) answers[id] = current.answers[id]
    validateAnswers(RegistrationFormSchema.parse(current.form), answers, false, retired)
    const saved = await repository.saveDraft({ ...parsed.data, profile, answers, user })
    if (!saved) throw new ApplicationError(409, 'APPLICATION_REVISION_CONFLICT', '草稿已在其他页面更新，请刷新后重试')
    return response(repository, saved)
  },
  submit: async (user: AuthenticatedSessionUser, input: unknown) => {
    if (user.disabledAt !== null) throw new ApplicationError(403, 'ACCOUNT_DISABLED', '账号已停用')
    const parsed = ApplicationSubmitRequestSchema.safeParse(input)
    if (!parsed.success) throw new ApplicationError(400, 'INVALID_REQUEST', '提交请求格式错误')
    const current = await repository.getOrCreateDraft(user)
    if (!['draft', 'needs_supplement'].includes(current.status)) throw new ApplicationError(409, 'APPLICATION_ALREADY_SUBMITTED', '报名当前不能提交')
    if (current.status === 'draft') { const window = await repository.registrationWindow(); if (!window.open) throw new ApplicationError(409, window.reason ?? 'REGISTRATION_CLOSED', '当前不在报名时间内') }
    if (current.status === 'needs_supplement' && current.supplement?.deadline && current.supplement.deadline.getTime() < Date.now()) throw new ApplicationError(409, 'SUPPLEMENT_DEADLINE_PASSED', '补充材料提交时间已截止')
    const parsedProfile = ApplicationCoreFieldsSchema.parse(current.profile)
    const currentProfile = Object.fromEntries(Object.entries(parsedProfile).filter(([key]) => key !== 'phone')) as Omit<ApplicationCoreFields, 'phone'>
    validateProfile(currentProfile, true, options)
    validateAnswers(current.form, current.answers, true, new Set(current.retiredAnswerIds))
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
    return { apiVersion: 'v1' as const, data: { applicationId: result.applicationId, versionId: result.versionId, status: current.status === 'needs_supplement' ? 'reviewing' as const : 'submitted' as const, submittedAt: result.submittedAt.toISOString() } }
  },
})
