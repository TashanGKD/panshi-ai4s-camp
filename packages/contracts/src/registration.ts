import { z } from 'zod'
import { JsonObjectSchema, type JsonObject, type JsonValue } from './common.js'

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
