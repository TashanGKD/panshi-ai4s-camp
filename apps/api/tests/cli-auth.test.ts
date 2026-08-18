import { createHash } from 'node:crypto'
import express from 'express'
import bcrypt from 'bcryptjs'
import cookieParser from 'cookie-parser'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import { errorHandler } from '../src/middleware/error-handler.js'
import { createRequireUser } from '../src/middleware/require-user.js'
import { requireAdmin } from '../src/middleware/require-admin.js'
import { prepareAuditEntry, sensitiveAuditText, type AuditEntry } from '../src/modules/audit/audit-policy.js'
import type { AuthTransactionRepository, IdentityRepository } from '../src/modules/identity/identity.repository.js'
import { createSessionService, type SessionKind } from '../src/modules/identity/session.service.js'

type TestUser = {
  id: string
  displayName: string
  phoneNormalized: string
  passwordHash: string
  role: 'user' | 'admin'
  disabledAt: Date | null
  passwordResetRequiredAt: Date | null
}

type TestSession = {
  tokenHash: string
  userId: string
  kind: SessionKind
  expiresAt: Date
  revokedAt: Date | null
}

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')
const origin = 'https://camp.example'

class TestRepository implements IdentityRepository, AuthTransactionRepository {
  users: TestUser[] = []
  sessions: TestSession[] = []
  audits: AuditEntry[] = []

  findUserByPhoneNormalized = async (phoneNormalized: string) => this.users.find((user) => user.phoneNormalized === phoneNormalized) ?? null

  findSessionByTokenHash = async (tokenHash: string) => {
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash)
    const user = this.users.find((candidate) => candidate.id === session?.userId)
    return session && user ? { ...session, user } : null
  }

  revokeSessionByTokenHash = async (tokenHash: string, revokedAt: Date) => {
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash)
    if (session && session.revokedAt === null) session.revokedAt = revokedAt
  }

  revokeSessionAndAudit = async (input: Parameters<NonNullable<AuthTransactionRepository['revokeSessionAndAudit']>>[0]) => {
    await this.revokeSessionByTokenHash(input.tokenHash, input.revokedAt)
    this.audits.push(input.audit)
  }

  rotateSessionAndAudit = async (input: Parameters<AuthTransactionRepository['rotateSessionAndAudit']>[0]) => {
    for (const session of this.sessions) {
      if (session.userId === input.userId && session.kind === input.kind && session.revokedAt === null) {
        session.revokedAt = input.revokedAt
      }
    }
    this.sessions.push({
      tokenHash: input.tokenHash,
      userId: input.userId,
      kind: input.kind,
      expiresAt: input.expiresAt,
      revokedAt: null,
    })
    this.audits.push(input.audit)
  }
}

describe('CLI-scoped authentication', () => {
  let repository: TestRepository
  let passwordHash: string

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('correct horse battery staple', 12)
  })

  beforeEach(() => {
    repository = new TestRepository()
    repository.users.push({
      id: '10000000-0000-4000-8000-000000000001',
      displayName: '测试学员',
      phoneNormalized: '+8613800138000',
      passwordHash,
      role: 'user',
      disabledAt: null,
      passwordResetRequiredAt: null,
    })
  })

  const app = () => createApp({
    checkDatabase: async () => undefined,
    identityRepository: repository,
    authTransactionRepository: repository,
    config: {
      allowedOrigins: [origin],
      healthcheckTimeoutMs: 2_000,
      jsonLimitBytes: 1_048_576,
      sessionTtlSeconds: 28_800,
    },
  })

  const cliLogin = () => request(app()).post('/api/v1/auth/cli/login')
    .send({ phone: '13800138000', password: 'correct horse battery staple' })

  it.each([
    'Bearer',
    'Bearer ',
    'bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    'Bearer ABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD',
    'Bearer short',
    'Basic YTpi',
    'Bearer aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa extra',
  ])('rejects malformed bearer authorization %j', async (authorization) => {
    const response = await request(app()).get('/api/v1/me/profile').set('Authorization', authorization)
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('fails closed when both cookie and bearer credentials are supplied', async () => {
    const token = 'a'.repeat(64)
    repository.sessions.push({ tokenHash: hashToken(token), userId: repository.users[0]!.id, kind: 'web', expiresAt: new Date(Date.now() + 60_000), revokedAt: null })
    const response = await request(app()).get('/api/v1/me/profile')
      .set('Cookie', `panshi_session=${token}`)
      .set('Authorization', `Bearer ${'b'.repeat(64)}`)
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('AUTH_CREDENTIALS_AMBIGUOUS')
  })

  it('returns a no-store bearer token without setting a cookie or leaking it into audit metadata', async () => {
    const response = await cliLogin()
    expect(response.status, JSON.stringify(response.body)).toBe(200)
    expect(response.headers['cache-control']).toContain('no-store')
    expect(response.headers['set-cookie']).toBeUndefined()
    expect(response.body.data.token).toMatch(/^[a-f0-9]{64}$/u)
    expect(response.body.data.expiresAt).toMatch(/Z$/u)
    expect(repository.sessions[0]?.kind).toBe('cli')
    expect(repository.audits).toEqual([expect.objectContaining({
      action: 'auth.cli_login_succeeded',
      metadata: { clientKind: 'cli' },
    })])
    const auditText = JSON.stringify(repository.audits)
    expect(auditText).not.toContain(response.body.data.token)
    expect(auditText).not.toContain('correct horse battery staple')
    expect(auditText).not.toMatch(/cookie/iu)
  })

  it('keeps the active Web session while rotating only the previous CLI session', async () => {
    const web = await request(app()).post('/api/v1/auth/login').set('Origin', origin)
      .send({ phone: '13800138000', password: 'correct horse battery staple' })
    expect(web.status).toBe(200)
    expect(repository.sessions.filter(({ revokedAt }) => revokedAt === null).map(({ kind }) => kind)).toEqual(['web'])

    const firstCli = await cliLogin()
    expect(firstCli.status, JSON.stringify(firstCli.body)).toBe(200)
    const secondCli = await cliLogin()
    expect(secondCli.status).toBe(200)

    const webSessions = repository.sessions.filter(({ kind }) => kind === 'web')
    const cliSessions = repository.sessions.filter(({ kind }) => kind === 'cli')
    expect(webSessions).toHaveLength(1)
    expect(webSessions[0]?.revokedAt).toBeNull()
    expect(cliSessions).toHaveLength(2)
    expect(cliSessions[0]?.revokedAt).toBeInstanceOf(Date)
    expect(cliSessions[1]?.revokedAt).toBeNull()
  })

  it('revokes a CLI bearer token on logout and rejects reuse', async () => {
    const login = await cliLogin()
    const token = login.body.data.token as string
    const logout = await request(app()).post('/api/v1/auth/cli/logout').set('Authorization', `Bearer ${token}`)
    expect(logout.status).toBe(204)
    expect(repository.audits.at(-1)).toMatchObject({ action: 'auth.cli_logout', metadata: { clientKind: 'cli' } })
    const profile = await request(app()).get('/api/v1/me/profile').set('Authorization', `Bearer ${token}`)
    expect(profile.status).toBe(401)
  })

  it('rejects expired and disabled-account CLI sessions', async () => {
    for (const scenario of ['expired', 'disabled'] as const) {
      const token = scenario === 'expired' ? 'c'.repeat(64) : 'd'.repeat(64)
      repository.sessions.push({
        tokenHash: hashToken(token), userId: repository.users[0]!.id, kind: 'cli',
        expiresAt: scenario === 'expired' ? new Date(Date.now() - 1) : new Date(Date.now() + 60_000), revokedAt: null,
      })
      repository.users[0]!.disabledAt = scenario === 'disabled' ? new Date() : null
      const response = await request(app()).get('/api/v1/me/profile').set('Authorization', `Bearer ${token}`)
      expect(response.status).toBe(scenario === 'disabled' ? 403 : 401)
    }
  })

  it('does not accept a user CLI token on an admin-only route', async () => {
    const login = await cliLogin()
    const sessions = createSessionService(repository, repository, { sessionTtlSeconds: 60 })
    const protectedApp = express()
    protectedApp.use(cookieParser())
    protectedApp.get('/admin', createRequireUser(sessions), requireAdmin, (_request, response) => response.json({ ok: true }))
    protectedApp.use(errorHandler)
    const response = await request(protectedApp).get('/admin').set('Authorization', `Bearer ${login.body.data.token}`)
    expect(response.status).toBe(403)
  })

  it('keeps CLI audit definitions strict and rejects common secret-bearing text', () => {
    expect(prepareAuditEntry({
      actorUserId: repository.users[0]!.id,
      action: 'auth.cli_login_succeeded',
      entityType: 'session',
      entityId: null,
      metadata: { clientKind: 'cli' },
    })).toBeTruthy()
    for (const secret of ['token', 'cookie', 'password', 'a'.repeat(64)]) {
      expect(sensitiveAuditText(secret)).toBe(true)
    }
    expect(() => prepareAuditEntry({
      actorUserId: repository.users[0]!.id,
      action: 'auth.cli_login_succeeded',
      entityType: 'session',
      entityId: null,
      metadata: { clientKind: 'cli', token: 'a'.repeat(64) },
    })).toThrow()
  })
})
