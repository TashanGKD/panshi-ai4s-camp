import type { Request } from 'express'
import type { JsonObject, LearnerCapabilityId } from '@panshi/contracts'
import { HttpError } from '../../middleware/error-handler.js'
import type { ConfirmationActor, ConfirmationService } from './confirmation.service.js'

const HEADER_BINDING = 'X-Confirmation-Binding'
const HEADER_IDEMPOTENCY = 'X-Idempotency-Key'
const HEADER_CONFIRMATION = 'X-Confirmation-Id'

export const executeConfirmedRequest = async (
  service: ConfirmationService,
  actor: ConfirmationActor,
  capabilityId: LearnerCapabilityId,
  request: Pick<Request, 'get' | 'body'>,
  payload: JsonObject = request.body as JsonObject,
  serverContext?: unknown,
) => {
  const { confirmationId, clientBinding, idempotencyKey } = requireConfirmationHeaders(request)
  return service.execute(actor, confirmationId, { clientBinding, idempotencyKey, payload }, capabilityId, serverContext)
}

export const requireConfirmationHeaders = (request: Pick<Request, 'get'>) => {
  const confirmationId = request.get(HEADER_CONFIRMATION)
  const clientBinding = request.get(HEADER_BINDING)
  const idempotencyKey = request.get(HEADER_IDEMPOTENCY)
  if (!confirmationId || !clientBinding || !idempotencyKey) throw new HttpError(409, 'CONFIRMATION_REQUIRED', '该操作需要先生成并确认变更预览')
  return { confirmationId, clientBinding, idempotencyKey }
}

export const confirmationHeaders = {
  binding: HEADER_BINDING,
  confirmation: HEADER_CONFIRMATION,
  idempotency: HEADER_IDEMPOTENCY,
} as const
