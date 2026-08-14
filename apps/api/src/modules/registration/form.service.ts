import {
  RegistrationFormDraftResponseSchema,
  RegistrationFormHistoryResponseSchema,
  RegistrationFormPublishResponseSchema,
  RegistrationFormSchema,
  type RegistrationForm,
  type RegistrationFormDraftResponse,
  type RegistrationFormHistoryResponse,
  type RegistrationFormPublishResponse,
} from '@panshi/contracts'
import type { ZodIssue } from 'zod'

export type RegistrationFormRecord = {
  form: RegistrationForm
  revision: number
  baseVersion: number | null
  publishedVersionId: string | null
}

export type RegistrationFormVersionRecord = {
  id: string
  version: number
  form: RegistrationForm
  createdBy: string
  createdAt: Date
}

export type RegistrationFormRepository = {
  getDraft: () => Promise<RegistrationFormRecord | null>
  saveDraft: (input: { form: RegistrationForm, expectedRevision: number, actorUserId: string }) => Promise<RegistrationFormRecord | null>
  publishDraft: (input: { expectedRevision: number, actorUserId: string }) => Promise<{ revision: number, version: number, formVersionId: string } | null>
  listVersions: () => Promise<{ publishedVersion: number | null, versions: readonly RegistrationFormVersionRecord[] }>
  getPublished: () => Promise<RegistrationFormVersionRecord | null>
  getVersion: (id: string) => Promise<RegistrationFormVersionRecord | null>
}

export class RegistrationFormConflictError extends Error {
  constructor() { super('Registration form revision conflict'); this.name = 'RegistrationFormConflictError' }
}

export class RegistrationFormNotFoundError extends Error {
  constructor() { super('Registration form was not found'); this.name = 'RegistrationFormNotFoundError' }
}

export class RegistrationFormValidationError extends Error {
  constructor(readonly details: { fields: Array<{ path: string, code: string, message: string }> }) {
    super('Registration form validation failed')
    this.name = 'RegistrationFormValidationError'
  }
}

const issueCode = (issue: ZodIssue) => issue.code === 'custom' ? 'INVALID_FIELD' : issue.code.toUpperCase()

const parseForm = (value: unknown): RegistrationForm => {
  const parsed = RegistrationFormSchema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new RegistrationFormValidationError({
    fields: parsed.error.issues.map((issue) => ({
      path: issue.path.map(String).join('.'),
      code: issueCode(issue),
      message: issue.message,
    })),
  })
}

const requireDraft = (record: RegistrationFormRecord | null): RegistrationFormRecord => {
  if (!record) throw new RegistrationFormNotFoundError()
  return { ...record, form: parseForm(record.form) }
}

export type RegistrationFormService = {
  getDraft: () => Promise<RegistrationFormDraftResponse>
  saveDraft: (form: unknown, expectedRevision: number, actorUserId: string) => Promise<RegistrationFormDraftResponse>
  preview: () => Promise<RegistrationFormDraftResponse>
  publish: (expectedRevision: number, actorUserId: string) => Promise<RegistrationFormPublishResponse>
  getHistory: () => Promise<RegistrationFormHistoryResponse>
  getPublished: () => ReturnType<RegistrationFormRepository['getPublished']>
  getVersion: (id: string) => ReturnType<RegistrationFormRepository['getVersion']>
}

export const createRegistrationFormService = (repository: RegistrationFormRepository): RegistrationFormService => ({
  getDraft: async () => {
    const draft = requireDraft(await repository.getDraft())
    return RegistrationFormDraftResponseSchema.parse({ apiVersion: 'v1', data: draft })
  },

  saveDraft: async (input, expectedRevision, actorUserId) => {
    const form = parseForm(input)
    const saved = await repository.saveDraft({ form, expectedRevision, actorUserId })
    if (!saved) throw new RegistrationFormConflictError()
    return RegistrationFormDraftResponseSchema.parse({ apiVersion: 'v1', data: requireDraft(saved) })
  },

  preview: async () => {
    const draft = requireDraft(await repository.getDraft())
    return RegistrationFormDraftResponseSchema.parse({ apiVersion: 'v1', data: draft })
  },

  publish: async (expectedRevision, actorUserId) => {
    const result = await repository.publishDraft({ expectedRevision, actorUserId })
    if (!result) throw new RegistrationFormConflictError()
    return RegistrationFormPublishResponseSchema.parse({ apiVersion: 'v1', data: result })
  },

  getHistory: async () => {
    const result = await repository.listVersions()
    return RegistrationFormHistoryResponseSchema.parse({
      apiVersion: 'v1',
      data: {
        publishedVersion: result.publishedVersion,
        versions: result.versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })),
      },
    })
  },

  getPublished: () => repository.getPublished(),
  getVersion: (id) => repository.getVersion(id),
})
