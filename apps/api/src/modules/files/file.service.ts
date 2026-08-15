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
    visibility?: 'public' | 'authenticated' | 'admitted'
  }, actor: AuthenticatedSessionUser) => {
    if (actor.disabledAt !== null) throw new FileServiceError(403, 'ACCOUNT_DISABLED', '账号已停用')
    const name = validateOriginalFileName(input.originalName)
    if (input.mimeType !== name.mime) {
      throw new FileServiceError(415, 'FILE_MIME_MISMATCH', '文件类型与扩展名不一致')
    }
    if (!['registration_attachment', 'resource'].includes(input.purpose)) {
      throw new FileServiceError(422, 'FILE_PURPOSE_INVALID', '附件用途无效')
    }
    if (input.purpose === 'resource' && actor.role !== 'admin') throw new FileServiceError(404, 'FILE_NOT_AVAILABLE', '文件不存在或不可访问')
    if (input.purpose === 'resource' && !input.visibility) throw new FileServiceError(422, 'FILE_VISIBILITY_INVALID', '资料访问范围无效')
    if (input.purpose === 'registration_attachment' && input.visibility) throw new FileServiceError(422, 'FILE_VISIBILITY_INVALID', '附件访问范围无效')
    if (input.attachmentSlot !== undefined && !/^(?:[a-z][a-z0-9_-]{0,63}|[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/u.test(input.attachmentSlot)) {
      throw new FileServiceError(422, 'FILE_ATTACHMENT_SLOT_INVALID', '附件项标识无效')
    }

    const storageKey = storage.createStorageKey()
    const recovery = await repository.beginUploadRecovery(storageKey, actor.id)
    let stored
    try {
      stored = await storage.put(input.stream, { mime: input.mimeType, size: input.sizeBytes }, storageKey)
    } catch (error) {
      const failureCode = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
        ? error.code
        : undefined
      const recoveryRequired = typeof error === 'object' && error !== null && 'recoveryRequired' in error && error.recoveryRequired === true
      if (failureCode?.startsWith('FILE_STORAGE_')) {
        let audited = false
        try {
          await repository.recordUploadStorageFailure(recovery.id, actor.id, failureCode)
          audited = true
        } catch {
          // Keep the pending recovery row when the audit transaction is unavailable.
        }
        if (!audited) throw error
      }
      if (recoveryRequired) {
        await repository.markUploadCleanupFailed(
          recovery.id,
          actor.id,
          'FILE_STORAGE_TARGET_CLEANUP_FAILED',
        ).catch(() => undefined)
      } else {
        await repository.clearUploadRecovery(recovery.id).catch(() => undefined)
      }
      throw error
    }
    try {
      const record = await repository.finalizeUploadWithAudit(recovery.id, {
        storageKey: stored.storageKey,
        originalName: name.originalName,
        mimeType: stored.mime,
        sizeBytes: stored.size,
        sha256: stored.sha256,
        uploadedBy: actor.id,
        ownerUserId: actor.id,
        purpose: input.purpose as 'registration_attachment' | 'resource',
        visibility: input.purpose === 'resource' ? input.visibility! : 'owner_admin',
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
      try {
        await storage.remove(stored.storageKey)
        await repository.clearUploadRecovery(recovery.id).catch(() => undefined)
      } catch {
        await repository.markUploadCleanupFailed(
          recovery.id,
          actor.id,
          'FILE_STORAGE_DELETE_FAILED',
        ).catch(() => undefined)
      }
      throw error
    }
  },

  openForDownload: async (id: string, actor: AuthenticatedSessionUser) => {
    const record = await repository.findById(id)
    if (!record || record.lifecycleState !== 'active' || record.hiddenAt !== null || record.deletedAt !== null || !canManage(record, actor)) throw unavailable()
    try {
      return { record, stream: await storage.open(record.storageKey) }
    } catch {
      throw unavailable()
    }
  },

  openPublishedResource: async (id: string) => {
    const record = await repository.findById(id)
    if (!record || record.purpose !== 'resource' || record.lifecycleState !== 'active' || record.hiddenAt !== null || record.deletedAt !== null) throw unavailable()
    try {
      return { record, stream: await storage.open(record.storageKey) }
    } catch {
      throw unavailable()
    }
  },

  hide: async (id: string, actor: AuthenticatedSessionUser) => {
    if (actor.disabledAt !== null) throw new FileServiceError(403, 'ACCOUNT_DISABLED', '账号已停用')
    const result = await repository.hideWithAudit(id, actor)
    if (result.kind === 'locked') throw new FileServiceError(409, 'FILE_LOCKED_BY_APPLICATION', '已提交报名的附件不能修改')
    if (result.kind === 'unavailable') throw unavailable()
  },

  remove: async (id: string, actor: AuthenticatedSessionUser) => {
    if (actor.disabledAt !== null) throw new FileServiceError(403, 'ACCOUNT_DISABLED', '账号已停用')
    const result = await repository.beginDeleteWithAudit(id, actor)
    if (result.kind === 'locked') throw new FileServiceError(409, 'FILE_LOCKED_BY_APPLICATION', '已提交报名的附件不能修改')
    if (result.kind === 'unavailable') throw unavailable()
    const deleting = result.record
    try {
      await storage.remove(deleting.storageKey)
    } catch {
      await repository.markDeleteFailedWithAudit(
        id,
        actor.id,
        'FILE_STORAGE_DELETE_FAILED',
      ).catch(() => undefined)
      throw new FileServiceError(503, 'FILE_DELETE_FAILED', '文件删除失败，请稍后重试')
    }
    if (!await repository.markDeletedWithAudit(id, actor.id)) {
      throw new FileServiceError(503, 'FILE_DELETE_FINALIZE_FAILED', '文件删除状态更新失败，请稍后重试')
    }
  },
})
