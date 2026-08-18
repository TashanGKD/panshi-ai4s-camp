import { eq } from 'drizzle-orm'
import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { createDatabaseClient } from '../src/db/client.js'
import { runMigrations } from '../src/db/migrate.js'
import { auditLogs, sessions, users } from '../src/db/schema.js'
import { createIdentityRepository } from '../src/modules/identity/identity.repository.js'
import { hashPassword } from '../src/modules/identity/password.js'

const databaseUrl = process.env.TEST_DATABASE_URL
const parsed = databaseUrl ? new URL(databaseUrl) : undefined
if (!databaseUrl || !parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || parsed.pathname !== '/panshi_ai4s_camp_test') {
  throw new Error('TEST_DATABASE_URL must target exactly panshi_ai4s_camp_test')
}

const database = createDatabaseClient(databaseUrl)
const repository = createIdentityRepository(database.db)
const origin = 'https://camp.example'
const app = createApp({
  checkDatabase: database.checkHealth,
  identityRepository: repository,
  authTransactionRepository: repository,
  config: { allowedOrigins: [origin], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576, sessionTtlSeconds: 28_800 },
})

const loginBody = { phone: '13800138000', password: 'correct horse battery staple' }

describe('CLI authentication PostgreSQL integration', () => {
  beforeAll(async () => {
    await runMigrations({ connect: () => database.pool.connect(), close: async () => undefined })
  })

  beforeEach(async () => {
    await database.pool.query('TRUNCATE audit_logs, sessions, users CASCADE')
    await database.db.insert(users).values({
      displayName: '测试学员',
      phoneNormalized: '+8613800138000',
      passwordHash: await hashPassword(loginBody.password),
      role: 'user',
    })
  })

  afterAll(async () => {
    await database.pool.query('TRUNCATE audit_logs, sessions, users CASCADE')
    await database.close()
  })

  it('keeps Web and latest CLI sessions active independently and persists safe audits', async () => {
    const web = await request(app).post('/api/v1/auth/login').set('Origin', origin).send(loginBody)
    const firstCli = await request(app).post('/api/v1/auth/cli/login').send(loginBody)
    const secondCli = await request(app).post('/api/v1/auth/cli/login').send(loginBody)

    expect(web.status).toBe(200)
    expect(web.headers['set-cookie']).toBeDefined()
    expect(firstCli.status).toBe(200)
    expect(firstCli.headers['set-cookie']).toBeUndefined()
    expect(secondCli.status).toBe(200)

    const storedSessions = await database.db.select().from(sessions)
    const webSessions = storedSessions.filter(({ kind }) => kind === 'web')
    const cliSessions = storedSessions.filter(({ kind }) => kind === 'cli')
    expect(webSessions).toHaveLength(1)
    expect(webSessions[0]?.revokedAt).toBeNull()
    expect(cliSessions).toHaveLength(2)
    expect(cliSessions.filter(({ revokedAt }) => revokedAt === null)).toHaveLength(1)

    const token = secondCli.body.data.token as string
    expect((await request(app).get('/api/v1/me/profile').set('Authorization', `Bearer ${token}`)).status).toBe(200)
    expect((await request(app).post('/api/v1/auth/cli/logout').set('Authorization', `Bearer ${token}`)).status).toBe(204)
    expect((await request(app).get('/api/v1/me/profile').set('Authorization', `Bearer ${token}`)).status).toBe(401)

    const audits = await database.db.select().from(auditLogs).where(eq(auditLogs.entityType, 'session'))
    expect(audits.map(({ action }) => action)).toEqual([
      'auth.login_succeeded',
      'auth.cli_login_succeeded',
      'auth.cli_login_succeeded',
      'auth.cli_logout',
    ])
    const serialized = JSON.stringify(audits)
    expect(serialized).not.toContain(token)
    expect(serialized).not.toContain(loginBody.password)
    expect(serialized).not.toMatch(/cookie/iu)
  })
})
