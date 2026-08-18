import { randomUUID } from 'node:crypto'
import { and, eq, sql } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import { ApplicationCoreFieldsSchema } from '@panshi/contracts'
import {
  applications,
  checkInCredentials,
  checkIns,
  users,
} from '../../db/schema.js'
import type * as schema from '../../db/schema.js'
import { appendAuditLog } from '../audit/audit.repository.js'
import type { CheckInContext, CheckInRepository } from './check-in.service.js'

export const createCheckInRepository = (
  db: NodePgDatabase<typeof schema>,
  options: { now?: () => Date, createPublicId?: () => string } = {},
): CheckInRepository => {
  const now = options.now ?? (() => new Date())
  const createPublicId = options.createPublicId ?? randomUUID

  const readContext = async (database: NodePgDatabase<typeof schema>, applicationId: string): Promise<CheckInContext | null> => {
    const [row] = await database.select({
      applicationId: applications.id,
      applicationStatus: applications.status,
      coreFields: applications.coreFields,
      phone: users.phoneNormalized,
      credentialId: checkInCredentials.id,
      credentialPublicId: checkInCredentials.publicId,
      credentialRevision: checkInCredentials.revision,
      credentialRevokedAt: checkInCredentials.revokedAt,
      checkInId: checkIns.id,
      checkInActive: checkIns.active,
      confirmedAt: checkIns.confirmedAt,
      confirmedBy: checkIns.confirmedBy,
      checkInRevokedAt: checkIns.revokedAt,
      revokeReason: checkIns.revokeReason,
      checkInRevision: checkIns.revision,
    }).from(applications)
      .innerJoin(users, eq(users.id, applications.userId))
      .leftJoin(checkInCredentials, eq(checkInCredentials.applicationId, applications.id))
      .leftJoin(checkIns, eq(checkIns.applicationId, applications.id))
      .where(eq(applications.id, applicationId)).limit(1)
    if (!row) return null
    const profile = ApplicationCoreFieldsSchema.parse({ ...(row.coreFields as Record<string, unknown>), phone: row.phone })
    let confirmedByName: string | null = null
    if (row.confirmedBy) {
      const [actor] = await database.select({ displayName: users.displayName }).from(users).where(eq(users.id, row.confirmedBy)).limit(1)
      confirmedByName = actor?.displayName ?? '管理员'
    }
    return {
      applicationId: row.applicationId,
      applicationStatus: row.applicationStatus,
      profile: {
        name: profile.name,
        phone: profile.phone,
        organization: profile.organization,
        department: profile.department,
        identityType: profile.identityType,
      },
      credential: row.credentialId && row.credentialPublicId ? {
        id: row.credentialId,
        applicationId: row.applicationId,
        publicId: row.credentialPublicId,
        revision: row.credentialRevision ?? 0,
        revokedAt: row.credentialRevokedAt,
      } : null,
      checkIn: row.checkInId && row.confirmedAt && confirmedByName ? {
        id: row.checkInId,
        active: row.checkInActive ?? false,
        confirmedAt: row.confirmedAt,
        confirmedByName,
        revokedAt: row.checkInRevokedAt,
        revokeReason: row.revokeReason,
        revision: row.checkInRevision ?? 0,
      } : null,
    }
  }

  return {
    findStudentContext: async (userId) => {
      const [application] = await db.select({ id: applications.id }).from(applications).where(eq(applications.userId, userId)).limit(1)
      return application ? readContext(db, application.id) : null
    },

    ensureCredential: (applicationId, actorUserId) => db.transaction(async (transaction) => {
      const [application] = await transaction.select({ id: applications.id, status: applications.status })
        .from(applications).where(eq(applications.id, applicationId)).for('update')
      if (!application || application.status !== 'admitted') throw new Error('CHECK_IN_NOT_ADMITTED')
      const [existing] = await transaction.select().from(checkInCredentials).where(eq(checkInCredentials.applicationId, applicationId)).for('update')
      if (existing && !existing.revokedAt) return existing
      const issuedAt = now()
      const [issued] = existing
        ? await transaction.update(checkInCredentials).set({ publicId: createPublicId(), revokedAt: null, revision: sql`${checkInCredentials.revision} + 1`, updatedAt: issuedAt }).where(eq(checkInCredentials.id, existing.id)).returning()
        : await transaction.insert(checkInCredentials).values({ applicationId, publicId: createPublicId(), createdAt: issuedAt, updatedAt: issuedAt }).returning()
      if (!issued) throw new Error('CHECK_IN_CREDENTIAL_ISSUE_FAILED')
      await appendAuditLog(transaction, {
        actorUserId,
        action: 'check_in.credential_issued',
        entityType: 'check_in_credential',
        entityId: issued.id,
        metadata: { applicationId, revision: issued.revision },
      })
      return issued
    }),

    findByPublicId: async (publicId) => {
      const [credential] = await db.select({ applicationId: checkInCredentials.applicationId }).from(checkInCredentials).where(eq(checkInCredentials.publicId, publicId)).limit(1)
      return credential ? readContext(db, credential.applicationId) : null
    },

    recordRepeatedLookup: async ({ checkInId, applicationId, credentialId, adminId, revision }) => {
      await appendAuditLog(db, {
        actorUserId: adminId,
        action: 'check_in.repeated_lookup',
        entityType: 'check_in',
        entityId: checkInId,
        metadata: { applicationId, credentialId, revision },
      })
    },

    confirm: (input) => db.transaction(async (transaction) => {
      const [credential] = await transaction.select({
        id: checkInCredentials.id,
        applicationId: checkInCredentials.applicationId,
        credentialRevision: checkInCredentials.revision,
        revokedAt: checkInCredentials.revokedAt,
        status: applications.status,
      }).from(checkInCredentials).innerJoin(applications, eq(applications.id, checkInCredentials.applicationId))
        .where(eq(checkInCredentials.id, input.credentialId)).for('update')
      if (!credential || credential.revokedAt || credential.status !== 'admitted') return null
      const [existing] = await transaction.select().from(checkIns).where(eq(checkIns.credentialId, credential.id)).for('update')
      if (existing?.active) {
        const context = await readContext(transaction, credential.applicationId)
        return context ? { ...context, duplicate: true } : null
      }
      const confirmedAt = now()
      const [saved] = existing
        ? input.expectedRevision === existing.revision
          ? await transaction.update(checkIns).set({ active: true, revokedAt: null, revokedBy: null, revokeReason: null, revision: sql`${checkIns.revision} + 1`, updatedAt: confirmedAt }).where(and(eq(checkIns.id, existing.id), eq(checkIns.revision, input.expectedRevision))).returning()
          : []
        : input.expectedRevision === credential.credentialRevision
          ? await transaction.insert(checkIns).values({ applicationId: credential.applicationId, credentialId: credential.id, active: true, confirmedAt, confirmedBy: input.adminId, createdAt: confirmedAt, updatedAt: confirmedAt }).onConflictDoNothing().returning()
          : []
      if (!saved) return null
      await appendAuditLog(transaction, {
        actorUserId: input.adminId,
        action: existing ? 'check_in.reconfirmed' : 'check_in.confirmed',
        entityType: 'check_in',
        entityId: saved.id,
        metadata: { applicationId: credential.applicationId, credentialId: credential.id, revision: saved.revision },
      })
      const context = await readContext(transaction, credential.applicationId)
      return context ? { ...context, duplicate: false } : null
    }),

    revoke: (input) => db.transaction(async (transaction) => {
      const [credential] = await transaction.select({ applicationId: checkInCredentials.applicationId, revokedAt: checkInCredentials.revokedAt, status: applications.status })
        .from(checkInCredentials).innerJoin(applications, eq(applications.id, checkInCredentials.applicationId))
        .where(eq(checkInCredentials.id, input.credentialId)).for('update')
      if (!credential || credential.revokedAt || credential.status !== 'admitted') return null
      const [existing] = await transaction.select().from(checkIns).where(eq(checkIns.credentialId, input.credentialId)).for('update')
      if (!existing || !existing.active || existing.revision !== input.expectedRevision) return null
      const revokedAt = now()
      const [saved] = await transaction.update(checkIns).set({ active: false, revokedAt, revokedBy: input.adminId, revokeReason: input.reason, revision: sql`${checkIns.revision} + 1`, updatedAt: revokedAt })
        .where(and(eq(checkIns.id, existing.id), eq(checkIns.revision, input.expectedRevision))).returning()
      if (!saved) return null
      await appendAuditLog(transaction, {
        actorUserId: input.adminId,
        action: 'check_in.revoked',
        entityType: 'check_in',
        entityId: saved.id,
        metadata: { applicationId: credential.applicationId, credentialId: input.credentialId, revision: saved.revision, reason: input.reason },
      })
      const context = await readContext(transaction, credential.applicationId)
      return context ? { ...context, duplicate: false } : null
    }),
  }
}
