import { createHash } from 'node:crypto'
import { isNull } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { auditLogs, sessions, users } from '../src/db/schema.js'
import { createIdentityRepository } from '../src/modules/identity/identity.repository.js'
import { hashPassword } from '../src/modules/identity/password.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL
const parsedTestDatabaseUrl = testDatabaseUrl ? new URL(testDatabaseUrl) : undefined
if (!testDatabaseUrl || !parsedTestDatabaseUrl
  || !['postgres:', 'postgresql:'].includes(parsedTestDatabaseUrl.protocol)
  || parsedTestDatabaseUrl.pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}

const database = createDatabaseClient(testDatabaseUrl)
const origin = 'https://admin.example'
const cookieHeader = (response: request.Response) => {
  const value = response.headers['set-cookie'] as unknown as string[] | undefined
  const cookie = value?.[0]
  if (!cookie) throw new Error('Missing session token cookie')
  return cookie
}
const cookieToken = (response: request.Response) => {
  const token = /^panshi_session=([^;]+)/u.exec(cookieHeader(response))?.[1]
  if (!token) throw new Error('Missing session token cookie')
  return token
}

describe('administrator authentication PostgreSQL boundary', () => {
  beforeAll(async () => {
    await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined })
  })

  beforeEach(async () => {
    await database.pool.query('drop trigger if exists test_fail_auth_audit on audit_logs')
    await database.pool.query('drop function if exists test_fail_auth_audit()')
    await database.pool.query('truncate table audit_logs, sessions, users cascade')
    await database.db.insert(users).values({
      displayName: '管理员',
      phoneNormalized: '+8613800138000',
      passwordHash: await hashPassword('integration password'),
      role: 'admin',
    })
  })

  afterAll(async () => database.close())

  const identityRepository = createIdentityRepository(database.db)
  const app = createApp({
    checkDatabase: database.checkHealth,
    identityRepository,
    authTransactionRepository: identityRepository,
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
    const token = cookieToken(login)

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

  it('serializes concurrent login rotations so only the last committed session remains active', async () => {
    const [first, second] = await Promise.all([
      request(app).post('/api/v1/auth/admin/login').set('Origin', origin)
        .send({ phone: '13800138000', password: 'integration password' }),
      request(app).post('/api/v1/auth/admin/login').set('Origin', origin)
        .send({ phone: '+8613800138000', password: 'integration password' }),
    ])
    const tokens = [cookieToken(first), cookieToken(second)]

    expect([first.status, second.status]).toEqual([200, 200])
    expect(await database.db.select().from(sessions).where(isNull(sessions.revokedAt))).toHaveLength(1)
    const statuses = await Promise.all(tokens.map(async (token) => {
      const response = await request(app).get('/api/v1/me/profile').set('Cookie', `panshi_session=${token}`)
      return response.status
    }))
    expect(statuses.sort()).toEqual([200, 401])
  })

  it('rolls back revocation and replacement when the mandatory login audit insert fails', async () => {
    const first = await request(app).post('/api/v1/auth/admin/login').set('Origin', origin)
      .send({ phone: '13800138000', password: 'integration password' })
    const firstToken = cookieToken(first)
    await database.pool.query(`
      create function test_fail_auth_audit() returns trigger language plpgsql as $$
      begin
        if new.action = 'auth.login_succeeded' then raise exception 'test audit failure'; end if;
        return new;
      end
      $$
    `)
    await database.pool.query(`
      create trigger test_fail_auth_audit before insert on audit_logs
      for each row execute function test_fail_auth_audit()
    `)

    let failed: request.Response | undefined
    try {
      failed = await request(app).post('/api/v1/auth/admin/login').set('Origin', origin)
        .send({ phone: '13800138000', password: 'integration password' })
    } finally {
      await database.pool.query('drop trigger if exists test_fail_auth_audit on audit_logs')
      await database.pool.query('drop function if exists test_fail_auth_audit()')
    }

    expect(failed?.status).toBe(500)
    expect(await database.db.select().from(sessions).where(isNull(sessions.revokedAt))).toHaveLength(1)
    expect(await database.db.select().from(auditLogs)).toHaveLength(1)
    expect((await request(app).get('/api/v1/me/profile').set('Cookie', `panshi_session=${firstToken}`)).status).toBe(200)
  })
})
