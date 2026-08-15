import { and, asc, count, desc, eq, gte, isNull, lt, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { auditLogs, sessions, users } from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { appendAuditLog } from '../audit/audit.repository.js'

export type AdminRecord = { id: string, displayName: string, phone: string, disabledAt: Date | null, createdAt: Date }
export type AuditQuery = { actorId?: string, action?: string, entityType?: string, entityId?: string, from?: Date, toExclusive?: Date, page: number, pageSize: number }
export type AuditRecord = { id: string, actorId: string | null, actorDisplayName: string | null, action: string, entityType: string, entityId: string | null, metadata: unknown, createdAt: Date }

const adminSelection = { id: users.id, displayName: users.displayName, phone: users.phoneNormalized, disabledAt: users.disabledAt, createdAt: users.createdAt }
const adminMutationLock = sql`select pg_advisory_xact_lock(hashtext('panshi_admin_management'))`
const databaseError = (error: unknown): { code?: string, constraint?: string } => {
  if (typeof error !== 'object' || error === null) return {}
  const candidate = error as { code?: string, constraint?: string, cause?: unknown }
  return candidate.code ? candidate : databaseError(candidate.cause)
}

export const createAdminManagementRepository = (db: NodePgDatabase<typeof schema>) => {
  const actorIsActive = async (executor: NodePgDatabase<typeof schema>, actorId: string) => {
    const [actor] = await executor.select({ id: users.id }).from(users).where(and(eq(users.id, actorId), eq(users.role, 'admin'), isNull(users.disabledAt))).limit(1)
    return Boolean(actor)
  }
  const auditSelection = { id: auditLogs.id, actorId: auditLogs.actorUserId, actorDisplayName: users.displayName, action: auditLogs.action, entityType: auditLogs.entityType, entityId: auditLogs.entityId, metadata: auditLogs.metadata, createdAt: auditLogs.createdAt }

  return {
    listAdmins: async (): Promise<AdminRecord[]> => db.select(adminSelection).from(users).where(eq(users.role, 'admin')).orderBy(asc(users.createdAt), asc(users.id)),
    createAdmin: async (input: { displayName: string, phone: string, passwordHash: string, actorId: string }) => {
      try {
        return await db.transaction(async (transaction) => {
          await transaction.execute(adminMutationLock)
          if (!await actorIsActive(transaction as NodePgDatabase<typeof schema>, input.actorId)) return 'actor_invalid' as const
          const [record] = await transaction.insert(users).values({ displayName: input.displayName, phoneNormalized: input.phone, passwordHash: input.passwordHash, role: 'admin' }).returning(adminSelection)
          if (!record) throw new Error('Administrator insert returned no row')
          await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: input.actorId, action: 'admin.created', entityType: 'user', entityId: record.id, metadata: { result: 'success' } })
          return record
        })
      } catch (error) {
        const candidate = databaseError(error)
        if (candidate.code === '23505' && candidate.constraint === 'users_admin_display_name_unique') return 'name_conflict' as const
        if (candidate.code === '23505' && candidate.constraint === 'users_phone_normalized_unique') return 'phone_conflict' as const
        throw error
      }
    },
    disableAdmin: async (input: { targetId: string, actorId: string, disabledAt: Date }) => db.transaction(async (transaction) => {
      await transaction.execute(adminMutationLock)
      if (!await actorIsActive(transaction as NodePgDatabase<typeof schema>, input.actorId)) return 'actor_invalid' as const
      const [target] = await transaction.select(adminSelection).from(users).where(and(eq(users.id, input.targetId), eq(users.role, 'admin'))).for('update')
      if (!target) return 'not_found' as const
      if (target.disabledAt) return target
      const [active] = await transaction.select({ value: count() }).from(users).where(and(eq(users.role, 'admin'), isNull(users.disabledAt)))
      if ((active?.value ?? 0) <= 1) return 'last_active' as const
      const [updated] = await transaction.update(users).set({ disabledAt: input.disabledAt }).where(and(eq(users.id, target.id), isNull(users.disabledAt))).returning(adminSelection)
      if (!updated) return 'not_found' as const
      const revoked = await transaction.update(sessions).set({ revokedAt: input.disabledAt }).where(and(eq(sessions.userId, target.id), isNull(sessions.revokedAt))).returning({ id: sessions.id })
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: input.actorId, action: 'admin.disabled', entityType: 'user', entityId: target.id, metadata: { revokedSessionCount: revoked.length, result: 'success' } })
      return updated
    }),
    resetAdminPassword: async (input: { targetId: string, actorId: string, passwordHash: string, changedAt: Date }) => db.transaction(async (transaction) => {
      await transaction.execute(adminMutationLock)
      if (!await actorIsActive(transaction as NodePgDatabase<typeof schema>, input.actorId)) return 'actor_invalid' as const
      const [target] = await transaction.select(adminSelection).from(users).where(and(eq(users.id, input.targetId), eq(users.role, 'admin'), isNull(users.disabledAt))).for('update')
      if (!target) return 'not_found' as const
      await transaction.update(users).set({ passwordHash: input.passwordHash }).where(eq(users.id, target.id))
      const revoked = await transaction.update(sessions).set({ revokedAt: input.changedAt }).where(and(eq(sessions.userId, target.id), isNull(sessions.revokedAt))).returning({ id: sessions.id })
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: input.actorId, action: 'admin.password_reset', entityType: 'user', entityId: target.id, metadata: { revokedSessionCount: revoked.length, result: 'success' } })
      return target
    }),
    listAuditLogs: async (query: AuditQuery) => {
      const filters = [query.actorId ? eq(auditLogs.actorUserId, query.actorId) : undefined, query.action ? eq(auditLogs.action, query.action) : undefined, query.entityType ? eq(auditLogs.entityType, query.entityType) : undefined, query.entityId ? eq(auditLogs.entityId, query.entityId) : undefined, query.from ? gte(auditLogs.createdAt, query.from) : undefined, query.toExclusive ? lt(auditLogs.createdAt, query.toExclusive) : undefined].filter((value): value is NonNullable<typeof value> => value !== undefined)
      const where = filters.length ? and(...filters) : undefined
      const [rows, totalRows] = await Promise.all([
        db.select(auditSelection).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(where).orderBy(desc(auditLogs.createdAt), desc(auditLogs.id)).limit(query.pageSize).offset((query.page - 1) * query.pageSize),
        db.select({ value: count() }).from(auditLogs).where(where),
      ])
      return { rows, total: totalRows[0]?.value ?? 0 }
    },
    getAuditLog: async (id: string): Promise<AuditRecord | null> => {
      const [record] = await db.select(auditSelection).from(auditLogs).leftJoin(users, eq(users.id, auditLogs.actorUserId)).where(eq(auditLogs.id, id)).limit(1)
      return record ?? null
    },
  }
}

export type AdminManagementRepository = ReturnType<typeof createAdminManagementRepository>
