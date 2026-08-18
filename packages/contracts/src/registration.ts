import { z } from 'zod'
import { JsonObjectSchema, type JsonObject, type JsonValue } from './common.js'

const UuidSchema = z.string().uuid()

const InstitutionSourceSchema = z.object({
  label: z.string().trim().min(1).max(200),
  href: z.url(),
  asOf: z.iso.date(),
}).strict()

const UniversityEntrySchema = z.object({
  name: z.string().trim().min(1).max(200),
  province: z.string().trim().min(1).max(100),
  level: z.string().trim().min(1).max(100),
}).strict()

const UcasTrainingUnitSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: z.enum(['college', 'institute']),
}).strict()

const uniqueNames = <T extends { name: string }>(items: readonly T[], path: string, context: z.RefinementCtx) => {
  const names = new Set<string>()
  items.forEach((item, index) => {
    if (names.has(item.name)) context.addIssue({ code: 'custom', path: [path, index, 'name'], message: `${path} names must be unique` })
    names.add(item.name)
  })
}

export const InstitutionDirectoryResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    version: z.string().trim().min(1).max(200),
    sources: z.array(InstitutionSourceSchema).min(2).max(10),
    universities: z.array(UniversityEntrySchema).min(1).max(10_000),
    ucasTrainingUnits: z.array(UcasTrainingUnitSchema).min(1).max(1_000),
  }).strict().superRefine((directory, context) => {
    uniqueNames(directory.universities, 'universities', context)
    uniqueNames(directory.ucasTrainingUnits, 'ucasTrainingUnits', context)
  }),
}).strict()

export type InstitutionDirectoryResponse = z.infer<typeof InstitutionDirectoryResponseSchema>
export type UniversityEntry = z.infer<typeof UniversityEntrySchema>
export type UcasTrainingUnit = z.infer<typeof UcasTrainingUnitSchema>

export const REGISTRATION_FORM_LIMITS = {
  maxQuestions: 50,
  maxAttachments: 10,
  maxOptionsPerQuestion: 20,
  labelMaxLength: 200,
  helpTextMaxLength: 1_000,
  optionValueMaxLength: 100,
  optionLabelMaxLength: 200,
  textMaxLength: 10_000,
} as const

export const REGISTRATION_IDENTITY_OPTIONS = [
  '本科生', '硕士研究生', '博士研究生', '在站博士后', '在职人员', '其他',
] as const

export const REGISTRATION_PROFICIENCY_LEVELS = [
  { value: 'unfamiliar', label: '不了解' },
  { value: 'basic', label: '了解并会简单使用' },
  { value: 'proficient', label: '熟练使用并掌握相关原理' },
] as const

const LabelSchema = z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.labelMaxLength)
const HelpTextSchema = z.string().max(REGISTRATION_FORM_LIMITS.helpTextMaxLength)

export const DEFAULT_REGISTRATION_ATTACHMENT_ID = '00000000-0000-4000-8000-000000000001'

export const RegistrationCoreFieldKeySchema = z.enum([
  'name', 'phone', 'email', 'organization', 'department', 'identityType', 'educationStage', 'majorResearchDirection',
  'major', 'researchInterest', 'researchDirection', 'postdocStation', 'disciplineField', 'supervisor',
  'jobPosition', 'professionalTitleLevel', 'specificTitle', 'identityDescription',
])

export const RegistrationCoreFieldSchema = z.object({
  key: RegistrationCoreFieldKeySchema,
  label: LabelSchema,
  required: z.boolean(),
  readOnly: z.boolean(),
}).strict()

const TextValidationSchema = z.object({
  minLength: z.number().int().nonnegative().max(REGISTRATION_FORM_LIMITS.textMaxLength).optional(),
  maxLength: z.number().int().positive().max(REGISTRATION_FORM_LIMITS.textMaxLength).optional(),
}).strict().superRefine((value, context) => {
  if (value.minLength !== undefined && value.maxLength !== undefined && value.minLength > value.maxLength) {
    context.addIssue({ code: 'custom', path: ['maxLength'], message: 'maxLength must be greater than or equal to minLength' })
  }
})

const RegistrationQuestionBaseSchema = z.object({
  id: UuidSchema,
  label: LabelSchema,
  helpText: HelpTextSchema,
  required: z.boolean(),
  order: z.number().int().nonnegative(),
  active: z.boolean(),
  validation: TextValidationSchema,
  visibleWhen: z.object({
    questionId: UuidSchema,
    includes: z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.optionValueMaxLength),
  }).strict().optional(),
}).strict()

const TextQuestionSchema = RegistrationQuestionBaseSchema.extend({
  type: z.enum(['short_text', 'long_text']),
  options: z.never().optional(),
})

export const RegistrationQuestionOptionSchema = z.object({
  id: UuidSchema,
  value: z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.optionValueMaxLength),
  label: z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.optionLabelMaxLength),
  description: z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.helpTextMaxLength).optional(),
}).strict()

const ChoiceValidationSchema = z.object({
  minSelections: z.number().int().nonnegative().max(REGISTRATION_FORM_LIMITS.maxOptionsPerQuestion).optional(),
  maxSelections: z.number().int().positive().max(REGISTRATION_FORM_LIMITS.maxOptionsPerQuestion).optional(),
}).strict().superRefine((value, context) => {
  if (value.minSelections !== undefined && value.maxSelections !== undefined && value.minSelections > value.maxSelections) {
    context.addIssue({ code: 'custom', path: ['maxSelections'], message: 'maxSelections must be greater than or equal to minSelections' })
  }
})

const ChoiceQuestionSchema = RegistrationQuestionBaseSchema.extend({
  type: z.enum(['single_choice', 'multiple_choice']),
  options: z.array(RegistrationQuestionOptionSchema).min(1).max(REGISTRATION_FORM_LIMITS.maxOptionsPerQuestion),
  validation: ChoiceValidationSchema,
}).strict().superRefine((question, context) => {
  const ids = new Set<string>()
  const values = new Set<string>()
  question.options.forEach((option, index) => {
    if (ids.has(option.id)) context.addIssue({ code: 'custom', path: ['options', index, 'id'], message: 'option ids must be unique' })
    if (values.has(option.value)) context.addIssue({ code: 'custom', path: ['options', index, 'value'], message: 'option values must be unique' })
    ids.add(option.id)
    values.add(option.value)
  })
  if (question.validation.minSelections !== undefined && question.validation.minSelections > question.options.length) {
    context.addIssue({ code: 'custom', path: ['validation', 'minSelections'], message: 'minSelections cannot exceed option count' })
  }
  if (question.validation.maxSelections !== undefined && question.validation.maxSelections > question.options.length) {
    context.addIssue({ code: 'custom', path: ['validation', 'maxSelections'], message: 'maxSelections cannot exceed option count' })
  }
})

const ProficiencyMatrixQuestionSchema = RegistrationQuestionBaseSchema.extend({
  type: z.literal('proficiency_matrix'),
  items: z.array(RegistrationQuestionOptionSchema.omit({ description: true })).min(1).max(REGISTRATION_FORM_LIMITS.maxOptionsPerQuestion),
  levels: z.array(RegistrationQuestionOptionSchema.omit({ description: true })).length(3),
  allowOther: z.boolean(),
  options: z.never().optional(),
  validation: z.object({}).strict(),
}).strict().superRefine((question, context) => {
  for (const [path, values] of [['items', question.items], ['levels', question.levels]] as const) {
    const ids = new Set<string>()
    const machineValues = new Set<string>()
    values.forEach((item, index) => {
      if (ids.has(item.id)) context.addIssue({ code: 'custom', path: [path, index, 'id'], message: `${path} ids must be unique` })
      if (machineValues.has(item.value)) context.addIssue({ code: 'custom', path: [path, index, 'value'], message: `${path} values must be unique` })
      ids.add(item.id)
      machineValues.add(item.value)
    })
  }
})

export const RegistrationDynamicQuestionSchema = z.discriminatedUnion('type', [TextQuestionSchema, ChoiceQuestionSchema, ProficiencyMatrixQuestionSchema])

export const RegistrationAttachmentSchema = z.object({
  id: UuidSchema,
  label: LabelSchema,
  helpText: HelpTextSchema,
  required: z.boolean(),
  order: z.number().int().nonnegative(),
  active: z.boolean(),
  allowedExtensions: z.array(z.enum(['pdf', 'docx'])).min(1),
  maxSizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
}).strict().superRefine((attachment, context) => {
  if (new Set(attachment.allowedExtensions).size !== attachment.allowedExtensions.length) {
    context.addIssue({ code: 'custom', path: ['allowedExtensions'], message: 'allowedExtensions must be unique' })
  }
})

const hasUniqueAndNormalizedOrder = <T extends { id: string, order: number }>(items: readonly T[], path: string, context: z.RefinementCtx) => {
  const ids = new Set<string>()
  items.forEach((item, index) => {
    if (ids.has(item.id)) context.addIssue({ code: 'custom', path: [path, index, 'id'], message: `${path} ids must be unique` })
    if (item.order !== index) context.addIssue({ code: 'custom', path: [path, index, 'order'], message: `${path} order must be normalized from zero` })
    ids.add(item.id)
  })
}

export const RegistrationFormSchema = z.object({
  coreFields: z.array(RegistrationCoreFieldSchema).length(8),
  questions: z.array(RegistrationDynamicQuestionSchema).max(REGISTRATION_FORM_LIMITS.maxQuestions),
  attachments: z.array(RegistrationAttachmentSchema).max(REGISTRATION_FORM_LIMITS.maxAttachments),
}).strict().superRefine((form, context) => {
  if (form.coreFields.some((field, index) => {
    const expected = DEFAULT_REGISTRATION_CORE_FIELDS[index]
    return expected === undefined
      || field.key !== expected.key
      || field.label !== expected.label
      || field.required !== expected.required
      || field.readOnly !== expected.readOnly
  })) context.addIssue({ code: 'custom', path: ['coreFields'], message: 'fixed core fields must exactly match the default definition' })
  hasUniqueAndNormalizedOrder(form.questions, 'questions', context)
  hasUniqueAndNormalizedOrder(form.attachments, 'attachments', context)
  const questions = new Map(form.questions.map((question) => [question.id, question]))
  form.questions.forEach((question, index) => {
    if (!question.visibleWhen) return
    const controller = questions.get(question.visibleWhen.questionId)
    if (!controller || controller.order >= question.order) {
      context.addIssue({ code: 'custom', path: ['questions', index, 'visibleWhen', 'questionId'], message: 'visibility controller must be an earlier question' })
      return
    }
    if ((controller.type !== 'single_choice' && controller.type !== 'multiple_choice') || !controller.options.some((option) => option.value === question.visibleWhen?.includes)) {
      context.addIssue({ code: 'custom', path: ['questions', index, 'visibleWhen', 'includes'], message: 'visibility value must belong to the controller question' })
    }
  })
})

const DEFAULT_REGISTRATION_CORE_FIELDS = [
  { key: 'name', label: '姓名', required: true, readOnly: false },
  { key: 'phone', label: '手机号', required: true, readOnly: true },
  { key: 'email', label: '电子邮箱', required: false, readOnly: false },
  { key: 'organization', label: '所在单位', required: true, readOnly: false },
  { key: 'department', label: '院系/部门', required: true, readOnly: false },
  { key: 'identityType', label: '身份类型', required: true, readOnly: false },
  { key: 'educationStage', label: '学历阶段', required: true, readOnly: false },
  { key: 'majorResearchDirection', label: '专业及研究方向', required: true, readOnly: false },
] as const

export const DEFAULT_REGISTRATION_FORM: RegistrationForm = {
  coreFields: DEFAULT_REGISTRATION_CORE_FIELDS.map((field) => ({ ...field })),
  questions: [],
  attachments: [{
    id: DEFAULT_REGISTRATION_ATTACHMENT_ID,
    label: '个人简历／补充材料',
    helpText: '支持 PDF、DOCX，单个文件不超过 10 MB。',
    required: false,
    order: 0,
    active: true,
    allowedExtensions: ['pdf', 'docx'],
    maxSizeBytes: 10 * 1024 * 1024,
  }],
}

export const RegistrationFormDraftResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    form: RegistrationFormSchema,
    revision: z.number().int().nonnegative(),
    baseVersion: z.number().int().positive().nullable(),
    publishedVersionId: UuidSchema.nullable(),
  }).strict(),
}).strict()

export const RegistrationFormPublishResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    formVersionId: UuidSchema,
    revision: z.number().int().nonnegative(),
    version: z.number().int().positive(),
  }).strict(),
}).strict()

export const RegistrationFormHistoryResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    publishedVersion: z.number().int().positive().nullable(),
    versions: z.array(z.object({
      id: UuidSchema,
      version: z.number().int().positive(),
      form: RegistrationFormSchema,
      createdBy: z.string().min(1),
      createdAt: z.iso.datetime(),
    }).strict()),
  }).strict(),
}).strict()

export const PublicRegistrationFormResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    formVersionId: UuidSchema,
    version: z.number().int().positive(),
    form: RegistrationFormSchema,
  }).strict(),
}).strict()

export const RegistrationFormSaveDraftRequestSchema = z.object({
  form: RegistrationFormSchema,
  expectedRevision: z.number().int().nonnegative(),
}).strict()

export const RegistrationFormPublishRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict()

export type RegistrationCoreFieldKey = z.infer<typeof RegistrationCoreFieldKeySchema>
export type RegistrationCoreField = z.infer<typeof RegistrationCoreFieldSchema>
export type RegistrationQuestionOption = z.infer<typeof RegistrationQuestionOptionSchema>
export type RegistrationDynamicQuestion = z.infer<typeof RegistrationDynamicQuestionSchema>
export type RegistrationAttachment = z.infer<typeof RegistrationAttachmentSchema>
export type RegistrationForm = z.infer<typeof RegistrationFormSchema>

export const isRegistrationQuestionVisible = (
  question: RegistrationDynamicQuestion,
  answers: Record<string, unknown>,
) => {
  if (!question.visibleWhen) return true
  const controller = answers[question.visibleWhen.questionId]
  return Array.isArray(controller)
    ? controller.includes(question.visibleWhen.includes)
    : controller === question.visibleWhen.includes
}
export type RegistrationFormDraftResponse = z.infer<typeof RegistrationFormDraftResponseSchema>
export type RegistrationFormPublishResponse = z.infer<typeof RegistrationFormPublishResponseSchema>
export type RegistrationFormHistoryResponse = z.infer<typeof RegistrationFormHistoryResponseSchema>
export type PublicRegistrationFormResponse = z.infer<typeof PublicRegistrationFormResponseSchema>

export const ApplicationStatusSchema = z.enum([
  'draft',
  'submitted',
  'reviewing',
  'needs_supplement',
  'admitted',
  'waitlisted',
  'rejected',
])

type FrozenRegistrationSnapshot = Readonly<{
  formVersion: string
  submittedAt: string
  answers: JsonObject
}>

const cloneAndDeepFreezeJson = (value: JsonValue): JsonValue => {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(cloneAndDeepFreezeJson))
  }

  if (value !== null && typeof value === 'object') {
    return Object.freeze(Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneAndDeepFreezeJson(item)]),
    ))
  }

  return value
}

const RegistrationAnswersSchema = JsonObjectSchema.refine(
  (answers) => Object.keys(answers).every((key) => key.length > 0),
  { message: 'Registration answer keys must not be empty' },
)

export const RegistrationSnapshotSchema = z.object({
  formVersion: z.string().min(1),
  submittedAt: z.iso.datetime(),
  answers: RegistrationAnswersSchema,
}).transform((snapshot): FrozenRegistrationSnapshot => Object.freeze({
  ...snapshot,
  answers: cloneAndDeepFreezeJson(snapshot.answers) as JsonObject,
}))

export type ApplicationStatus = z.infer<typeof ApplicationStatusSchema>
export type RegistrationSnapshot = z.infer<typeof RegistrationSnapshotSchema>

const CoreFieldValueSchema = z.string().trim().max(500)
const OptionalProfileValueSchema = z.string().trim().max(2_000).default('')
export const ApplicationCoreFieldsSchema = z.object({
  name: CoreFieldValueSchema,
  phone: z.string().min(1).max(32),
  email: z.union([z.literal(''), z.string().trim().email().max(320)]),
  organization: CoreFieldValueSchema,
  department: CoreFieldValueSchema,
  identityType: CoreFieldValueSchema,
  educationStage: CoreFieldValueSchema,
  majorResearchDirection: z.string().trim().max(2_000),
  major: OptionalProfileValueSchema,
  researchInterest: OptionalProfileValueSchema,
  researchDirection: OptionalProfileValueSchema,
  postdocStation: OptionalProfileValueSchema,
  disciplineField: OptionalProfileValueSchema,
  supervisor: OptionalProfileValueSchema,
  jobPosition: OptionalProfileValueSchema,
  professionalTitleLevel: OptionalProfileValueSchema,
  specificTitle: OptionalProfileValueSchema,
  identityDescription: OptionalProfileValueSchema,
}).strict()

export const ProficiencyMatrixAnswerSchema = z.object({
  ratings: z.record(
    z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.optionValueMaxLength),
    z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.optionValueMaxLength),
  ),
  otherLabel: z.string().trim().max(REGISTRATION_FORM_LIMITS.optionLabelMaxLength).default(''),
  otherLevel: z.string().trim().max(REGISTRATION_FORM_LIMITS.optionValueMaxLength).default(''),
}).strict()

export const ApplicationAnswersSchema = z.record(UuidSchema, z.union([
  z.string().max(REGISTRATION_FORM_LIMITS.textMaxLength),
  z.array(z.string().max(REGISTRATION_FORM_LIMITS.optionValueMaxLength)).max(REGISTRATION_FORM_LIMITS.maxOptionsPerQuestion),
  ProficiencyMatrixAnswerSchema,
])).refine((value) => Object.keys(value).length <= REGISTRATION_FORM_LIMITS.maxQuestions, 'too many answers')

export const ApplicationAttachmentReferenceSchema = z.object({
  slotId: UuidSchema,
  fileId: UuidSchema,
}).strict()

export const ApplicationDraftSaveRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  profile: ApplicationCoreFieldsSchema.omit({ phone: true }),
  answers: ApplicationAnswersSchema,
  attachments: z.array(ApplicationAttachmentReferenceSchema).max(REGISTRATION_FORM_LIMITS.maxAttachments),
}).strict()

const ApplicationFileSchema = z.object({
  id: UuidSchema,
  slotId: UuidSchema,
  originalName: z.string().min(1).max(255),
  mimeType: z.enum(['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']),
  sizeBytes: z.number().int().nonnegative(),
  downloadUrl: z.string().startsWith('/api/v1/files/'),
}).strict()

const UnlinkedApplicationFileSchema = ApplicationFileSchema.omit({ slotId: true })

export const ApplicationTimelineEntrySchema = z.object({
  status: ApplicationStatusSchema,
  createdAt: z.iso.datetime(),
  publicReason: z.string().max(2_000).nullable(),
}).strict()

export const MyApplicationResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    application: z.object({
      id: UuidSchema,
      status: ApplicationStatusSchema,
      revision: z.number().int().nonnegative(),
      locked: z.boolean(),
      formVersionId: UuidSchema,
      formVersion: z.number().int().positive(),
      form: RegistrationFormSchema,
      profile: ApplicationCoreFieldsSchema,
      answers: ApplicationAnswersSchema,
      attachments: z.array(ApplicationFileSchema),
      unlinkedAttachments: z.array(UnlinkedApplicationFileSchema),
      retiredAnswerIds: z.array(UuidSchema),
      submittedAt: z.iso.datetime().nullable(),
      updatedAt: z.iso.datetime(),
    }).strict(),
    timeline: z.array(ApplicationTimelineEntrySchema),
    supplementRequest: z.object({
      message: z.string(),
      deadline: z.iso.datetime().nullable(),
      editableFieldIds: z.array(z.string().min(1)),
      editableAttachmentIds: z.array(UuidSchema),
    }).strict().nullable(),
    accessibleResources: z.array(z.object({ id: UuidSchema, title: z.string(), downloadUrl: z.string() }).strict()),
  }).strict(),
}).strict()

export const ApplicationSubmitRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict()

export const ApplicationReopenRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict()

export const ApplicationSubmitResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    applicationId: UuidSchema,
    status: z.enum(['submitted', 'reviewing']),
    submittedAt: z.iso.datetime(),
    versionId: UuidSchema,
  }).strict(),
}).strict()

const StudentCheckInUnavailableSchema = z.object({
  availability: z.literal('unavailable'),
  reason: z.string().trim().min(1).max(200),
}).strict()

const StudentCheckInAvailableSchema = z.object({
  availability: z.literal('available'),
  qrPayload: z.string().min(32).max(512),
  displayCode: z.string().trim().min(6).max(32),
  checkedInAt: z.null(),
}).strict()

const StudentCheckInCompletedSchema = z.object({
  availability: z.literal('checked_in'),
  qrPayload: z.string().min(32).max(512),
  displayCode: z.string().trim().min(6).max(32),
  checkedInAt: z.iso.datetime(),
}).strict()

export const StudentCheckInResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.discriminatedUnion('availability', [
    StudentCheckInUnavailableSchema,
    StudentCheckInAvailableSchema,
    StudentCheckInCompletedSchema,
  ]),
}).strict()

export const AdminCheckInLookupRequestSchema = z.object({
  code: z.string().trim().min(16).max(512),
}).strict()

export const AdminCheckInConfirmRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict()

export const AdminCheckInRevokeRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(2).max(500),
}).strict()

export const AdminCheckInRecordSchema = z.object({
  credentialId: UuidSchema,
  applicationId: UuidSchema,
  name: z.string().trim().min(1).max(500),
  phone: z.string().trim().min(1).max(32),
  organization: z.string().trim().max(500),
  department: z.string().trim().max(500),
  identityType: z.string().trim().max(500),
  applicationStatus: z.literal('admitted'),
  checkInState: z.enum(['not_checked_in', 'checked_in', 'revoked']),
  revision: z.number().int().nonnegative(),
  firstCheckedInAt: z.iso.datetime().nullable(),
  firstCheckedInBy: z.string().trim().min(1).max(200).nullable(),
  revokedAt: z.iso.datetime().nullable(),
  revokeReason: z.string().trim().min(2).max(500).nullable(),
}).strict()

export const AdminCheckInLookupResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: AdminCheckInRecordSchema,
}).strict()

export const AdminCheckInMutationResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: AdminCheckInRecordSchema.extend({ duplicate: z.boolean() }).strict(),
}).strict()

export type ApplicationCoreFields = z.infer<typeof ApplicationCoreFieldsSchema>
export type ProficiencyMatrixAnswer = z.infer<typeof ProficiencyMatrixAnswerSchema>
export type ApplicationAnswers = z.infer<typeof ApplicationAnswersSchema>
export type ApplicationDraftSaveRequest = z.infer<typeof ApplicationDraftSaveRequestSchema>
export type ApplicationReopenRequest = z.infer<typeof ApplicationReopenRequestSchema>
export type MyApplicationResponse = z.infer<typeof MyApplicationResponseSchema>
export type StudentCheckInResponse = z.infer<typeof StudentCheckInResponseSchema>
export type AdminCheckInLookupRequest = z.infer<typeof AdminCheckInLookupRequestSchema>
export type AdminCheckInConfirmRequest = z.infer<typeof AdminCheckInConfirmRequestSchema>
export type AdminCheckInRevokeRequest = z.infer<typeof AdminCheckInRevokeRequestSchema>
export type AdminCheckInRecord = z.infer<typeof AdminCheckInRecordSchema>
export type AdminCheckInLookupResponse = z.infer<typeof AdminCheckInLookupResponseSchema>
export type AdminCheckInMutationResponse = z.infer<typeof AdminCheckInMutationResponseSchema>
