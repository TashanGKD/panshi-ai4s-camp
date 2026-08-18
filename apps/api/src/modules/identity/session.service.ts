import { createHash, randomBytes } from 'node:crypto'
import { normalizeMainlandChinaMobile, type AuthenticatedUser } from '@panshi/contracts'
import { SessionRotationRejectedError, type AuthTransactionRepository, type IdentityRepository, type IdentityUser, type SessionKind } from './identity.repository.js'
import { DUMMY_PASSWORD_HASH, verifyPassword } from './password.js'

export const SESSION_COOKIE_NAME = 'panshi_session'

export class AuthenticationError extends Error {
  constructor(readonly kind: 'invalid_credentials' | 'unauthorized' | 'forbidden' | 'account_disabled') {
    super(kind)
    this.name = 'AuthenticationError'
  }
}

export const hashSessionToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export type AuthenticatedSessionUser = IdentityUser
export type { SessionKind } from './identity.repository.js'

export type SessionService = ReturnType<typeof createSessionService>

export const createSessionService = (
  repository: IdentityRepository,
  transactions: AuthTransactionRepository,
  options: { sessionTtlSeconds: number, now?: () => Date, createToken?: () => Buffer },
) => {
  const now = options.now ?? (() => new Date())
  const createToken = options.createToken ?? (() => randomBytes(32))

  const login = async (phoneInput: string, password: string, requiredRole: 'user' | 'admin', kind: SessionKind) => {
      let phoneNormalized: string | undefined
      try {
        phoneNormalized = normalizeMainlandChinaMobile(phoneInput)
      } catch {
        // Continue through the same dummy hash path as an unknown account.
      }

      const user = phoneNormalized
        ? await repository.findUserByPhoneNormalized(phoneNormalized)
        : null
      const passwordMatches = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH)
      if (!user || !passwordMatches) throw new AuthenticationError('invalid_credentials')
      if (user.role !== requiredRole || user.disabledAt !== null || user.passwordResetRequiredAt != null) {
        throw new AuthenticationError(requiredRole === 'admin' ? 'forbidden' : 'invalid_credentials')
      }

      const issuedAt = now()
      const token = createToken().toString('hex')
      const expiresAt = new Date(issuedAt.getTime() + options.sessionTtlSeconds * 1_000)
      try {
        await transactions.rotateSessionAndAudit({
          userId: user.id,
          expectedPasswordHash: user.passwordHash,
          requiredRole,
          tokenHash: hashSessionToken(token),
          kind,
          expiresAt,
          revokedAt: issuedAt,
          audit: {
            actorUserId: user.id,
            action: kind === 'cli' || kind === 'admin_cli' ? 'auth.cli_login_succeeded' : 'auth.login_succeeded',
            entityType: 'session',
            metadata: kind === 'cli' || kind === 'admin_cli'
              ? { clientKind: 'cli' }
              : { authenticationMethod: 'password' },
          },
        })
      } catch (error) {
        if (error instanceof SessionRotationRejectedError) {
          throw new AuthenticationError(error.reason === 'inactive' && requiredRole === 'admin' ? 'forbidden' : 'invalid_credentials')
        }
        throw error
      }

      const publicUser: AuthenticatedUser = {
        id: user.id,
        displayName: user.displayName,
        role: user.role,
      }
      return { token, expiresAt, user: publicUser }
  }

  return {
    loginAdmin: (phoneInput: string, password: string) => login(phoneInput, password, 'admin', 'admin_web'),

    loginAdminWeb: (phoneInput: string, password: string) => login(phoneInput, password, 'admin', 'admin_web'),

    loginAdminCli: (phoneInput: string, password: string) => login(phoneInput, password, 'admin', 'admin_cli'),

    loginStudent: (phoneInput: string, password: string) => login(phoneInput, password, 'user', 'web'),

    loginStudentWeb: (phoneInput: string, password: string) => login(phoneInput, password, 'user', 'web'),

    loginStudentCli: (phoneInput: string, password: string) => login(phoneInput, password, 'user', 'cli'),

    resolve: async (token: string | undefined, allowedKinds?: readonly SessionKind[]): Promise<AuthenticatedSessionUser> => {
      if (!token) throw new AuthenticationError('unauthorized')
      const session = await repository.findSessionByTokenHash(hashSessionToken(token))
      const effectiveKind = session?.kind ?? (session?.user.role === 'admin' ? 'admin_web' : 'web')
      if (!session || session.revokedAt !== null || session.expiresAt.getTime() <= now().getTime() || (allowedKinds && !allowedKinds.includes(effectiveKind))) {
        throw new AuthenticationError('unauthorized')
      }
      if (session.user.disabledAt !== null || !['user', 'admin'].includes(session.user.role)) {
        await repository.revokeSessionByTokenHash(session.tokenHash, now())
        throw new AuthenticationError(session.user.disabledAt !== null ? 'account_disabled' : 'unauthorized')
      }
      if (session.user.passwordResetRequiredAt != null) {
        await repository.revokeSessionByTokenHash(session.tokenHash, now())
        throw new AuthenticationError('unauthorized')
      }
      return session.user
    },

    logout: async (token: string | undefined) => {
      if (token) await repository.revokeSessionByTokenHash(hashSessionToken(token), now())
    },

    logoutCli: async (token: string | undefined) => {
      if (!token) return
      const tokenHash = hashSessionToken(token)
      const session = await repository.findSessionByTokenHash(tokenHash)
      if (!session || !session.kind || !['cli', 'admin_cli'].includes(session.kind)) throw new AuthenticationError('unauthorized')
      const audit = {
        actorUserId: session.user.id,
        action: 'auth.cli_logout',
        entityType: 'session',
        metadata: { clientKind: 'cli' },
      } as const
      await transactions.revokeSessionAndAudit({ tokenHash, revokedAt: now(), audit })
    },
  }
}
