import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { and, eq, isNull } from 'drizzle-orm'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { auditLogs, sessions, users } from '../src/db/schema.js'
import { createAdminManagementRepository } from '../src/modules/identity/admin-management.repository.js'
import { createAdminManagementService, sanitizeAuditMetadata } from '../src/modules/identity/admin-management.service.js'
import { hashPassword } from '../src/modules/identity/password.js'
import { createSessionService, hashSessionToken } from '../src/modules/identity/session.service.js'
import { createIdentityRepository } from '../src/modules/identity/identity.repository.js'

const url = process.env.TEST_DATABASE_URL
if (!url || new URL(url).pathname !== '/panshi_ai4s_camp_test') throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
const database = createDatabaseClient(url)
const password = 'CurrentAdmin!2026'
const ids = ['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000003'] as const
const phones = ['+8613800138001', '+8613800138002', '+8613800138003'] as const

const readActor = async (id: string) => {
  const [record] = await database.db.select().from(users).where(eq(users.id, id)).limit(1)
  if (!record) throw new Error('Missing test administrator')
  return record
}

describe('administrator management PostgreSQL truth', () => {
  beforeAll(async () => {
    await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public')
    await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined })
  })
  beforeEach(async () => {
    await database.pool.query('TRUNCATE audit_logs, sessions, users CASCADE')
    const passwordHash = await hashPassword(password)
    await database.db.insert(users).values(ids.map((id, index) => ({ id, displayName: `管理员${index + 1}`, phoneNormalized: phones[index]!, passwordHash, role: 'admin' as const })))
  })
  afterAll(async () => { await database.pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public'); await database.close() })

  it('requires reauthentication, enforces unique phone and administrator name, and never returns hashes', async () => {
    const service = createAdminManagementService(createAdminManagementRepository(database.db))
    const actor = await readActor(ids[0])
    await expect(service.create(actor, { displayName: '唯一管理员', phone: '13900139000', password: 'NewAdmin!2026', currentPassword: 'wrong-password' })).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' })
    await expect(service.disable(actor, ids[1], { currentPassword: 'wrong-password' })).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' })
    await expect(service.resetPassword(actor, ids[1], { currentPassword: 'wrong-password', newPassword: 'Replacement!2026' })).rejects.toMatchObject({ code: 'CURRENT_PASSWORD_INVALID' })
    const created = await service.create(actor, { displayName: '唯一管理员', phone: '13900139000', password: 'NewAdmin!2026', currentPassword: password })
    expect(created.data.administrator).toMatchObject({ isCurrent: false })
    expect(JSON.stringify(created)).not.toMatch(/password|hash|CurrentAdmin|NewAdmin/iu)
    await expect(service.create(actor, { displayName: '唯一管理员', phone: '13700137000', password: 'OtherAdmin!2026', currentPassword: password })).rejects.toMatchObject({ code: 'ADMIN_NAME_CONFLICT' })
    await expect(service.create(actor, { displayName: '另一个管理员', phone: '13900139000', password: 'OtherAdmin!2026', currentPassword: password })).rejects.toMatchObject({ code: 'ADMIN_PHONE_CONFLICT' })
    expect(JSON.stringify(await service.list())).not.toMatch(/passwordHash|session|token/iu)
  })

  it('rejects self-disable and atomically preserves one active administrator under concurrent disable', async () => {
    await database.pool.query('DELETE FROM users WHERE id = $1', [ids[2]])
    const service = createAdminManagementService(createAdminManagementRepository(database.db))
    const first = await readActor(ids[0]); const second = await readActor(ids[1])
    await expect(service.disable(first, first.id, { currentPassword: password })).rejects.toMatchObject({ code: 'CANNOT_DISABLE_SELF' })
    const results = await Promise.allSettled([
      service.disable(first, second.id, { currentPassword: password }),
      service.disable(second, first.id, { currentPassword: password }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const [active] = await database.db.select({ id: users.id }).from(users).where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
    expect(active).toBeTruthy()
    const activeCount = await database.pool.query<{ count: string }>("select count(*)::text as count from users where role='admin' and disabled_at is null")
    expect(activeCount.rows[0]?.count).toBe('1')
  })

  it('prevents direct database updates or deletes from removing the final active administrator', async () => {
    await database.pool.query('DELETE FROM users WHERE id <> $1', [ids[0]])
    await expect(database.pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [ids[0]])).rejects.toThrow(/last active administrator/iu)
    await expect(database.pool.query('DELETE FROM users WHERE id=$1', [ids[0]])).rejects.toThrow(/last active administrator/iu)
  })

  it('preserves one active administrator under concurrent direct database updates', async () => {
    await database.pool.query('DELETE FROM users WHERE id = $1', [ids[2]])
    const results = await Promise.allSettled([
      database.pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [ids[0]]),
      database.pool.query('UPDATE users SET disabled_at=now() WHERE id=$1', [ids[1]]),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    const active = await database.pool.query<{ count: string }>("select count(*)::text as count from users where role='admin' and disabled_at is null")
    expect(active.rows[0]?.count).toBe('1')
  })

  it('revokes every target session atomically on disable and password reset', async () => {
    const repository = createAdminManagementRepository(database.db)
    const service = createAdminManagementService(repository)
    const actor = await readActor(ids[0]); const target = await readActor(ids[1])
    await database.db.insert(sessions).values([{ tokenHash: hashSessionToken('target-one'), userId: target.id, expiresAt: new Date(Date.now() + 60_000) }, { tokenHash: hashSessionToken('target-two'), userId: target.id, expiresAt: new Date(Date.now() + 60_000) }])
    await service.resetPassword(actor, target.id, { currentPassword: password, newPassword: 'Replacement!2026' })
    expect((await database.db.select().from(sessions).where(eq(sessions.userId, target.id))).every((row) => row.revokedAt !== null)).toBe(true)
    await database.db.insert(sessions).values({ tokenHash: hashSessionToken('target-three'), userId: target.id, expiresAt: new Date(Date.now() + 60_000) })
    await service.disable(actor, target.id, { currentPassword: password })
    const identity = createIdentityRepository(database.db)
    const sessionService = createSessionService(identity, identity, { sessionTtlSeconds: 60 })
    await expect(sessionService.resolve('target-three')).rejects.toMatchObject({ kind: 'unauthorized' })
    const actions = (await database.db.select({ action: auditLogs.action, metadata: auditLogs.metadata }).from(auditLogs)).filter((row) => row.action.startsWith('admin.'))
    expect(actions).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'admin.password_reset' }), expect.objectContaining({ action: 'admin.disabled' })]))
    expect(JSON.stringify(actions.map((entry) => entry.metadata))).not.toMatch(/password|hash|token|phone|CurrentAdmin|Replacement/iu)
  })

  it('deeply removes unapproved audit metadata and keeps audit rows immutable', async () => {
    expect(sanitizeAuditMetadata({ result: 'success', before: { revision: 1, password: 'secret', nested: { token: 'x' } }, filters: { status: 'submitted', phone: '13800138000' }, answers: ['secret'], internalNote: 'secret' })).toEqual({ result: 'success', before: { revision: 1 }, filters: { status: 'submitted' } })
    expect(sanitizeAuditMetadata({ result: 'password=secret', status: '+8613800138000', columns: ['安全列', 'token=hidden'] })).toEqual({ columns: ['安全列'] })
    await database.db.insert(auditLogs).values({ actorUserId: ids[0], action: 'password=must-not-render', entityType: 'token=must-not-render', entityId: ids[0], metadata: { result: 'success' } })
    const [record] = await database.db.select({ id: auditLogs.id }).from(auditLogs).limit(1)
    const presented = await createAdminManagementService(createAdminManagementRepository(database.db)).auditLog(record!.id)
    expect(JSON.stringify(presented)).not.toMatch(/password|token|must-not-render/iu)
    await expect(database.pool.query('update audit_logs set action=$1 where id=$2', ['tampered', record!.id])).rejects.toThrow(/append-only/iu)
    await expect(database.pool.query('delete from audit_logs where id=$1', [record!.id])).rejects.toThrow(/append-only/iu)
  })
})
