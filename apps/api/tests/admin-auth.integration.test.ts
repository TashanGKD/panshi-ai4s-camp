import { createHash } from 'node:crypto'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { auditLogs, sessions, users } from '../src/db/schema.js'
import { createAuditRepository } from '../src/modules/audit/audit.repository.js'
import { createIdentityRepository } from '../src/modules/identity/identity.repository.js'
import { hashPassword } from '../src/modules/identity/password.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
if (!testDatabaseUrl || new URL(testDatabaseUrl).pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}

const database = createDatabaseClient(testDatabaseUrl)
const origin = 'https://admin.example'

describe('administrator authentication PostgreSQL boundary', () => {
  beforeAll(async () => {
    await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined })
  })

  beforeEach(async () => {
    await database.pool.query('truncate table audit_logs, sessions, users cascade')
    await database.db.insert(users).values({
      displayName: '管理员',
      phoneNormalized: '+8613800138000',
      passwordHash: await hashPassword('integration password'),
      role: 'admin',
    })
  })

  afterAll(async () => database.close())

  const app = createApp({
    checkDatabase: database.checkHealth,
    identityRepository: createIdentityRepository(database.db),
    auditRepository: createAuditRepository(database.db),
    config: {
      allowedOrigins: [origin],
      healthcheckTimeoutMs: 2_000,
      jsonLimitBytes: 1_048_576,
      secureCookies: false,
      sessionTtlSeconds: 28_800,
    },
  })

  it('persists only a SHA-256 session hash, resolves profile, audits login, and revokes logout', async () => {
    const agent = request.agent(app)
    const login = await agent.post('/api/v1/auth/admin/login')
      .set('Origin', origin)
      .send({ phone: '13800138000', password: 'integration password' })
    const cookie = (login.headers['set-cookie'] as unknown as string[])[0]!
    const token = /^panshi_session=([^;]+)/u.exec(cookie)?.[1]
    if (!token) throw new Error('Missing session token cookie')

    const [storedSession] = await database.db.select().from(sessions)
    const storedAudit = await database.db.select().from(auditLogs)
    expect(storedSession?.tokenHash).toBe(createHash('sha256').update(token).digest('hex'))
    expect(storedSession?.tokenHash).not.toBe(token)
    expect(JSON.stringify(storedAudit)).not.toContain(token)
    expect(storedAudit).toHaveLength(1)
    expect((await agent.get('/api/v1/me/profile')).status).toBe(200)

    expect((await agent.post('/api/v1/auth/admin/logout').set('Origin', origin)).status).toBe(204)
    const [revoked] = await database.db.select().from(sessions)
    expect(revoked?.revokedAt).toBeInstanceOf(Date)
    expect((await agent.get('/api/v1/me/profile')).status).toBe(401)
  })
})
