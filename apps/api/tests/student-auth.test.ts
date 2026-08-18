import { createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp } from '../src/app.js'
import type { AuditEntry } from '../src/modules/audit/audit.repository.js'
import type {
  AuthTransactionRepository,
  IdentityRepository,
  StudentIdentityRepository,
  VerificationPurpose,
} from '../src/modules/identity/identity.repository.js'
import { createMockVerificationProvider } from '../src/modules/identity/mock-verification-provider.js'
import type { VerificationProvider } from '../src/modules/identity/verification-provider.js'
import { createVerificationService } from '../src/modules/identity/verification.service.js'

type TestUser = {
  id: string
  displayName: string
  phoneNormalized: string
  passwordHash: string
  role: 'user' | 'admin'
  disabledAt: Date | null
}

type TestSession = {
  tokenHash: string
  userId: string
  expiresAt: Date
  revokedAt: Date | null
}

type TestCode = {
  id: string
  phoneNormalized: string
  purpose: VerificationPurpose
  codeHash: string
  deliveryState: 'pending' | 'sent' | 'failed'
  expiresAt: Date
  failedAttempts: number
  consumedAt: Date | null
  createdAt: Date
}

const origin = 'https://camp.example'
const now = new Date('2026-08-15T00:00:00.000Z')
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

class TestRepository implements IdentityRepository, AuthTransactionRepository, StudentIdentityRepository {
  users: TestUser[] = []
  sessions: TestSession[] = []
  codes: TestCode[] = []
  audits: AuditEntry[] = []
  nextUser = 1
  nextCode = 1

  findUserByPhoneNormalized = async (phoneNormalized: string) => (
    this.users.find((user) => user.phoneNormalized === phoneNormalized) ?? null
  )

  findSessionByTokenHash = async (tokenHash: string) => {
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash)
    const user = this.users.find((candidate) => candidate.id === session?.userId)
    return session && user ? { ...session, user } : null
  }

  revokeSessionByTokenHash = async (tokenHash: string, revokedAt: Date) => {
    const session = this.sessions.find((candidate) => candidate.tokenHash === tokenHash)
    if (session && session.revokedAt === null) session.revokedAt = revokedAt
  }

  rotateSessionAndAudit = async (input: Parameters<AuthTransactionRepository['rotateSessionAndAudit']>[0]) => {
    for (const session of this.sessions) {
      if (session.userId === input.userId && session.revokedAt === null) session.revokedAt = input.revokedAt
    }
    this.sessions.push({
      tokenHash: input.tokenHash,
      userId: input.userId,
      expiresAt: input.expiresAt,
      revokedAt: null,
    })
    this.audits.push(input.audit)
  }

  revokeSessionAndAudit = async (input: Parameters<AuthTransactionRepository['revokeSessionAndAudit']>[0]) => {
    await this.revokeSessionByTokenHash(input.tokenHash, input.revokedAt)
    this.audits.push(input.audit)
  }

  storeVerificationCode = async (input: Parameters<StudentIdentityRepository['storeVerificationCode']>[0]) => {
    const latest = [...this.codes]
      .filter(({ phoneNormalized, deliveryState }) => (
        phoneNormalized === input.phoneNormalized && deliveryState !== 'failed'
      ))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    if (latest && input.createdAt.getTime() - latest.createdAt.getTime() < input.cooldownSeconds * 1_000) {
      return 'rate_limited' as const
    }
    this.codes.push({
      id: `code-${this.nextCode++}`,
      phoneNormalized: input.phoneNormalized,
      purpose: input.purpose,
      codeHash: input.codeHash,
      deliveryState: 'pending',
      expiresAt: input.expiresAt,
      failedAttempts: 0,
      consumedAt: null,
      createdAt: input.createdAt,
    })
    return { status: 'stored' as const, id: this.codes.at(-1)!.id }
  }

  setVerificationDeliveryState = async (input: Parameters<StudentIdentityRepository['setVerificationDeliveryState']>[0]) => {
    const record = this.codes.find((candidate) => (
      candidate.id === input.id
      && candidate.phoneNormalized === input.phoneNormalized
      && candidate.purpose === input.purpose
      && candidate.deliveryState === 'pending'
    ))
    if (!record) return 'not_pending' as const
    record.deliveryState = input.deliveryState
    return 'updated' as const
  }

  registerStudentWithVerification = async (input: Parameters<StudentIdentityRepository['registerStudentWithVerification']>[0]) => {
    const verified = this.consume(input)
    if (verified !== 'verified') return verified
    if (this.users.some(({ phoneNormalized }) => phoneNormalized === input.phoneNormalized)) return 'conflict' as const
    const user = {
      id: `user-${this.nextUser++}`,
      displayName: input.displayName,
      phoneNormalized: input.phoneNormalized,
      passwordHash: await input.createPasswordHash(),
      role: 'user' as const,
      disabledAt: null,
    }
    this.users.push(user)
    this.audits.push({ actorUserId: user.id, action: 'auth.student_registered', entityType: 'user', entityId: user.id, metadata: {} })
    return { status: 'created' as const, user }
  }

  resetPasswordWithVerification = async (input: Parameters<StudentIdentityRepository['resetPasswordWithVerification']>[0]) => {
    const verified = this.consume(input)
    if (verified !== 'verified') return verified
    const user = this.users.find(({ phoneNormalized }) => phoneNormalized === input.phoneNormalized)
    if (!user || user.role !== 'user' || user.disabledAt !== null) return 'invalid_account' as const
    user.passwordHash = await input.createPasswordHash()
    for (const session of this.sessions) {
      if (session.userId === user.id && session.revokedAt === null) session.revokedAt = input.consumedAt
    }
    this.audits.push({
      actorUserId: user.id,
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: user.id,
      metadata: { revokedSessions: true },
    })
    return 'reset' as const
  }

  private consume(input: {
    phoneNormalized: string
    purpose: VerificationPurpose
    codeHash: string
    consumedAt: Date
    maxAttempts: number
  }) {
    const record = [...this.codes]
      .filter(({ phoneNormalized, purpose, deliveryState }) => (
        phoneNormalized === input.phoneNormalized && purpose === input.purpose && deliveryState === 'sent'
      ))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
    if (!record) return 'invalid_code' as const
    if (record.consumedAt) return 'consumed' as const
    if (record.expiresAt.getTime() <= input.consumedAt.getTime()) return 'expired' as const
    if (record.failedAttempts >= input.maxAttempts) return 'attempts_exceeded' as const
    if (record.codeHash !== input.codeHash) {
      record.failedAttempts += 1
      return record.failedAttempts >= input.maxAttempts ? 'attempts_exceeded' as const : 'invalid_code' as const
    }
    record.consumedAt = input.consumedAt
    return 'verified' as const
  }
}

describe('student phone authentication', () => {
  let repository: TestRepository
  let sentCodes: Array<{ phone: string, code: string, purpose: VerificationPurpose }>
  let currentTime: Date

  beforeEach(() => {
    repository = new TestRepository()
    sentCodes = []
    currentTime = new Date(now)
  })

  const app = (options: { providerEnabled?: boolean, maxAttempts?: number, provider?: VerificationProvider, loginFailureMax?: number } = {}) => {
    const provider = options.provider ?? (options.providerEnabled === false
      ? undefined
      : createMockVerificationProvider({
        code: '246810',
        logger: (message) => sentCodes.push(message),
      }))
    const verificationService = createVerificationService(repository, provider, {
      secret: 'ab'.repeat(32),
      ttlSeconds: 300,
      cooldownSeconds: 60,
      maxAttempts: options.maxAttempts ?? 3,
      now: () => new Date(currentTime),
    })
    return createApp({
      checkDatabase: async () => undefined,
      identityRepository: repository,
      authTransactionRepository: repository,
      studentIdentityRepository: repository,
      verificationService,
      config: {
        allowedOrigins: [origin],
        healthcheckTimeoutMs: 2_000,
        jsonLimitBytes: 1_048_576,
        sessionTtlSeconds: 28_800,
        ...(options.loginFailureMax ? { rateLimits: { login_failure: { max: options.loginFailureMax, windowMs: 60_000 } } } : {}),
      },
    })
  }

  const sendCode = (authApp: ReturnType<typeof app>, phone = '13800138000', purpose: VerificationPurpose = 'register') => request(authApp)
    .post('/api/v1/auth/verification/send')
    .set('Origin', origin)
    .send({ phone, purpose })

  it('requires a 64-character hexadecimal HMAC secret', () => {
    expect(() => createVerificationService(repository, undefined, {
      secret: 'g'.repeat(64), ttlSeconds: 300, cooldownSeconds: 60, maxAttempts: 3,
    })).toThrow('64 hexadecimal characters')
  })

  it('rejects malformed phones before sending', async () => {
    const response = await sendCode(app(), 'phone=13800138000')
    expect(response.status).toBe(400)
    expect(sentCodes).toHaveLength(0)
  })

  it('stores only a keyed code hash and rate limits repeated sends per phone', async () => {
    const authApp = app()
    expect((await sendCode(authApp)).status).toBe(204)
    const repeated = await sendCode(authApp, '+8613800138000', 'reset_password')

    expect(repeated.status).toBe(429)
    expect(repeated.body.error.code).toBe('VERIFICATION_RATE_LIMITED')
    expect(repository.codes[0]?.codeHash).toMatch(/^[a-f0-9]{64}$/u)
    expect(repository.codes[0]?.codeHash).not.toBe(createHash('sha256').update('246810').digest('hex'))
    expect(JSON.stringify(repository.codes)).not.toContain('246810')
  })

  it('returns 503 without an enabled provider and never returns a code', async () => {
    const response = await sendCode(app({ providerEnabled: false }))
    expect(response.status).toBe(503)
    expect(response.body.error.code).toBe('VERIFICATION_UNAVAILABLE')
    expect(JSON.stringify(response.body)).not.toMatch(/246810|codeHash/u)
  })

  it('marks rejected deliveries unusable and permits an immediate retry', async () => {
    let rejectDelivery = true
    const provider = {
      createCode: () => '246810',
      sendCode: async () => {
        if (rejectDelivery) throw new Error('provider rejected delivery')
      },
    }
    const authApp = app({ provider })

    const rejected = await sendCode(authApp)
    expect(rejected.status).toBe(503)
    expect(rejected.body.error.code).toBe('VERIFICATION_UNAVAILABLE')
    expect((await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-1' })).status).toBe(400)

    rejectDelivery = false
    expect((await sendCode(authApp)).status).toBe(204)
  })

  it('does not let a failed delivery shadow the latest sent code', async () => {
    let code = '246810'
    let rejectDelivery = false
    const provider = {
      createCode: () => code,
      sendCode: async () => {
        if (rejectDelivery) throw new Error('provider rejected delivery')
      },
    }
    const authApp = app({ provider })
    expect((await sendCode(authApp)).status).toBe(204)

    currentTime = new Date(now.getTime() + 61_000)
    code = '135790'
    rejectDelivery = true
    expect((await sendCode(authApp)).status).toBe(503)
    expect((await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-1' })).status).toBe(201)
  })

  it('does not accept a code issued for a different purpose', async () => {
    const authApp = app()
    await sendCode(authApp, '13800138000', 'reset_password')
    const response = await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-1' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('VERIFICATION_INVALID')
    expect(repository.users).toHaveLength(0)
  })

  it('does not hash a password before a verification record is accepted', async () => {
    const hash = vi.spyOn(bcrypt, 'hash')
    const response = await request(app()).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-1' })

    expect(response.status).toBe(400)
    expect(hash).not.toHaveBeenCalled()
  })

  it('skips password hashing for every rejected registration and reset state', async () => {
    const hash = vi.spyOn(bcrypt, 'hash')
    const attemptRegister = async (configure: (testRepository: TestRepository) => void) => {
      repository = new TestRepository()
      const authApp = app({ maxAttempts: 2 })
      await sendCode(authApp)
      configure(repository)
      return request(authApp).post('/api/v1/auth/register').set('Origin', origin)
        .send({ phone: '13800138000', code: '246810', password: 'password-1' })
    }

    repository = new TestRepository()
    expect((await request(app()).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-1' })).status).toBe(400)
    expect((await attemptRegister((candidate) => { candidate.codes[0]!.codeHash = 'wrong' })).status).toBe(400)
    expect((await attemptRegister((candidate) => { candidate.codes[0]!.expiresAt = new Date(now.getTime() - 1) })).status).toBe(400)
    expect((await attemptRegister((candidate) => { candidate.codes[0]!.consumedAt = now })).status).toBe(400)
    expect((await attemptRegister((candidate) => { candidate.codes[0]!.failedAttempts = 2 })).status).toBe(400)
    expect((await attemptRegister((candidate) => {
      candidate.users.push({
        id: 'existing', displayName: '已有学员', phoneNormalized: '+8613800138000',
        passwordHash: 'existing-hash', role: 'user', disabledAt: null,
      })
    })).status).toBe(409)

    const attemptReset = async (role: 'user' | 'admin', disabledAt: Date | null) => {
      repository = new TestRepository()
      repository.users.push({
        id: 'target', displayName: '目标账号', phoneNormalized: '+8613800138000',
        passwordHash: 'existing-hash', role, disabledAt,
      })
      const authApp = app()
      await sendCode(authApp, '13800138000', 'reset_password')
      return request(authApp).post('/api/v1/auth/password/reset').set('Origin', origin)
        .send({ phone: '13800138000', code: '246810', newPassword: 'password-2' })
    }
    expect((await attemptReset('admin', null)).body.error.code).toBe('PASSWORD_RESET_FAILED')
    expect((await attemptReset('user', now)).body.error.code).toBe('PASSWORD_RESET_FAILED')
    expect(hash).not.toHaveBeenCalled()
  })

  it('rejects wrong purpose, wrong codes, exhausted attempts, expired codes, and consumed codes', async () => {
    const authApp = app({ maxAttempts: 2 })
    await sendCode(authApp)

    const wrongPurpose = await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-1', purpose: 'reset_password' })
    expect(wrongPurpose.status).toBe(400)

    const wrong = await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '111111', password: 'password-1' })
    const exhausted = await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '222222', password: 'password-1' })
    expect(wrong.status).toBe(400)
    expect(exhausted.status).toBe(400)
    expect(exhausted.body.error.code).toBe('VERIFICATION_INVALID')

    repository.codes[0]!.failedAttempts = 0
    repository.codes[0]!.expiresAt = new Date(now.getTime() - 1)
    const expired = await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-1' })
    expect(expired.status).toBe(400)

    repository.codes[0]!.expiresAt = new Date(now.getTime() + 60_000)
    repository.codes[0]!.consumedAt = null
    expect((await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-1' })).status).toBe(201)
    expect((await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-2' })).status).toBe(400)
  })

  it('registers a unique student with a non-identifying default name', async () => {
    const authApp = app()
    await sendCode(authApp)
    const registered = await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-1' })

    expect(registered.status).toBe(201)
    expect(registered.headers['set-cookie']).toBeUndefined()
    expect(registered.body.data.user).toMatchObject({ role: 'user', displayName: '实训营学员' })
    expect(registered.body.data.user).not.toHaveProperty('phoneNormalized')
    expect(await bcrypt.compare('password-1', repository.users[0]!.passwordHash)).toBe(true)
    expect(repository.users[0]!.displayName).not.toContain('13800138000')

    currentTime = new Date(now.getTime() + 61_000)
    await sendCode(authApp)
    const duplicate = await request(authApp).post('/api/v1/auth/register').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', password: 'password-2' })
    expect(duplicate.status).toBe(409)
    expect(duplicate.body.error.code).toBe('ACCOUNT_EXISTS')
    currentTime = new Date(now)
  })

  it('logs students in with a secure rotating cookie without admitting them to admin', async () => {
    repository.users.push({
      id: 'student-1', displayName: '学员', phoneNormalized: '+8613800138000',
      passwordHash: await bcrypt.hash('password-1', 12), role: 'user', disabledAt: null,
    })
    const authApp = app()
    const agent = request.agent(authApp)
    const login = await agent.post('/api/v1/auth/login').set('Origin', origin)
      .send({ phone: '13800138000', password: 'password-1' })
    const profile = await agent.get('/api/v1/me/profile')
    const adminSummary = await agent.get('/api/v1/admin/summary')

    expect(login.status).toBe(200)
    expect(login.headers['set-cookie']?.[0]).toMatch(/HttpOnly.*SameSite=Lax/u)
    expect(profile.status).toBe(200)
    expect(profile.body.data.user).toMatchObject({ id: 'student-1', role: 'user', phoneNormalized: '+8613800138000' })
    expect(adminSummary.status).toBe(404)
  })

  it('uses one credential error for unknown, wrong-password, disabled, and admin student-login attempts', async () => {
    repository.users.push({
      id: 'student-1', displayName: '学员', phoneNormalized: '+8613800138000',
      passwordHash: await bcrypt.hash('password-1', 12), role: 'user', disabledAt: null,
    })
    const authApp = app()
    const attempt = (phone: string, password: string) => request(authApp).post('/api/v1/auth/login')
      .set('Origin', origin).send({ phone, password })

    const wrong = await attempt('13800138000', 'password-x')
    const unknown = await attempt('13900139000', 'password-x')
    repository.users[0]!.disabledAt = new Date()
    const disabled = await attempt('13800138000', 'password-1')
    repository.users[0]!.disabledAt = null
    repository.users[0]!.role = 'admin'
    const admin = await attempt('13800138000', 'password-1')

    expect([wrong, unknown, disabled, admin].map(({ status }) => status)).toEqual([401, 401, 401, 401])
    expect(new Set([wrong, unknown, disabled, admin].map(({ body }) => body.error.code))).toEqual(new Set(['INVALID_CREDENTIALS']))
  })

  it('rate-limits login failures per hashed account actor and resets that actor on success', async () => {
    repository.users.push({
      id: 'student-1', displayName: '学员', phoneNormalized: '+8613800138000',
      passwordHash: await bcrypt.hash('password-1', 12), role: 'user', disabledAt: null,
    })
    const authApp = app({ loginFailureMax: 2 })
    const attempt = (password: string) => request(authApp).post('/api/v1/auth/login').set('Origin', origin)
      .send({ phone: '13800138000', password })

    await attempt('password-x').expect(401)
    await attempt('password-1').expect(200)
    await attempt('password-x').expect(401)
    await attempt('password-x').expect(401)
    const blocked = await attempt('password-1').expect(429)
    expect(blocked.body.error.code).toBe('LOGIN_RATE_LIMITED')
    expect(blocked.headers['retry-after']).toBe('60')
    expect(blocked.headers['cache-control']).toBe('private, no-store')
    expect(JSON.stringify(blocked.body)).not.toContain('13800138000')
  })

  it('resets a password, atomically consumes the code, revokes every old session, and writes a redacted audit', async () => {
    repository.users.push({
      id: 'student-1', displayName: '学员', phoneNormalized: '+8613800138000',
      passwordHash: await bcrypt.hash('password-1', 12), role: 'user', disabledAt: null,
    })
    repository.sessions.push(
      { tokenHash: hashToken('old-a'), userId: 'student-1', expiresAt: new Date(now.getTime() + 60_000), revokedAt: null },
      { tokenHash: hashToken('old-b'), userId: 'student-1', expiresAt: new Date(now.getTime() + 60_000), revokedAt: null },
    )
    const authApp = app()
    await sendCode(authApp, '13800138000', 'reset_password')
    const reset = await request(authApp).post('/api/v1/auth/password/reset').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', newPassword: 'password-2' })

    expect(reset.status).toBe(204)
    expect(repository.sessions.every(({ revokedAt }) => revokedAt !== null)).toBe(true)
    expect(await bcrypt.compare('password-2', repository.users[0]!.passwordHash)).toBe(true)
    expect(repository.audits.at(-1)).toMatchObject({
      actorUserId: 'student-1', action: 'auth.password_reset', entityType: 'user', entityId: 'student-1',
    })
    expect(JSON.stringify(repository.audits)).not.toMatch(/13800138000|246810|password-[12]/u)
    expect((await request(authApp).post('/api/v1/auth/password/reset').set('Origin', origin)
      .send({ phone: '13800138000', code: '246810', newPassword: 'password-3' })).status).toBe(400)
  })

  it('does not expose account existence while sending reset codes or in reset failures', async () => {
    const authApp = app()
    expect((await sendCode(authApp, '13900139000', 'reset_password')).status).toBe(204)
    const response = await request(authApp).post('/api/v1/auth/password/reset').set('Origin', origin)
      .send({ phone: '13900139000', code: '246810', newPassword: 'password-2' })
    expect(response.status).toBe(400)
    expect(response.body.error.code).toBe('PASSWORD_RESET_FAILED')
    expect(JSON.stringify(response.body)).not.toMatch(/不存在|not.?found|13900139000/iu)
  })
})
