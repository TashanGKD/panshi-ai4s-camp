import { z } from 'zod'
import { JsonObjectSchema, type JsonObject, type JsonValue } from './common.js'

const UuidSchema = z.string().uuid()

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

const LabelSchema = z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.labelMaxLength)
const HelpTextSchema = z.string().max(REGISTRATION_FORM_LIMITS.helpTextMaxLength)

export const DEFAULT_REGISTRATION_ATTACHMENT_ID = '00000000-0000-4000-8000-000000000001'

export const RegistrationCoreFieldKeySchema = z.enum([
  'name', 'phone', 'email', 'organization', 'department', 'identityType', 'educationStage', 'majorResearchDirection',
])

export const RegistrationCoreFieldSchema = z.object({
  key: RegistrationCoreFieldKeySchema,
  label: LabelSchema,
  required: z.literal(true),
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
}).strict()

const TextQuestionSchema = RegistrationQuestionBaseSchema.extend({
  type: z.enum(['short_text', 'long_text']),
  options: z.never().optional(),
})

export const RegistrationQuestionOptionSchema = z.object({
  id: UuidSchema,
  value: z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.optionValueMaxLength),
  label: z.string().trim().min(1).max(REGISTRATION_FORM_LIMITS.optionLabelMaxLength),
}).strict()

const ChoiceQuestionSchema = RegistrationQuestionBaseSchema.extend({
  type: z.enum(['single_choice', 'multiple_choice']),
  options: z.array(RegistrationQuestionOptionSchema).min(1).max(REGISTRATION_FORM_LIMITS.maxOptionsPerQuestion),
  validation: z.object({}).strict(),
}).strict().superRefine((question, context) => {
  const ids = new Set<string>()
  const values = new Set<string>()
  question.options.forEach((option, index) => {
    if (ids.has(option.id)) context.addIssue({ code: 'custom', path: ['options', index, 'id'], message: 'option ids must be unique' })
    if (values.has(option.value)) context.addIssue({ code: 'custom', path: ['options', index, 'value'], message: 'option values must be unique' })
    ids.add(option.id)
    values.add(option.value)
  })
})

export const RegistrationDynamicQuestionSchema = z.discriminatedUnion('type', [TextQuestionSchema, ChoiceQuestionSchema])

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
})

const DEFAULT_REGISTRATION_CORE_FIELDS = [
  { key: 'name', label: '姓名', required: true, readOnly: false },
  { key: 'phone', label: '手机号', required: true, readOnly: true },
  { key: 'email', label: '电子邮箱', required: true, readOnly: false },
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
export const ApplicationCoreFieldsSchema = z.object({
  name: CoreFieldValueSchema,
  phone: z.string().min(1).max(32),
  email: z.union([z.literal(''), z.string().trim().email().max(320)]),
  organization: CoreFieldValueSchema,
  department: CoreFieldValueSchema,
  identityType: CoreFieldValueSchema,
  educationStage: CoreFieldValueSchema,
  majorResearchDirection: z.string().trim().max(2_000),
}).strict()

export const ApplicationAnswersSchema = z.record(UuidSchema, z.union([
  z.string().max(REGISTRATION_FORM_LIMITS.textMaxLength),
  z.array(z.string().max(REGISTRATION_FORM_LIMITS.optionValueMaxLength)).max(REGISTRATION_FORM_LIMITS.maxOptionsPerQuestion),
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
      retiredAnswerIds: z.array(UuidSchema),
      submittedAt: z.iso.datetime().nullable(),
      updatedAt: z.iso.datetime(),
    }).strict(),
    timeline: z.array(ApplicationTimelineEntrySchema),
    supplementRequest: z.object({
      message: z.string(),
      editableFieldIds: z.array(UuidSchema),
      editableAttachmentIds: z.array(UuidSchema),
    }).strict().nullable(),
    accessibleResources: z.array(z.object({ id: UuidSchema, title: z.string(), downloadUrl: z.string() }).strict()),
  }).strict(),
}).strict()

export const ApplicationSubmitRequestSchema = z.object({
  expectedRevision: z.number().int().nonnegative(),
}).strict()

export const ApplicationSubmitResponseSchema = z.object({
  apiVersion: z.literal('v1'),
  data: z.object({
    applicationId: UuidSchema,
    status: z.literal('submitted'),
    submittedAt: z.iso.datetime(),
    versionId: UuidSchema,
  }).strict(),
}).strict()

export type ApplicationCoreFields = z.infer<typeof ApplicationCoreFieldsSchema>
export type ApplicationAnswers = z.infer<typeof ApplicationAnswersSchema>
export type ApplicationDraftSaveRequest = z.infer<typeof ApplicationDraftSaveRequestSchema>
export type MyApplicationResponse = z.infer<typeof MyApplicationResponseSchema>
