import { and, eq, gt, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { confirmationIntents } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { appendAuditLog } from '../audit/audit.repository.js'
import type { ConfirmationIntent, ConfirmationRepository } from './confirmation.service.js'

const selection = {
  id: confirmationIntents.id,
  actorUserId: confirmationIntents.actorUserId,
  siteId: confirmationIntents.siteId,
  capabilityId: confirmationIntents.capabilityId,
  payloadSha256: confirmationIntents.payloadSha256,
  payload: confirmationIntents.payload,
  preview: confirmationIntents.preview,
  targetType: confirmationIntents.targetType,
  targetId: confirmationIntents.targetId,
  expectedRevision: confirmationIntents.expectedRevision,
  clientBindingDigest: confirmationIntents.clientBindingDigest,
  idempotencyKey: confirmationIntents.idempotencyKey,
  status: confirmationIntents.status,
  safeResult: confirmationIntents.safeResult,
  createdAt: confirmationIntents.createdAt,
  expiresAt: confirmationIntents.expiresAt,
  consumedAt: confirmationIntents.consumedAt,
}

const asIntent = (row: typeof confirmationIntents.$inferSelect): ConfirmationIntent => ({
  ...row,
  siteId: 'panshi-ai4s-camp',
  capabilityId: row.capabilityId as ConfirmationIntent['capabilityId'],
})

export const createConfirmationRepository = (
  db: NodePgDatabase<typeof schema>,
): ConfirmationRepository => ({
  create: async (intent) => db.transaction(async (transaction) => {
    const actorPredicate = intent.actorUserId
      ? eq(confirmationIntents.actorUserId, intent.actorUserId)
      : isNull(confirmationIntents.actorUserId)
    const bindingPredicate = intent.actorUserId
      ? actorPredicate
      : and(actorPredicate, eq(confirmationIntents.clientBindingDigest, intent.clientBindingDigest))
    const [existing] = await transaction.select(selection).from(confirmationIntents).where(and(
      bindingPredicate,
      eq(confirmationIntents.idempotencyKey, intent.idempotencyKey),
    )).limit(1)
    if (existing) return asIntent(existing as typeof confirmationIntents.$inferSelect)
    const [created] = await transaction.insert(confirmationIntents).values(intent).returning(selection)
    if (!created) throw new Error('CONFIRMATION_CREATE_FAILED')
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId: intent.actorUserId,
      action: 'confirmation.prepared', entityType: 'confirmation_intent', entityId: intent.id,
      metadata: { capabilityId: intent.capabilityId, resultCode: 'PREPARED', targetType: intent.targetType },
    })
    return asIntent(created as typeof confirmationIntents.$inferSelect)
  }),

  findById: async (id) => {
    const [row] = await db.select(selection).from(confirmationIntents).where(eq(confirmationIntents.id, id)).limit(1)
    return row ? asIntent(row as typeof confirmationIntents.$inferSelect) : null
  },

  claim: async (id, now) => {
    const rows = await db.update(confirmationIntents).set({ status: 'executing' }).where(and(
      eq(confirmationIntents.id, id), eq(confirmationIntents.status, 'pending'),
      gt(confirmationIntents.expiresAt, now),
    )).returning({ id: confirmationIntents.id })
    return rows.length === 1
  },

  consume: async (id, safeResult, consumedAt) => db.transaction(async (transaction) => {
    const [intent] = await transaction.update(confirmationIntents).set({ status: 'consumed', safeResult, consumedAt, resultCode: 'CONSUMED' })
      .where(and(eq(confirmationIntents.id, id), eq(confirmationIntents.status, 'executing')))
      .returning({ actorUserId: confirmationIntents.actorUserId, capabilityId: confirmationIntents.capabilityId, targetType: confirmationIntents.targetType })
    if (!intent) throw new Error('CONFIRMATION_CONSUME_STATE_INVALID')
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId: intent.actorUserId, action: 'confirmation.consumed', entityType: 'confirmation_intent', entityId: id,
      metadata: { capabilityId: intent.capabilityId, resultCode: 'CONSUMED', targetType: intent.targetType },
    })
  }),

  reject: async (id, status, resultCode) => db.transaction(async (transaction) => {
    const [intent] = await transaction.update(confirmationIntents).set({ status, resultCode })
      .where(and(eq(confirmationIntents.id, id), eq(confirmationIntents.status, status === 'expired' ? 'pending' : 'executing')))
      .returning({ actorUserId: confirmationIntents.actorUserId, capabilityId: confirmationIntents.capabilityId, targetType: confirmationIntents.targetType })
    if (!intent) return
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId: intent.actorUserId, action: 'confirmation.rejected', entityType: 'confirmation_intent', entityId: id,
      metadata: { capabilityId: intent.capabilityId, resultCode, targetType: intent.targetType },
    })
  }),
})
