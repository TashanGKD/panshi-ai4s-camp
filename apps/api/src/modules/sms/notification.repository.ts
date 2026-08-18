import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { smsNotificationOutbox } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import type {
  SmsNotificationEventType,
  SmsNotificationWorkerRepository,
} from './notification.types.js'

type Database = NodePgDatabase<typeof schema>

export type EnqueueSmsNotificationInput = {
  eventKey: string
  eventType: SmsNotificationEventType
  applicationId: string
  userId: string
  phoneNormalized: string
}

const domesticPhone = (phoneNormalized: string) => {
  if (!/^\+861[3-9][0-9]{9}$/u.test(phoneNormalized)) {
    throw new Error('SMS notification recipient must be one normalized mainland phone number')
  }
  return phoneNormalized.slice(3)
}

export const enqueueSmsNotification = async (
  database: Database,
  input: EnqueueSmsNotificationInput,
) => {
  await database.insert(smsNotificationOutbox).values({
    ...input,
    phoneNormalized: domesticPhone(input.phoneNormalized),
  }).onConflictDoNothing({ target: smsNotificationOutbox.eventKey })
}

const requireUpdated = async (query: Promise<Array<{ id: string }>>) => {
  const updated = await query
  if (updated.length !== 1) throw new Error('SMS outbox state transition conflict')
}

export const createSmsNotificationRepository = (db: Database): SmsNotificationWorkerRepository => ({
  claimBatch: (input) => db.transaction(async (transaction) => {
    const rows = await transaction.select({ id: smsNotificationOutbox.id })
      .from(smsNotificationOutbox)
      .where(or(
        and(
          inArray(smsNotificationOutbox.status, ['pending', 'retry_wait']),
          lte(smsNotificationOutbox.availableAt, input.now),
        ),
        and(
          eq(smsNotificationOutbox.status, 'processing'),
          lte(smsNotificationOutbox.lockedAt, input.staleBefore),
        ),
      ))
      .orderBy(asc(smsNotificationOutbox.availableAt), asc(smsNotificationOutbox.id))
      .limit(input.batchSize)
      .for('update', { skipLocked: true })
    if (rows.length === 0) return []
    return transaction.update(smsNotificationOutbox).set({
      status: 'processing',
      attempts: sql`${smsNotificationOutbox.attempts} + 1`,
      lockedAt: input.now,
      updatedAt: input.now,
    }).where(inArray(smsNotificationOutbox.id, rows.map(({ id }) => id))).returning({
      id: smsNotificationOutbox.id,
      eventKey: smsNotificationOutbox.eventKey,
      eventType: smsNotificationOutbox.eventType,
      applicationId: smsNotificationOutbox.applicationId,
      userId: smsNotificationOutbox.userId,
      phoneNormalized: smsNotificationOutbox.phoneNormalized,
      attempts: smsNotificationOutbox.attempts,
    })
  }),

  markAccepted: async (id, input) => requireUpdated(
    db.update(smsNotificationOutbox).set({
      status: 'accepted',
      lockedAt: null,
      bizId: input.bizId,
      providerRequestId: input.requestId,
      lastErrorCode: null,
      acceptedAt: input.acceptedAt,
      updatedAt: input.acceptedAt,
    }).where(and(eq(smsNotificationOutbox.id, id), eq(smsNotificationOutbox.status, 'processing')))
      .returning({ id: smsNotificationOutbox.id }),
  ),

  markRetry: async (id, input) => requireUpdated(
    db.update(smsNotificationOutbox).set({
      status: 'retry_wait',
      lockedAt: null,
      availableAt: input.availableAt,
      lastErrorCode: input.errorCode,
      updatedAt: new Date(),
    }).where(and(eq(smsNotificationOutbox.id, id), eq(smsNotificationOutbox.status, 'processing')))
      .returning({ id: smsNotificationOutbox.id }),
  ),

  markDeadLetter: async (id, input) => requireUpdated(
    db.update(smsNotificationOutbox).set({
      status: 'dead_letter',
      lockedAt: null,
      lastErrorCode: input.errorCode,
      updatedAt: new Date(),
    }).where(and(eq(smsNotificationOutbox.id, id), eq(smsNotificationOutbox.status, 'processing')))
      .returning({ id: smsNotificationOutbox.id }),
  ),
})
