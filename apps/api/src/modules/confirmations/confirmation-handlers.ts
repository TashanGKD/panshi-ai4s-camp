import { learnerCapabilities, type JsonObject, type LearnerCapabilityId } from '@panshi/contracts'

export type ConfirmationPreparation = {
  preview: JsonObject
  targetType?: string | null
  targetId?: string | null
  expectedRevision?: number | null
}

export type ConfirmationHandler = {
  capabilityId: LearnerCapabilityId
  prepare: (payload: JsonObject) => ConfirmationPreparation | Promise<ConfirmationPreparation>
  executionBindingPayload?: (preparedPayload: JsonObject, executionPayload: JsonObject) => JsonObject
  execute: (input: {
    actorUserId: string | null
    preparedPayload: JsonObject
    executionPayload: JsonObject
  }) => Promise<JsonObject>
}

export type ConfirmationHandlerRegistry = ReadonlyMap<LearnerCapabilityId, ConfirmationHandler>

export const createConfirmationHandlerRegistry = (
  handlers: readonly ConfirmationHandler[],
): ConfirmationHandlerRegistry => {
  const registry = new Map<LearnerCapabilityId, ConfirmationHandler>()
  for (const handler of handlers) {
    const capability = learnerCapabilities.find(({ id }) => id === handler.capabilityId)
    if (!capability || capability.effect === 'read' || capability.confirmation === 'none') {
      throw new Error(`Capability is not confirmable: ${handler.capabilityId}`)
    }
    if (registry.has(handler.capabilityId)) throw new Error(`Duplicate confirmation handler: ${handler.capabilityId}`)
    registry.set(handler.capabilityId, handler)
  }
  return registry
}
