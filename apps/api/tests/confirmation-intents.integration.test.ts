import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { auditLogs, confirmationIntents, users } from '../src/db/schema.js'
import { createConfirmationHandlerRegistry } from '../src/modules/confirmations/confirmation-handlers.js'
import { createConfirmationRepository } from '../src/modules/confirmations/confirmation.repository.js'
import { createConfirmationService } from '../src/modules/confirmations/confirmation.service.js'

const requireTestDatabase = (value: string | undefined) => {
  if (!value) throw new Error('TEST_DATABASE_URL is required')
  const parsed = new URL(value)
  if (parsed.pathname !== '/panshi_ai4s_camp_test') throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
  return parsed.toString()
}

const database = createDatabaseClient(requireTestDatabase(process.env.TEST_DATABASE_URL))
const binding = 'c'.repeat(64)

beforeAll(async () => { await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined }) })
beforeEach(async () => {
  await database.pool.query('truncate table audit_logs, confirmation_intents, users cascade')
})
afterAll(async () => { await database.close() })

describe('confirmation repository integration', () => {
  it('atomically executes once, persists a redacted result, and audits metadata only', async () => {
    const [user] = await database.db.insert(users).values({
      displayName: '确认测试用户', phoneNormalized: '+8613900000123', passwordHash: 'hash', role: 'user',
    }).returning({ id: users.id })
    const execute = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
      return { status: 'submitted' }
    })
    const service = createConfirmationService(
      createConfirmationRepository(database.db),
      createConfirmationHandlerRegistry([{
        capabilityId: 'application.submit',
        prepare: (payload) => ({ preview: { action: '提交报名', revision: payload.revision ?? null }, targetType: 'application', targetId: 'mine', expectedRevision: 2 }),
        execute,
      }]),
    )
    const idempotencyKey = randomUUID()
    const prepared = await service.prepare({ userId: user!.id, role: 'user' }, {
      capabilityId: 'application.submit', payload: { targetId: 'mine', revision: 2 }, clientBinding: binding, idempotencyKey,
    })
    const execution = { clientBinding: binding, idempotencyKey, payload: { targetId: 'mine', revision: 2 } }
    const results = await Promise.allSettled([
      service.execute({ userId: user!.id, role: 'user' }, prepared.confirmationId, execution),
      service.execute({ userId: user!.id, role: 'user' }, prepared.confirmationId, execution),
    ])
    expect(results.filter(({ status }) => status === 'fulfilled')).toHaveLength(1)
    expect(results.filter(({ status }) => status === 'rejected')).toHaveLength(1)
    expect(execute).toHaveBeenCalledTimes(1)

    const [stored] = await database.db.select().from(confirmationIntents).where(eq(confirmationIntents.id, prepared.confirmationId))
    expect(stored).toMatchObject({ status: 'consumed', safeResult: { status: 'submitted' }, resultCode: 'CONSUMED' })
    const logs = await database.db.select().from(auditLogs).where(eq(auditLogs.entityId, prepared.confirmationId))
    expect(logs.map(({ action }) => action)).toEqual(['confirmation.prepared', 'confirmation.consumed'])
    expect(JSON.stringify(logs)).not.toMatch(/password|token|cookie|verification|[a-f0-9]{64}/iu)
  })
})
