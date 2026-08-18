import { z } from 'zod'
import { LearnerCapabilityIdSchema } from './capabilities.js'
import { JsonObjectSchema, type JsonValue } from './common.js'

const clientBindingSchema = z.string().regex(/^[a-f0-9]{64}$/)
const payloadDigestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const normalizedSecretKeys = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'cookie',
  'verificationcode',
  'code',
  '验证码',
  '密码',
])

const normalizeKey = (key: string) => key.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]/gu, '')

const findSecretPath = (value: JsonValue, path: Array<string | number> = []): Array<string | number> | null => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const result = findSecretPath(value[index], [...path, index])
      if (result) return result
    }
    return null
  }

  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (normalizedSecretKeys.has(normalizeKey(key))) return [...path, key]
      const result = findSecretPath(child, [...path, key])
      if (result) return result
    }
  }

  return null
}

export const ConfirmationPrepareRequestSchema = z.strictObject({
  capabilityId: LearnerCapabilityIdSchema,
  payload: JsonObjectSchema,
  clientBinding: clientBindingSchema,
  idempotencyKey: z.uuid(),
}).superRefine((request, context) => {
  const secretPath = findSecretPath(request.payload)
  if (secretPath) {
    context.addIssue({
      code: 'custom',
      path: ['payload', ...secretPath],
      message: 'Confirmation previews must not contain secrets',
    })
  }
})

export const ConfirmationPrepareResponseSchema = z.strictObject({
  apiVersion: z.literal('v1'),
  data: z.strictObject({
    confirmationId: z.uuid(),
    expiresAt: z.iso.datetime(),
    preview: JsonObjectSchema,
    payloadSha256: payloadDigestSchema,
    confirmation: z.enum(['single', 'double']),
  }),
})

export const ConfirmationExecuteRequestSchema = z.strictObject({
  clientBinding: clientBindingSchema,
  idempotencyKey: z.uuid(),
  payload: JsonObjectSchema,
})

export type ConfirmationPrepareRequest = z.infer<typeof ConfirmationPrepareRequestSchema>
export type ConfirmationPrepareResponse = z.infer<typeof ConfirmationPrepareResponseSchema>
export type ConfirmationExecuteRequest = z.infer<typeof ConfirmationExecuteRequestSchema>
