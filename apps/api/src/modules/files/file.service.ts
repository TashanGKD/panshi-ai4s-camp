import type { Readable } from 'node:stream'
import type { AuthenticatedSessionUser } from '../identity/session.service.js'
import type { FileStorage } from './file-storage.js'
import { validateOriginalFileName } from './file-validation.js'
import type { FileRecord, FileRepository } from './file.repository.js'

export class FileServiceError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'FileServiceError'
  }
}

const unavailable = () => new FileServiceError(404, 'FILE_NOT_AVAILABLE', '文件不存在或不可访问')

const canManage = (record: FileRecord, actor: AuthenticatedSessionUser) => (
  actor.disabledAt === null && (actor.role === 'admin' || record.ownerUserId === actor.id)
)

export type FileService = ReturnType<typeof createFileService>

export const createFileService = (repository: FileRepository, storage: FileStorage) => ({
  upload: async (input: {
    stream: Readable
    originalName: string
    mimeType: string
    sizeBytes: number
    purpose: string
    attachmentSlot?: string
  }, actor: AuthenticatedSessionUser) => {
    if (actor.disabledAt !== null) throw new FileServiceError(403, 'ACCOUNT_DISABLED', '账号已停用')
    const name = validateOriginalFileName(input.originalName)
    if (input.mimeType !== name.mime) {
      throw new FileServiceError(415, 'FILE_MIME_MISMATCH', '文件类型与扩展名不一致')
    }
    if (input.purpose !== 'registration_attachment') {
      throw new FileServiceError(422, 'FILE_PURPOSE_INVALID', '附件用途无效')
    }
    if (input.attachmentSlot !== undefined && !/^[a-z][a-z0-9_-]{0,63}$/u.test(input.attachmentSlot)) {
      throw new FileServiceError(422, 'FILE_ATTACHMENT_SLOT_INVALID', '附件项标识无效')
    }

    const stored = await storage.put(input.stream, { mime: input.mimeType, size: input.sizeBytes })
    try {
      const record = await repository.createWithAudit({
        storageKey: stored.storageKey,
        originalName: name.originalName,
        mimeType: stored.mime,
        sizeBytes: stored.size,
        sha256: stored.sha256,
        uploadedBy: actor.id,
        ownerUserId: actor.id,
        purpose: 'registration_attachment',
        visibility: 'owner_admin',
        attachmentSlot: input.attachmentSlot ?? null,
      }, actor.id)
      return {
        id: record.id,
        originalName: record.originalName,
        mimeType: record.mimeType,
        sizeBytes: record.sizeBytes,
        purpose: record.purpose,
        attachmentSlot: record.attachmentSlot,
      }
    } catch (error) {
      await storage.remove(stored.storageKey).catch(() => undefined)
      throw error
    }
  },

  openForDownload: async (id: string, actor: AuthenticatedSessionUser) => {
    const record = await repository.findById(id)
    if (!record || record.hiddenAt !== null || record.deletedAt !== null || !canManage(record, actor)) throw unavailable()
    try {
      return { record, stream: await storage.open(record.storageKey) }
    } catch {
      throw unavailable()
    }
  },

  hide: async (id: string, actor: AuthenticatedSessionUser) => {
    const record = await repository.findById(id)
    if (!record || record.hiddenAt !== null || record.deletedAt !== null || !canManage(record, actor)) throw unavailable()
    if (!await repository.hideWithAudit(id, actor.id)) throw unavailable()
  },

  remove: async (id: string, actor: AuthenticatedSessionUser) => {
    const record = await repository.findById(id)
    if (!record || record.deletedAt !== null || !canManage(record, actor)) throw unavailable()
    const deleted = await repository.markDeletedWithAudit(id, actor.id)
    if (!deleted) throw unavailable()
    await storage.remove(record.storageKey).catch(() => undefined)
  },
})
