import { and, eq, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type { UserRole } from '@panshi/contracts'
import { sessions, users } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'

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
  revokeActiveSessionsForUser: (userId: string, revokedAt: Date) => Promise<void>
  createSession: (session: { tokenHash: string, userId: string, expiresAt: Date }) => Promise<void>
  findSessionByTokenHash: (tokenHash: string) => Promise<ResolvedSession | null>
  revokeSessionByTokenHash: (tokenHash: string, revokedAt: Date) => Promise<void>
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
): IdentityRepository & AdminCreationRepository => ({
  findUserByPhoneNormalized: async (phoneNormalized) => {
    const [user] = await db.select(userSelection).from(users).where(eq(users.phoneNormalized, phoneNormalized)).limit(1)
    return user ?? null
  },

  revokeActiveSessionsForUser: async (userId, revokedAt) => {
    await db.update(sessions).set({ revokedAt }).where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
  },

  createSession: async ({ tokenHash, userId, expiresAt }) => {
    await db.insert(sessions).values({ tokenHash, userId, expiresAt })
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
