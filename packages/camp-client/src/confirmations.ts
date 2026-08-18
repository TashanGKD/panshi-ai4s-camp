import {
  ConfirmationPrepareRequestSchema,
  ConfirmationPrepareResponseSchema,
  JsonObjectSchema,
  type ConfirmationPrepareRequest,
  type JsonObject,
  type LearnerCapabilityId,
} from '@panshi/contracts'
import type { CampTransport } from './http.js'

export type ConfirmationContext = Pick<ConfirmationPrepareRequest, 'clientBinding' | 'idempotencyKey'>
export type ConfirmedOperation = ConfirmationContext & { confirmationId: string }

export const confirmationHeaders = (context: ConfirmedOperation): HeadersInit => ({
  'X-Confirmation-Id': context.confirmationId,
  'X-Confirmation-Binding': context.clientBinding,
  'X-Idempotency-Key': context.idempotencyKey,
})

export const createConfirmationApi = (transport: CampTransport) => ({
  prepare: (capabilityId: LearnerCapabilityId, payload: JsonObject, context: ConfirmationContext) => {
    const body = ConfirmationPrepareRequestSchema.parse({ capabilityId, payload, ...context })
    return transport.controlJson('/api/v1/confirmations/prepare', {
      schema: ConfirmationPrepareResponseSchema,
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })
  },
  execute: (confirmationId: string, payload: JsonObject, context: ConfirmationContext) => transport.controlJson(
    `/api/v1/confirmations/${encodeURIComponent(confirmationId)}/execute`,
    { schema: JsonObjectSchema, method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...context, payload }) },
  ),
})
