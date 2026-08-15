import { and, asc, count, desc, eq, gte, ilike, isNull, lt, or, sql } from 'drizzle-orm'
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
    listStudents: async (search?: string): Promise<AdminRecord[]> => db.select(adminSelection).from(users).where(and(eq(users.role, 'user'), search ? or(ilike(users.displayName, `%${search}%`), ilike(users.phoneNormalized, `%${search}%`)) : undefined)).orderBy(desc(users.createdAt), desc(users.id)).limit(200),
    updateOwnDisplayName: async (input: { actorId: string, displayName: string }) => {
      try {
        return await db.transaction(async (transaction) => {
          const [updated] = await transaction.update(users).set({ displayName: input.displayName }).where(and(eq(users.id, input.actorId), eq(users.role, 'admin'), isNull(users.disabledAt))).returning(adminSelection)
          if (!updated) return 'actor_invalid' as const
          await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: input.actorId, action: 'admin.profile_updated', entityType: 'user', entityId: input.actorId, metadata: { changedFields: ['displayName'] } })
          return updated
        })
      } catch (error) {
        const candidate = databaseError(error)
        if (candidate.code === '23505' && candidate.constraint === 'users_admin_display_name_unique') return 'name_conflict' as const
        throw error
      }
    },
    changeOwnPassword: async (input: { actorId: string, expectedPasswordHash: string, passwordHash: string, changedAt: Date }) => db.transaction(async (transaction) => {
      const [actor] = await transaction.select({ id: users.id, passwordHash: users.passwordHash, disabledAt: users.disabledAt }).from(users).where(eq(users.id, input.actorId)).for('update')
      if (!actor || actor.disabledAt || actor.passwordHash !== input.expectedPasswordHash) return 'actor_invalid' as const
      await transaction.update(users).set({ passwordHash: input.passwordHash }).where(eq(users.id, actor.id))
      const revoked = await transaction.update(sessions).set({ revokedAt: input.changedAt }).where(and(eq(sessions.userId, actor.id), isNull(sessions.revokedAt))).returning({ id: sessions.id })
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: actor.id, action: 'auth.password_changed', entityType: 'user', entityId: actor.id, metadata: { revokedSessionCount: revoked.length } })
      return 'changed' as const
    }),
    setStudentDisabled: async (input: { targetId: string, actorId: string, disabled: boolean, changedAt: Date }) => db.transaction(async (transaction) => {
      if (!await actorIsActive(transaction as NodePgDatabase<typeof schema>, input.actorId)) return 'actor_invalid' as const
      const [target] = await transaction.select(adminSelection).from(users).where(and(eq(users.id, input.targetId), eq(users.role, 'user'))).for('update')
      if (!target) return 'not_found' as const
      const [updated] = await transaction.update(users).set({ disabledAt: input.disabled ? input.changedAt : null }).where(eq(users.id, target.id)).returning(adminSelection)
      if (input.disabled) await transaction.update(sessions).set({ revokedAt: input.changedAt }).where(and(eq(sessions.userId, target.id), isNull(sessions.revokedAt)))
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: input.actorId, action: input.disabled ? 'student.disabled' : 'student.enabled', entityType: 'user', entityId: target.id, metadata: { result: 'success' } })
      return updated!
    }),
    forceStudentPasswordReset: async (input: { targetId: string, actorId: string, changedAt: Date }) => db.transaction(async (transaction) => {
      if (!await actorIsActive(transaction as NodePgDatabase<typeof schema>, input.actorId)) return 'actor_invalid' as const
      const [target] = await transaction.select(adminSelection).from(users).where(and(eq(users.id, input.targetId), eq(users.role, 'user'))).for('update')
      if (!target) return 'not_found' as const
      await transaction.update(users).set({ passwordResetRequiredAt: input.changedAt }).where(eq(users.id, target.id))
      const revoked = await transaction.update(sessions).set({ revokedAt: input.changedAt }).where(and(eq(sessions.userId, target.id), isNull(sessions.revokedAt))).returning({ id: sessions.id })
      await appendAuditLog(transaction as NodePgDatabase<typeof schema>, { actorUserId: input.actorId, action: 'student.password_reset_required', entityType: 'user', entityId: target.id, metadata: { revokedSessionCount: revoked.length, resetMethod: 'verification_code' } })
      return target
    }),
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
