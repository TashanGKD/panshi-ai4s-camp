import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { UserRole } from '@panshi/contracts'
import { auditLogs, sessions, users, verificationCodes } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import type { AuditEntry } from '../audit/audit.repository.js'

export type IdentityUser = {
  id: string
  displayName: string
  phoneNormalized: string
  passwordHash: string
  role: UserRole
  disabledAt: Date | null
}

export type ResolvedSession = {
  tokenHash: string
  expiresAt: Date
  revokedAt: Date | null
  user: IdentityUser
}

export type NewAdmin = {
  displayName: string
  phoneNormalized: string
  passwordHash: string
  role: 'admin'
}

export type VerificationPurpose = 'register' | 'reset_password'

type VerificationAttemptInput = {
  phoneNormalized: string
  purpose: VerificationPurpose
  codeHash: string
  consumedAt: Date
  maxAttempts: number
}

export type StudentIdentityRepository = {
  storeVerificationCode: (input: {
    phoneNormalized: string
    purpose: VerificationPurpose
    codeHash: string
    expiresAt: Date
    createdAt: Date
    cooldownSeconds: number
  }) => Promise<'stored' | 'rate_limited'>
  registerStudentWithVerification: (input: VerificationAttemptInput & {
    displayName: string
    passwordHash: string
  }) => Promise<
    | { status: 'created', user: IdentityUser }
    | 'invalid_code'
    | 'expired'
    | 'attempts_exceeded'
    | 'consumed'
    | 'conflict'
  >
  resetPasswordWithVerification: (input: VerificationAttemptInput & {
    passwordHash: string
  }) => Promise<'reset' | 'invalid_code' | 'expired' | 'attempts_exceeded' | 'consumed' | 'invalid_account'>
}

export type IdentityRepository = {
  findUserByPhoneNormalized: (phoneNormalized: string) => Promise<IdentityUser | null>
  findSessionByTokenHash: (tokenHash: string) => Promise<ResolvedSession | null>
  revokeSessionByTokenHash: (tokenHash: string, revokedAt: Date) => Promise<void>
}

export type AuthTransactionRepository = {
  rotateSessionAndAudit: (rotation: {
    userId: string
    tokenHash: string
    expiresAt: Date
    revokedAt: Date
    audit: AuditEntry
  }) => Promise<void>
}

export type AdminCreationRepository = {
  createAdmin: (admin: NewAdmin) => Promise<void>
}

const userSelection = {
  id: users.id,
  displayName: users.displayName,
  phoneNormalized: users.phoneNormalized,
  passwordHash: users.passwordHash,
  role: users.role,
  disabledAt: users.disabledAt,
}

export const createIdentityRepository = (
  db: NodePgDatabase<typeof schema>,
): IdentityRepository & AuthTransactionRepository & AdminCreationRepository & StudentIdentityRepository => ({
  findUserByPhoneNormalized: async (phoneNormalized) => {
    const [user] = await db.select(userSelection).from(users).where(eq(users.phoneNormalized, phoneNormalized)).limit(1)
    return user ?? null
  },

  rotateSessionAndAudit: async ({ userId, tokenHash, expiresAt, revokedAt, audit }) => {
    await db.transaction(async (transaction) => {
      await transaction.execute(sql`select ${users.id} from ${users} where ${users.id} = ${userId} for update`)
      await transaction.update(sessions).set({ revokedAt })
        .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
      await transaction.insert(sessions).values({ tokenHash, userId, expiresAt })
      await transaction.insert(auditLogs).values(audit)
    })
  },

  findSessionByTokenHash: async (tokenHash) => {
    const [row] = await db.select({
      tokenHash: sessions.tokenHash,
      expiresAt: sessions.expiresAt,
      revokedAt: sessions.revokedAt,
      ...userSelection,
    }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.tokenHash, tokenHash)).limit(1)
    if (!row) return null
    return {
      tokenHash: row.tokenHash,
      expiresAt: row.expiresAt,
      revokedAt: row.revokedAt,
      user: {
        id: row.id,
        displayName: row.displayName,
        phoneNormalized: row.phoneNormalized,
        passwordHash: row.passwordHash,
        role: row.role,
        disabledAt: row.disabledAt,
      },
    }
  },

  revokeSessionByTokenHash: async (tokenHash, revokedAt) => {
    await db.update(sessions).set({ revokedAt }).where(and(eq(sessions.tokenHash, tokenHash), isNull(sessions.revokedAt)))
  },

  createAdmin: async (admin) => {
    await db.insert(users).values(admin)
  },

  storeVerificationCode: async (input) => db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${input.phoneNormalized}))`)
    const [latest] = await transaction.select({ createdAt: verificationCodes.createdAt })
      .from(verificationCodes)
      .where(eq(verificationCodes.phoneNormalized, input.phoneNormalized))
      .orderBy(desc(verificationCodes.createdAt))
      .limit(1)
    if (latest && input.createdAt.getTime() - latest.createdAt.getTime() < input.cooldownSeconds * 1_000) {
      return 'rate_limited' as const
    }
    await transaction.insert(verificationCodes).values({
      phoneNormalized: input.phoneNormalized,
      purpose: input.purpose,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      createdAt: input.createdAt,
    })
    return 'stored' as const
  }),

  registerStudentWithVerification: async (input) => {
    try {
      return await db.transaction(async (transaction) => {
        await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${input.phoneNormalized}))`)
        const [record] = await transaction.select({
          id: verificationCodes.id,
          codeHash: verificationCodes.codeHash,
          expiresAt: verificationCodes.expiresAt,
          consumedAt: verificationCodes.consumedAt,
          failedAttempts: verificationCodes.failedAttempts,
        }).from(verificationCodes).where(and(
          eq(verificationCodes.phoneNormalized, input.phoneNormalized),
          eq(verificationCodes.purpose, input.purpose),
        )).orderBy(desc(verificationCodes.createdAt)).limit(1).for('update')
        if (!record) return 'invalid_code' as const
        if (record.consumedAt !== null) return 'consumed' as const
        if (record.expiresAt.getTime() <= input.consumedAt.getTime()) return 'expired' as const
        if (record.failedAttempts >= input.maxAttempts) return 'attempts_exceeded' as const
        if (record.codeHash !== input.codeHash) {
          const failedAttempts = record.failedAttempts + 1
          await transaction.update(verificationCodes).set({ failedAttempts }).where(eq(verificationCodes.id, record.id))
          return failedAttempts >= input.maxAttempts ? 'attempts_exceeded' as const : 'invalid_code' as const
        }

        const [existing] = await transaction.select({ id: users.id }).from(users)
          .where(eq(users.phoneNormalized, input.phoneNormalized)).limit(1)
        if (existing) return 'conflict' as const

        const [user] = await transaction.insert(users).values({
          displayName: input.displayName,
          phoneNormalized: input.phoneNormalized,
          passwordHash: input.passwordHash,
          role: 'user',
        }).returning(userSelection)
        if (!user) throw new Error('Student account creation did not return a user')
        await transaction.update(verificationCodes).set({ consumedAt: input.consumedAt })
          .where(eq(verificationCodes.id, record.id))
        await transaction.insert(auditLogs).values({
          actorUserId: user.id,
          action: 'auth.student_registered',
          entityType: 'user',
          entityId: user.id,
          metadata: { authenticationMethod: 'verification_code' },
        })
        return { status: 'created' as const, user }
      })
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return 'conflict'
      throw error
    }
  },

  resetPasswordWithVerification: async (input) => db.transaction(async (transaction) => {
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${input.phoneNormalized}))`)
    const [record] = await transaction.select({
      id: verificationCodes.id,
      codeHash: verificationCodes.codeHash,
      expiresAt: verificationCodes.expiresAt,
      consumedAt: verificationCodes.consumedAt,
      failedAttempts: verificationCodes.failedAttempts,
    }).from(verificationCodes).where(and(
      eq(verificationCodes.phoneNormalized, input.phoneNormalized),
      eq(verificationCodes.purpose, input.purpose),
    )).orderBy(desc(verificationCodes.createdAt)).limit(1).for('update')
    if (!record) return 'invalid_code' as const
    if (record.consumedAt !== null) return 'consumed' as const
    if (record.expiresAt.getTime() <= input.consumedAt.getTime()) return 'expired' as const
    if (record.failedAttempts >= input.maxAttempts) return 'attempts_exceeded' as const
    if (record.codeHash !== input.codeHash) {
      const failedAttempts = record.failedAttempts + 1
      await transaction.update(verificationCodes).set({ failedAttempts }).where(eq(verificationCodes.id, record.id))
      return failedAttempts >= input.maxAttempts ? 'attempts_exceeded' as const : 'invalid_code' as const
    }

    await transaction.update(verificationCodes).set({ consumedAt: input.consumedAt })
      .where(eq(verificationCodes.id, record.id))
    const [user] = await transaction.select(userSelection).from(users)
      .where(eq(users.phoneNormalized, input.phoneNormalized)).limit(1).for('update')
    if (!user) return 'invalid_account' as const

    await transaction.update(users).set({ passwordHash: input.passwordHash }).where(eq(users.id, user.id))
    await transaction.update(sessions).set({ revokedAt: input.consumedAt })
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)))
    await transaction.insert(auditLogs).values({
      actorUserId: user.id,
      action: 'auth.password_reset',
      entityType: 'user',
      entityId: user.id,
      metadata: { revokedSessions: true },
    })
    return 'reset' as const
  }),
})
