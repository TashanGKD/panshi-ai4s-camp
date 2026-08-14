import { and, eq, isNull } from 'drizzle-orm'
import type { NodePgDatabase } from 'drizzle-orm/node-postgres'
import type * as schema from '../../db/schema.js'
import { auditLogs, files } from '../../db/schema.js'

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
  createdAt: Date
}

export type NewFileRecord = Omit<FileRecord, 'id' | 'hiddenAt' | 'deletedAt' | 'createdAt'>

export type FileRepository = {
  createWithAudit: (record: NewFileRecord, actorUserId: string) => Promise<FileRecord>
  findById: (id: string) => Promise<FileRecord | null>
  hideWithAudit: (id: string, actorUserId: string) => Promise<FileRecord | null>
  markDeletedWithAudit: (id: string, actorUserId: string) => Promise<FileRecord | null>
}

export const createFileRepository = (db: NodePgDatabase<typeof schema>): FileRepository => ({
  createWithAudit: (record, actorUserId) => db.transaction(async (transaction) => {
    const [created] = await transaction.insert(files).values(record).returning()
    if (!created) throw new Error('File metadata insert did not return a row')
    await transaction.insert(auditLogs).values({
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
    return created
  }),

  findById: async (id) => {
    const [record] = await db.select().from(files).where(eq(files.id, id)).limit(1)
    return record ?? null
  },

  hideWithAudit: (id, actorUserId) => db.transaction(async (transaction) => {
    const [record] = await transaction.update(files).set({ hiddenAt: new Date() })
      .where(and(eq(files.id, id), isNull(files.hiddenAt), isNull(files.deletedAt))).returning()
    if (!record) return null
    await transaction.insert(auditLogs).values({
      actorUserId,
      action: 'file.hidden',
      entityType: 'file',
      entityId: id,
      metadata: { purpose: record.purpose, visibility: record.visibility },
    })
    return record
  }),

  markDeletedWithAudit: (id, actorUserId) => db.transaction(async (transaction) => {
    const [record] = await transaction.update(files).set({ deletedAt: new Date() })
      .where(and(eq(files.id, id), isNull(files.deletedAt))).returning()
    if (!record) return null
    await transaction.insert(auditLogs).values({
      actorUserId,
      action: 'file.deleted',
      entityType: 'file',
      entityId: id,
      metadata: { purpose: record.purpose, visibility: record.visibility },
    })
    return record
  }),
})
