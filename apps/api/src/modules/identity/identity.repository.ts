import { and, eq, isNull, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { UserRole } from '@panshi/contracts'
import { auditLogs, sessions, users } from '../../db/schema.js'
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
): IdentityRepository & AuthTransactionRepository & AdminCreationRepository => ({
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
})
