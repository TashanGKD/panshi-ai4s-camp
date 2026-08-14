import { createHmac, randomInt } from 'node:crypto'
import { normalizeMainlandChinaMobile } from '@panshi/contracts'
import type { StudentIdentityRepository, VerificationPurpose } from './identity.repository.js'
import { hashPassword } from './password.js'
import type { VerificationProvider } from './verification-provider.js'

export type VerificationFailure =
  | 'unavailable'
  | 'rate_limited'
  | 'invalid_code'
  | 'conflict'
  | 'password_reset_failed'

export class VerificationError extends Error {
  constructor(readonly kind: VerificationFailure) {
    super(kind)
    this.name = 'VerificationError'
  }
}

const createCodeHash = (
  secret: string,
  phoneNormalized: string,
  purpose: VerificationPurpose,
  code: string,
) => createHmac('sha256', secret).update(`${phoneNormalized}:${purpose}:${code}`).digest('hex')

export const createVerificationService = (
  repository: StudentIdentityRepository,
  provider: VerificationProvider | undefined,
  options: {
    secret: string
    ttlSeconds: number
    cooldownSeconds: number
    maxAttempts: number
    now?: () => Date
    createCode?: () => string
  },
) => {
  if (Buffer.byteLength(options.secret, 'utf8') < 32) {
    throw new Error('Verification secret must be at least 32 UTF-8 bytes')
  }
  const now = options.now ?? (() => new Date())
  const providerCodeFactory = provider && 'createCode' in provider && typeof provider.createCode === 'function'
    ? provider.createCode as () => string
    : undefined
  const createCode = options.createCode ?? providerCodeFactory ?? (() => randomInt(0, 1_000_000).toString().padStart(6, '0'))

  const normalize = (phone: string) => normalizeMainlandChinaMobile(phone)
  const hashCode = (phoneNormalized: string, purpose: VerificationPurpose, code: string) => (
    createCodeHash(options.secret, phoneNormalized, purpose, code)
  )

  return {
    sendCode: async (phone: string, purpose: VerificationPurpose) => {
      if (!provider) throw new VerificationError('unavailable')
      const phoneNormalized = normalize(phone)
      const code = createCode()
      if (!/^\d{6}$/u.test(code)) throw new Error('Verification provider produced an invalid code')
      const createdAt = now()
      const stored = await repository.storeVerificationCode({
        phoneNormalized,
        purpose,
        codeHash: hashCode(phoneNormalized, purpose, code),
        createdAt,
        expiresAt: new Date(createdAt.getTime() + options.ttlSeconds * 1_000),
        cooldownSeconds: options.cooldownSeconds,
      })
      if (stored === 'rate_limited') throw new VerificationError('rate_limited')
      await provider.sendCode({ phone: phoneNormalized, code, purpose })
    },

    register: async (phone: string, code: string, password: string) => {
      const phoneNormalized = normalize(phone)
      const passwordHash = await hashPassword(password)
      const consumedAt = now()
      const result = await repository.registerStudentWithVerification({
        phoneNormalized,
        purpose: 'register',
        codeHash: hashCode(phoneNormalized, 'register', code),
        consumedAt,
        maxAttempts: options.maxAttempts,
        displayName: '实训营学员',
        passwordHash,
      })
      if (result === 'conflict') throw new VerificationError('conflict')
      if (typeof result === 'string') throw new VerificationError('invalid_code')
      return result.user
    },

    resetPassword: async (phone: string, code: string, newPassword: string) => {
      const phoneNormalized = normalize(phone)
      const passwordHash = await hashPassword(newPassword)
      const result = await repository.resetPasswordWithVerification({
        phoneNormalized,
        purpose: 'reset_password',
        codeHash: hashCode(phoneNormalized, 'reset_password', code),
        consumedAt: now(),
        maxAttempts: options.maxAttempts,
        passwordHash,
      })
      if (result === 'invalid_account') throw new VerificationError('password_reset_failed')
      if (result !== 'reset') throw new VerificationError('invalid_code')
    },
  }
}

export type VerificationService = ReturnType<typeof createVerificationService>
