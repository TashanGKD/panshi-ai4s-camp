import { and, asc, eq, inArray, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '../../db/schema.js'
import { applications, applicationFiles, files, fileStorageRecoveries } from '../../db/schema.js'
import { appendAuditLog } from '../audit/audit.repository.js'

export type FileLifecycleState = 'active' | 'deleting' | 'delete_failed' | 'deleted'

export type FileRecord = {
  id: string
  storageKey: string
  originalName: string
  mimeType: string
  sizeBytes: number
  sha256: string
  uploadedBy: string | null
  ownerUserId: string | null
  purpose: 'registration_attachment' | 'resource' | 'legacy'
  visibility: 'owner_admin' | 'public' | 'authenticated' | 'admitted'
  attachmentSlot: string | null
  hiddenAt: Date | null
  deletedAt: Date | null
  lifecycleState: FileLifecycleState
  deleteFailureCode: string | null
  createdAt: Date
}

export type NewFileRecord = Omit<FileRecord, 'id' | 'hiddenAt' | 'deletedAt' | 'lifecycleState' | 'deleteFailureCode' | 'createdAt'>
export type FileMutationResult = { kind: 'updated', record: FileRecord } | { kind: 'locked' } | { kind: 'unavailable' }

export type FileRepository = {
  beginUploadRecovery: (storageKey: string, actorUserId: string) => Promise<{ id: string }>
  finalizeUploadWithAudit: (recoveryId: string, record: NewFileRecord, actorUserId: string) => Promise<FileRecord>
  clearUploadRecovery: (recoveryId: string) => Promise<void>
  recordUploadStorageFailure: (recoveryId: string, actorUserId: string, failureCode: string) => Promise<void>
  markUploadCleanupFailed: (recoveryId: string, actorUserId: string, failureCode: string) => Promise<void>
  findById: (id: string) => Promise<FileRecord | null>
  hideWithAudit: (id: string, actor: { id: string, role: 'user' | 'admin' }) => Promise<FileMutationResult>
  beginDeleteWithAudit: (id: string, actor: { id: string, role: 'user' | 'admin' }) => Promise<FileMutationResult>
  markDeleteFailedWithAudit: (id: string, actorUserId: string, failureCode: string) => Promise<FileRecord | null>
  markDeletedWithAudit: (id: string, actorUserId: string) => Promise<FileRecord | null>
}

export const createFileRepository = (db: NodePgDatabase<typeof schema>): FileRepository => ({
  beginUploadRecovery: async (storageKey, actorUserId) => {
    const [recovery] = await db.insert(fileStorageRecoveries).values({ storageKey, actorUserId }).returning({ id: fileStorageRecoveries.id })
    if (!recovery) throw new Error('File upload recovery insert did not return a row')
    return recovery
  },

  finalizeUploadWithAudit: (recoveryId, record, actorUserId) => db.transaction(async (transaction) => {
    const [created] = await transaction.insert(files).values(record).returning()
    if (!created) throw new Error('File metadata insert did not return a row')
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId,
      action: 'file.uploaded',
      entityType: 'file',
      entityId: created.id,
      metadata: {
        purpose: created.purpose,
        visibility: created.visibility,
        mimeType: created.mimeType,
        sizeBytes: created.sizeBytes,
        attachmentSlot: created.attachmentSlot,
      },
    })
    const [consumedRecovery] = await transaction.delete(fileStorageRecoveries).where(and(
      eq(fileStorageRecoveries.id, recoveryId),
      eq(fileStorageRecoveries.storageKey, record.storageKey),
      eq(fileStorageRecoveries.state, 'pending'),
    )).returning({ id: fileStorageRecoveries.id })
    if (!consumedRecovery) throw new Error('Matching file upload recovery row is missing')
    return created
  }),

  clearUploadRecovery: async (recoveryId) => {
    await db.delete(fileStorageRecoveries).where(eq(fileStorageRecoveries.id, recoveryId))
  },

  recordUploadStorageFailure: (recoveryId, actorUserId, failureCode) => db.transaction(async (transaction) => {
    const [recovery] = await transaction.update(fileStorageRecoveries).set({ updatedAt: new Date() })
      .where(eq(fileStorageRecoveries.id, recoveryId)).returning({ id: fileStorageRecoveries.id })
    if (!recovery) throw new Error('File upload recovery row is missing')
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId,
      action: 'file.storage_rejected',
      entityType: 'file_storage_recovery',
      entityId: recovery.id,
      metadata: { failureCode },
    })
  }),

  markUploadCleanupFailed: (recoveryId, actorUserId, failureCode) => db.transaction(async (transaction) => {
    const [recovery] = await transaction.update(fileStorageRecoveries).set({
      state: 'delete_failed', failureCode, updatedAt: new Date(),
    }).where(and(eq(fileStorageRecoveries.id, recoveryId), eq(fileStorageRecoveries.state, 'pending')))
      .returning({ id: fileStorageRecoveries.id })
    if (!recovery) throw new Error('File upload recovery row is missing')
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId,
      action: 'file.upload_cleanup_failed',
      entityType: 'file_storage_recovery',
      entityId: recovery.id,
      metadata: { failureCode },
    })
  }),

  findById: async (id) => {
    const [record] = await db.select().from(files).where(eq(files.id, id)).limit(1)
    return record ?? null
  },

  hideWithAudit: (id, actor) => db.transaction(async (transaction) => {
    const linkedApplications = await transaction.select({ id: applications.id, status: applications.status, slot: applicationFiles.attachmentSlot, editableSlots: applications.supplementEditableAttachmentIds }).from(applicationFiles)
      .innerJoin(applications, eq(applications.id, applicationFiles.applicationId))
      .where(eq(applicationFiles.fileId, id)).orderBy(asc(applications.id)).for('update', { of: applications })
    const [lockedFile] = await transaction.select().from(files).where(eq(files.id, id)).for('update')
    if (!lockedFile || lockedFile.lifecycleState !== 'active' || lockedFile.hiddenAt !== null || lockedFile.deletedAt !== null
      || (actor.role !== 'admin' && lockedFile.ownerUserId !== actor.id)) return { kind: 'unavailable' }
    if (linkedApplications.some((application) => application.status !== 'draft' && !(application.status === 'needs_supplement' && application.editableSlots.includes(application.slot)))) return { kind: 'locked' }
    const [record] = await transaction.update(files).set({ hiddenAt: new Date() })
      .where(and(eq(files.id, id), eq(files.lifecycleState, 'active'), isNull(files.hiddenAt), isNull(files.deletedAt))).returning()
    if (!record) return { kind: 'unavailable' }
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId: actor.id,
      action: 'file.hidden',
      entityType: 'file',
      entityId: id,
      metadata: { purpose: record.purpose, visibility: record.visibility },
    })
    return { kind: 'updated', record }
  }),

  beginDeleteWithAudit: (id, actor) => db.transaction(async (transaction) => {
    const linkedApplications = await transaction.select({ id: applications.id, status: applications.status, slot: applicationFiles.attachmentSlot, editableSlots: applications.supplementEditableAttachmentIds }).from(applicationFiles)
      .innerJoin(applications, eq(applications.id, applicationFiles.applicationId))
      .where(eq(applicationFiles.fileId, id)).orderBy(asc(applications.id)).for('update', { of: applications })
    const [lockedFile] = await transaction.select().from(files).where(eq(files.id, id)).for('update')
    if (!lockedFile || lockedFile.deletedAt !== null || !['active', 'deleting', 'delete_failed'].includes(lockedFile.lifecycleState)
      || (actor.role !== 'admin' && lockedFile.ownerUserId !== actor.id)) return { kind: 'unavailable' }
    if (linkedApplications.some((application) => application.status !== 'draft' && !(application.status === 'needs_supplement' && application.editableSlots.includes(application.slot)))) return { kind: 'locked' }
    const [record] = await transaction.update(files).set({ lifecycleState: 'deleting', deleteFailureCode: null })
      .where(and(eq(files.id, id), isNull(files.deletedAt), inArray(files.lifecycleState, ['active', 'deleting', 'delete_failed']))).returning()
    if (!record) return { kind: 'unavailable' }
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId: actor.id,
      action: 'file.delete_started',
      entityType: 'file',
      entityId: id,
      metadata: { purpose: record.purpose, visibility: record.visibility },
    })
    return { kind: 'updated', record }
  }),

  markDeleteFailedWithAudit: (id, actorUserId, failureCode) => db.transaction(async (transaction) => {
    const [record] = await transaction.update(files).set({ lifecycleState: 'delete_failed', deleteFailureCode: failureCode })
      .where(and(eq(files.id, id), eq(files.lifecycleState, 'deleting'), isNull(files.deletedAt))).returning()
    if (!record) return null
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId,
      action: 'file.delete_failed',
      entityType: 'file',
      entityId: id,
      metadata: { failureCode },
    })
    return record
  }),

  markDeletedWithAudit: (id, actorUserId) => db.transaction(async (transaction) => {
    const [record] = await transaction.update(files).set({
      lifecycleState: 'deleted', deleteFailureCode: null, deletedAt: new Date(),
    }).where(and(eq(files.id, id), eq(files.lifecycleState, 'deleting'), isNull(files.deletedAt))).returning()
    if (!record) return null
    await appendAuditLog(transaction as NodePgDatabase<typeof schema>, {
      actorUserId,
      action: 'file.deleted',
      entityType: 'file',
      entityId: id,
      metadata: { purpose: record.purpose, visibility: record.visibility },
    })
    return record
  }),
})
