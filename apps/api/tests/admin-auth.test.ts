import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../src/app.js'
import type { AuditEntry } from '../src/modules/audit/audit.repository.js'
import type { AuthTransactionRepository } from '../src/modules/identity/identity.repository.js'

type Role = 'user' | 'admin'
type TestUser = {
  id: string
  displayName: string
  phoneNormalized: string
  passwordHash: string
  role: Role
  disabledAt: Date | null
}
type TestSession = {
  tokenHash: string
  userId: string
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
}

class TestIdentityRepository {
  users: TestUser[] = []
  sessions: TestSession[] = []

  findUserByPhoneNormalized = async (phoneNormalized: string) => (
    this.users.find((user) => user.phoneNormalized === phoneNormalized) ?? null
  )

  findSessionByTokenHash = async (tokenHash: string) => {
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash)
    if (!session) return null
    const user = this.users.find((candidate) => candidate.id === session.userId)
    return user ? { ...session, user } : null
  }

  revokeSessionByTokenHash = async (tokenHash: string, revokedAt: Date) => {
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash)
    if (session && session.revokedAt === null) session.revokedAt = revokedAt
  }
}

class TestAuthTransactionRepository implements AuthTransactionRepository {
  entries: AuditEntry[] = []
  fail = false
  private tail = Promise.resolve()

  constructor(private readonly identity: TestIdentityRepository) {}

  rotateSessionAndAudit = async (rotation: Parameters<AuthTransactionRepository['rotateSessionAndAudit']>[0]) => {
    const previous = this.tail
    let release!: () => void
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await previous
    const previousSessions = this.identity.sessions.map((session) => ({ ...session }))
    try {
      for (const session of this.identity.sessions) {
        if (session.userId === rotation.userId && session.revokedAt === null) session.revokedAt = rotation.revokedAt
      }
      this.identity.sessions.push({
        tokenHash: rotation.tokenHash,
        userId: rotation.userId,
        expiresAt: rotation.expiresAt,
        revokedAt: null,
        createdAt: new Date(),
      })
      if (this.fail) throw new Error('audit unavailable')
      this.entries.push(rotation.audit)
    } catch (error) {
      this.identity.sessions = previousSessions
      throw error
    } finally {
      release()
    }
  }
}

const allowedOrigin = 'https://admin.example'
const sessionCookie = (token: string) => `panshi_session=${token}`
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex')
const cookieHeader = (response: request.Response) => {
  const value = response.headers['set-cookie']
  if (!value) throw new Error('Expected Set-Cookie header')
  return Array.isArray(value) ? value[0]! : value
}

describe('administrator authentication API', () => {
  let passwordHash: string
  let identityRepository: TestIdentityRepository
  let authTransactionRepository: TestAuthTransactionRepository

  beforeAll(async () => {
    passwordHash = await bcrypt.hash('correct horse battery staple', 12)
  })

  beforeEach(() => {
    identityRepository = new TestIdentityRepository()
    authTransactionRepository = new TestAuthTransactionRepository(identityRepository)
    identityRepository.users.push({
      id: 'admin-1',
      displayName: '管理员',
      phoneNormalized: '+8613800138000',
      passwordHash,
      role: 'admin',
      disabledAt: null,
    })
  })

  const app = (secureCookies = false) => createApp({
    checkDatabase: async () => undefined,
    identityRepository,
    authTransactionRepository,
    config: {
      allowedOrigins: [allowedOrigin],
      healthcheckTimeoutMs: 2_000,
      jsonLimitBytes: 1_048_576,
      secureCookies,
      sessionTtlSeconds: 28_800,
    },
  } as Parameters<typeof createApp>[0])

  const login = (password = 'correct horse battery staple') => request(app())
    .post('/api/v1/auth/admin/login')
    .set('Origin', allowedOrigin)
    .send({ phone: '13800138000', password })

  it('returns the same 401 boundary for a wrong password and an unknown phone', async () => {
    const wrongPassword = await login('wrong password')
    const unknownPhone = await request(app())
      .post('/api/v1/auth/admin/login')
      .set('Origin', allowedOrigin)
      .send({ phone: '13900139000', password: 'wrong password' })

    expect(wrongPassword.status).toBe(401)
    expect(unknownPhone.status).toBe(401)
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS')
    expect(unknownPhone.body.error.code).toBe('INVALID_CREDENTIALS')
  })

  it.each([
    'phone=13800138000',
    '01012345678',
    '+86 13800138000',
    '12800138000',
  ])('rejects malformed whole mobile input %s before authentication', async (phone) => {
    const response = await request(app()).post('/api/v1/auth/admin/login').set('Origin', allowedOrigin)
      .send({ phone, password: 'correct horse battery staple' })
    expect(response.status).toBe(400)
    expect(identityRepository.sessions).toHaveLength(0)
  })

  it('rejects passwords beyond the bcrypt byte boundary before authentication', async () => {
    const response = await request(app()).post('/api/v1/auth/admin/login').set('Origin', allowedOrigin)
      .send({ phone: '13800138000', password: 'a'.repeat(73) })
    expect(response.status).toBe(400)
    expect(identityRepository.sessions).toHaveLength(0)
  })

  it('fails safely for malformed and legacy-cost stored bcrypt hashes', async () => {
    for (const storedHash of ['not-a-bcrypt-hash', await bcrypt.hash('correct horse battery staple', 10)]) {
      identityRepository.users[0]!.passwordHash = storedHash
      const response = await login()
      expect(response.status).toBe(401)
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS')
    }
  })

  it('returns 403 when an ordinary user tries the administrator login', async () => {
    identityRepository.users[0]!.role = 'user'
    expect((await login()).status).toBe(403)
  })

  it('enforces the administrator guard for an authenticated ordinary user', async () => {
    identityRepository.users[0]!.role = 'user'
    const token = 'd'.repeat(64)
    identityRepository.sessions.push({
      tokenHash: tokenHash(token),
      userId: 'admin-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: new Date(),
    })

    const response = await request(app())
      .get('/api/v1/me/profile')
      .set('Cookie', sessionCookie(token))
    expect(response.status).toBe(403)
    expect(response.body.error.code).toBe('FORBIDDEN')
  })

  it('returns 403 when a disabled administrator tries to log in', async () => {
    identityRepository.users[0]!.disabledAt = new Date()
    expect((await login()).status).toBe(403)
  })

  it('normalizes a mainland China phone, hashes only the random session token, sets the cookie, and audits login', async () => {
    const response = await login()
    const cookie = cookieHeader(response)
    const token = /^panshi_session=([^;]+)/u.exec(cookie)?.[1]

    expect(response.status).toBe(200)
    expect(response.body).toEqual({
      apiVersion: 'v1',
      data: { user: { id: 'admin-1', displayName: '管理员', role: 'admin' } },
    })
    expect(token).toMatch(/^[a-f0-9]{64}$/u)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).not.toContain('Secure')
    expect(identityRepository.sessions).toHaveLength(1)
    expect(identityRepository.sessions[0]?.tokenHash).toBe(tokenHash(token!))
    expect(identityRepository.sessions[0]?.tokenHash).not.toBe(token)
    expect(identityRepository.sessions[0]?.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(identityRepository.users[0]?.phoneNormalized).toBe('+8613800138000')
    expect(authTransactionRepository.entries).toHaveLength(1)
    expect(authTransactionRepository.entries[0]).toMatchObject({
      actorUserId: 'admin-1',
      action: 'auth.login_succeeded',
      entityType: 'session',
    })
    expect(JSON.stringify(authTransactionRepository.entries)).not.toContain(token)
    expect(JSON.stringify(authTransactionRepository.entries)).not.toContain('correct horse battery staple')
  })

  it('sets Secure only for production cookies', async () => {
    const response = await request(app(true))
      .post('/api/v1/auth/admin/login')
      .set('Origin', allowedOrigin)
      .send({ phone: '+8613800138000', password: 'correct horse battery staple' })
    expect(cookieHeader(response)).toContain('Secure')
  })

  it.each([
    ['unknown', 'a'.repeat(64)],
    ['expired', 'b'.repeat(64)],
    ['revoked', 'c'.repeat(64)],
  ])('returns 401 for an %s session', async (state, token) => {
    if (state !== 'unknown') {
      identityRepository.sessions.push({
        tokenHash: tokenHash(token),
        userId: 'admin-1',
        expiresAt: state === 'expired' ? new Date(Date.now() - 1_000) : new Date(Date.now() + 60_000),
        revokedAt: state === 'revoked' ? new Date() : null,
        createdAt: new Date(),
      })
    }

    const response = await request(app())
      .get('/api/v1/me/profile')
      .set('Cookie', sessionCookie(token))
    expect(response.status).toBe(401)
    expect(response.body.error.code).toBe('UNAUTHORIZED')
  })

  it('returns a typed profile for an active session and rejects it after logout', async () => {
    const agent = request.agent(app())
    const loggedIn = await agent.post('/api/v1/auth/admin/login')
      .set('Origin', allowedOrigin)
      .send({ phone: '13800138000', password: 'correct horse battery staple' })
    const profile = await agent.get('/api/v1/me/profile')
    const loggedOut = await agent.post('/api/v1/auth/admin/logout').set('Origin', allowedOrigin)
    const afterLogout = await agent.get('/api/v1/me/profile')

    expect(loggedIn.status).toBe(200)
    expect(profile.status).toBe(200)
    expect(profile.body.data.user).toEqual({
      id: 'admin-1',
      displayName: '管理员',
      phoneNormalized: '+8613800138000',
      role: 'admin',
    })
    expect(loggedOut.status).toBe(204)
    const cleared = cookieHeader(loggedOut)
    expect(cleared).toContain('panshi_session=')
    expect(cleared).toContain('Path=/')
    expect(cleared).toContain('HttpOnly')
    expect(cleared).toContain('SameSite=Lax')
    expect(afterLogout.status).toBe(401)
  })

  it.each([
    ['missing', undefined, undefined],
    ['unknown', 'e'.repeat(64), undefined],
    ['expired', 'f'.repeat(64), { expiresAt: new Date(0), revokedAt: null }],
    ['revoked', '1'.repeat(64), { expiresAt: new Date(Date.now() + 60_000), revokedAt: new Date() }],
  ])('clears the cookie and returns 204 for a %s logout session', async (_state, token, stored) => {
    if (token && stored) {
      identityRepository.sessions.push({
        tokenHash: tokenHash(token),
        userId: 'admin-1',
        createdAt: new Date(),
        ...stored,
      })
    }

    const call = request(app()).post('/api/v1/auth/admin/logout').set('Origin', allowedOrigin)
    if (token) call.set('Cookie', sessionCookie(token))
    const response = await call

    expect(response.status).toBe(204)
    const cleared = cookieHeader(response)
    expect(cleared).toContain('panshi_session=')
    expect(cleared).toContain('Path=/')
    expect(cleared).toContain('Expires=Thu, 01 Jan 1970 00:00:00 GMT')
    expect(cleared).toContain('HttpOnly')
    expect(cleared).toContain('SameSite=Lax')
    expect(cleared).not.toContain('Secure')
  })

  it('clears an idempotent production logout cookie with matching Secure attributes', async () => {
    const response = await request(app(true)).post('/api/v1/auth/admin/logout').set('Origin', allowedOrigin)
    expect(response.status).toBe(204)
    const cleared = cookieHeader(response)
    expect(cleared).toContain('Path=/')
    expect(cleared).toContain('HttpOnly')
    expect(cleared).toContain('Secure')
    expect(cleared).toContain('SameSite=Lax')
  })

  it('rolls back session rotation when mandatory audit persistence fails', async () => {
    const first = await login()
    const firstToken = /^panshi_session=([^;]+)/u.exec(cookieHeader(first))?.[1]
    if (!firstToken) throw new Error('Missing first login token')
    authTransactionRepository.fail = true

    expect((await login()).status).toBe(500)
    expect(identityRepository.sessions.filter(({ revokedAt }) => revokedAt === null)).toHaveLength(1)
    expect((await request(app()).get('/api/v1/me/profile').set('Cookie', sessionCookie(firstToken))).status).toBe(200)
  })

  it('serializes concurrent same-user rotations so exactly one returned token remains valid', async () => {
    const authApp = app()
    const [first, second] = await Promise.all([
      request(authApp).post('/api/v1/auth/admin/login').set('Origin', allowedOrigin)
        .send({ phone: '13800138000', password: 'correct horse battery staple' }),
      request(authApp).post('/api/v1/auth/admin/login').set('Origin', allowedOrigin)
        .send({ phone: '+8613800138000', password: 'correct horse battery staple' }),
    ])
    const tokens = [first, second].map((response) => /^panshi_session=([^;]+)/u.exec(cookieHeader(response))?.[1])
    if (tokens.some((token) => !token)) throw new Error('Missing concurrent login token')

    expect([first.status, second.status]).toEqual([200, 200])
    expect(identityRepository.sessions.filter(({ revokedAt }) => revokedAt === null)).toHaveLength(1)
    const statuses = await Promise.all(tokens.map(async (token) => {
      const response = await request(authApp).get('/api/v1/me/profile').set('Cookie', sessionCookie(token!))
      return response.status
    }))
    expect(statuses.sort()).toEqual([200, 401])
  })

  it.each([
    ['identity only', true, false],
    ['transaction only', false, true],
    ['neither', false, false],
  ])('does not mount fake auth routes with %s dependencies', async (_label, includeIdentity, includeTransaction) => {
    const dependencies = {
      checkDatabase: async () => undefined,
      ...(includeIdentity ? { identityRepository } : {}),
      ...(includeTransaction ? { authTransactionRepository } : {}),
      config: { allowedOrigins: [allowedOrigin], healthcheckTimeoutMs: 2_000, jsonLimitBytes: 1_048_576 },
    }
    const response = await request(createApp(dependencies)).post('/api/v1/auth/admin/login')
      .set('Origin', allowedOrigin)
      .send({ phone: '13800138000', password: 'correct horse battery staple' })
    expect(response.status).toBe(404)
  })

  it('rejects hostile and missing Origin headers before login or logout writes', async () => {
    const hostileLogin = await request(app())
      .post('/api/v1/auth/admin/login')
      .set('Origin', 'https://evil.example')
      .send({ phone: '13800138000', password: 'correct horse battery staple' })
    const missingLogin = await request(app())
      .post('/api/v1/auth/admin/login')
      .send({ phone: '13800138000', password: 'correct horse battery staple' })
    const hostileLogout = await request(app())
      .post('/api/v1/auth/admin/logout')
      .set('Origin', 'https://evil.example')

    expect(hostileLogin.status).toBe(403)
    expect(missingLogin.status).toBe(403)
    expect(hostileLogout.status).toBe(403)
    expect(identityRepository.sessions).toHaveLength(0)
  })
})
