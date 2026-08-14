import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { auditLogs, sessions, users, verificationCodes } from '../src/db/schema.js'
import { createIdentityRepository } from '../src/modules/identity/identity.repository.js'
import { createMockVerificationProvider } from '../src/modules/identity/mock-verification-provider.js'
import { hashPassword } from '../src/modules/identity/password.js'
import { createVerificationService } from '../src/modules/identity/verification.service.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const parsed = databaseUrl ? new URL(databaseUrl) : undefined
if (!databaseUrl || !parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol)
  || parsed.pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}

const database = createDatabaseClient(databaseUrl)
const repository = createIdentityRepository(database.db)
const origin = 'https://camp.example'
const testCode = '246810'
const secret = 'integration-only-verification-secret-32-bytes'
const sent: string[] = []
const verificationService = createVerificationService(
  repository,
  createMockVerificationProvider({ code: testCode, logger: ({ purpose }) => sent.push(purpose) }),
  { secret, ttlSeconds: 300, cooldownSeconds: 60, maxAttempts: 3 },
)
const app = createApp({
  checkDatabase: database.checkHealth,
  identityRepository: repository,
  authTransactionRepository: repository,
  studentIdentityRepository: repository,
  verificationService,
  config: {
    allowedOrigins: [origin], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576, sessionTtlSeconds: 28_800,
  },
})

const cleanup = async () => {
  await database.pool.query('TRUNCATE audit_logs, sessions, verification_codes, users CASCADE')
  sent.length = 0
}

const send = (phone: string, purpose: 'register' | 'reset_password') => request(app)
  .post('/api/v1/auth/verification/send').set('Origin', origin).send({ phone, purpose })

describe('student authentication PostgreSQL integration', () => {
  beforeAll(async () => {
    await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined })
  })
  beforeEach(cleanup)
  afterAll(async () => {
    await cleanup()
    await database.close()
  })

  it('persists purpose and a keyed digest without plaintext verification codes', async () => {
    expect((await send('13800138000', 'register')).status).toBe(204)
    const [record] = await database.db.select().from(verificationCodes)
    expect(record).toMatchObject({ phoneNormalized: '+8613800138000', purpose: 'register', failedAttempts: 0, consumedAt: null })
    expect(record?.codeHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(record?.codeHash).not.toBe(createHash('sha256').update(testCode).digest('hex'))
    expect(JSON.stringify(record)).not.toContain(testCode)
  })

  it('atomically consumes one registration code under concurrent submissions', async () => {
    await send('13800138000', 'register')
    const calls = await Promise.all([
      request(app).post('/api/v1/auth/register').set('Origin', origin)
        .send({ phone: '13800138000', code: testCode, password: 'password-1' }),
      request(app).post('/api/v1/auth/register').set('Origin', origin)
        .send({ phone: '13800138000', code: testCode, password: 'password-1' }),
    ])
    expect(calls.map(({ status }) => status).sort()).toEqual([201, 400])
    expect(await database.db.select().from(users)).toHaveLength(1)
    expect((await database.db.select().from(verificationCodes))[0]?.consumedAt).toBeInstanceOf(Date)
  })

  it('resets password and revokes all existing sessions in one transaction', async () => {
    const [user] = await database.db.insert(users).values({
      displayName: '学员', phoneNormalized: '+8613800138000', passwordHash: await hashPassword('password-1'), role: 'user',
    }).returning({ id: users.id })
    if (!user) throw new Error('Missing test user')
    await database.db.insert(sessions).values([
      { userId: user.id, tokenHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000) },
      { userId: user.id, tokenHash: 'b'.repeat(64), expiresAt: new Date(Date.now() + 60_000) },
    ])
    await send('13800138000', 'reset_password')

    expect((await request(app).post('/api/v1/auth/password/reset').set('Origin', origin)
      .send({ phone: '13800138000', code: testCode, newPassword: 'password-2' })).status).toBe(204)
    expect((await database.db.select().from(sessions).where(eq(sessions.userId, user.id)))
      .every(({ revokedAt }) => revokedAt !== null)).toBe(true)
    expect(await database.db.select().from(auditLogs)).toContainEqual(expect.objectContaining({
      actorUserId: user.id, action: 'auth.password_reset', entityType: 'user', entityId: user.id,
    }))
    expect(JSON.stringify(await database.db.select().from(auditLogs))).not.toMatch(/13800138000|246810|password-[12]/u)
  })
})
