import { createHash, randomBytes } from 'node:crypto'
import type { AuthenticatedUser } from '@panshi/contracts'
import type { AuditService } from '../audit/audit.service.js'
import type { IdentityRepository, IdentityUser } from './identity.repository.js'
import { DUMMY_PASSWORD_HASH, normalizeMainlandChinaPhone, verifyPassword } from './password.js'

export const SESSION_COOKIE_NAME = 'panshi_session'

export class AuthenticationError extends Error {
  constructor(readonly kind: 'invalid_credentials' | 'unauthorized' | 'forbidden') {
    super(kind)
    this.name = 'AuthenticationError'
  }
}

export const hashSessionToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export type AuthenticatedSessionUser = IdentityUser

export type SessionService = ReturnType<typeof createSessionService>

export const createSessionService = (
  repository: IdentityRepository,
  audit: AuditService,
  options: { sessionTtlSeconds: number, now?: () => Date, createToken?: () => Buffer },
) => {
  const now = options.now ?? (() => new Date())
  const createToken = options.createToken ?? (() => randomBytes(32))

  return {
    loginAdmin: async (phoneInput: string, password: string) => {
      let phoneNormalized: string | undefined
      try {
        phoneNormalized = normalizeMainlandChinaPhone(phoneInput)
      } catch {
        // Continue through the same dummy hash path as an unknown account.
      }

      const user = phoneNormalized
        ? await repository.findUserByPhoneNormalized(phoneNormalized)
        : null
      const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
      if (!user || !passwordMatches) throw new AuthenticationError('invalid_credentials')
      if (user.role !== 'admin' || user.disabledAt !== null) throw new AuthenticationError('forbidden')

      const issuedAt = now()
      await repository.revokeActiveSessionsForUser(user.id, issuedAt)
      const token = createToken().toString('hex')
      const expiresAt = new Date(issuedAt.getTime() + options.sessionTtlSeconds * 1_000)
      await repository.createSession({ tokenHash: hashSessionToken(token), userId: user.id, expiresAt })
      await audit.record({
        actorUserId: user.id,
        action: 'auth.login_succeeded',
        entityType: 'session',
        metadata: { authenticationMethod: 'password' },
      })

      const publicUser: AuthenticatedUser = {
        id: user.id,
        displayName: user.displayName,
        role: user.role,
      }
      return { token, expiresAt, user: publicUser }
    },

    resolve: async (token: string | undefined): Promise<AuthenticatedSessionUser> => {
      if (!token) throw new AuthenticationError('unauthorized')
      const session = await repository.findSessionByTokenHash(hashSessionToken(token))
      if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= now().getTime()) {
        throw new AuthenticationError('unauthorized')
      }
      return session.user
    },

    logout: async (token: string | undefined) => {
      if (!token) throw new AuthenticationError('unauthorized')
      const session = await repository.findSessionByTokenHash(hashSessionToken(token))
      if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= now().getTime()) {
        throw new AuthenticationError('unauthorized')
      }
      await repository.revokeSessionByTokenHash(hashSessionToken(token), now())
    },
  }
}
