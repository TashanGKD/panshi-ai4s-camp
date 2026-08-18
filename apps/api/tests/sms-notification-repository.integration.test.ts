import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import {
  applications,
  registrationFormVersions,
  smsNotificationOutbox,
  users,
} from '../src/db/schema.js'
import {
  createSmsNotificationRepository,
  enqueueSmsNotification,
} from '../src/modules/sms/notification.repository.js'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}
const database = createDatabaseClient(url)
const userId = '10000000-0000-4000-8000-000000000001'
const applicationId = '30000000-0000-4000-8000-000000000001'

describe('SMS notification outbox PostgreSQL repository', () => {
  beforeAll(async () => {
    await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined })
  })

  beforeEach(async () => {
    await database.pool.query('TRUNCATE sms_notification_outbox, applications, registration_form_versions, users CASCADE')
    await database.db.insert(users).values({
      id: userId,
      displayName: '报名学员',
      phoneNormalized: '+8613800138000',
      passwordHash: 'x',
      role: 'user',
    })
    const [form] = await database.db.insert(registrationFormVersions).values({
      version: 1,
      schema: {},
      publishedAt: new Date(),
    }).returning({ id: registrationFormVersions.id })
    await database.db.insert(applications).values({
      id: applicationId,
      userId,
      formVersionId: form!.id,
      status: 'submitted',
      coreFields: {},
      answers: {},
    })
  })

  afterAll(async () => {
    await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await database.close()
  })

  it('deduplicates the same business event and snapshots one domestic recipient', async () => {
    const input = {
      eventKey: 'application-submitted:50000000-0000-4000-8000-000000000001',
      eventType: 'application_submitted' as const,
      applicationId,
      userId,
      phoneNormalized: '+8613800138000',
    }

    await enqueueSmsNotification(database.db, input)
    await enqueueSmsNotification(database.db, input)

    const records = await database.db.select().from(smsNotificationOutbox)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      eventKey: input.eventKey,
      eventType: input.eventType,
      phoneNormalized: '13800138000',
      status: 'pending',
      attempts: 0,
    })
  })

  it.each([
    '13800138000,13900139000',
    '+8613800138000',
    ' 13800138000',
    '12800138000',
  ])('rejects an invalid persisted recipient %s', async (phoneNormalized) => {
    await expect(database.db.insert(smsNotificationOutbox).values({
      eventKey: `invalid:${phoneNormalized}`,
      eventType: 'application_submitted',
      applicationId,
      userId,
      phoneNormalized,
    })).rejects.toThrow()
  })

  it('claims ready and stale rows without reclaiming a fresh processing lock', async () => {
    const now = new Date('2026-08-18T12:00:00Z')
    await database.db.insert(smsNotificationOutbox).values([
      {
        eventKey: 'pending', eventType: 'application_submitted', applicationId, userId,
        phoneNormalized: '13800138000', status: 'pending', availableAt: new Date('2026-08-18T11:59:00Z'),
      },
      {
        eventKey: 'retry-future', eventType: 'admitted', applicationId, userId,
        phoneNormalized: '13800138000', status: 'retry_wait', availableAt: new Date('2026-08-18T12:01:00Z'),
      },
      {
        eventKey: 'processing-fresh', eventType: 'waitlisted', applicationId, userId,
        phoneNormalized: '13800138000', status: 'processing', lockedAt: new Date('2026-08-18T11:59:30Z'), attempts: 1,
      },
      {
        eventKey: 'processing-stale', eventType: 'rejected', applicationId, userId,
        phoneNormalized: '13800138000', status: 'processing', lockedAt: new Date('2026-08-18T11:50:00Z'), attempts: 1,
      },
    ])
    const repository = createSmsNotificationRepository(database.db)

    const claimed = await repository.claimBatch({
      batchSize: 10,
      now,
      staleBefore: new Date('2026-08-18T11:58:00Z'),
    })

    expect(claimed.map((record) => record.eventKey).sort()).toEqual(['pending', 'processing-stale'])
    expect(claimed.map((record) => record.attempts).sort()).toEqual([1, 2])
    const untouched = await database.db.select().from(smsNotificationOutbox)
      .where(eq(smsNotificationOutbox.eventKey, 'processing-fresh'))
    expect(untouched[0]).toMatchObject({ status: 'processing', attempts: 1 })
  })

  it('moves claimed records through retry, accepted, and dead-letter states', async () => {
    await database.db.insert(smsNotificationOutbox).values({
      eventKey: 'state-machine', eventType: 'needs_supplement', applicationId, userId,
      phoneNormalized: '13800138000', status: 'processing', lockedAt: new Date(), attempts: 1,
    })
    const repository = createSmsNotificationRepository(database.db)
    const [record] = await database.db.select().from(smsNotificationOutbox)

    await repository.markRetry(record!.id, {
      errorCode: 'isp.SYSTEM_ERROR', availableAt: new Date('2026-08-18T12:01:00Z'),
    })
    expect((await database.db.select().from(smsNotificationOutbox))[0]).toMatchObject({
      status: 'retry_wait', lastErrorCode: 'isp.SYSTEM_ERROR', lockedAt: null,
    })

    await database.db.update(smsNotificationOutbox).set({ status: 'processing', lockedAt: new Date() })
      .where(eq(smsNotificationOutbox.id, record!.id))
    await repository.markAccepted(record!.id, {
      bizId: 'biz-1', requestId: 'request-1', acceptedAt: new Date('2026-08-18T12:02:00Z'),
    })
    expect((await database.db.select().from(smsNotificationOutbox))[0]).toMatchObject({
      status: 'accepted', bizId: 'biz-1', providerRequestId: 'request-1', lastErrorCode: null,
    })

    await database.db.update(smsNotificationOutbox).set({
      status: 'processing', lockedAt: new Date(), bizId: null, providerRequestId: null, acceptedAt: null,
    }).where(eq(smsNotificationOutbox.id, record!.id))
    await repository.markDeadLetter(record!.id, { errorCode: 'INVALID_PHONE' })
    expect((await database.db.select().from(smsNotificationOutbox))[0]).toMatchObject({
      status: 'dead_letter', lastErrorCode: 'INVALID_PHONE', lockedAt: null,
    })
  })
})
