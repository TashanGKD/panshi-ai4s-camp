import { z } from 'zod'
import { LearnerCapabilityIdSchema } from './capabilities.js'
import { JsonValueSchema } from './common.js'

export const StableCliErrorCodeSchema = z.enum([
  'UNAUTHORIZED',
  'FORBIDDEN',
  'INPUT_INVALID',
  'STATE_NOT_ALLOWED',
  'APPLICATION_REVISION_CONFLICT',
  'CONFIRMATION_REQUIRED',
  'CONFIRMATION_EXPIRED',
  'CONFIRMATION_MISMATCH',
  'CONFIRMATION_ALREADY_USED',
  'CONFIRMATION_EXECUTION_INDETERMINATE',
  'RESOURCE_NOT_FOUND',
  'SERVICE_UNAVAILABLE',
  'AUTH_CREDENTIALS_AMBIGUOUS',
  'INTERACTIVE_INPUT_REQUIRED',
  'KEYCHAIN_UNAVAILABLE',
  'OUTPUT_EXISTS',
  'REQUEST_FAILED',
])

export const CliSuccessSchema = z.strictObject({
  ok: z.literal(true),
  apiVersion: z.literal('v1'),
  capabilityId: LearnerCapabilityIdSchema,
  data: JsonValueSchema,
  requestId: z.string().min(1),
})

export const CliFailureSchema = z.strictObject({
  ok: z.literal(false),
  code: StableCliErrorCodeSchema,
  message: z.string().min(1),
  details: JsonValueSchema.optional(),
  requestId: z.string().min(1),
})

export const CliOutputSchema = z.discriminatedUnion('ok', [CliSuccessSchema, CliFailureSchema])

export type StableCliErrorCode = z.infer<typeof StableCliErrorCodeSchema>
export type CliSuccess = z.infer<typeof CliSuccessSchema>
export type CliFailure = z.infer<typeof CliFailureSchema>
export type CliOutput = z.infer<typeof CliOutputSchema>
